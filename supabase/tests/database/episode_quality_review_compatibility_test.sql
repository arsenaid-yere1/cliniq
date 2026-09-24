begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('71000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','episode-qc@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.patients(id,first_name,last_name,date_of_birth)
values('72000000-0000-4000-8000-000000000001','Episode','QC','1980-01-01');
insert into public.cases(id,case_number,patient_id,case_status)
values('73000000-0000-4000-8000-000000000001','EPISODE-QC-COMPATIBILITY','72000000-0000-4000-8000-000000000001','active');
update public.care_episodes set id='74000000-0000-4000-8000-000000000001',opened_at='2026-01-01'
where case_id='73000000-0000-4000-8000-000000000001';
insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date)
values('75000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','pain_evaluation','completed','2026-01-01'),
('75000000-0000-4000-8000-000000000002','73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','discharge','completed','2026-02-01');
insert into public.initial_visit_notes(id,case_id,episode_id,encounter_id,visit_type,status,visit_date,chief_complaint)
values('76000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000001','pain_evaluation_visit','finalized','2026-01-01','Prior Episode complaint');
insert into public.discharge_notes(case_id,episode_id,encounter_id,status,visit_date)
values('73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','75000000-0000-4000-8000-000000000002','finalized','2026-02-01');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
create temporary table qc_handles(key text primary key,value jsonb);
insert into qc_handles values('prior_run',public.quality_review_run('begin','73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','{}'));
insert into qc_handles values('prior_review',public.quality_review_run('publish','73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001',jsonb_build_object(
 'run_id',(select value->>'id' from qc_handles where key='prior_run'),'findings','[{"key":"prior","message":"Prior Episode finding"}]'::jsonb,
 'finding_overrides','{}'::jsonb,'overall_assessment','minor_issues','coverage','{"complete":true}'::jsonb)));
insert into qc_handles select 'prior_snapshot',to_jsonb(r) from public.case_quality_reviews r where id=(select (value->>'id')::uuid from qc_handles where key='prior_review');
insert into qc_handles values('prior_fix',public.quality_review_run('begin','73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','{"kind":"fix"}'));
reset role;
update public.care_episodes set status='discharged',ended_at='2026-02-01' where id='74000000-0000-4000-8000-000000000001';
set local role authenticated;
insert into qc_handles
select 'return',to_jsonb(r) from public.start_return_episode('73000000-0000-4000-8000-000000000001','Pain returned','episode-qc-return','in_person',null,null,'2026-03-01',null,'{}',null,null,'{}',false,null,null,null,null) r;
insert into qc_handles select 'evaluation',to_jsonb(n) from public.initial_visit_notes n where episode_id=(select (value->>'episode_id')::uuid from qc_handles where key='return');
select is((select value->>'visit_type' from qc_handles where key='evaluation'),'pain_evaluation_visit','real return RPC supplies the QC pain evaluation target');
select is((select value->>'status' from qc_handles where key='evaluation'),'draft','new evaluation is editable by QC');

select lives_ok($$insert into qc_handles values('return_run',public.quality_review_run('begin','73000000-0000-4000-8000-000000000001',(select (value->>'episode_id')::uuid from qc_handles where key='return'),'{}'))$$,'new Episode review can run while old Episode has a processing attempt');
select lives_ok($$insert into qc_handles values('return_review',public.quality_review_run('publish','73000000-0000-4000-8000-000000000001',(select (value->>'episode_id')::uuid from qc_handles where key='return'),jsonb_build_object(
 'run_id',(select value->>'id' from qc_handles where key='return_run'),'findings','[{"key":"return","message":"Return evaluation finding"}]'::jsonb,
 'finding_overrides','{}'::jsonb,'overall_assessment','minor_issues','coverage','{"complete":true}'::jsonb)))$$,'new Episode review publishes independently');
select is((select count(*) from public.case_quality_reviews where case_id='73000000-0000-4000-8000-000000000001' and deleted_at is null),2::bigint,'both Episode reviews remain live');
select is((select to_jsonb(r) from public.case_quality_reviews r where id=(select (value->>'id')::uuid from qc_handles where key='prior_review')),(select value from qc_handles where key='prior_snapshot'),'publishing new review leaves prior review exactly unchanged');
select throws_ok($$select public.quality_review_run('begin','73000000-0000-4000-8000-000000000001','74000000-0000-4000-8000-000000000001','{}')$$,'P0001','Care episode changed; reload the review','historical Episode cannot acquire a new review after return');

insert into qc_handles values('evaluation_fix',public.quality_review_run('begin','73000000-0000-4000-8000-000000000001',(select (value->>'episode_id')::uuid from qc_handles where key='return'),jsonb_build_object('kind','fix','fix_target',jsonb_build_object(
 'table','initial_visit_notes','note_id',(select value->>'id' from qc_handles where key='evaluation'),'section','chief_complaint','updated_at',(select value->>'updated_at' from qc_handles where key='evaluation')))));
select throws_ok($$select public.quality_review_save_fix((select (value->>'id')::uuid from qc_handles where key='prior_fix'),'initial_visit_notes',(select (value->>'id')::uuid from qc_handles where key='evaluation'),(select (value->>'updated_at')::timestamptz from qc_handles where key='evaluation'),'{"chief_complaint":"Wrong Episode"}')$$,'P0001','Fix attempt expired or changed','a live prior Episode fix cannot write the return evaluation');
select lives_ok($$select public.quality_review_save_fix((select (value->>'id')::uuid from qc_handles where key='evaluation_fix'),'initial_visit_notes',(select (value->>'id')::uuid from qc_handles where key='evaluation'),(select (value->>'updated_at')::timestamptz from qc_handles where key='evaluation'),'{"chief_complaint":"Corrected return complaint"}')$$,'QC fixes the exact draft return evaluation');
select is((select chief_complaint from public.initial_visit_notes where id=(select (value->>'id')::uuid from qc_handles where key='evaluation')),'Corrected return complaint','return evaluation receives the fix');
select is((select chief_complaint from public.initial_visit_notes where id='76000000-0000-4000-8000-000000000001'),'Prior Episode complaint','prior evaluation content remains unchanged');
select is((select episode_id from public.initial_visit_notes where id='76000000-0000-4000-8000-000000000001'),'74000000-0000-4000-8000-000000000001'::uuid,'prior evaluation ownership remains unchanged');
select throws_ok($$select public.quality_review_save_fix((select (value->>'id')::uuid from qc_handles where key='evaluation_fix'),'initial_visit_notes','76000000-0000-4000-8000-000000000001',(select updated_at from public.initial_visit_notes where id='76000000-0000-4000-8000-000000000001'),'{"chief_complaint":"Overwrite signed history"}')$$,'P0001','Note changed or is not editable','QC cannot edit a finalized historical target');
select throws_ok($$select public.quality_review_save_fix((select (value->>'id')::uuid from qc_handles where key='evaluation_fix'),'initial_visit_notes',(select (value->>'id')::uuid from qc_handles where key='evaluation'),(select (value->>'updated_at')::timestamptz from qc_handles where key='evaluation'),'{"chief_complaint":"Stale correction"}')$$,'P0001','Note changed or is not editable','fix retains optimistic concurrency checks');
select public.quality_review_run('fail','73000000-0000-4000-8000-000000000001',(select (value->>'episode_id')::uuid from qc_handles where key='return'),jsonb_build_object('run_id',(select value->>'id' from qc_handles where key='evaluation_fix'),'error_message','Release synthetic fix lease'));

-- Finalize through the real audited lifecycle, then exercise follow-up QC.
insert into public.documents(case_id,episode_id,encounter_id,document_type,file_name,file_path,status,uploaded_by_user_id)
select case_id,episode_id,encounter_id,'generated','QC Evaluation','test/episode-qc-evaluation.pdf','reviewed','71000000-0000-4000-8000-000000000001'
from public.initial_visit_notes where id=(select (value->>'id')::uuid from qc_handles where key='evaluation');
select lives_ok($$select public.finish_clinical_note('initial_visit_notes',n.id,n.case_id,d.id,n.updated_at)
from public.initial_visit_notes n join public.documents d on d.encounter_id=n.encounter_id where d.file_path='test/episode-qc-evaluation.pdf'$$,'QC-edited evaluation finalizes normally');
select throws_ok($$select public.quality_review_save_fix((select (value->>'id')::uuid from qc_handles where key='evaluation_fix'),'initial_visit_notes',n.id,n.updated_at,'{"chief_complaint":"Overwrite finalized return"}') from public.initial_visit_notes n where n.id=(select (value->>'id')::uuid from qc_handles where key='evaluation')$$,'P0001','Note changed or is not editable','QC rejects the return evaluation after finalization');
insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date)
select '75000000-0000-4000-8000-000000000003','73000000-0000-4000-8000-000000000001',(value->>'episode_id')::uuid,'pain_follow_up','in_progress','2026-03-02' from qc_handles where key='return';
insert into public.pain_follow_up_notes(id,case_id,episode_id,encounter_id,status,subjective)
select '76000000-0000-4000-8000-000000000003','73000000-0000-4000-8000-000000000001',(value->>'episode_id')::uuid,'75000000-0000-4000-8000-000000000003','draft','Original return follow-up' from qc_handles where key='return';
insert into qc_handles values('followup_fix',public.quality_review_run('begin','73000000-0000-4000-8000-000000000001',(select (value->>'episode_id')::uuid from qc_handles where key='return'),jsonb_build_object('kind','fix','fix_target',jsonb_build_object('table','pain_follow_up_notes','note_id','76000000-0000-4000-8000-000000000003','section','subjective','updated_at',(select updated_at from public.pain_follow_up_notes where id='76000000-0000-4000-8000-000000000003')))));
select lives_ok($$select public.quality_review_save_fix((select (value->>'id')::uuid from qc_handles where key='followup_fix'),'pain_follow_up_notes','76000000-0000-4000-8000-000000000003',(select updated_at from public.pain_follow_up_notes where id='76000000-0000-4000-8000-000000000003'),'{"subjective":"Corrected return follow-up"}')$$,'QC fixes a follow-up within the evaluation-first return series');
select is((select subjective from public.pain_follow_up_notes where id='76000000-0000-4000-8000-000000000003'),'Corrected return follow-up','follow-up patch reaches the selected note');
select is((select to_jsonb(r) from public.case_quality_reviews r where id=(select (value->>'id')::uuid from qc_handles where key='prior_review')),(select value from qc_handles where key='prior_snapshot'),'evaluation and follow-up fixes preserve prior review snapshot');
select * from finish();
rollback;
