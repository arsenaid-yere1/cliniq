begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(3);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '11000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'telehealth-consent-date@test.local', '',
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.patients (id, first_name, last_name, date_of_birth)
values ('21000000-0000-4000-8000-000000000001', 'Test', 'Patient', '1980-01-01');

insert into public.cases (id, case_number, patient_id, case_status)
values (
  '31000000-0000-4000-8000-000000000001',
  'TELEHEALTH-CONSENT-DATE-TEST',
  '21000000-0000-4000-8000-000000000001',
  'active'
);

update public.care_episodes
set
  id = '41000000-0000-4000-8000-000000000001',
  created_by_user_id = '11000000-0000-4000-8000-000000000001',
  updated_by_user_id = '11000000-0000-4000-8000-000000000001'
where case_id = '31000000-0000-4000-8000-000000000001'
  and episode_number = 1;

insert into public.clinical_encounters (
  id, case_id, episode_id, encounter_type, modality, status,
  encounter_date, telehealth_consent_obtained, telehealth_consent_at,
  created_by_user_id, updated_by_user_id
) values (
  '51000000-0000-4000-8000-000000000001',
  '31000000-0000-4000-8000-000000000001',
  '41000000-0000-4000-8000-000000000001',
  'pain_follow_up', 'telehealth', 'in_progress',
  '2026-08-20', true, '2026-08-27 18:42:15+00',
  '11000000-0000-4000-8000-000000000001',
  '11000000-0000-4000-8000-000000000001'
);

select results_eq(
  $$select telehealth_consent_at from public.clinical_encounters
    where id = '51000000-0000-4000-8000-000000000001'$$,
  $$values ('2026-08-20 18:42:15+00'::timestamptz)$$,
  'consent timestamp aligns to the encounter date on insert'
);

update public.clinical_encounters
set encounter_date = '2026-08-21'
where id = '51000000-0000-4000-8000-000000000001';

select results_eq(
  $$select telehealth_consent_at from public.clinical_encounters
    where id = '51000000-0000-4000-8000-000000000001'$$,
  $$values ('2026-08-21 18:42:15+00'::timestamptz)$$,
  'consent timestamp follows a corrected encounter date'
);

update public.clinical_encounters
set telehealth_consent_obtained = false
where id = '51000000-0000-4000-8000-000000000001';

select results_eq(
  $$select telehealth_consent_at from public.clinical_encounters
    where id = '51000000-0000-4000-8000-000000000001'$$,
  $$values (null::timestamptz)$$,
  'clearing consent also clears its timestamp'
);

select * from finish();
rollback;
