-- Audited corrections for finalized discharge summaries.
-- Corrections revise the document only: the discharged episode, completed
-- encounter, and completed procedure series remain historical and unchanged.

create schema if not exists private;
revoke all on schema private from public, anon;

alter table public.discharge_notes
  add constraint discharge_notes_id_episode_case_unique
  unique (id, episode_id, case_id);

create table public.discharge_note_corrections (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  episode_id uuid not null,
  discharge_note_id uuid not null,
  revision_number integer not null check (revision_number >= 2),
  reason text not null check (length(btrim(reason)) >= 10),
  original_document_id uuid not null references public.documents(id),
  replacement_document_id uuid references public.documents(id),
  original_note_snapshot jsonb not null
    check (jsonb_typeof(original_note_snapshot) = 'object'),
  status text not null default 'open'
    check (status in ('open', 'finalized', 'cancelled')),
  opened_at timestamptz not null default now(),
  opened_by_user_id uuid not null references public.users(id),
  finalized_at timestamptz,
  finalized_by_user_id uuid references public.users(id),
  cancelled_at timestamptz,
  cancelled_by_user_id uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discharge_note_corrections_episode_case_fkey
    foreign key (episode_id, case_id)
    references public.care_episodes(id, case_id),
  constraint discharge_note_corrections_note_ownership_fkey
    foreign key (discharge_note_id, episode_id, case_id)
    references public.discharge_notes(id, episode_id, case_id),
  constraint discharge_note_corrections_lifecycle_check check (
    (status = 'open'
      and replacement_document_id is null
      and finalized_at is null
      and finalized_by_user_id is null
      and cancelled_at is null
      and cancelled_by_user_id is null)
    or
    (status = 'finalized'
      and replacement_document_id is not null
      and finalized_at is not null
      and finalized_by_user_id is not null
      and cancelled_at is null
      and cancelled_by_user_id is null)
    or
    (status = 'cancelled'
      and replacement_document_id is null
      and finalized_at is null
      and finalized_by_user_id is null
      and cancelled_at is not null
      and cancelled_by_user_id is not null)
  )
);

create unique index discharge_note_corrections_revision_idx
  on public.discharge_note_corrections(discharge_note_id, revision_number);
create unique index discharge_note_corrections_one_open_idx
  on public.discharge_note_corrections(discharge_note_id)
  where status = 'open';
create index discharge_note_corrections_case_episode_idx
  on public.discharge_note_corrections(case_id, episode_id, created_at desc);
create index discharge_note_corrections_original_document_idx
  on public.discharge_note_corrections(original_document_id);
create index discharge_note_corrections_replacement_document_idx
  on public.discharge_note_corrections(replacement_document_id)
  where replacement_document_id is not null;

create trigger discharge_note_corrections_updated_at_trg
  before update on public.discharge_note_corrections
  for each row execute function public.update_updated_at();

alter table public.discharge_note_corrections enable row level security;
revoke all on table public.discharge_note_corrections from anon, authenticated;
grant select on table public.discharge_note_corrections to authenticated;

create policy discharge_note_corrections_authenticated_select
  on public.discharge_note_corrections
  for select to authenticated
  using ((select auth.uid()) is not null);

create or replace function private.assert_discharge_correction_actor(
  p_case_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_is_active boolean;
  v_case_status text;
  v_assigned_provider_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select app_user.role, app_user.is_active
  into v_role, v_is_active
  from public.users app_user
  where app_user.id = v_actor;

  if not found or not coalesce(v_is_active, false) then
    raise exception using errcode = '42501', message = 'Active user account required';
  end if;

  select clinical_case.case_status, clinical_case.assigned_provider_id
  into v_case_status, v_assigned_provider_id
  from public.cases clinical_case
  where clinical_case.id = p_case_id
    and clinical_case.deleted_at is null;

  if not found then
    raise exception using errcode = 'P0002', message = 'Case not found';
  end if;

  if v_role = 'admin' then
    return;
  end if;

  if v_role = 'provider'
    and v_assigned_provider_id = v_actor
    and v_case_status not in ('pending_settlement', 'closed', 'archived')
  then
    return;
  end if;

  raise exception using
    errcode = '42501',
    message = 'Only an administrator or the assigned provider may correct this discharge';
end
$$;

create or replace function private.begin_discharge_correction(
  p_case_id uuid,
  p_episode_id uuid,
  p_note_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_note public.discharge_notes%rowtype;
  v_revision_number integer;
  v_correction_id uuid;
begin
  perform private.assert_discharge_correction_actor(p_case_id);

  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception using errcode = '22023', message = 'Correction reason must be at least 10 characters';
  end if;

  perform 1
  from public.cases clinical_case
  where clinical_case.id = p_case_id
    and clinical_case.deleted_at is null
  for update;

  -- The case lock serializes begins for this case. Check the audit row before
  -- requiring a finalized note so repeat/concurrent attempts receive the same
  -- correction-specific error after the first begin makes the note a draft.
  if exists (
    select 1
    from public.discharge_note_corrections correction
    where correction.discharge_note_id = p_note_id
      and correction.case_id = p_case_id
      and correction.episode_id = p_episode_id
      and correction.status = 'open'
  ) then
    raise exception using errcode = '23505', message = 'A discharge correction is already in progress';
  end if;

  select note.*
  into v_note
  from public.discharge_notes note
  join public.care_episodes episode
    on episode.id = note.episode_id
    and episode.case_id = note.case_id
  join public.clinical_encounters encounter
    on encounter.id = note.encounter_id
    and encounter.episode_id = note.episode_id
    and encounter.case_id = note.case_id
  join public.documents document
    on document.id = note.document_id
    and document.case_id = note.case_id
    and document.episode_id = note.episode_id
    and document.encounter_id = note.encounter_id
    and document.deleted_at is null
  where note.id = p_note_id
    and note.case_id = p_case_id
    and note.episode_id = p_episode_id
    and note.status = 'finalized'
    and note.deleted_at is null
    and episode.status = 'discharged'
    and episode.deleted_at is null
    and encounter.encounter_type = 'discharge'
    and encounter.status = 'completed'
    and encounter.deleted_at is null
  for update of note, episode, encounter, document;

  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'Only a finalized discharge in a discharged episode can be corrected';
  end if;

  if exists (
    select 1
    from public.billing_source_claims claim
    where claim.encounter_id = v_note.encounter_id
      and claim.claim_kind = 'visit'
      and claim.released_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Remove this discharge visit from its invoice or void the invoice before correcting it';
  end if;

  select coalesce(max(correction.revision_number), 1) + 1
  into v_revision_number
  from public.discharge_note_corrections correction
  where correction.discharge_note_id = p_note_id;

  insert into public.discharge_note_corrections (
    case_id,
    episode_id,
    discharge_note_id,
    revision_number,
    reason,
    original_document_id,
    original_note_snapshot,
    opened_by_user_id
  ) values (
    p_case_id,
    p_episode_id,
    p_note_id,
    v_revision_number,
    btrim(p_reason),
    v_note.document_id,
    to_jsonb(v_note),
    v_actor
  )
  returning id into v_correction_id;

  update public.discharge_notes
  set
    status = 'draft',
    document_id = null,
    finalized_at = null,
    finalized_by_user_id = null,
    updated_by_user_id = v_actor
  where id = p_note_id;

  return v_correction_id;
end
$$;

create or replace function private.save_discharge_correction(
  p_case_id uuid,
  p_episode_id uuid,
  p_note_id uuid,
  p_correction_id uuid,
  p_values jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_allowed_keys text[] := array[
    'visit_date',
    'subjective',
    'objective_vitals',
    'objective_general',
    'objective_cervical',
    'objective_lumbar',
    'objective_neurological',
    'diagnoses',
    'assessment',
    'plan_and_recommendations',
    'patient_education',
    'prognosis',
    'clinician_disclaimer'
  ];
begin
  perform private.assert_discharge_correction_actor(p_case_id);

  if p_values is null
    or jsonb_typeof(p_values) <> 'object'
    or not (p_values ?& v_allowed_keys)
    or (p_values - v_allowed_keys) <> '{}'::jsonb
  then
    raise exception using errcode = '22023', message = 'Invalid discharge correction fields';
  end if;

  if exists (
    select 1
    from unnest(v_allowed_keys[2:13]) field_name
    where jsonb_typeof(p_values -> field_name) <> 'string'
      or length(btrim(p_values ->> field_name)) = 0
  ) then
    raise exception using errcode = '22023', message = 'All discharge sections are required';
  end if;

  perform 1
  from public.discharge_note_corrections correction
  join public.discharge_notes note
    on note.id = correction.discharge_note_id
    and note.episode_id = correction.episode_id
    and note.case_id = correction.case_id
  where correction.id = p_correction_id
    and correction.case_id = p_case_id
    and correction.episode_id = p_episode_id
    and correction.discharge_note_id = p_note_id
    and correction.status = 'open'
    and note.status = 'draft'
    and note.deleted_at is null
  for update of correction, note;

  if not found then
    raise exception using errcode = 'P0001', message = 'Open discharge correction not found';
  end if;

  update public.discharge_notes
  set
    visit_date = nullif(p_values ->> 'visit_date', '')::date,
    subjective = p_values ->> 'subjective',
    objective_vitals = p_values ->> 'objective_vitals',
    objective_general = p_values ->> 'objective_general',
    objective_cervical = p_values ->> 'objective_cervical',
    objective_lumbar = p_values ->> 'objective_lumbar',
    objective_neurological = p_values ->> 'objective_neurological',
    diagnoses = p_values ->> 'diagnoses',
    assessment = p_values ->> 'assessment',
    plan_and_recommendations = p_values ->> 'plan_and_recommendations',
    patient_education = p_values ->> 'patient_education',
    prognosis = p_values ->> 'prognosis',
    clinician_disclaimer = p_values ->> 'clinician_disclaimer',
    updated_by_user_id = v_actor
  where id = p_note_id;

  return p_note_id;
end
$$;

create or replace function private.cancel_discharge_correction(
  p_case_id uuid,
  p_episode_id uuid,
  p_note_id uuid,
  p_correction_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_snapshot jsonb;
begin
  perform private.assert_discharge_correction_actor(p_case_id);

  select correction.original_note_snapshot
  into v_snapshot
  from public.discharge_note_corrections correction
  join public.discharge_notes note
    on note.id = correction.discharge_note_id
    and note.episode_id = correction.episode_id
    and note.case_id = correction.case_id
  where correction.id = p_correction_id
    and correction.case_id = p_case_id
    and correction.episode_id = p_episode_id
    and correction.discharge_note_id = p_note_id
    and correction.status = 'open'
    and note.status = 'draft'
    and note.deleted_at is null
  for update of correction, note;

  if not found then
    raise exception using errcode = 'P0001', message = 'Open discharge correction not found';
  end if;

  update public.discharge_notes
  set
    visit_date = (v_snapshot ->> 'visit_date')::date,
    subjective = v_snapshot ->> 'subjective',
    objective_vitals = v_snapshot ->> 'objective_vitals',
    objective_general = v_snapshot ->> 'objective_general',
    objective_cervical = v_snapshot ->> 'objective_cervical',
    objective_lumbar = v_snapshot ->> 'objective_lumbar',
    objective_neurological = v_snapshot ->> 'objective_neurological',
    diagnoses = v_snapshot ->> 'diagnoses',
    assessment = v_snapshot ->> 'assessment',
    plan_and_recommendations = v_snapshot ->> 'plan_and_recommendations',
    patient_education = v_snapshot ->> 'patient_education',
    prognosis = v_snapshot ->> 'prognosis',
    clinician_disclaimer = v_snapshot ->> 'clinician_disclaimer',
    ai_model = v_snapshot ->> 'ai_model',
    raw_ai_response = nullif(v_snapshot -> 'raw_ai_response', 'null'::jsonb),
    status = v_snapshot ->> 'status',
    generation_error = v_snapshot ->> 'generation_error',
    generation_attempts = (v_snapshot ->> 'generation_attempts')::integer,
    source_data_hash = v_snapshot ->> 'source_data_hash',
    sections_done = (v_snapshot ->> 'sections_done')::integer,
    sections_total = (v_snapshot ->> 'sections_total')::integer,
    tone_hint = v_snapshot ->> 'tone_hint',
    bp_systolic = (v_snapshot ->> 'bp_systolic')::integer,
    bp_diastolic = (v_snapshot ->> 'bp_diastolic')::integer,
    heart_rate = (v_snapshot ->> 'heart_rate')::integer,
    respiratory_rate = (v_snapshot ->> 'respiratory_rate')::integer,
    temperature_f = (v_snapshot ->> 'temperature_f')::numeric,
    spo2_percent = (v_snapshot ->> 'spo2_percent')::integer,
    pain_score_min = (v_snapshot ->> 'pain_score_min')::integer,
    pain_score_max = (v_snapshot ->> 'pain_score_max')::integer,
    pain_trajectory_text = v_snapshot ->> 'pain_trajectory_text',
    discharge_pain_estimate_min = (v_snapshot ->> 'discharge_pain_estimate_min')::integer,
    discharge_pain_estimate_max = (v_snapshot ->> 'discharge_pain_estimate_max')::integer,
    discharge_pain_estimated = (v_snapshot ->> 'discharge_pain_estimated')::boolean,
    document_id = (v_snapshot ->> 'document_id')::uuid,
    finalized_at = (v_snapshot ->> 'finalized_at')::timestamptz,
    finalized_by_user_id = (v_snapshot ->> 'finalized_by_user_id')::uuid,
    updated_by_user_id = v_actor
  where id = p_note_id;

  update public.discharge_note_corrections
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_by_user_id = v_actor
  where id = p_correction_id;

  return p_note_id;
end
$$;

create or replace function private.finalize_discharge_correction(
  p_case_id uuid,
  p_episode_id uuid,
  p_note_id uuid,
  p_correction_id uuid,
  p_document_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_encounter_id uuid;
  v_correction_status text;
  v_existing_document_id uuid;
begin
  perform private.assert_discharge_correction_actor(p_case_id);

  select correction.status, correction.replacement_document_id, note.encounter_id
  into v_correction_status, v_existing_document_id, v_encounter_id
  from public.discharge_note_corrections correction
  join public.discharge_notes note
    on note.id = correction.discharge_note_id
    and note.episode_id = correction.episode_id
    and note.case_id = correction.case_id
  where correction.id = p_correction_id
    and correction.case_id = p_case_id
    and correction.episode_id = p_episode_id
    and correction.discharge_note_id = p_note_id
    and note.deleted_at is null
  for update of correction, note;

  if not found then
    raise exception using errcode = 'P0002', message = 'Discharge correction not found';
  end if;

  if v_correction_status = 'finalized' and v_existing_document_id = p_document_id then
    return p_note_id;
  end if;

  if v_correction_status <> 'open' then
    raise exception using errcode = 'P0001', message = 'Discharge correction is not open';
  end if;

  if not exists (
    select 1
    from public.discharge_notes note
    where note.id = p_note_id
      and note.status = 'draft'
      and note.document_id is null
      and note.deleted_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'Corrected discharge draft is not writable';
  end if;

  if exists (
    select 1
    from public.billing_source_claims claim
    where claim.encounter_id = v_encounter_id
      and claim.claim_kind = 'visit'
      and claim.released_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Remove this discharge visit from its invoice or void the invoice before finalizing the correction';
  end if;

  if not exists (
    select 1
    from public.documents document
    where document.id = p_document_id
      and document.case_id = p_case_id
      and document.episode_id = p_episode_id
      and document.encounter_id = v_encounter_id
      and document.document_type = 'generated'
      and document.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'Corrected discharge document not found';
  end if;

  update public.discharge_notes
  set
    status = 'finalized',
    document_id = p_document_id,
    finalized_at = now(),
    finalized_by_user_id = v_actor,
    updated_by_user_id = v_actor
  where id = p_note_id;

  update public.discharge_note_corrections
  set
    status = 'finalized',
    replacement_document_id = p_document_id,
    finalized_at = now(),
    finalized_by_user_id = v_actor
  where id = p_correction_id;

  return p_note_id;
end
$$;

create or replace function private.prevent_open_discharge_correction_claim()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.encounter_id is not null
    and new.claim_kind = 'visit'
    and new.released_at is null
    and exists (
      select 1
      from public.discharge_note_corrections correction
      join public.discharge_notes note
        on note.id = correction.discharge_note_id
        and note.episode_id = correction.episode_id
        and note.case_id = correction.case_id
      where note.encounter_id = new.encounter_id
        and correction.status = 'open'
    )
  then
    raise exception using
      errcode = 'P0001',
      message = 'A discharge correction is in progress; finalize or cancel it before billing this visit';
  end if;
  return new;
end
$$;

create trigger billing_source_claims_open_discharge_correction_trg
  before insert on public.billing_source_claims
  for each row execute function private.prevent_open_discharge_correction_claim();

create or replace function public.begin_discharge_correction(
  p_case_id uuid,
  p_episode_id uuid,
  p_note_id uuid,
  p_reason text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.begin_discharge_correction(
    p_case_id,
    p_episode_id,
    p_note_id,
    p_reason
  )
$$;

create or replace function public.save_discharge_correction(
  p_case_id uuid,
  p_episode_id uuid,
  p_note_id uuid,
  p_correction_id uuid,
  p_values jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.save_discharge_correction(
    p_case_id,
    p_episode_id,
    p_note_id,
    p_correction_id,
    p_values
  )
$$;

create or replace function public.cancel_discharge_correction(
  p_case_id uuid,
  p_episode_id uuid,
  p_note_id uuid,
  p_correction_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.cancel_discharge_correction(
    p_case_id,
    p_episode_id,
    p_note_id,
    p_correction_id
  )
$$;

create or replace function public.finalize_discharge_correction(
  p_case_id uuid,
  p_episode_id uuid,
  p_note_id uuid,
  p_correction_id uuid,
  p_document_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.finalize_discharge_correction(
    p_case_id,
    p_episode_id,
    p_note_id,
    p_correction_id,
    p_document_id
  )
$$;

revoke all on function private.assert_discharge_correction_actor(uuid) from public, anon;
revoke all on function private.begin_discharge_correction(uuid, uuid, uuid, text) from public, anon;
revoke all on function private.save_discharge_correction(uuid, uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function private.cancel_discharge_correction(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function private.finalize_discharge_correction(uuid, uuid, uuid, uuid, uuid) from public, anon;
revoke all on function private.prevent_open_discharge_correction_claim() from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.begin_discharge_correction(uuid, uuid, uuid, text) to authenticated;
grant execute on function private.save_discharge_correction(uuid, uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function private.cancel_discharge_correction(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function private.finalize_discharge_correction(uuid, uuid, uuid, uuid, uuid) to authenticated;

revoke all on function public.begin_discharge_correction(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.save_discharge_correction(uuid, uuid, uuid, uuid, jsonb) from public, anon;
revoke all on function public.cancel_discharge_correction(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.finalize_discharge_correction(uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.begin_discharge_correction(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.save_discharge_correction(uuid, uuid, uuid, uuid, jsonb) to authenticated;
grant execute on function public.cancel_discharge_correction(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.finalize_discharge_correction(uuid, uuid, uuid, uuid, uuid) to authenticated;
