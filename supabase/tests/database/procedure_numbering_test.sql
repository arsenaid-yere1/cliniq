begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(10);

insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('13000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','numbering@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.provider_profiles (id,user_id,display_name)
values ('13000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000001','Numbering test');
insert into public.patients (id,first_name,last_name,date_of_birth)
values ('23000000-0000-4000-8000-000000000001','Numbering','Patient','1980-01-01');
insert into public.cases (id,case_number,patient_id,case_status,assigned_provider_id)
values ('33000000-0000-4000-8000-000000000001','NUMBERING-TEST','23000000-0000-4000-8000-000000000001','active','13000000-0000-4000-8000-000000000002');
update public.care_episodes set id='43000000-0000-4000-8000-000000000001'
where case_id='33000000-0000-4000-8000-000000000001';
insert into public.procedure_series (id,case_id,episode_id,series_number,procedure_type)
values ('83000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',1,'prp'),
('83000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',2,'botox');
insert into public.procedures (case_id,episode_id,procedure_series_id,procedure_date,procedure_name,procedure_type,procedure_number,deleted_at,sites)
select '33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',current_date,'PRP','prp',n,case when n=2 then now() end,'[{"label":"knee"}]'::jsonb from generate_series(1,2) n;
-- A different series must not affect allocation.
insert into public.procedures (case_id,episode_id,procedure_series_id,procedure_date,procedure_name,procedure_type,procedure_number,sites)
values ('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002',current_date,'Botox','botox',9,'[{"label":"head"}]');
insert into public.clinical_encounters (id,case_id,episode_id,encounter_type,status,encounter_date)
values ('53000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','pain_follow_up','completed',current_date);
insert into public.procedure_orders (id,case_id,episode_id,source_encounter_id,source_recommendation_id,procedure_series_id,procedure_type,status,sites)
values ('63000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','prp','scheduled','[{"label":"knee"}]');
insert into public.procedure_appointments (id,case_id,episode_id,procedure_order_id,scheduled_start,scheduled_end,provider_id)
values ('73000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001',now(),now()+interval '1 hour','13000000-0000-4000-8000-000000000002');

select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
create temporary table numbering_results (label text, result jsonb);
insert into numbering_results values ('scheduled',public.complete_procedure_appointment('73000000-0000-4000-8000-000000000001','{}','{}','numbering-scheduled'));
select is((select procedure_number from public.procedures where id=(select (result->>'procedure_id')::uuid from numbering_results where label='scheduled')),2,'scheduled completion reuses deleted trailing number in its own series');
insert into numbering_results values ('scheduled-retry',public.complete_procedure_appointment('73000000-0000-4000-8000-000000000001','{}','{}','numbering-scheduled'));
select is((select result->>'procedure_id' from numbering_results where label='scheduled-retry'),(select result->>'procedure_id' from numbering_results where label='scheduled'),'scheduled retry returns same procedure');
select is((select result->>'replayed' from numbering_results where label='scheduled-retry'),'true','scheduled retry is marked replayed');
-- Delete the replacement, then create directly in the same series.
update public.procedures set deleted_at=now() where id=(select (result->>'procedure_id')::uuid from numbering_results where label='scheduled');
insert into numbering_results values ('direct',public.create_direct_episode_procedure('33000000-0000-4000-8000-000000000001','prp','{"procedure_date":"2026-09-12","procedure_name":"PRP","consent_obtained":true,"sites":[{"label":"knee"}]}','{}','numbering-direct'));
select is((select procedure_number from public.procedures where id=(select (result->>'procedure_id')::uuid from numbering_results where label='direct')),2,'direct creation ignores all deleted trailing numbers');
insert into numbering_results values ('direct-retry',public.create_direct_episode_procedure('33000000-0000-4000-8000-000000000001','prp','{"procedure_date":"2026-09-12","procedure_name":"PRP","consent_obtained":true,"sites":[{"label":"knee"}]}','{}','numbering-direct'));
select is((select result->>'procedure_id' from numbering_results where label='direct-retry'),(select result->>'procedure_id' from numbering_results where label='direct'),'direct retry returns same procedure');
select is((select result->>'procedure_number' from numbering_results where label='direct-retry'),'2','direct retry retains number 2');
select is((select count(*)::integer from public.procedures where procedure_series_id='83000000-0000-4000-8000-000000000001' and deleted_at is not null),2,'deleted history is preserved');
select is((select count(*)::integer from public.procedures where procedure_series_id='83000000-0000-4000-8000-000000000001' and deleted_at is null),2,'retries do not add extra procedures');
-- Retain a gap: max+1, not count+1.
insert into public.procedures (case_id,episode_id,procedure_series_id,procedure_date,procedure_name,procedure_type,procedure_number,sites)
values ('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',current_date,'PRP','prp',4,'[{"label":"knee"}]');
select is(public.create_direct_episode_procedure('33000000-0000-4000-8000-000000000001','prp','{"procedure_date":"2026-09-12","procedure_name":"PRP","consent_obtained":true,"sites":[{"label":"knee"}]}','{}','numbering-gap')->>'procedure_number','5','retained gaps do not renumber existing procedures');
select is(public.create_direct_episode_procedure('33000000-0000-4000-8000-000000000001','cortisone','{"procedure_date":"2026-09-12","procedure_name":"Cortisone","consent_obtained":true,"sites":[{"label":"knee"}]}','{}','numbering-empty')->>'procedure_number','1','empty series starts at 1');
select * from finish();
rollback;
