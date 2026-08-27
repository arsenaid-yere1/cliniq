begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'discharge-rpc@test.local', '',
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.patients (id, first_name, last_name, date_of_birth)
values ('20000000-0000-4000-8000-000000000001', 'Test', 'Patient', '1980-01-01');

insert into public.cases (id, case_number, patient_id, case_status)
values (
  '30000000-0000-4000-8000-000000000001',
  'DISCHARGE-RPC-TEST',
  '20000000-0000-4000-8000-000000000001',
  'active'
);

update public.care_episodes
set
  id = '40000000-0000-4000-8000-000000000001',
  opened_at = now() - interval '1 day',
  created_by_user_id = '10000000-0000-4000-8000-000000000001',
  updated_by_user_id = '10000000-0000-4000-8000-000000000001'
where case_id = '30000000-0000-4000-8000-000000000001'
  and episode_number = 1;

insert into public.clinical_encounters (
  id, case_id, episode_id, encounter_type, status, encounter_date,
  created_by_user_id, updated_by_user_id
) values (
  '50000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'discharge', 'in_progress', current_date,
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.documents (
  id, case_id, episode_id, encounter_id, document_type,
  file_name, file_path, status, created_by_user_id, updated_by_user_id
) values (
  '60000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'generated', 'Discharge Summary', 'test/discharge-summary.pdf', 'reviewed',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.discharge_notes (
  id, case_id, episode_id, encounter_id, status, pain_score_max,
  created_by_user_id, updated_by_user_id
) values (
  '70000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'draft', 4,
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.procedure_series (
  id, case_id, episode_id, series_number, procedure_type, status,
  created_by_user_id, updated_by_user_id
) values (
  '80000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  1, 'prp', 'active',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select * from public.finalize_episode_discharge(
    '30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001'
  )$$,
  'finalizing an episode with an active procedure series does not raise an ambiguous-column error'
);

select results_eq(
  $$select status from public.discharge_notes where id = '70000000-0000-4000-8000-000000000001'$$,
  $$values ('finalized'::text)$$,
  'the discharge note is finalized'
);

select results_eq(
  $$select status from public.procedure_series where id = '80000000-0000-4000-8000-000000000001'$$,
  $$values ('completed'::text)$$,
  'the active procedure series is completed'
);

select results_eq(
  $$select status from public.care_episodes where id = '40000000-0000-4000-8000-000000000001'$$,
  $$values ('discharged'::text)$$,
  'the care episode is discharged'
);

select * from finish();
rollback;
