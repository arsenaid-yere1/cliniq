-- Fresh-start clinical revisions. Signed content and PDFs are retained.
create table public.clinical_reset_operations (
 id uuid primary key default gen_random_uuid(),
 case_id uuid not null references public.cases(id),
 episode_id uuid not null,
 actor_id uuid not null references public.users(id),
 reason text not null,
 request_key uuid not null,
 request jsonb not null,
 before_state jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique (actor_id, request_key),
 foreign key (episode_id,case_id) references public.care_episodes(id,case_id)
);
create table public.clinical_note_revisions (
 id uuid primary key default gen_random_uuid(),
 operation_id uuid not null references public.clinical_reset_operations(id),
 case_id uuid not null references public.cases(id),
 episode_id uuid not null,
 note_table text not null check (note_table in ('initial_visit_notes','procedure_notes','discharge_notes','pain_follow_up_notes')),
 note_id uuid not null,
 original_snapshot jsonb not null,
 original_document_id uuid not null references public.documents(id),
 replacement_document_id uuid references public.documents(id),
 replaced_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),
 foreign key (episode_id,case_id) references public.care_episodes(id,case_id)
);
create unique index clinical_note_revisions_pending_idx on public.clinical_note_revisions(note_table,note_id) where replacement_document_id is null;
create index clinical_note_revisions_case_idx on public.clinical_note_revisions(case_id);
create index clinical_note_revisions_original_idx on public.clinical_note_revisions(original_document_id);
create index clinical_note_revisions_replacement_idx on public.clinical_note_revisions(replacement_document_id);
alter table public.clinical_reset_operations enable row level security;
alter table public.clinical_note_revisions enable row level security;
revoke all on public.clinical_reset_operations, public.clinical_note_revisions from public, anon, authenticated, service_role;
grant select on public.clinical_reset_operations, public.clinical_note_revisions to authenticated;
create policy reset_operations_read on public.clinical_reset_operations for select to authenticated using (exists(select 1 from public.users u where u.id=auth.uid() and u.is_active));
create policy note_revisions_read on public.clinical_note_revisions for select to authenticated using (exists(select 1 from public.users u where u.id=auth.uid() and u.is_active));

create function private.clinical_note_table(p_kind text) returns text
language plpgsql immutable set search_path='' as $$
begin
 if p_kind not in ('initial_visit_notes','procedure_notes','discharge_notes','pain_follow_up_notes') or p_kind is null then
  raise exception using errcode='22023',message='Unsupported clinical note type';
 end if;
 return p_kind;
end $$;

create function private.clinical_note_info(p_kind text,p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n jsonb; p public.procedures%rowtype;
begin
 execute format('select to_jsonb(n) from public.%I n where id=$1 and deleted_at is null',private.clinical_note_table(p_kind)) into n using p_id;
 if n is null then raise exception using errcode='P0002',message='Clinical note not found'; end if;
 if p_kind='procedure_notes' then
  select * into p from public.procedures where id=(n->>'procedure_id')::uuid and deleted_at is null;
  if not found then raise exception 'Procedure not found'; end if;
  if (n->>'case_id')::uuid is distinct from p.case_id then raise exception 'Note ownership mismatch'; end if;
  n:=n || jsonb_build_object('case_id',p.case_id,'episode_id',p.episode_id,'encounter_id',null,'procedure_date',p.procedure_date);
 else
  n:=n || jsonb_build_object('visit_date',coalesce(n->>'visit_date',(select e.encounter_date::text from public.clinical_encounters e where e.id=(n->>'encounter_id')::uuid)));
 end if;
 return n;
end $$;

create function private.clinical_reset_blockers(p_kind text,p_note jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(b), '[]'::jsonb) from (
  select jsonb_build_object('kind','billing','id',c.invoice_id,'message','Resolve the invoice before resetting this note') b
  from public.billing_source_claims c where c.released_at is null and
   ((p_kind='procedure_notes' and c.procedure_id=(p_note->>'procedure_id')::uuid) or
    (p_kind<>'procedure_notes' and c.encounter_id=(p_note->>'encounter_id')::uuid))
  union all
  select jsonb_build_object('kind','procedure_order','id',o.id,'message','Resolve the dependent procedure order before resetting this note')
  from public.procedure_orders o where o.deleted_at is null and o.source_encounter_id=(p_note->>'encounter_id')::uuid
 ) blockers
$$;

create function private.preview_clinical_reset(p_case_id uuid,p_episode_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.cases%rowtype; e public.care_episodes%rowtype; k text; n jsonb; notes jsonb:='[]'; actor public.users%rowtype; ids uuid[]; nid uuid;
begin
 select * into actor from public.users where id=auth.uid() and is_active;
 if not found then raise exception using errcode='42501',message='Active user account required'; end if;
 select * into c from public.cases where id=p_case_id and deleted_at is null;
 if not found then raise exception 'Case not found'; end if;
 select * into e from public.care_episodes where case_id=p_case_id and deleted_at is null
  and (p_episode_id is null or id=p_episode_id) order by episode_number desc limit 1;
 if not found then raise exception 'Care episode not found'; end if;
 foreach k in array array['initial_visit_notes','procedure_notes','discharge_notes','pain_follow_up_notes'] loop
  if k='procedure_notes' then
   select array_agg(pn.id order by pn.id) into ids from public.procedure_notes pn join public.procedures p on p.id=pn.procedure_id
    where p.episode_id=e.id and p.case_id=c.id and p.deleted_at is null and pn.deleted_at is null;
  else
   execute format('select array_agg(id order by id) from public.%I where episode_id=$1 and case_id=$2 and deleted_at is null',k) into ids using e.id,c.id;
  end if;
  foreach nid in array coalesce(ids,'{}'::uuid[]) loop
   n:=private.clinical_note_info(k,nid);
   notes:=notes || jsonb_build_array(jsonb_build_object('id',nid,'kind',k,'status',n->>'status','updated_at',n->>'updated_at',
     'visit_type',n->>'visit_type','date',coalesce(n->>'visit_date',n->>'procedure_date'),
     'procedure_id',n->>'procedure_id','encounter_id',n->>'encounter_id',
     'blockers',private.clinical_reset_blockers(k,n)));
  end loop;
 end loop;
 return jsonb_build_object('case_id',c.id,'case_status',c.case_status,'case_version',c.updated_at,
  'episode_id',e.id,'episode_number',e.episode_number,'episode_status',e.status,'episode_version',e.updated_at,
  'is_admin',actor.role='admin','notes',notes,
  'latest_episode',not exists(select 1 from public.care_episodes x where x.case_id=c.id and x.deleted_at is null and x.episode_number>e.episode_number),
  'open_correction',exists(select 1 from public.discharge_note_corrections x where x.episode_id=e.id and x.status='open'),
  'reopened',exists(select 1 from public.clinical_reset_operations x where x.episode_id=e.id and (x.request->>'reactivate')::boolean and x.before_state->'episode'->>'status'='discharged'));
end $$;

create function public.preview_clinical_reset(p_case_id uuid,p_episode_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select private.preview_clinical_reset(p_case_id,p_episode_id) $$;

create function private.apply_clinical_reset(p_request jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.users%rowtype; c public.cases%rowtype; e public.care_episodes%rowtype;
 op public.clinical_reset_operations%rowtype; item jsonb; n jsonb; patch jsonb; columns_sql text; k text;
 cid uuid:=(p_request->>'case_id')::uuid; eid uuid:=(p_request->>'episode_id')::uuid;
 reactivate boolean:=coalesce((p_request->>'reactivate')::boolean,false);
 reason text:=btrim(coalesce(p_request->>'reason','')); operation_id uuid; doc public.documents%rowtype;
begin
 select * into actor from public.users where id=auth.uid() and is_active;
 if not found then raise exception using errcode='42501',message='Active user account required'; end if;
 if length(reason)>1000 then raise exception 'Reason must be 1000 characters or fewer'; end if;
 if jsonb_typeof(p_request->'notes') is distinct from 'array' or jsonb_array_length(p_request->'notes')>100
  or (p_request->>'request_key') is null then raise exception 'Invalid reset request'; end if;
 -- Serialize request-key retries before inspecting mutable versions.
 perform pg_advisory_xact_lock(hashtextextended(actor.id::text || (p_request->>'request_key'),0));
 select * into op from public.clinical_reset_operations where actor_id=actor.id and request_key=(p_request->>'request_key')::uuid;
 if found then
  if op.request is distinct from p_request then raise exception 'Request key was already used with different input'; end if;
  return op.id;
 end if;
 if (select count(*)<>count(distinct (x->>'kind',x->>'id')) from jsonb_array_elements(p_request->'notes') x) then raise exception 'Duplicate note selection'; end if;
 -- Deterministic note locks precede encounter, episode, and case locks.
 for item in select value from jsonb_array_elements(p_request->'notes') order by value->>'kind',value->>'id' loop
  k:=private.clinical_note_table(item->>'kind');
  execute format('select to_jsonb(n) from public.%I n where id=$1 for update',k) into n using (item->>'id')::uuid;
  n:=private.clinical_note_info(k,(item->>'id')::uuid);
  if (n->>'case_id')::uuid is distinct from cid or (n->>'episode_id')::uuid is distinct from eid then raise exception 'Note does not belong to this case and episode'; end if;
  if (n->>'updated_at')::timestamptz is distinct from (item->>'updated_at')::timestamptz then raise exception 'Note changed; refresh and try again'; end if;
  if n->>'status' not in ('draft','failed','finalized') then raise exception 'Generating notes cannot be reset'; end if;
  if coalesce((item->>'keep_content')::boolean,false) and n->>'status'<>'finalized' then raise exception 'Only finalized notes can be reopened for editing'; end if;
  if n->>'status'='finalized' and (actor.role<>'admin' or length(reason)<10) then raise exception using errcode='42501',message='Administrator and a reason of at least 10 characters required'; end if;
  if jsonb_array_length(private.clinical_reset_blockers(k,n))>0 then raise exception 'Resolve billing claims and procedure orders before resetting this note'; end if;
  if k='procedure_notes' then
   perform 1 from public.procedures where id=(n->>'procedure_id')::uuid for update;
  end if;
  if k<>'procedure_notes' then
   perform 1 from public.clinical_encounters where id=(n->>'encounter_id')::uuid and episode_id=eid and case_id=cid
    and deleted_at is null and status in ('in_progress','completed') for update;
   if not found then raise exception 'Visit is not writable'; end if;
  end if;
 end loop;
 select * into e from public.care_episodes where id=eid and case_id=cid and deleted_at is null for update;
 if not found then raise exception 'Care episode not found'; end if;
 select * into c from public.cases where id=cid and deleted_at is null for update;
 if not found then raise exception 'Case not found'; end if;
 if c.updated_at is distinct from (p_request->>'case_version')::timestamptz or e.updated_at is distinct from (p_request->>'episode_version')::timestamptz then raise exception 'Case or episode changed; refresh and try again'; end if;
 if exists(select 1 from public.discharge_note_corrections where episode_id=eid and status='open') then raise exception 'Finish or cancel the open discharge correction first'; end if;
 if reactivate then
  if actor.role<>'admin' or length(reason)<10 then raise exception using errcode='42501',message='Administrator and a reason of at least 10 characters required'; end if;
  if e.status='cancelled' or exists(select 1 from public.care_episodes where case_id=cid and deleted_at is null and episode_number>e.episode_number) then raise exception 'Only the latest active or discharged episode can be reactivated'; end if;
 else
  if e.status<>'active' or c.case_status in ('pending_settlement','closed','archived') then raise exception 'Reactivate the case and episode before resetting notes'; end if;
  if jsonb_array_length(p_request->'notes')=0 then raise exception 'Select a note to reset'; end if;
 end if;
 insert into public.clinical_reset_operations(case_id,episode_id,actor_id,reason,request_key,request,before_state)
 values(cid,eid,actor.id,reason,(p_request->>'request_key')::uuid,p_request,jsonb_build_object('case',to_jsonb(c),'episode',to_jsonb(e))) returning id into operation_id;
 if reactivate then
  update public.cases set case_status='active',case_close_date=null,updated_by_user_id=actor.id where id=cid;
  update public.care_episodes set status='active',ended_at=null,end_reason=null,updated_by_user_id=actor.id where id=eid and status='discharged';
  insert into public.case_status_history(case_id,previous_status,new_status,changed_by_user_id,notes) values(cid,c.case_status,'active',actor.id,'Care episode reactivated: '||reason);
 end if;
 for item in select value from jsonb_array_elements(p_request->'notes') order by value->>'kind',value->>'id' loop
  k:=item->>'kind'; n:=private.clinical_note_info(k,(item->>'id')::uuid);
  if jsonb_array_length(private.clinical_reset_blockers(k,n))>0 then raise exception 'Resolve billing claims and procedure orders before resetting this note'; end if;
  if n->>'status'='finalized' then
   select * into doc from public.documents where id=(n->>'document_id')::uuid and case_id=cid and deleted_at is null for update;
   if not found then raise exception 'Signed PDF is missing; restore the document before resetting'; end if;
   insert into public.clinical_note_revisions(operation_id,case_id,episode_id,note_table,note_id,original_snapshot,original_document_id)
   values(operation_id,cid,eid,k,(n->>'id')::uuid,n,doc.id);
  end if;
  if coalesce((item->>'keep_content')::boolean,false) then
   patch:='{"status":"draft","document_id":null,"finalized_at":null,"finalized_by_user_id":null}'::jsonb;
  else
   patch:=case k
    when 'initial_visit_notes' then '{"introduction": null, "history_of_accident": null, "post_accident_history": null, "chief_complaint": null, "past_medical_history": null, "social_history": null, "review_of_systems": null, "physical_exam": null, "imaging_findings": null, "medical_necessity": null, "diagnoses": null, "treatment_plan": null, "patient_education": null, "prognosis": null, "time_complexity_attestation": null, "clinician_disclaimer": null, "ai_model": null, "raw_ai_response": null, "generation_error": null, "source_data_hash": null, "prp_target_evidence_hash": null, "status": "draft", "generation_attempts": 0, "sections_done": 0, "document_id": null, "finalized_at": null, "finalized_by_user_id": null, "prp_target_recommendations": []}'::jsonb
    when 'procedure_notes' then '{"subjective": null, "past_medical_history": null, "allergies": null, "current_medications": null, "social_history": null, "review_of_systems": null, "objective_vitals": null, "objective_physical_exam": null, "assessment_summary": null, "procedure_indication": null, "procedure_preparation": null, "procedure_prp_prep": null, "procedure_anesthesia": null, "procedure_injection": null, "procedure_post_care": null, "procedure_followup": null, "assessment_and_plan": null, "patient_education": null, "prognosis": null, "clinician_disclaimer": null, "ai_model": null, "raw_ai_response": null, "generation_error": null, "source_data_hash": null, "status": "draft", "generation_attempts": 0, "sections_done": 0, "document_id": null, "finalized_at": null, "finalized_by_user_id": null}'::jsonb
    when 'discharge_notes' then '{"subjective": null, "objective_vitals": null, "objective_general": null, "objective_cervical": null, "objective_lumbar": null, "objective_neurological": null, "diagnoses": null, "assessment": null, "plan_and_recommendations": null, "patient_education": null, "prognosis": null, "clinician_disclaimer": null, "ai_model": null, "raw_ai_response": null, "generation_error": null, "source_data_hash": null, "status": "draft", "generation_attempts": 0, "sections_done": 0, "document_id": null, "finalized_at": null, "finalized_by_user_id": null, "pain_trajectory_text": null, "discharge_pain_estimate_min": null, "discharge_pain_estimate_max": null, "discharge_pain_estimated": false}'::jsonb
    when 'pain_follow_up_notes' then '{"subjective": null, "interval_history": null, "review_of_systems": null, "telehealth_observations": null, "imaging_review": null, "assessment": null, "diagnoses": null, "treatment_plan": null, "patient_education": null, "follow_up": null, "clinician_disclaimer": null, "ai_model": null, "raw_ai_response": null, "generation_error": null, "source_data_hash": null, "document_id": null, "finalized_at": null, "finalized_by_user_id": null, "status": "draft", "generation_attempts": 0, "sections_done": 0, "procedure_recommendations": []}'::jsonb
   end;
  end if;
  patch:=patch || jsonb_build_object('updated_by_user_id',actor.id);
  -- Only allowlisted generated columns present on this note family are changed.
  select string_agg(format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',key,k,key),',') into columns_sql
  from jsonb_object_keys(patch) key where exists(select 1 from information_schema.columns where table_schema='public' and table_name=k and column_name=key);
  execute format('update public.%I set %s where id=$2',k,columns_sql) using patch,(n->>'id')::uuid;
  if k in ('pain_follow_up_notes','discharge_notes') then
   update public.clinical_encounters set status='in_progress',completed_at=null,updated_by_user_id=actor.id where id=(n->>'encounter_id')::uuid;
  end if;
 end loop;
 return operation_id;
end $$;
create function public.apply_clinical_reset(p_request jsonb) returns uuid
language sql security invoker set search_path='' as $$ select private.apply_clinical_reset(p_request) $$;

-- Signed rows can only transition through privileged, audited functions. Ordinary
-- draft edits stay available; privileged correction functions retain their behavior.
create function private.guard_signed_clinical_note() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') then
  if (tg_op='DELETE' and old.status='finalized') or
     (tg_op='UPDATE' and (old.status='finalized' or new.status='finalized')) or
     (tg_op='INSERT' and new.status='finalized') then
   raise exception using errcode='42501',message='Use the audited clinical note controls for signed records';
  end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

create function private.link_clinical_note_revision() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='finalized' and new.document_id is not null then
  update public.clinical_note_revisions set replacement_document_id=new.document_id,replaced_at=clock_timestamp()
   where note_table=tg_table_name and note_id=new.id and replacement_document_id is null;
 end if;
 return new;
end $$;

do $$ declare k text; begin
 foreach k in array array['initial_visit_notes','procedure_notes','discharge_notes','pain_follow_up_notes'] loop
  execute format('create trigger guard_signed_clinical_note before insert or update or delete on public.%I for each row execute function private.guard_signed_clinical_note()',k);
  execute format('create trigger link_clinical_note_revision after update on public.%I for each row execute function private.link_clinical_note_revision()',k);
 end loop;
end $$;

-- Current signed outputs and reset history share the same retention guard.
create function private.is_retained_clinical_document(p_id uuid) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.clinical_note_revisions where original_document_id=p_id or replacement_document_id=p_id)
 or exists(select 1 from public.initial_visit_notes where document_id=p_id and status='finalized')
 or exists(select 1 from public.procedure_notes where document_id=p_id and status='finalized')
 or exists(select 1 from public.discharge_notes where document_id=p_id and status='finalized')
 or exists(select 1 from public.pain_follow_up_notes where document_id=p_id and status='finalized')
$$;
revoke all on function private.is_retained_clinical_document(uuid) from public,anon,authenticated;

create function private.protect_revision_document() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if private.is_retained_clinical_document(old.id) and
  (tg_op='DELETE' or new.deleted_at is not null or new.file_path is distinct from old.file_path) then
  raise exception 'Signed revision documents are retained and cannot be removed';
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger protect_revision_document before update or delete on public.documents for each row execute function private.protect_revision_document();

create function private.protect_revision_storage() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.bucket_id='case-documents' and exists(
  select 1 from public.documents d where d.file_path=old.name and private.is_retained_clinical_document(d.id)
 ) then raise exception 'Signed revision files are retained and cannot be removed or replaced'; end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger protect_revision_storage before update or delete on storage.objects for each row execute function private.protect_revision_storage();

-- Old callers must supply the reviewed reason via the new controls.
create or replace function public.unfinalize_pain_follow_up(p_case_id uuid,p_note_id uuid) returns uuid
language plpgsql security invoker set search_path='' as $$ begin
 raise exception 'Use the audited Edit control and provide a reason';
end $$;

revoke all on function private.clinical_note_table(text),private.clinical_note_info(text,uuid),private.clinical_reset_blockers(text,jsonb),private.preview_clinical_reset(uuid,uuid),private.apply_clinical_reset(jsonb),private.guard_signed_clinical_note(),private.link_clinical_note_revision(),private.protect_revision_document(),private.protect_revision_storage() from public,anon,authenticated;
grant execute on function private.preview_clinical_reset(uuid,uuid),private.apply_clinical_reset(jsonb) to authenticated;
revoke all on function public.preview_clinical_reset(uuid,uuid),public.apply_clinical_reset(jsonb) from public,anon;
grant execute on function public.preview_clinical_reset(uuid,uuid),public.apply_clinical_reset(jsonb) to authenticated;

-- Keep the existing discharge/follow-up business rules behind one versioned
-- finalization entry point. Only the private implementation may change signed state.
alter function public.finalize_episode_discharge(uuid,uuid,uuid,uuid) set schema private;
alter function public.finalize_pain_follow_up(uuid,uuid,uuid,uuid,timestamptz) set schema private;
revoke all on function private.finalize_episode_discharge(uuid,uuid,uuid,uuid),private.finalize_pain_follow_up(uuid,uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
create function private.finish_clinical_note(p_kind text,p_note_id uuid,p_case_id uuid,p_document_id uuid,p_expected_updated_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare n jsonb; k text:=private.clinical_note_table(p_kind); eid uuid; encounter uuid;
begin
 if not exists(select 1 from public.users where id=auth.uid() and is_active) then raise exception using errcode='42501',message='Active user account required'; end if;
 execute format('select to_jsonb(n) from public.%I n where id=$1 for update',k) into n using p_note_id;
 n:=private.clinical_note_info(k,p_note_id);
 if (n->>'case_id')::uuid is distinct from p_case_id then raise exception 'Note does not belong to this case'; end if;
 if n->>'status'='finalized' and (n->>'document_id')::uuid=p_document_id then return p_note_id; end if;
 if n->>'status'<>'draft' or (n->>'updated_at')::timestamptz is distinct from p_expected_updated_at then raise exception 'Note changed; review and finalize again'; end if;
 eid:=(n->>'episode_id')::uuid; encounter:=(n->>'encounter_id')::uuid;
 if k<>'procedure_notes' then
  perform 1 from public.clinical_encounters where id=encounter and episode_id=eid and case_id=p_case_id and deleted_at is null and status='in_progress' for update;
  if not found then raise exception 'Visit is not writable'; end if;
 end if;
 perform 1 from public.care_episodes where id=eid and case_id=p_case_id and status='active' and deleted_at is null for update;
 if not found then raise exception 'Care episode is not writable'; end if;
 perform 1 from public.cases where id=p_case_id and deleted_at is null and case_status not in ('pending_settlement','closed','archived') for update;
 if not found then raise exception 'Case is not writable'; end if;
 if exists(select 1 from public.discharge_note_corrections where episode_id=eid and status='open') then raise exception 'Finish or cancel the open discharge correction first'; end if;
 perform 1 from public.documents where id=p_document_id and case_id=p_case_id and episode_id=eid and document_type='generated' and deleted_at is null
  and uploaded_by_user_id=auth.uid()
  and (k='procedure_notes' or encounter_id=encounter) for update;
 if not found then raise exception 'Generated document not found'; end if;
 if exists(select 1 from public.clinical_note_revisions where original_document_id=p_document_id or replacement_document_id=p_document_id)
  or exists(select 1 from public.initial_visit_notes where document_id=p_document_id)
  or exists(select 1 from public.procedure_notes where document_id=p_document_id)
  or exists(select 1 from public.discharge_notes where document_id=p_document_id)
  or exists(select 1 from public.pain_follow_up_notes where document_id=p_document_id)
 then raise exception 'Generated document is already linked to a signed note'; end if;
 if k='discharge_notes' then
  if n->>'pain_score_max' is null then raise exception 'Discharge pain score is required'; end if;
  perform private.finalize_episode_discharge(p_case_id,eid,p_note_id,p_document_id);
 elsif k='pain_follow_up_notes' then
  perform private.finalize_pain_follow_up(p_case_id,encounter,p_note_id,p_document_id,p_expected_updated_at);
 else
  if k='procedure_notes' and n->>'plan_alignment_status'='unplanned' and n->>'plan_deviation_acknowledged_at' is null then raise exception 'Acknowledge the plan deviation before finalizing'; end if;
  execute format('update public.%I set status=''finalized'',document_id=$1,finalized_at=clock_timestamp(),finalized_by_user_id=auth.uid(),updated_by_user_id=auth.uid() where id=$2',k) using p_document_id,p_note_id;
 end if;
 return p_note_id;
end $$;
create function public.finish_clinical_note(p_kind text,p_note_id uuid,p_case_id uuid,p_document_id uuid,p_expected_updated_at timestamptz) returns uuid
language sql security invoker set search_path='' as $$ select private.finish_clinical_note(p_kind,p_note_id,p_case_id,p_document_id,p_expected_updated_at) $$;
-- Compatible versioned follow-up entry point, including its encounter ownership check.
create function public.finalize_pain_follow_up(p_case_id uuid,p_encounter_id uuid,p_note_id uuid,p_document_id uuid,p_expected_updated_at timestamptz)
returns table(note_id uuid,encounter_id uuid,replayed boolean)
language plpgsql security invoker set search_path='' as $$
declare was_finalized boolean;
begin
 select n.status='finalized' into was_finalized from public.pain_follow_up_notes n where n.id=p_note_id and n.case_id=p_case_id and n.encounter_id=p_encounter_id and n.deleted_at is null;
 if not found then raise exception 'Follow-up note not found'; end if;
 perform private.finish_clinical_note('pain_follow_up_notes',p_note_id,p_case_id,p_document_id,p_expected_updated_at);
 return query select p_note_id,p_encounter_id,was_finalized;
end $$;
revoke all on function private.finish_clinical_note(text,uuid,uuid,uuid,timestamptz),public.finish_clinical_note(text,uuid,uuid,uuid,timestamptz),public.finalize_pain_follow_up(uuid,uuid,uuid,uuid,timestamptz) from public,anon;
grant execute on function private.finish_clinical_note(text,uuid,uuid,uuid,timestamptz),public.finish_clinical_note(text,uuid,uuid,uuid,timestamptz),public.finalize_pain_follow_up(uuid,uuid,uuid,uuid,timestamptz) to authenticated;

-- Dependency writers lock the same owning records as reset. A dependency cannot
-- be attached between the reset's check and commit, nor to a pending replacement.
create function private.guard_reset_dependency() returns trigger
language plpgsql security definer set search_path='' as $$
declare encounter uuid; proc uuid;
begin
 if tg_table_name='procedure_orders' then
  if new.deleted_at is not null then return new; end if;
  encounter:=new.source_encounter_id;
 else
  if new.released_at is not null then return new; end if;
  encounter:=new.encounter_id; proc:=new.procedure_id;
 end if;
 if encounter is not null then
  perform 1 from public.clinical_encounters where id=encounter for update;
 elsif proc is not null then
  perform 1 from public.procedures where id=proc for update;
 end if;
 if exists(select 1 from public.clinical_note_revisions r where r.replacement_document_id is null and
  ((r.original_snapshot->>'encounter_id')::uuid=encounter or (r.original_snapshot->>'procedure_id')::uuid=proc)) then
  raise exception 'Finalize the replacement note before creating dependent orders or billing claims';
 end if;
 return new;
end $$;
create trigger guard_reset_dependency before insert or update on public.billing_source_claims for each row execute function private.guard_reset_dependency();
create trigger guard_reset_dependency before insert or update on public.procedure_orders for each row execute function private.guard_reset_dependency();
revoke all on function private.guard_reset_dependency() from public,anon,authenticated;

-- now() is constant within a transaction. Versions must advance even when an
-- edit/reset/finalize is executed in the same transaction (or clock tick).
create function private.stamp_clinical_version() returns trigger
language plpgsql set search_path='' as $$ begin
 new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 return new;
end $$;
do $$ declare k text; begin
 foreach k in array array['cases','care_episodes','initial_visit_notes','procedure_notes','discharge_notes','pain_follow_up_notes'] loop
  execute format('create trigger zz_clinical_version_stamp before update on public.%I for each row execute function private.stamp_clinical_version()',k);
 end loop;
end $$;
revoke all on function private.stamp_clinical_version() from public,anon,authenticated;

create function private.guard_episode_reactivation() returns trigger
language plpgsql security invoker set search_path='' as $$ begin
 if tg_op='INSERT' then
  perform 1 from public.cases where id=new.case_id for update;
 elsif old.status='discharged' and new.status='active' and current_user in ('authenticated','anon','service_role') then
  raise exception using errcode='42501',message='Use the audited Reactivate case control';
 end if;
 return new;
end $$;
create trigger guard_episode_reactivation before insert or update on public.care_episodes for each row execute function private.guard_episode_reactivation();
revoke all on function private.guard_episode_reactivation() from public,anon,authenticated;
