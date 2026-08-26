-- Start a new care episode and its first pain follow-up encounter atomically.
-- The function is intentionally security invoker so table grants and RLS remain
-- authoritative for the authenticated caller.

create or replace function public.start_return_episode(
  p_case_id uuid,
  p_return_reason text,
  p_idempotency_key text,
  p_modality text,
  p_scheduled_start timestamptz,
  p_scheduled_end timestamptz,
  p_encounter_date date,
  p_provider_id uuid,
  p_provider_intake jsonb,
  p_patient_reported_pain_min integer,
  p_patient_reported_pain_max integer,
  p_patient_reported_measurements jsonb,
  p_telehealth_consent_obtained boolean,
  p_telehealth_consent_at timestamptz,
  p_patient_location_state text,
  p_provider_location text,
  p_connection_method text
)
returns table (
  episode_id uuid,
  encounter_id uuid,
  replayed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_case_status text;
  v_episode_number integer;
  v_episode_id uuid;
  v_encounter_id uuid;
  v_input_hash text;
  v_idempotency public.operation_idempotency%rowtype;
begin
  if v_actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if length(btrim(coalesce(p_return_reason, ''))) = 0 then
    raise exception using errcode = '22023', message = 'Return reason is required';
  end if;

  if length(btrim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception using errcode = '22023', message = 'Idempotency key is invalid';
  end if;

  if p_modality not in ('unknown', 'in_person', 'telehealth', 'phone') then
    raise exception using errcode = '22023', message = 'Encounter modality is invalid';
  end if;

  if p_scheduled_start is not null
     and p_scheduled_end is not null
     and p_scheduled_end <= p_scheduled_start then
    raise exception using errcode = '22023', message = 'Scheduled end must be after scheduled start';
  end if;

  if p_patient_reported_pain_min is not null
     and p_patient_reported_pain_max is not null
     and p_patient_reported_pain_min > p_patient_reported_pain_max then
    raise exception using errcode = '22023', message = 'Maximum pain must be greater than or equal to minimum pain';
  end if;

  if p_modality <> 'telehealth' and p_telehealth_consent_obtained is true then
    raise exception using errcode = '22023', message = 'Telehealth consent requires a telehealth encounter';
  end if;

  if jsonb_typeof(coalesce(p_provider_intake, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_patient_reported_measurements, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'Encounter intake and measurements must be objects';
  end if;

  v_input_hash := md5(jsonb_build_object(
    'case_id', p_case_id,
    'return_reason', btrim(p_return_reason),
    'modality', p_modality,
    'scheduled_start', p_scheduled_start,
    'scheduled_end', p_scheduled_end,
    'encounter_date', p_encounter_date,
    'provider_id', p_provider_id,
    'provider_intake', coalesce(p_provider_intake, '{}'::jsonb),
    'patient_reported_pain_min', p_patient_reported_pain_min,
    'patient_reported_pain_max', p_patient_reported_pain_max,
    'patient_reported_measurements', coalesce(p_patient_reported_measurements, '{}'::jsonb),
    'telehealth_consent_obtained', p_telehealth_consent_obtained,
    'telehealth_consent_at', p_telehealth_consent_at,
    'patient_location_state', p_patient_location_state,
    'provider_location', p_provider_location,
    'connection_method', p_connection_method
  )::text);

  insert into public.operation_idempotency (
    actor_id,
    operation_type,
    client_key,
    input_hash,
    case_id,
    status
  ) values (
    v_actor_id,
    'start_return_episode',
    btrim(p_idempotency_key),
    v_input_hash,
    p_case_id,
    'pending'
  )
  on conflict (actor_id, operation_type, client_key) do nothing;

  select operation.*
  into v_idempotency
  from public.operation_idempotency operation
  where operation.actor_id = v_actor_id
    and operation.operation_type = 'start_return_episode'
    and operation.client_key = btrim(p_idempotency_key)
  for update;

  if v_idempotency.input_hash <> v_input_hash then
    raise exception using
      errcode = '22023',
      message = 'Idempotency key was already used with different input';
  end if;

  if v_idempotency.status = 'completed' then
    return query select
      (v_idempotency.result ->> 'episode_id')::uuid,
      (v_idempotency.result ->> 'encounter_id')::uuid,
      true;
    return;
  end if;

  select clinical_case.case_status
  into v_case_status
  from public.cases clinical_case
  where clinical_case.id = p_case_id
    and clinical_case.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Case not found';
  end if;

  if v_case_status = 'archived' then
    raise exception using
      errcode = 'P0001',
      message = 'Archived cases must be moved to Closed before starting a return visit';
  end if;

  if v_case_status not in ('active', 'closed', 'pending_settlement') then
    raise exception using
      errcode = 'P0001',
      message = 'Case must be Active, Pending Settlement, or Closed to start a return visit';
  end if;

  if exists (
    select 1
    from public.care_episodes episode
    where episode.case_id = p_case_id
      and episode.status = 'active'
      and episode.deleted_at is null
  ) then
    raise exception using
      errcode = '23505',
      message = 'This case already has an active care episode';
  end if;

  select coalesce(max(episode.episode_number), 0) + 1
  into v_episode_number
  from public.care_episodes episode
  where episode.case_id = p_case_id;

  insert into public.care_episodes (
    case_id,
    episode_number,
    status,
    opened_at,
    return_reason,
    created_by_user_id,
    updated_by_user_id
  ) values (
    p_case_id,
    v_episode_number,
    'active',
    coalesce(p_scheduled_start, p_encounter_date::timestamptz, now()),
    btrim(p_return_reason),
    v_actor_id,
    v_actor_id
  )
  returning id into v_episode_id;

  insert into public.clinical_encounters (
    case_id,
    episode_id,
    encounter_type,
    modality,
    status,
    scheduled_start,
    scheduled_end,
    encounter_date,
    provider_id,
    reason_for_visit,
    provider_intake,
    patient_reported_pain_min,
    patient_reported_pain_max,
    patient_reported_measurements,
    telehealth_consent_obtained,
    telehealth_consent_at,
    patient_location_state,
    provider_location,
    connection_method,
    created_by_user_id,
    updated_by_user_id
  ) values (
    p_case_id,
    v_episode_id,
    'pain_follow_up',
    p_modality,
    case when p_scheduled_start is null then 'in_progress' else 'scheduled' end,
    p_scheduled_start,
    p_scheduled_end,
    p_encounter_date,
    p_provider_id,
    btrim(p_return_reason),
    coalesce(p_provider_intake, '{}'::jsonb),
    p_patient_reported_pain_min,
    p_patient_reported_pain_max,
    coalesce(p_patient_reported_measurements, '{}'::jsonb),
    p_telehealth_consent_obtained,
    p_telehealth_consent_at,
    nullif(btrim(p_patient_location_state), ''),
    nullif(btrim(p_provider_location), ''),
    nullif(btrim(p_connection_method), ''),
    v_actor_id,
    v_actor_id
  )
  returning id into v_encounter_id;

  if v_case_status in ('closed', 'pending_settlement') then
    update public.cases
    set
      case_status = 'active',
      case_close_date = null,
      updated_at = now(),
      updated_by_user_id = v_actor_id
    where id = p_case_id;

    insert into public.case_status_history (
      case_id,
      previous_status,
      new_status,
      changed_by_user_id,
      notes
    ) values (
      p_case_id,
      v_case_status,
      'active',
      v_actor_id,
      'Return to care: ' || btrim(p_return_reason)
    );
  end if;

  update public.operation_idempotency
  set
    status = 'completed',
    episode_id = v_episode_id,
    result = jsonb_build_object(
      'episode_id', v_episode_id,
      'encounter_id', v_encounter_id
    ),
    completed_at = now(),
    error_code = null
  where id = v_idempotency.id;

  return query select v_episode_id, v_encounter_id, false;
end
$$;

revoke all on function public.start_return_episode(
  uuid, text, text, text, timestamptz, timestamptz, date, uuid, jsonb,
  integer, integer, jsonb, boolean, timestamptz, text, text, text
) from public, anon;

grant execute on function public.start_return_episode(
  uuid, text, text, text, timestamptz, timestamptz, date, uuid, jsonb,
  integer, integer, jsonb, boolean, timestamptz, text, text, text
) to authenticated;
