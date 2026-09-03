begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(49);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '10000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'follow-up-reset@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.patients (id, first_name, last_name, date_of_birth)
values ('20000000-0000-4000-8000-000000000001', 'Reset', 'Patient', '1980-01-01');

insert into public.cases (id, case_number, patient_id, case_status)
values (
  '30000000-0000-4000-8000-000000000001',
  'FOLLOW-UP-RESET-TEST',
  '20000000-0000-4000-8000-000000000001',
  'active'
);

update public.care_episodes
set id = '40000000-0000-4000-8000-000000000001',
    created_by_user_id = '10000000-0000-4000-8000-000000000001',
    updated_by_user_id = '10000000-0000-4000-8000-000000000001'
where case_id = '30000000-0000-4000-8000-000000000001'
  and episode_number = 1;

insert into public.clinical_encounters (
  id, case_id, episode_id, encounter_type, modality, status, encounter_date,
  reason_for_visit, provider_intake, patient_reported_pain_min,
  patient_reported_pain_max, telehealth_consent_obtained,
  patient_location_state, provider_location, connection_method,
  created_by_user_id, updated_by_user_id
) values (
  '50000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'pain_follow_up', 'telehealth', 'in_progress', '2026-09-01',
  'Recurring lumbar pain', '{"history":"preserve me"}'::jsonb, 3, 7, true,
  'CA', 'Los Angeles, CA', 'video',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

insert into public.pain_follow_up_notes (
  id, case_id, episode_id, encounter_id, subjective, interval_history,
  review_of_systems, telehealth_observations, imaging_review, assessment,
  diagnoses, treatment_plan, patient_education, follow_up,
  clinician_disclaimer, procedure_recommendations, ai_model, raw_ai_response,
  status, generation_error, generation_attempts, source_data_hash,
  sections_done, sections_total, tone_hint, created_at, updated_at,
  created_by_user_id, updated_by_user_id
) values (
  '60000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'Subjective text', 'Interval text', 'ROS text', 'Observation text',
  'Imaging text', 'Assessment text', 'Diagnosis text', 'Plan text',
  'Education text', 'Follow-up text', 'Disclaimer text',
  '[{"recommendation_id":"61000000-0000-4000-8000-000000000001","procedure_type":"prp","sites":["Lumbar facet"],"diagnoses":[],"rationale":"Persistent pain"}]'::jsonb,
  'test-model', '{"raw":"response"}'::jsonb, 'draft', null, 3, 'source-hash',
  11, 11, 'concise', '2026-01-01 00:00:00+00',
  '2026-01-01 00:00:00+00',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  not has_function_privilege('anon', 'public.reset_pain_follow_up(uuid,uuid)', 'execute'),
  'anon cannot reset a follow-up note'
);
select ok(
  has_function_privilege('authenticated', 'public.reset_pain_follow_up(uuid,uuid)', 'execute'),
  'authenticated users can execute reset'
);
select ok(
  not has_function_privilege('anon', 'public.finalize_pain_follow_up(uuid,uuid,uuid,uuid,timestamptz)', 'execute'),
  'anon cannot finalize a follow-up note'
);
select ok(
  has_function_privilege('authenticated', 'public.finalize_pain_follow_up(uuid,uuid,uuid,uuid,timestamptz)', 'execute'),
  'authenticated users can execute finalize'
);
select ok(
  not has_function_privilege('anon', 'public.unfinalize_pain_follow_up(uuid,uuid)', 'execute'),
  'anon cannot unfinalize a follow-up note'
);
select ok(
  has_function_privilege('authenticated', 'public.unfinalize_pain_follow_up(uuid,uuid)', 'execute'),
  'authenticated users can execute unfinalize'
);
select is(
  to_regprocedure('public.finalize_pain_follow_up(uuid,uuid,uuid,uuid)'),
  null::regprocedure,
  'the obsolete four-argument finalize function is absent'
);

set local role authenticated;

select lives_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'a populated draft note can be reset'
);
select ok(
  (select subjective is null and interval_history is null
      and review_of_systems is null and telehealth_observations is null
      and imaging_review is null and assessment is null and diagnoses is null
      and treatment_plan is null and patient_education is null
      and follow_up is null and clinician_disclaimer is null
    from public.pain_follow_up_notes
    where id = '60000000-0000-4000-8000-000000000001'),
  'reset clears all eleven generated sections'
);
select ok(
  (select procedure_recommendations = '[]'::jsonb and ai_model is null
      and raw_ai_response is null and generation_error is null
      and source_data_hash is null and generation_attempts = 0
      and sections_done = 0 and sections_total = 11
    from public.pain_follow_up_notes
    where id = '60000000-0000-4000-8000-000000000001'),
  'reset clears recommendations and generation metadata'
);
select ok(
  (select status = 'draft' and tone_hint = 'concise'
      and created_at = '2026-01-01 00:00:00+00'::timestamptz
      and created_by_user_id = '10000000-0000-4000-8000-000000000001'
    from public.pain_follow_up_notes
    where id = '60000000-0000-4000-8000-000000000001'),
  'reset preserves note identity, tone, and creation audit fields'
);
select is(
  (select updated_by_user_id from public.pain_follow_up_notes
    where id = '60000000-0000-4000-8000-000000000001'),
  '10000000-0000-4000-8000-000000000001'::uuid,
  'reset attributes the authenticated actor'
);
select ok(
  (select status = 'in_progress' and reason_for_visit = 'Recurring lumbar pain'
      and provider_intake = '{"history":"preserve me"}'::jsonb
      and patient_reported_pain_min = 3 and patient_reported_pain_max = 7
      and telehealth_consent_obtained and patient_location_state = 'CA'
    from public.clinical_encounters
    where id = '50000000-0000-4000-8000-000000000001'),
  'reset preserves encounter status and clinical intake'
);

update public.pain_follow_up_notes
set status = 'failed', subjective = 'failed content', generation_error = 'failed'
where id = '60000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'a failed note can be reset'
);

update public.pain_follow_up_notes set status = 'generating'
where id = '60000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Only draft or failed follow-up notes can be reset',
  'generating notes cannot be reset'
);

update public.pain_follow_up_notes set status = 'finalized'
where id = '60000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Only draft or failed follow-up notes can be reset',
  'finalized notes cannot be reset'
);

update public.pain_follow_up_notes set status = 'draft'
where id = '60000000-0000-4000-8000-000000000001';
update public.clinical_encounters set status = 'scheduled'
where id = '50000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Follow-up encounter is not writable',
  'scheduled encounters cannot be reset'
);
update public.clinical_encounters set status = 'completed'
where id = '50000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Follow-up encounter is not writable',
  'completed encounters cannot be reset'
);
update public.clinical_encounters set status = 'cancelled'
where id = '50000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Follow-up encounter is not writable',
  'cancelled encounters cannot be reset'
);
update public.clinical_encounters set status = 'no_show'
where id = '50000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Follow-up encounter is not writable',
  'no-show encounters cannot be reset'
);

update public.clinical_encounters set status = 'in_progress'
where id = '50000000-0000-4000-8000-000000000001';
update public.care_episodes set status = 'discharged', ended_at = now()
where id = '40000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Care episode is not writable',
  'discharged episodes cannot be reset'
);
update public.care_episodes set status = 'active', ended_at = null
where id = '40000000-0000-4000-8000-000000000001';

update public.cases set case_status = 'pending_settlement'
where id = '30000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Case is not writable', 'pending-settlement cases cannot be reset'
);
update public.cases set case_status = 'closed'
where id = '30000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Case is not writable', 'closed cases cannot be reset'
);
update public.cases set case_status = 'archived'
where id = '30000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Case is not writable', 'archived cases cannot be reset'
);
update public.cases set case_status = 'active'
where id = '30000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000099',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0002', 'Follow-up note not found', 'reset rejects a case ownership mismatch'
);

update public.pain_follow_up_notes
set subjective = 'Content preserved through unfinalize',
    procedure_recommendations =
      '[{"recommendation_id":"61000000-0000-4000-8000-000000000001","procedure_type":"prp","sites":["Lumbar facet"],"diagnoses":[],"rationale":"Persistent pain"}]'::jsonb
where id = '60000000-0000-4000-8000-000000000001';

insert into public.documents (
  id, case_id, episode_id, encounter_id, document_type, file_name, file_path,
  status, uploaded_by_user_id, created_by_user_id, updated_by_user_id
) values
  ('70000000-0000-4000-8000-000000000001',
   '30000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   'generated', 'Follow-up A', 'cases/test/follow-up-a.pdf', 'reviewed',
   '10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000002',
   '30000000-0000-4000-8000-000000000001',
   '40000000-0000-4000-8000-000000000001',
   '50000000-0000-4000-8000-000000000001',
   'generated', 'Follow-up B', 'cases/test/follow-up-b.pdf', 'reviewed',
   '10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001',
   '10000000-0000-4000-8000-000000000001');

select lives_ok(
  $$select * from public.finalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    (select updated_at from public.pain_follow_up_notes
      where id = '60000000-0000-4000-8000-000000000001'))$$,
  'finalize accepts the matching note version'
);
select ok(
  (select n.status = 'finalized' and n.document_id = '70000000-0000-4000-8000-000000000001'
      and e.status = 'completed'
    from public.pain_follow_up_notes n
    join public.clinical_encounters e on e.id = n.encounter_id
    where n.id = '60000000-0000-4000-8000-000000000001'),
  'finalize links the document and completes the encounter'
);
select results_eq(
  $$select replayed from public.finalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    (select updated_at from public.pain_follow_up_notes
      where id = '60000000-0000-4000-8000-000000000001'))$$,
  $$values (true)$$,
  'finalize replay succeeds for the already-linked document'
);
select throws_ok(
  $$select * from public.finalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000002',
    (select updated_at from public.pain_follow_up_notes
      where id = '60000000-0000-4000-8000-000000000001'))$$,
  'P0001', 'Follow-up note changed; review and finalize again',
  'a competing finalized document is rejected'
);

select lives_ok(
  $$select public.unfinalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001')$$,
  'a finalized note can be unfinalized'
);
select ok(
  (select status = 'draft' and subjective = 'Content preserved through unfinalize'
      and jsonb_array_length(procedure_recommendations) = 1 and document_id is null
    from public.pain_follow_up_notes
    where id = '60000000-0000-4000-8000-000000000001'),
  'unfinalize preserves the current generated-content state and clears finalization linkage'
);
select ok(
  (select d.deleted_at is not null and e.status = 'in_progress'
      and e.completed_at is null
    from public.documents d
    join public.clinical_encounters e
      on e.id = '50000000-0000-4000-8000-000000000001'
    where d.id = '70000000-0000-4000-8000-000000000001'),
  'unfinalize soft-deletes the document and reopens the encounter'
);
select lives_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'reset succeeds after unfinalize'
);

insert into public.clinical_encounters (
  id, case_id, episode_id, encounter_type, status, encounter_date,
  created_by_user_id, updated_by_user_id
) values (
  '50000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  'pain_follow_up', 'in_progress', '2026-09-02',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);
insert into public.pain_follow_up_notes (
  id, case_id, episode_id, encounter_id, subjective, status, updated_at,
  created_by_user_id, updated_by_user_id
) values (
  '60000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  'stale content', 'draft', '2026-01-01 00:00:00+00',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);
insert into public.documents (
  id, case_id, episode_id, encounter_id, document_type, file_name, file_path,
  status, uploaded_by_user_id, created_by_user_id, updated_by_user_id
) values (
  '70000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000002',
  'generated', 'Stale Follow-up', 'cases/test/follow-up-stale.pdf', 'reviewed',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);
select lives_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002')$$,
  'the stale-version fixture resets from an explicitly old timestamp'
);
select throws_ok(
  $$select * from public.finalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000002',
    '60000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000004',
    '2026-01-01 00:00:00+00'::timestamptz)$$,
  'P0001', 'Follow-up note changed; review and finalize again',
  'reset wins over finalization carrying a stale note version'
);
select ok(
  (select n.status = 'draft' and n.document_id is null
      and e.status = 'in_progress'
    from public.pain_follow_up_notes n
    join public.clinical_encounters e on e.id = n.encounter_id
    where n.id = '60000000-0000-4000-8000-000000000002'),
  'stale finalization leaves the reset note and encounter unchanged'
);

insert into public.documents (
  id, case_id, episode_id, encounter_id, document_type, file_name, file_path,
  status, uploaded_by_user_id, created_by_user_id, updated_by_user_id
) values (
  '70000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'generated', 'Follow-up C', 'cases/test/follow-up-c.pdf', 'reviewed',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);
select lives_ok(
  $$select * from public.finalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000003',
    (select updated_at from public.pain_follow_up_notes
      where id = '60000000-0000-4000-8000-000000000001'))$$,
  'finalization can win before a reset'
);
select throws_ok(
  $$select public.reset_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Only draft or failed follow-up notes can be reset',
  'reset loses after finalization commits first'
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
insert into public.procedure_orders (
  id, case_id, episode_id, source_encounter_id, source_recommendation_id,
  procedure_series_id, procedure_type, sites, diagnoses, status,
  created_by_user_id, updated_by_user_id
) values (
  '81000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  '61000000-0000-4000-8000-000000000002',
  '80000000-0000-4000-8000-000000000001', 'prp', '[]'::jsonb, '[]'::jsonb,
  'ordered', '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);
select throws_ok(
  $$select public.unfinalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Remove procedure orders and billing claims before reopening this note',
  'procedure orders block unfinalize'
);
update public.procedure_orders set deleted_at = now()
where id = '81000000-0000-4000-8000-000000000001';

insert into public.invoices (
  id, case_id, invoice_number, invoice_date, status,
  created_by_user_id, updated_by_user_id
) values (
  '90000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'FOLLOW-UP-RESET-INVOICE', current_date, 'draft',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);
insert into public.billing_source_claims (
  id, invoice_id, encounter_id, claim_kind,
  created_by_user_id, updated_by_user_id
) values (
  '91000000-0000-4000-8000-000000000001',
  '90000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001', 'visit',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);
select throws_ok(
  $$select public.unfinalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Remove procedure orders and billing claims before reopening this note',
  'unreleased billing claims block unfinalize'
);
update public.billing_source_claims set released_at = now(), release_reason = 'test'
where id = '91000000-0000-4000-8000-000000000001';
select lives_ok(
  $$select public.unfinalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001')$$,
  'unfinalize succeeds after dependencies are resolved'
);
select ok(
  (select n.status = 'draft' and e.status = 'in_progress'
      and n.updated_by_user_id = '10000000-0000-4000-8000-000000000001'
      and e.updated_by_user_id = '10000000-0000-4000-8000-000000000001'
    from public.pain_follow_up_notes n
    join public.clinical_encounters e on e.id = n.encounter_id
    where n.id = '60000000-0000-4000-8000-000000000001'),
  'unfinalize attributes the actor and preserves the reopened state'
);
select throws_ok(
  $$select public.unfinalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Finalized note is not writable',
  'a non-finalized note cannot be unfinalized'
);

insert into public.documents (
  id, case_id, episode_id, encounter_id, document_type, file_name, file_path,
  status, uploaded_by_user_id, created_by_user_id, updated_by_user_id
) values (
  '70000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'generated', 'Lifecycle Follow-up', 'cases/test/follow-up-lifecycle.pdf', 'reviewed',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
);
update public.pain_follow_up_notes
set status = 'finalized', document_id = '70000000-0000-4000-8000-000000000005',
    finalized_at = now(), finalized_by_user_id = '10000000-0000-4000-8000-000000000001'
where id = '60000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.unfinalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Finalized note is not writable',
  'an in-progress encounter cannot be unfinalized'
);
update public.clinical_encounters set status = 'completed', completed_at = now()
where id = '50000000-0000-4000-8000-000000000001';
update public.care_episodes set status = 'discharged', ended_at = now()
where id = '40000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.unfinalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Finalized note is not writable',
  'an inactive episode cannot be unfinalized'
);
update public.care_episodes set status = 'active', ended_at = null
where id = '40000000-0000-4000-8000-000000000001';

update public.cases set case_status = 'pending_settlement'
where id = '30000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.unfinalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Finalized note is not writable',
  'pending-settlement cases cannot be unfinalized'
);
update public.cases set case_status = 'closed'
where id = '30000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.unfinalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Finalized note is not writable',
  'closed cases cannot be unfinalized'
);
update public.cases set case_status = 'archived'
where id = '30000000-0000-4000-8000-000000000001';
select throws_ok(
  $$select public.unfinalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Finalized note is not writable',
  'archived cases cannot be unfinalized'
);
update public.cases set case_status = 'active'
where id = '30000000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.unfinalize_pain_follow_up(
    '30000000-0000-4000-8000-000000000099',
    '60000000-0000-4000-8000-000000000001')$$,
  'P0001', 'Finalized note is not writable',
  'unfinalize rejects a case ownership mismatch'
);

select * from finish();
rollback;
