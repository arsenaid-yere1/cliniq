begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,email,raw_user_meta_data)
values('61000000-0000-4000-8000-000000000001','episode-reset@test.local','{"full_name":"Episode Reset Admin"}');
update public.users set role='admin',is_active=true where id='61000000-0000-4000-8000-000000000001';
insert into public.patients(id,first_name,last_name,date_of_birth)
values('62000000-0000-4000-8000-000000000001','Episode','Reset','1980-01-01');
insert into public.cases(id,case_number,patient_id,case_status)
values('63000000-0000-4000-8000-000000000001','EPISODE-RESET-COMPATIBILITY','62000000-0000-4000-8000-000000000001','active');
update public.care_episodes set id='64000000-0000-4000-8000-000000000001',opened_at='2026-01-01'
where case_id='63000000-0000-4000-8000-000000000001';
insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date)
values('65000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','pain_evaluation','completed','2026-01-01'),
('65000000-0000-4000-8000-000000000002','63000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','discharge','completed','2026-02-01');
insert into public.initial_visit_notes(id,case_id,episode_id,encounter_id,visit_type,status,visit_date,chief_complaint)
values('66000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','pain_evaluation_visit','finalized','2026-01-01','Prior Episode complaint');
insert into public.discharge_notes(case_id,episode_id,encounter_id,status,visit_date)
values('63000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000002','finalized','2026-02-01');
update public.care_episodes set status='discharged',ended_at='2026-02-01' where id='64000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
create temporary table episode_reset_handles(key text primary key,value jsonb);
insert into episode_reset_handles select 'prior_episode',to_jsonb(e) from public.care_episodes e where id='64000000-0000-4000-8000-000000000001';
insert into episode_reset_handles select 'prior_note',to_jsonb(n) from public.initial_visit_notes n where id='66000000-0000-4000-8000-000000000001';
insert into episode_reset_handles select 'return',to_jsonb(r) from public.start_return_episode('63000000-0000-4000-8000-000000000001','Pain returned','episode-reset-return','in_person',null,null,'2026-03-01',null,'{"chief_complaint":"Return intake"}',null,null,'{}',false,null,null,null,null) r;
insert into episode_reset_handles select 'evaluation',to_jsonb(n) from public.initial_visit_notes n where episode_id=(select (value->>'episode_id')::uuid from episode_reset_handles where key='return');

create function pg_temp.sign_reset_fixture(kind text,nid uuid,path text) returns uuid
language plpgsql security invoker as $$ declare n jsonb; doc uuid; begin
 execute format('select to_jsonb(n) from public.%I n where id=$1',kind) into n using nid;
 insert into public.documents(case_id,episode_id,encounter_id,document_type,file_name,file_path,status,uploaded_by_user_id)
 values((n->>'case_id')::uuid,(n->>'episode_id')::uuid,(n->>'encounter_id')::uuid,'generated','Episode Reset Fixture',path,'reviewed',auth.uid()) returning id into doc;
 perform public.finish_clinical_note(kind,nid,(n->>'case_id')::uuid,doc,(n->>'updated_at')::timestamptz);
 return doc;
end $$;
create function pg_temp.episode_reset_request(eid uuid,nid uuid default null,reactivate boolean default false) returns jsonb
language plpgsql security invoker as $$ declare p jsonb; selection jsonb; begin
 p:=public.preview_clinical_reset('63000000-0000-4000-8000-000000000001',eid);
 select coalesce(jsonb_agg(jsonb_build_object('kind',x->>'kind','id',x->>'id','updated_at',x->>'updated_at','keep_content',true)),'[]'::jsonb)
 into selection from jsonb_array_elements(p->'notes') x where (x->>'id')::uuid=nid;
 return jsonb_build_object('case_id',p->>'case_id','episode_id',p->>'episode_id','case_version',p->>'case_version','episode_version',p->>'episode_version',
  'request_key',gen_random_uuid(),'reason','Correct return episode documentation','reactivate',reactivate,'notes',selection);
end $$;

update public.initial_visit_notes set chief_complaint='Signed return complaint' where id=(select (value->>'id')::uuid from episode_reset_handles where key='evaluation');
insert into episode_reset_handles select 'signed_document',to_jsonb(pg_temp.sign_reset_fixture('initial_visit_notes',(value->>'id')::uuid,'test/episode-reset-evaluation-original.pdf')) from episode_reset_handles where key='evaluation';
insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date)
select '65000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000001',(value->>'episode_id')::uuid,'pain_follow_up','in_progress','2026-03-02' from episode_reset_handles where key='return';
insert into public.pain_follow_up_notes(id,case_id,episode_id,encounter_id,status,subjective)
select '66000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000001',(value->>'episode_id')::uuid,'65000000-0000-4000-8000-000000000003','draft','Return follow-up' from episode_reset_handles where key='return';
select lives_ok($$insert into episode_reset_handles values('preview',public.preview_clinical_reset('63000000-0000-4000-8000-000000000001',(select (value->>'episode_id')::uuid from episode_reset_handles where key='return')))$$,'real reset preview loads a flagged return Episode');
select is((select jsonb_array_length(value->'notes') from episode_reset_handles where key='preview'),2,'preview contains only return evaluation and follow-up');
select ok((select exists(select 1 from jsonb_array_elements(value->'notes') n where n->>'visit_type'='pain_evaluation_visit' and n->>'status'='finalized') from episode_reset_handles where key='preview'),'preview identifies finalized return pain evaluation');
select ok((select not exists(select 1 from jsonb_array_elements(value->'notes') n where n->>'id'='66000000-0000-4000-8000-000000000001') from episode_reset_handles where key='preview'),'preview excludes historical evaluation');
insert into episode_reset_handles select 'reset_request',pg_temp.episode_reset_request((value->>'episode_id')::uuid,(select (value->>'id')::uuid from episode_reset_handles where key='evaluation')) from episode_reset_handles where key='return';
select lives_ok($$insert into episode_reset_handles select 'reset_operation',to_jsonb(public.apply_clinical_reset(value)) from episode_reset_handles where key='reset_request'$$,'signed return evaluation resets through audited RPC with existing follow-up');
select is((select status from public.initial_visit_notes where id=(select (value->>'id')::uuid from episode_reset_handles where key='evaluation')),'draft','evaluation reset returns to draft');
select is((select chief_complaint from public.initial_visit_notes where id=(select (value->>'id')::uuid from episode_reset_handles where key='evaluation')),'Signed return complaint','keep-content reset preserves narrative');
select is((select status from public.clinical_encounters where id=(select (value->>'encounter_id')::uuid from episode_reset_handles where key='return')),'in_progress','evaluation reset reopens its encounter');
select is((select count(*) from public.clinical_note_revisions where case_id='63000000-0000-4000-8000-000000000001'),1::bigint,'signed reset captures one revision');
select ok((select r.original_snapshot->>'chief_complaint'='Signed return complaint' and r.original_document_id=(select (value#>>'{}')::uuid from episode_reset_handles where key='signed_document') and r.replacement_document_id is null from public.clinical_note_revisions r where case_id='63000000-0000-4000-8000-000000000001'),'revision retains signed narrative and original PDF pending replacement');
select ok((select deleted_at is null from public.documents where id=(select (value#>>'{}')::uuid from episode_reset_handles where key='signed_document')),'original signed PDF remains retained');
select is((select to_jsonb(n) from public.initial_visit_notes n where id='66000000-0000-4000-8000-000000000001'),(select value from episode_reset_handles where key='prior_note'),'return reset leaves historical evaluation exactly unchanged');
select throws_ok($$update public.pain_follow_up_notes set status='generating' where id='66000000-0000-4000-8000-000000000003'$$,'P0001','Finalize this episode''s pain evaluation before follow-up or discharge','existing follow-up cannot progress while evaluation is reopened');
select throws_ok($$insert into public.clinical_encounters(case_id,episode_id,encounter_type,status,encounter_date) select '63000000-0000-4000-8000-000000000001',(value->>'episode_id')::uuid,'discharge','in_progress','2026-03-03' from episode_reset_handles where key='return'$$,'P0001','Finalize this episode''s pain evaluation before follow-up or discharge','discharge cannot start while evaluation is reopened');
select lives_ok($$insert into episode_reset_handles select 'replacement_document',to_jsonb(pg_temp.sign_reset_fixture('initial_visit_notes',(value->>'id')::uuid,'test/episode-reset-evaluation-replacement.pdf')) from episode_reset_handles where key='evaluation'$$,'replacement evaluation finalizes through audited control');
select is((select replacement_document_id from public.clinical_note_revisions where case_id='63000000-0000-4000-8000-000000000001'),(select (value#>>'{}')::uuid from episode_reset_handles where key='replacement_document'),'replacement PDF links to retained signed revision');
select lives_ok($$select pg_temp.sign_reset_fixture('pain_follow_up_notes','66000000-0000-4000-8000-000000000003','test/episode-reset-follow-up.pdf')$$,'existing follow-up can finalize after evaluation is restored');
insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date)
select '65000000-0000-4000-8000-000000000004','63000000-0000-4000-8000-000000000001',(value->>'episode_id')::uuid,'discharge','in_progress','2026-03-03' from episode_reset_handles where key='return';
insert into public.discharge_notes(id,case_id,episode_id,encounter_id,status,visit_date,pain_score_max)
select '66000000-0000-4000-8000-000000000004','63000000-0000-4000-8000-000000000001',(value->>'episode_id')::uuid,'65000000-0000-4000-8000-000000000004','draft','2026-03-03',3 from episode_reset_handles where key='return';
select lives_ok($$select pg_temp.sign_reset_fixture('discharge_notes','66000000-0000-4000-8000-000000000004','test/episode-reset-discharge.pdf')$$,'return series discharges after reset and replacement finalization');
select is((select status from public.care_episodes where id=(select (value->>'episode_id')::uuid from episode_reset_handles where key='return')),'discharged','return Episode ends discharged');
select lives_ok($$select public.apply_clinical_reset(pg_temp.episode_reset_request((select (value->>'episode_id')::uuid from episode_reset_handles where key='return'),null,true))$$,'latest discharged return Episode can reactivate through audited RPC');
select ok((select status='active' and requires_pain_evaluation from public.care_episodes where id=(select (value->>'episode_id')::uuid from episode_reset_handles where key='return')),'reactivation preserves evaluation requirement');
select ok((public.preview_clinical_reset('63000000-0000-4000-8000-000000000001',(select (value->>'episode_id')::uuid from episode_reset_handles where key='return'))->>'reopened')::boolean,'preview identifies audited reactivation');
select is((select to_jsonb(e) from public.care_episodes e where id='64000000-0000-4000-8000-000000000001'),(select value from episode_reset_handles where key='prior_episode'),'latest reactivation preserves older Episode exactly');
select throws_ok($$select public.apply_clinical_reset(pg_temp.episode_reset_request('64000000-0000-4000-8000-000000000001',null,true))$$,'P0001','Only the latest active or discharged episode can be reactivated','older discharged Episode cannot reactivate after a return series exists');
select is((select count(*) from public.care_episodes where case_id='63000000-0000-4000-8000-000000000001'),2::bigint,'reactivation reuses latest Episode rather than creating a new series');
select * from finish();
rollback;
