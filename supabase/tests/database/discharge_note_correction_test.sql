begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(35);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '12000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'discharge-correction@test.local', '',
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

update public.users
set role = 'admin'
where id = '12000000-0000-4000-8000-000000000001';

insert into public.patients (id, first_name, last_name, date_of_birth)
values ('22000000-0000-4000-8000-000000000001', 'Correction', 'Patient', '1980-01-01');

insert into public.cases (
  id, case_number, patient_id, case_status, assigned_provider_id
) values (
  '32000000-0000-4000-8000-000000000001',
  'DISCHARGE-CORRECTION-TEST',
  '22000000-0000-4000-8000-000000000001',
  'active',
  '12000000-0000-4000-8000-000000000001'
);

update public.care_episodes
set
  id = '42000000-0000-4000-8000-000000000001',
  status = 'discharged',
  opened_at = now() - interval '30 days',
  ended_at = now() - interval '1 day',
  end_reason = 'finalized_discharge',
  created_by_user_id = '12000000-0000-4000-8000-000000000001',
  updated_by_user_id = '12000000-0000-4000-8000-000000000001'
where case_id = '32000000-0000-4000-8000-000000000001'
  and episode_number = 1;

insert into public.clinical_encounters (
  id, case_id, episode_id, encounter_type, status, encounter_date, completed_at,
  created_by_user_id, updated_by_user_id
) values (
  '52000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  'discharge', 'completed', '2026-08-20', now() - interval '1 day',
  '12000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001'
);

insert into public.documents (
  id, case_id, episode_id, encounter_id, document_type,
  file_name, file_path, status, created_by_user_id, updated_by_user_id
) values (
  '62000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001',
  'generated', 'Discharge Summary', 'test/discharge-original.pdf', 'reviewed',
  '12000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001'
);

insert into public.discharge_notes (
  id, case_id, episode_id, encounter_id, visit_date,
  subjective, objective_vitals, objective_general, objective_cervical,
  objective_lumbar, objective_neurological, diagnoses, assessment,
  plan_and_recommendations, patient_education, prognosis,
  clinician_disclaimer, status, pain_score_max, document_id,
  finalized_at, finalized_by_user_id, created_by_user_id, updated_by_user_id
) values (
  '72000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001',
  '2026-08-20',
  'Original subjective', 'Original vitals', 'Original general',
  'Original cervical', 'Original lumbar', 'Original neurological',
  'Original diagnoses', 'Original assessment', 'Original plan',
  'Original education', 'Original prognosis', 'Original disclaimer',
  'finalized', 4, '62000000-0000-4000-8000-000000000001',
  now() - interval '1 day', '12000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001'
);

insert into public.procedure_series (
  id, case_id, episode_id, series_number, procedure_type, status,
  created_by_user_id, updated_by_user_id
) values (
  '82000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  1, 'prp', 'completed',
  '12000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001'
);

insert into public.invoices (
  id, case_id, invoice_number, invoice_date, status, total_amount,
  created_by_user_id, updated_by_user_id
) values (
  '92000000-0000-4000-8000-000000000001',
  '32000000-0000-4000-8000-000000000001',
  'INV-CORRECTION-TEST', '2026-08-20', 'draft', 150,
  '12000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001'
);

select set_config('request.jwt.claim.sub', '12000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select public.begin_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'Correct an inaccurate discharge statement'
  )$$,
  'an administrator can begin a discharge correction'
);

select throws_ok(
  $$select public.begin_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'Attempt a second simultaneous correction'
  )$$,
  '23505',
  'A discharge correction is already in progress',
  'a second open correction is rejected with a stable error'
);

select results_eq(
  $$select status from public.discharge_notes
    where id = '72000000-0000-4000-8000-000000000001'$$,
  $$values ('draft'::text)$$,
  'begin changes only the discharge note to draft'
);

select results_eq(
  $$select document_id from public.discharge_notes
    where id = '72000000-0000-4000-8000-000000000001'$$,
  $$values (null::uuid)$$,
  'begin clears the current note document link'
);

select results_eq(
  $$select status from public.care_episodes
    where id = '42000000-0000-4000-8000-000000000001'$$,
  $$values ('discharged'::text)$$,
  'begin leaves the episode discharged'
);

select results_eq(
  $$select status from public.clinical_encounters
    where id = '52000000-0000-4000-8000-000000000001'$$,
  $$values ('completed'::text)$$,
  'begin leaves the encounter completed'
);

select results_eq(
  $$select status from public.procedure_series
    where id = '82000000-0000-4000-8000-000000000001'$$,
  $$values ('completed'::text)$$,
  'begin leaves the procedure series completed'
);

select results_eq(
  $$select count(*)::integer from public.documents
    where id = '62000000-0000-4000-8000-000000000001'
      and deleted_at is null$$,
  $$values (1)$$,
  'begin preserves the original document'
);

select throws_ok(
  $$insert into public.billing_source_claims (
      invoice_id, encounter_id, claim_kind, created_by_user_id, updated_by_user_id
    ) values (
      '92000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      'visit',
      '12000000-0000-4000-8000-000000000001',
      '12000000-0000-4000-8000-000000000001'
    )$$,
  'P0001',
  'A discharge correction is in progress; finalize or cancel it before billing this visit',
  'billing cannot claim a discharge with an open correction'
);

select lives_ok(
  $$select public.save_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    (select id from public.discharge_note_corrections
      where discharge_note_id = '72000000-0000-4000-8000-000000000001'
        and status = 'open'),
    jsonb_build_object(
      'visit_date', '2026-08-21',
      'subjective', 'Corrected subjective',
      'objective_vitals', 'Corrected vitals',
      'objective_general', 'Corrected general',
      'objective_cervical', 'Corrected cervical',
      'objective_lumbar', 'Corrected lumbar',
      'objective_neurological', 'Corrected neurological',
      'diagnoses', 'Corrected diagnoses',
      'assessment', 'Corrected assessment',
      'plan_and_recommendations', 'Corrected plan',
      'patient_education', 'Corrected education',
      'prognosis', 'Corrected prognosis',
      'clinician_disclaimer', 'Corrected disclaimer'
    )
  )$$,
  'the correction content can be saved atomically'
);

select results_eq(
  $$select subjective from public.discharge_notes
    where id = '72000000-0000-4000-8000-000000000001'$$,
  $$values ('Corrected subjective'::text)$$,
  'save updates corrected content'
);

select lives_ok(
  $$select public.cancel_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    (select id from public.discharge_note_corrections
      where discharge_note_id = '72000000-0000-4000-8000-000000000001'
        and status = 'open')
  )$$,
  'an open correction can be cancelled'
);

select results_eq(
  $$select status, subjective, document_id from public.discharge_notes
    where id = '72000000-0000-4000-8000-000000000001'$$,
  $$values (
    'finalized'::text,
    'Original subjective'::text,
    '62000000-0000-4000-8000-000000000001'::uuid
  )$$,
  'cancellation restores the original note and document exactly'
);

select lives_ok(
  $$insert into public.billing_source_claims (
      invoice_id, encounter_id, claim_kind, created_by_user_id, updated_by_user_id
    ) values (
      '92000000-0000-4000-8000-000000000001',
      '52000000-0000-4000-8000-000000000001',
      'visit',
      '12000000-0000-4000-8000-000000000001',
      '12000000-0000-4000-8000-000000000001'
    )$$,
  'billing is allowed again after cancellation'
);

select throws_ok(
  $$select public.begin_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'Try correction while already billed'
  )$$,
  'P0001',
  'Remove this discharge visit from its invoice or void the invoice before correcting it',
  'an active billing claim blocks correction'
);

update public.billing_source_claims
set released_at = now(), release_reason = 'test release'
where encounter_id = '52000000-0000-4000-8000-000000000001'
  and released_at is null;

select lives_ok(
  $$select public.begin_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'Create the replacement discharge document'
  )$$,
  'correction can begin after the billing claim is released'
);

select results_eq(
  $$select revision_number from public.discharge_note_corrections
    where discharge_note_id = '72000000-0000-4000-8000-000000000001'
      and status = 'open'$$,
  $$values (3)$$,
  'revision numbers remain monotonic after a cancelled correction'
);

insert into public.documents (
  id, case_id, episode_id, encounter_id, document_type,
  file_name, file_path, status, created_by_user_id, updated_by_user_id
) values (
  '62000000-0000-4000-8000-000000000002',
  '32000000-0000-4000-8000-000000000001',
  '42000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000001',
  'generated', 'Discharge Summary - Corrected v3',
  'test/discharge-corrected-v3.pdf', 'reviewed',
  '12000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001'
);

select lives_ok(
  $$select public.finalize_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    (select id from public.discharge_note_corrections
      where discharge_note_id = '72000000-0000-4000-8000-000000000001'
        and status = 'open'),
    '62000000-0000-4000-8000-000000000002'
  )$$,
  'a corrected discharge can be finalized'
);

select results_eq(
  $$select status, document_id from public.discharge_notes
    where id = '72000000-0000-4000-8000-000000000001'$$,
  $$values ('finalized'::text, '62000000-0000-4000-8000-000000000002'::uuid)$$,
  'finalization links the replacement document'
);

select results_eq(
  $$select status, replacement_document_id from public.discharge_note_corrections
    where discharge_note_id = '72000000-0000-4000-8000-000000000001'
      and revision_number = 3$$,
  $$values ('finalized'::text, '62000000-0000-4000-8000-000000000002'::uuid)$$,
  'finalization completes the correction audit record'
);

select results_eq(
  $$select count(*)::integer from public.documents
    where id in (
      '62000000-0000-4000-8000-000000000001',
      '62000000-0000-4000-8000-000000000002'
    ) and deleted_at is null$$,
  $$values (2)$$,
  'both original and replacement documents remain live'
);

select results_eq(
  $$select status from public.care_episodes
    where id = '42000000-0000-4000-8000-000000000001'$$,
  $$values ('discharged'::text)$$,
  'correction finalization leaves the episode discharged'
);

select results_eq(
  $$select status from public.clinical_encounters
    where id = '52000000-0000-4000-8000-000000000001'$$,
  $$values ('completed'::text)$$,
  'correction finalization leaves the encounter completed'
);

select lives_ok(
  $$select public.finalize_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    (select id from public.discharge_note_corrections
      where discharge_note_id = '72000000-0000-4000-8000-000000000001'
        and revision_number = 3),
    '62000000-0000-4000-8000-000000000002'
  )$$,
  'correction finalization is idempotent for the same replacement'
);

update public.users
set role = 'staff'
where id = '12000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.begin_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'Staff must not correct discharge notes'
  )$$,
  '42501',
  'Only an administrator or the assigned provider may correct this discharge',
  'staff cannot begin a correction'
);

update public.users
set role = 'provider'
where id = '12000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.begin_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'Assigned provider corrects their discharge'
  )$$,
  'the assigned provider can begin a correction on an active case'
);

select lives_ok(
  $$select public.cancel_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    (select id from public.discharge_note_corrections
      where discharge_note_id = '72000000-0000-4000-8000-000000000001'
        and status = 'open')
  )$$,
  'the assigned provider can cancel their correction'
);

update public.cases
set assigned_provider_id = null
where id = '32000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.begin_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'Unassigned provider cannot correct discharge'
  )$$,
  '42501',
  'Only an administrator or the assigned provider may correct this discharge',
  'an unassigned provider cannot begin a correction'
);

update public.cases
set assigned_provider_id = '12000000-0000-4000-8000-000000000001'
where id = '32000000-0000-4000-8000-000000000001';

update public.cases
set case_status = 'closed'
where id = '32000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.begin_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'Provider cannot correct a locked case'
  )$$,
  '42501',
  'Only an administrator or the assigned provider may correct this discharge',
  'an assigned provider cannot correct a locked case'
);

update public.users
set role = 'admin'
where id = '12000000-0000-4000-8000-000000000001';

select lives_ok(
  $$select public.begin_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'Administrator corrects the locked case'
  )$$,
  'an administrator can begin a correction on a locked case'
);

select lives_ok(
  $$select public.cancel_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    (select id from public.discharge_note_corrections
      where discharge_note_id = '72000000-0000-4000-8000-000000000001'
        and status = 'open')
  )$$,
  'an administrator can cancel a correction on a locked case'
);

update public.cases
set case_status = 'active'
where id = '32000000-0000-4000-8000-000000000001';

insert into public.care_episodes (
  id, case_id, episode_number, status, opened_at,
  created_by_user_id, updated_by_user_id
) values (
  '42000000-0000-4000-8000-000000000002',
  '32000000-0000-4000-8000-000000000001',
  2, 'active', now(),
  '12000000-0000-4000-8000-000000000001',
  '12000000-0000-4000-8000-000000000001'
);

select lives_ok(
  $$select public.begin_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'Correct prior discharge after return visit'
  )$$,
  'a prior discharge can be corrected while a later episode is active'
);

select results_eq(
  $$select status from public.care_episodes
    where id = '42000000-0000-4000-8000-000000000002'$$,
  $$values ('active'::text)$$,
  'the later return episode remains active'
);

select lives_ok(
  $$select public.cancel_discharge_correction(
    '32000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    (select id from public.discharge_note_corrections
      where discharge_note_id = '72000000-0000-4000-8000-000000000001'
        and status = 'open')
  )$$,
  'the historical correction can be cancelled safely'
);

select results_eq(
  $$select count(*)::integer from public.discharge_note_corrections
    where discharge_note_id = '72000000-0000-4000-8000-000000000001'$$,
  $$values (5)$$,
  'every correction attempt remains in the audit history'
);

select * from finish();
rollback;
