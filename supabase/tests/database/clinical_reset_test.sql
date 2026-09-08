begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(1);

-- Exercise the real RPCs under the authenticated role. All fixtures roll back.
insert into auth.users(id,email,raw_user_meta_data) values
 ('11000000-0000-4000-8000-000000000001','reset-admin@test.local','{"full_name":"Reset Admin"}'),
 ('11000000-0000-4000-8000-000000000002','reset-staff@test.local','{"full_name":"Reset Staff"}'),
 ('11000000-0000-4000-8000-000000000003','reset-inactive@test.local','{}');
update public.users set is_active=false where id='11000000-0000-4000-8000-000000000003';
update public.users set role='admin',is_active=true where id='11000000-0000-4000-8000-000000000001';
insert into public.patients(id,first_name,last_name,date_of_birth) values('21000000-0000-4000-8000-000000000001','Reset','Fixture','1980-01-01');
insert into public.cases(id,patient_id,case_status) values('31000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000001','active');
create temporary table reset_fixture(kind text,note_id uuid,encounter_id uuid,document_id uuid);
grant all on reset_fixture to authenticated;

do $$
declare cid uuid:='31000000-0000-4000-8000-000000000001'; eid uuid; encounter uuid; doc uuid; nid uuid; proc uuid; series uuid; k text;
begin
 select id into eid from care_episodes where case_id=cid;
 insert into procedure_series(case_id,episode_id,series_number,procedure_type,status) values(cid,eid,1,'prp','completed') returning id into series;
 foreach k in array array['initial_visit_notes','procedure_notes','discharge_notes','pain_follow_up_notes'] loop
  encounter:=null;
  if k<>'procedure_notes' then
   insert into clinical_encounters(case_id,episode_id,encounter_type,status,encounter_date,provider_intake)
   values(cid,eid,case k when 'initial_visit_notes' then 'initial_evaluation' when 'discharge_notes' then 'discharge' else 'pain_follow_up' end,'completed','2026-09-01','{"history":"retain intake"}') returning id into encounter;
  else
   insert into procedures(case_id,episode_id,procedure_series_id,procedure_date,procedure_type,procedure_name,sites) values(cid,eid,series,'2026-09-01','prp','PRP','["Lumbar"]') returning id into proc;
  end if;
  insert into documents(case_id,episode_id,encounter_id,document_type,file_name,file_path,status,uploaded_by_user_id)
  values(cid,eid,encounter,'generated',k,'cases/test/'||k||'.pdf','reviewed','11000000-0000-4000-8000-000000000001') returning id into doc;
  if k='procedure_notes' then
   insert into procedure_notes(case_id,procedure_id,status,subjective,document_id) values(cid,proc,'finalized','signed text',doc) returning id into nid;
  elsif k='initial_visit_notes' then
   insert into initial_visit_notes(case_id,episode_id,encounter_id,status,introduction,document_id,provider_intake) values(cid,eid,encounter,'finalized','signed text',doc,'{"history":"retain intake"}') returning id into nid;
  else
   execute format('insert into %I(case_id,episode_id,encounter_id,status,subjective,document_id) values($1,$2,$3,''finalized'',''signed text'',$4) returning id',k) into nid using cid,eid,encounter,doc;
  end if;
  insert into reset_fixture values(k,nid,encounter,doc);
 end loop;
 update care_episodes set status='discharged',ended_at=now(),end_reason='finalized_discharge' where id=eid;
 update cases set case_status='closed',case_close_date=current_date where id=cid;
end $$;
select set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

do $$
declare cid uuid:='31000000-0000-4000-8000-000000000001'; p jsonb; req jsonb; oid uuid; f record; n jsonb; replacement uuid; failed boolean; version timestamptz; invoice uuid; claim uuid; order_id uuid; signed_req jsonb; correction_id uuid;
begin
 -- An open documentation correction must be resolved before care reopens.
 p:=public.preview_clinical_reset(cid);
 correction_id:=public.begin_discharge_correction(cid,(p->>'episode_id')::uuid,(select note_id from reset_fixture where kind='discharge_notes'),'Correct historical wording');
 p:=public.preview_clinical_reset(cid);
 req:=jsonb_build_object('case_id',cid,'episode_id',p->>'episode_id','case_version',p->>'case_version','episode_version',p->>'episode_version','reactivate',true,'reason','Reopen this care episode','request_key',gen_random_uuid(),'notes','[]'::jsonb);
 failed:=false;
 begin perform public.apply_clinical_reset(req); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Open discharge correction allowed reactivation'; end if;
 perform public.cancel_discharge_correction(cid,(p->>'episode_id')::uuid,(select note_id from reset_fixture where kind='discharge_notes'),correction_id);
 p:=public.preview_clinical_reset(cid);
 if jsonb_array_length(p->'notes')<>4 then raise exception 'Preview omitted notes'; end if;
 req:=jsonb_build_object('case_id',cid,'episode_id',p->>'episode_id','case_version',p->>'case_version','episode_version',p->>'episode_version',
 'reactivate',true,'reason','Fresh start requested','request_key',gen_random_uuid(),'notes','[]'::jsonb);
 perform set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000003',true);
 failed:=false;
 begin perform public.apply_clinical_reset(req); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Inactive account reset records'; end if;
 perform set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
 oid:=public.apply_clinical_reset(req);
 failed:=false;
 begin perform public.apply_clinical_reset(req || jsonb_build_object('reason','Different retry input')); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Idempotency key accepted changed input'; end if;
 if public.apply_clinical_reset(req)<>oid then raise exception 'Idempotent retry changed result'; end if;
 if exists(select 1 from reset_fixture fixture join documents d on d.id=fixture.document_id where d.deleted_at is not null) then raise exception 'Reactivation deleted documentation'; end if;
 if (select status from care_episodes where id=(p->>'episode_id')::uuid)<>'active' then raise exception 'Episode not reactivated'; end if;
 if (select status from procedure_series where case_id=cid)<>'completed' then raise exception 'Reactivation changed completed treatment'; end if;
 p:=public.preview_clinical_reset(cid);
 req:=req || jsonb_build_object('case_version',p->>'case_version','episode_version',p->>'episode_version','reactivate',false,'request_key',gen_random_uuid(),
 'notes',(select jsonb_agg(jsonb_build_object('kind',x->>'kind','id',x->>'id','updated_at',x->>'updated_at')) from jsonb_array_elements(p->'notes') x));
 -- A non-admin cannot reset signed notes, including a bulk request.
 perform set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000002',true);
 failed:=false;
 begin perform public.apply_clinical_reset(req); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Non-admin reset signed records'; end if;
 perform set_config('request.jwt.claim.sub','11000000-0000-4000-8000-000000000001',true);
 -- Direct writes and old unfinalize paths cannot bypass signed-history controls.
 failed:=false;
 begin update procedure_notes set status='draft' where case_id=cid; exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Direct signed transition bypassed guard'; end if;
 failed:=false;
 begin perform public.unfinalize_pain_follow_up(cid,(select note_id from reset_fixture where kind='pain_follow_up_notes')); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Legacy unfinalize bypassed guard'; end if;
 failed:=false;
 begin perform public.apply_clinical_reset(req || jsonb_build_object('episode_id',gen_random_uuid(),'request_key',gen_random_uuid())); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Mismatched note ownership accepted'; end if;
 -- Live orders block reset, and resolving them does not delete clinical history.
 insert into procedure_orders(case_id,episode_id,source_encounter_id,source_recommendation_id,procedure_series_id,procedure_type)
 values(cid,(p->>'episode_id')::uuid,(select encounter_id from reset_fixture where kind='pain_follow_up_notes'),gen_random_uuid(),(select id from procedure_series where case_id=cid),'prp') returning id into order_id;
 failed:=false;
 begin perform public.apply_clinical_reset(req); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Dependent order did not block reset'; end if;
 update procedure_orders set deleted_at=now() where id=order_id;
 -- A blocking claim aborts the entire bulk operation, leaving every signed row intact.
 insert into invoices(case_id,invoice_date,status) values(cid,current_date,'draft') returning id into invoice;
 insert into billing_source_claims(invoice_id,encounter_id,claim_kind) values(invoice,(select encounter_id from reset_fixture where kind='discharge_notes'),'visit') returning id into claim;
 failed:=false;
 begin perform public.apply_clinical_reset(req); exception when raise_exception then failed:=true; end;
 if not failed or exists(select 1 from clinical_note_revisions where case_id=cid) then raise exception 'Blocked bulk reset changed signed history'; end if;
 update billing_source_claims set released_at=now(),release_reason='test' where id=claim;
 p:=public.preview_clinical_reset(cid);
 req:=req || jsonb_build_object('case_version',p->>'case_version','episode_version',p->>'episode_version');
 oid:=public.apply_clinical_reset(req);
 if (select count(*) from clinical_note_revisions where operation_id=oid)<>4 then raise exception 'Signed revisions not captured'; end if;
 for f in select * from reset_fixture loop
  execute format('select to_jsonb(n) from public.%I n where id=$1',f.kind) into n using f.note_id;
  if n->>'status'<>'draft' or n->>'document_id' is not null or coalesce(n->>'subjective',n->>'introduction') is not null then raise exception 'Reset failed for %',f.kind; end if;
  if not exists(select 1 from documents where id=f.document_id and deleted_at is null) then raise exception 'Original PDF not retained'; end if;
 end loop;
 if exists(select 1 from clinical_encounters where case_id=cid and (status<>'in_progress' or provider_intake->>'history'<>'retain intake')) then raise exception 'Visit state or intake incorrect'; end if;
 -- Audit and document protection.
 failed:=false;
 begin delete from clinical_note_revisions where case_id=cid; exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Audit can be deleted'; end if;
 failed:=false;
 begin update documents set deleted_at=now() where id=(select document_id from reset_fixture limit 1); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Historical document can be deleted'; end if;
 -- Stale PDF finalization loses; a matching version links a replacement.
 select * into f from reset_fixture where kind='procedure_notes';
 update procedure_notes set subjective='replacement narrative' where id=f.note_id returning updated_at into version;
 insert into documents(case_id,episode_id,document_type,file_name,file_path,status,uploaded_by_user_id)
 values(cid,(p->>'episode_id')::uuid,'generated','Replacement','cases/test/replacement.pdf','reviewed',auth.uid()) returning id into replacement;
 failed:=false;
 begin perform public.finish_clinical_note(f.kind,f.note_id,cid,replacement,'2000-01-01'::timestamptz); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Stale finalization succeeded'; end if;
 perform public.finish_clinical_note(f.kind,f.note_id,cid,replacement,version);
 if not exists(select 1 from clinical_note_revisions where note_id=f.note_id and replacement_document_id=replacement) then raise exception 'Replacement not linked'; end if;
 -- Content-preserving Edit captures another revision; a following draft Reset
 -- clears text without replacing or deleting the pending signed snapshot.
 p:=public.preview_clinical_reset(cid);
 select x into n from jsonb_array_elements(p->'notes') x where x->>'kind'='procedure_notes';
 signed_req:=jsonb_build_object('case_id',cid,'episode_id',p->>'episode_id','case_version',p->>'case_version','episode_version',p->>'episode_version','reactivate',false,'reason','Edit replacement note','request_key',gen_random_uuid(),
 'notes',jsonb_build_array(jsonb_build_object('kind','procedure_notes','id',n->>'id','updated_at',n->>'updated_at','keep_content',true)));
 perform public.apply_clinical_reset(signed_req);
 if (select subjective from procedure_notes where id=f.note_id)<>'replacement narrative' then raise exception 'Edit cleared signed narrative'; end if;
 if (select count(*) from clinical_note_revisions where note_id=f.note_id)<>2 then raise exception 'Repeated reset overwrote lineage'; end if;
 update procedure_notes set subjective='new generated text' where id=f.note_id;
 p:=public.preview_clinical_reset(cid);
 select x into n from jsonb_array_elements(p->'notes') x where x->>'kind'='procedure_notes';
 signed_req:=signed_req || jsonb_build_object('request_key',gen_random_uuid(),'notes',jsonb_build_array(jsonb_build_object('kind','procedure_notes','id',n->>'id','updated_at',n->>'updated_at')));
 perform public.apply_clinical_reset(signed_req);
 if (select subjective from procedure_notes where id=f.note_id) is not null then raise exception 'Edit then reset retained generated text'; end if;
 if (select count(*) from clinical_note_revisions where note_id=f.note_id)<>2 then raise exception 'Draft reset duplicated signed history'; end if;
 -- A generating note is rejected even when its current version is supplied.
 update procedure_notes set status='generating' where id=f.note_id;
 p:=public.preview_clinical_reset(cid);
 select x into n from jsonb_array_elements(p->'notes') x where x->>'kind'='procedure_notes';
 failed:=false;
 begin perform public.apply_clinical_reset(signed_req || jsonb_build_object('request_key',gen_random_uuid(),'notes',jsonb_build_array(jsonb_build_object('kind','procedure_notes','id',n->>'id','updated_at',n->>'updated_at')))); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Generating note was reset'; end if;
 update procedure_notes set status='draft' where id=f.note_id;
 -- An old preview cannot be replayed under a fresh request key after state changed.
 failed:=false;
 begin perform public.apply_clinical_reset(req || jsonb_build_object('request_key',gen_random_uuid())); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Stale preview succeeded'; end if;
 -- Pending signed revisions cannot acquire new billing dependencies.
 failed:=false;
 begin insert into billing_source_claims(invoice_id,encounter_id,claim_kind) values(invoice,(select encounter_id from reset_fixture where kind='discharge_notes'),'visit'); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Pending replacement accepted billing claim'; end if;
 -- Every note family can generate/edit and finalize a replacement; discharge is last.
 for f in select * from reset_fixture where kind<>'procedure_notes' order by case when kind='discharge_notes' then 1 else 0 end loop
  execute format('select updated_at from public.%I where id=$1',f.kind) into version using f.note_id;
  if f.kind='discharge_notes' then
   update discharge_notes set pain_score_max=4 where id=f.note_id returning updated_at into version;
  end if;
  insert into documents(case_id,episode_id,encounter_id,document_type,file_name,file_path,status,uploaded_by_user_id)
  values(cid,(p->>'episode_id')::uuid,f.encounter_id,'generated','Replacement','cases/test/'||f.kind||'-replacement.pdf','reviewed',auth.uid()) returning id into replacement;
  perform public.finish_clinical_note(f.kind,f.note_id,cid,replacement,version);
  if not exists(select 1 from clinical_note_revisions where note_id=f.note_id and replacement_document_id=replacement) then raise exception 'Replacement link missing for %',f.kind; end if;
 end loop;
 if (select status from care_episodes where id=(p->>'episode_id')::uuid)<>'discharged' then raise exception 'Replacement discharge failed to close episode'; end if;
 -- A later active episode prevents historical reactivation even with a fresh preview.
 insert into care_episodes(case_id,episode_number,status) values(cid,2,'active');
 p:=public.preview_clinical_reset(cid,(p->>'episode_id')::uuid);
 req:=jsonb_build_object('case_id',cid,'episode_id',p->>'episode_id','case_version',p->>'case_version','episode_version',p->>'episode_version','reactivate',true,'reason','Cannot reopen older episode','request_key',gen_random_uuid(),'notes','[]'::jsonb);
 failed:=false;
 begin perform public.apply_clinical_reset(req); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Older episode reactivated despite newer episode'; end if;

end $$;
reset role;
do $$ declare doc record; failed boolean:=false; begin
 select d.* into doc from documents d join clinical_note_revisions r on r.original_document_id=d.id limit 1;
 insert into storage.objects(bucket_id,name) values('case-documents',doc.file_path);
 begin delete from storage.objects where name=doc.file_path; exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Signed revision storage object could be deleted'; end if;
end $$;
select pass('Clinical reset permissions, preservation, state transitions, replay, and version checks');
select * from finish();
rollback;
