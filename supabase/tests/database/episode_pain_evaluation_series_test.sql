begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('10000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','episode-series@test.local','',now(),
  '{"provider":"email","providers":["email"]}', '{}',now(),now());
insert into public.patients (id,first_name,last_name,date_of_birth)
values ('20000000-0000-4000-8000-000000000001','Episode','Patient','1980-01-01');
insert into public.cases (id,case_number,patient_id,case_status)
values ('30000000-0000-4000-8000-000000000001','EPISODE-SERIES-TEST','20000000-0000-4000-8000-000000000001','active');
update public.care_episodes set id='40000000-0000-4000-8000-000000000001',opened_at='2026-01-01'
where case_id='30000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);

create function pg_temp.start_return(d date default '2026-09-01', k text default 'episode-series-key', scheduled boolean default false)
returns table(episode_id uuid, encounter_id uuid, replayed boolean)
language sql security invoker as $$
 select * from public.start_return_episode('30000000-0000-4000-8000-000000000001','Pain returned',k,
 'in_person',case when scheduled then d::timestamptz else null end,null,d,null,'{"chief_complaint":"New pain"}',
 null,null,'{}',false,null,null,null,null)
$$;

set local role authenticated;
select throws_ok($$select * from pg_temp.start_return()$$,'23505','This case already has an active care episode','active Episode blocks new return');
reset role;
update public.care_episodes set status='cancelled',ended_at=now() where episode_number=1 and case_id='30000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select * from pg_temp.start_return()$$,'P0001','The latest care episode must be discharged before starting a return visit','cancelled Episode is not a discharge');
reset role;
update public.care_episodes set status='discharged' where id='40000000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select * from pg_temp.start_return()$$,'P0001','A finalized discharge with a service date is required before starting a return visit','discharged flag alone is insufficient');
reset role;
insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date)
values ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','discharge','completed','2026-08-01'),
('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','pain_evaluation','completed','2026-01-01');
insert into public.discharge_notes(case_id,episode_id,encounter_id,status,visit_date)
values ('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','finalized','2026-08-02');
insert into public.initial_visit_notes(case_id,episode_id,encounter_id,visit_type,status,visit_date,provider_intake)
values ('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000002','pain_evaluation_visit','finalized','2026-01-01','{"chief_complaint":"Old pain"}');
set local role authenticated;
select throws_ok($$select * from pg_temp.start_return('2026-08-01')$$,'23514','Return evaluation date cannot precede the previous discharge date','return uses discharge note service date, not completion timestamp');
select lives_ok($$select * from pg_temp.start_return('2026-09-01','episode-series-key',true)$$,'return creates scheduled pain evaluation');
select ok((select requires_pain_evaluation from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2),'new Episode requires evaluation');
select is((select encounter_type from public.clinical_encounters where episode_id=(select id from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2)),'pain_evaluation','first return encounter is pain evaluation');
select is((select status from public.clinical_encounters where episode_id=(select id from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2)),'scheduled','draft insertion preserves scheduled status');
select is((select count(*) from public.initial_visit_notes where case_id='30000000-0000-4000-8000-000000000001'),2::bigint,'same visit type coexists across Episodes');
select ok((select replayed from pg_temp.start_return('2026-09-01','episode-series-key',true)),'idempotent replay returns original evaluation');
select throws_ok($$select * from pg_temp.start_return('2026-09-02','episode-series-key',true)$$,'22023','Idempotency key was already used with different input','replay rejects changed payload');
select throws_ok($$select * from public.prepare_evaluation_visit('30000000-0000-4000-8000-000000000001','pain_evaluation_visit')$$,'P0001','Episode 1 is not writable','legacy preparation rejects ended Episode 1');
select is((select provider_intake->>'chief_complaint' from public.initial_visit_notes where encounter_id='50000000-0000-4000-8000-000000000002'),'Old pain','return leaves old intake intact');

create function pg_temp.add_visit(kind text,d date default '2026-09-02') returns uuid
language plpgsql security invoker as $$ declare eid uuid; visit uuid; begin
 select id into eid from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2;
 insert into public.clinical_encounters(case_id,episode_id,encounter_type,status,encounter_date)
 values('30000000-0000-4000-8000-000000000001',eid,kind,'in_progress',d) returning id into visit;
 return visit; end $$;
select throws_ok($$select pg_temp.add_visit('pain_follow_up')$$,'P0001','Finalize this episode''s pain evaluation before follow-up or discharge','follow-up blocked before evaluation finalization');
select throws_ok($$select pg_temp.add_visit('discharge')$$,'P0001','Finalize this episode''s pain evaluation before follow-up or discharge','discharge blocked before evaluation finalization');
select throws_ok($$update public.care_episodes set requires_pain_evaluation=false where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2$$,'23514','An episode pain evaluation requirement cannot be removed','requirement cannot be disabled');
select throws_ok($$update public.initial_visit_notes set visit_date='2026-07-01' where episode_id=(select id from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2)$$,'23514','Return evaluation date cannot precede the previous discharge date','subsequent evaluation date edits retain discharge floor');
update public.initial_visit_notes set status='generating' where episode_id=(select id from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2);
select is((select status from public.clinical_encounters where episode_id=(select id from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2)),'in_progress','generation starts scheduled encounter');
update public.initial_visit_notes set status='draft' where episode_id=(select id from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2);

-- Use the real signed-note entry point for the new series.
reset role;
insert into public.documents(case_id,episode_id,encounter_id,document_type,file_name,file_path,status,uploaded_by_user_id)
select case_id,episode_id,encounter_id,'generated','Evaluation','test/episode-evaluation.pdf','reviewed','10000000-0000-4000-8000-000000000001'
from public.initial_visit_notes where episode_id=(select id from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2);
set local role authenticated;
select lives_ok($$select public.finish_clinical_note('initial_visit_notes',n.id,n.case_id,d.id,n.updated_at)
 from public.initial_visit_notes n join public.documents d on d.encounter_id=n.encounter_id where d.file_path='test/episode-evaluation.pdf'$$,'evaluation finalizes through audited control');
select throws_ok($$select pg_temp.add_visit('pain_follow_up','2026-08-31')$$,'23514','Follow-up or discharge date cannot precede this episode''s pain evaluation date','follow-up date cannot precede evaluation');
select lives_ok($$select pg_temp.add_visit('pain_follow_up')$$,'finalized evaluation unlocks follow-up');
select lives_ok($$select pg_temp.add_visit('discharge','2026-09-03')$$,'finalized evaluation unlocks discharge');

reset role;
insert into public.pain_follow_up_notes(case_id,episode_id,encounter_id)
select case_id,episode_id,id from public.clinical_encounters where encounter_type='pain_follow_up' and case_id='30000000-0000-4000-8000-000000000001';
insert into public.discharge_notes(case_id,episode_id,encounter_id,visit_date,pain_score_max)
select case_id,episode_id,id,'2026-09-03',3 from public.clinical_encounters where encounter_type='discharge' and case_id='30000000-0000-4000-8000-000000000001' and status='in_progress';
-- Fixture simulates an audited evaluation reopen without altering its service date.
update public.initial_visit_notes set status='draft' where episode_id=(select id from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2);
set local role authenticated;
select throws_ok($$update public.pain_follow_up_notes set status='generating' where case_id='30000000-0000-4000-8000-000000000001'$$,'P0001','Finalize this episode''s pain evaluation before follow-up or discharge','existing follow-up cannot progress after evaluation reopen');
select throws_ok($$update public.discharge_notes set status='generating' where status='draft' and case_id='30000000-0000-4000-8000-000000000001'$$,'P0001','Finalize this episode''s pain evaluation before follow-up or discharge','existing discharge cannot progress after evaluation reopen');
select lives_ok($$update public.pain_follow_up_notes set status='draft' where case_id='30000000-0000-4000-8000-000000000001'$$,'follow-up reset remains allowed');
select lives_ok($$update public.clinical_encounters set status='cancelled' where encounter_type='pain_follow_up' and case_id='30000000-0000-4000-8000-000000000001'$$,'follow-up cancellation remains allowed');
reset role;
update public.initial_visit_notes set status='finalized' where episode_id=(select id from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2);
set local role authenticated;
select throws_ok($$update public.discharge_notes set visit_date='2026-08-31' where status='draft' and case_id='30000000-0000-4000-8000-000000000001'$$,'23514','Follow-up or discharge date cannot precede this episode''s pain evaluation date','discharge note date is independently validated');
select lives_ok($$select pg_temp.add_visit('pain_follow_up','2026-09-02')$$,'a replacement follow-up can proceed after evaluation is restored');
insert into public.pain_follow_up_notes(case_id,episode_id,encounter_id)
select case_id,episode_id,id from public.clinical_encounters where encounter_type='pain_follow_up' and status='in_progress' and case_id='30000000-0000-4000-8000-000000000001';
insert into public.documents(case_id,episode_id,encounter_id,document_type,file_name,file_path,status,uploaded_by_user_id)
select n.case_id,n.episode_id,n.encounter_id,'generated','Follow-up','test/episode-follow-up.pdf','reviewed','10000000-0000-4000-8000-000000000001'
from public.pain_follow_up_notes n join public.clinical_encounters e on e.id=n.encounter_id where e.status='in_progress' and n.case_id='30000000-0000-4000-8000-000000000001';
select lives_ok($$select public.finish_clinical_note('pain_follow_up_notes',n.id,n.case_id,d.id,n.updated_at)
 from public.pain_follow_up_notes n join public.documents d on d.encounter_id=n.encounter_id where d.file_path='test/episode-follow-up.pdf'$$,'follow-up finalizes through audited control');
reset role;
insert into public.documents(case_id,episode_id,encounter_id,document_type,file_name,file_path,status,uploaded_by_user_id)
select case_id,episode_id,encounter_id,'generated','Discharge','test/episode-discharge.pdf','reviewed','10000000-0000-4000-8000-000000000001'
from public.discharge_notes where status='draft' and case_id='30000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.finish_clinical_note('discharge_notes',n.id,n.case_id,d.id,n.updated_at)
 from public.discharge_notes n join public.documents d on d.encounter_id=n.encounter_id where d.file_path='test/episode-discharge.pdf'$$,'series completes through audited discharge');
select is((select status from public.care_episodes where case_id='30000000-0000-4000-8000-000000000001' and episode_number=2),'discharged','new series ends discharged');
select lives_ok($$select * from pg_temp.start_return('2026-10-01','episode-series-next')$$,'another pain evaluation begins the next series');
select is((select count(*) from public.initial_visit_notes where case_id='30000000-0000-4000-8000-000000000001'),3::bigint,'each successive series retains its own evaluation');
-- Historical procedure dates are checked against their owning Episode only.
reset role;
insert into public.procedure_series(id,case_id,episode_id,series_number,procedure_type)
values('80000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1,'prp');
select lives_ok($$insert into public.procedures(id,case_id,episode_id,procedure_series_id,procedure_date,procedure_name,procedure_type,procedure_number,sites)
values('90000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','2026-02-01','PRP','prp',1,'[{"label":"knee"}]')$$,'historical procedure can precede later Episode evaluations');
select lives_ok($$update public.procedures set procedure_date='2026-02-02' where id='90000000-0000-4000-8000-000000000001'$$,'historical procedure edits retain own Episode floor');
select throws_ok($$update public.procedures set procedure_date='2025-12-01' where id='90000000-0000-4000-8000-000000000001'$$,'23514',null,'historical procedure still respects its own evaluation date');

-- A writable legacy Episode must not steal later Episodes' evaluations.
insert into public.provider_profiles(id,user_id,display_name)
values('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Episode Provider');
update public.cases set assigned_provider_id='10000000-0000-4000-8000-000000000002' where id='30000000-0000-4000-8000-000000000001';
update public.care_episodes set status='cancelled',ended_at=greatest(now(),opened_at) where case_id='30000000-0000-4000-8000-000000000001' and episode_number=3;
update public.care_episodes set status='active',ended_at=null where id='40000000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok($$select public.prepare_evaluation_visit('30000000-0000-4000-8000-000000000001','pain_evaluation_visit')$$,'legacy preparation still supports writable Episode 1');
update public.cases set case_status='intake' where id='30000000-0000-4000-8000-000000000001';
select lives_ok($$select public.prepare_evaluation_visit('30000000-0000-4000-8000-000000000001','pain_evaluation_visit')$$,'legacy preparation supports intake cases');
update public.cases set case_status='pending_imaging' where id='30000000-0000-4000-8000-000000000001';
select lives_ok($$select public.prepare_evaluation_visit('30000000-0000-4000-8000-000000000001','pain_evaluation_visit')$$,'legacy preparation supports pending imaging cases');
select is((select count(distinct episode_id) from public.initial_visit_notes where case_id='30000000-0000-4000-8000-000000000001'),3::bigint,'legacy preparation never reparents later Episode notes');
select lives_ok($$insert into public.clinical_encounters(case_id,episode_id,encounter_type,status,encounter_date)
values('30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','pain_follow_up','in_progress','2026-01-02')$$,'legacy unflagged Episode keeps its existing follow-up workflow');
select * from finish();
rollback;
