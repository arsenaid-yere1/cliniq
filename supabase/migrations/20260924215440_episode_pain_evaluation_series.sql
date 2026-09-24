-- Return Episodes begin with their own pain evaluation. Existing Episodes retain
-- their legacy workflow, and historical notes are never moved between Episodes.
alter table public.care_episodes
  add column requires_pain_evaluation boolean not null default false;

comment on column public.care_episodes.requires_pain_evaluation is
  'New return series must finalize pain evaluation before follow-up or discharge.';

drop index public.idx_initial_visit_notes_case_visit_type_active;
create unique index initial_visit_notes_episode_visit_type_active_idx
  on public.initial_visit_notes(episode_id, visit_type) where deleted_at is null;

create or replace function public.enforce_initial_visit_date_order()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  sibling_date date;
begin
  -- Only check live rows with a visit_date set
  if new.deleted_at is not null or new.visit_date is null then
    return new;
  end if;

  if new.visit_type = 'pain_evaluation_visit' then
    -- The Pain Evaluation Visit must not precede the Initial Visit
    select visit_date into sibling_date
    from public.initial_visit_notes
    where case_id = new.case_id
      and episode_id = new.episode_id
      and visit_type = 'initial_visit'
      and deleted_at is null
    limit 1;

    if sibling_date is not null and new.visit_date < sibling_date then
      raise exception
        'Pain Evaluation Visit date (%) cannot precede the Initial Visit date (%) in the same episode',
        new.visit_date, sibling_date
        using errcode = 'check_violation';
    end if;
  elsif new.visit_type = 'initial_visit' then
    -- The Initial Visit must not come after the Pain Evaluation Visit
    select visit_date into sibling_date
    from public.initial_visit_notes
    where case_id = new.case_id
      and episode_id = new.episode_id
      and visit_type = 'pain_evaluation_visit'
      and deleted_at is null
    limit 1;

    if sibling_date is not null and new.visit_date > sibling_date then
      raise exception
        'Initial Visit date (%) cannot follow the Pain Evaluation Visit date (%) in the same episode',
        new.visit_date, sibling_date
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_initial_visit_date_order_trg on public.initial_visit_notes;

create trigger enforce_initial_visit_date_order_trg
  before insert or update of case_id, episode_id, visit_date, visit_type, deleted_at on public.initial_visit_notes
  for each row
  execute function public.enforce_initial_visit_date_order();

create or replace function public.enforce_procedure_date_after_initial_visit()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  floor_date date;
begin
  if new.deleted_at is not null or new.procedure_date is null then
    return new;
  end if;

  select max(visit_date) into floor_date
  from public.initial_visit_notes
  where case_id = new.case_id
    and episode_id = new.episode_id
    and deleted_at is null
    and visit_date is not null;

  if floor_date is not null and new.procedure_date < floor_date then
    raise exception
      'Procedure date (%) cannot precede the Initial Visit date (%) in the same episode',
      new.procedure_date, floor_date
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_procedure_date_after_initial_visit_trg on public.procedures;

create trigger enforce_procedure_date_after_initial_visit_trg
  before insert or update of case_id, episode_id, procedure_date, deleted_at on public.procedures
  for each row
  execute function public.enforce_procedure_date_after_initial_visit();

create or replace function public.sync_initial_visit_note_encounter()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_expected_encounter_type text;
begin
  if new.deleted_at is not null then
    return new;
  end if;

  v_expected_encounter_type := case new.visit_type
    when 'pain_evaluation_visit' then 'pain_evaluation'
    else 'initial_evaluation'
  end;

  update public.clinical_encounters
  set
    status = case
      when new.status = 'finalized' then 'completed'
      when new.status = 'draft' and status = 'scheduled' then 'scheduled'
      else 'in_progress'
    end,
    encounter_date = coalesce(new.visit_date, encounter_date),
    completed_at = case
      when new.status = 'finalized' then coalesce(new.finalized_at, completed_at, now())
      else null
    end,
    updated_by_user_id = coalesce(new.updated_by_user_id, auth.uid(), updated_by_user_id)
  where id = new.encounter_id
    and case_id = new.case_id
    and episode_id = new.episode_id
    and encounter_type = v_expected_encounter_type
    and deleted_at is null;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Initial/Pain Evaluation note encounter type or ownership mismatch';
  end if;

  return new;
end
$$;

drop trigger if exists sync_initial_visit_note_encounter_trg
  on public.initial_visit_notes;
create trigger sync_initial_visit_note_encounter_trg
  after insert or update of status, finalized_at, visit_date, encounter_id, deleted_at
  on public.initial_visit_notes
  for each row execute function public.sync_initial_visit_note_encounter();

revoke execute on function public.sync_initial_visit_note_encounter()
  from public, anon, authenticated;


-- Qualify note columns that collide with RETURNS TABLE output variables.
create or replace function public.prepare_evaluation_visit(
  p_case_id uuid,
  p_visit_type text
)
returns table (episode_id uuid, encounter_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_episode_id uuid;
  target_encounter_id uuid;
  target_encounter_type text;
  assigned_provider_id uuid;
  target_status text;
  case_status text;
begin
  if actor_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if p_visit_type not in ('initial_visit', 'pain_evaluation_visit') then
    raise exception using errcode = '22023', message = 'Unsupported evaluation visit type';
  end if;
  target_encounter_type := case p_visit_type when 'pain_evaluation_visit' then 'pain_evaluation' else 'initial_evaluation' end;

  select ce.id, c.assigned_provider_id, ce.status, c.case_status
  into target_episode_id, assigned_provider_id, target_status, case_status
  from public.cases c
  join public.care_episodes ce on ce.case_id = c.id and ce.episode_number = 1 and ce.deleted_at is null
  where c.id = p_case_id and c.deleted_at is null
  for update of c, ce;
  if target_episode_id is null then raise exception using errcode = 'P0002', message = 'Episode 1 is required for the evaluation'; end if;
  if target_status <> 'active' or case_status in ('pending_settlement', 'closed', 'archived') then raise exception using errcode = 'P0001', message = 'Episode 1 is not writable'; end if;
  if assigned_provider_id is null then raise exception using errcode = '23502', message = 'Assign a provider before preparing this visit'; end if;

  select e.id into target_encounter_id
  from public.clinical_encounters e
  where e.episode_id = target_episode_id and e.encounter_type = target_encounter_type and e.deleted_at is null
  for update;

  if target_encounter_id is null then
    insert into public.clinical_encounters (
      case_id, episode_id, encounter_type, modality, status, encounter_date,
      provider_id, provider_intake, created_by_user_id, updated_by_user_id
    ) values (
      p_case_id, target_episode_id, target_encounter_type, 'unknown', 'in_progress', current_date,
      assigned_provider_id, '{}'::jsonb, actor_id, actor_id
    ) returning id into target_encounter_id;
  else
    update public.clinical_encounters e
    set provider_id = assigned_provider_id, updated_by_user_id = actor_id
    where e.id = target_encounter_id and e.provider_id is null;
  end if;

  insert into public.initial_visit_notes (
    case_id, episode_id, encounter_id, visit_type, visit_date, status,
    provider_intake, created_by_user_id, updated_by_user_id
  ) values (
    p_case_id, target_episode_id, target_encounter_id, p_visit_type, current_date, 'draft',
    '{}'::jsonb, actor_id, actor_id
  ) on conflict do nothing;

  update public.initial_visit_notes n
  set episode_id = target_episode_id, encounter_id = target_encounter_id, updated_by_user_id = actor_id
  where n.case_id = p_case_id and n.episode_id = target_episode_id
    and n.visit_type = p_visit_type and n.deleted_at is null
    and (n.episode_id is distinct from target_episode_id or n.encounter_id is distinct from target_encounter_id);

  return query select target_episode_id, target_encounter_id;
end
$$;

revoke execute on function public.prepare_evaluation_visit(uuid, text) from public, anon;
grant execute on function public.prepare_evaluation_visit(uuid, text) to authenticated;

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
  v_previous public.care_episodes%rowtype;
  v_discharge_date date;
  v_visit_date date := coalesce(p_encounter_date, p_scheduled_start::date, current_date);
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

  select episode.* into v_previous from public.care_episodes episode
  where episode.case_id = p_case_id and episode.deleted_at is null
  order by episode.episode_number desc limit 1 for update;
  if not found or v_previous.status <> 'discharged' then
    raise exception using errcode = 'P0001', message = 'The latest care episode must be discharged before starting a return visit';
  end if;
  select coalesce(n.visit_date, e.encounter_date, e.scheduled_start::date)
  into v_discharge_date
  from public.discharge_notes n
  join public.clinical_encounters e on e.id = n.encounter_id
    and e.case_id = n.case_id and e.episode_id = n.episode_id
  where n.episode_id = v_previous.id and n.case_id = p_case_id
    and n.status = 'finalized' and n.deleted_at is null
    and e.encounter_type = 'discharge' and e.status = 'completed' and e.deleted_at is null;
  if v_discharge_date is null then
    raise exception using errcode = 'P0001', message = 'A finalized discharge with a service date is required before starting a return visit';
  end if;
  if v_visit_date < v_discharge_date then
    raise exception using errcode = '23514', message = 'Return evaluation date cannot precede the previous discharge date';
  end if;

  select coalesce(max(episode.episode_number), 0) + 1
  into v_episode_number
  from public.care_episodes episode
  where episode.case_id = p_case_id;

  insert into public.care_episodes (
    case_id,
    episode_number,
    requires_pain_evaluation,
    status,
    opened_at,
    return_reason,
    created_by_user_id,
    updated_by_user_id
  ) values (
    p_case_id,
    v_episode_number,
    true,
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
    'pain_evaluation',
    p_modality,
    case when p_scheduled_start is null then 'in_progress' else 'scheduled' end,
    p_scheduled_start,
    p_scheduled_end,
    v_visit_date,
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

  insert into public.initial_visit_notes (
    case_id, episode_id, encounter_id, visit_type, visit_date, status,
    provider_intake, created_by_user_id, updated_by_user_id
  ) values (
    p_case_id, v_episode_id, v_encounter_id, 'pain_evaluation_visit', v_visit_date, 'draft',
    coalesce(p_provider_intake, '{}'::jsonb), v_actor_id, v_actor_id
  );

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

-- Serialize series progression on the Episode. Cancellations, soft deletion and
-- resets remain possible even when the evaluation has been reopened.
create or replace function public.guard_episode_evaluation_sequence()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_required boolean;
  v_evaluation_date date;
  v_service_date date;
begin
  if new.deleted_at is not null then return new; end if;
  if tg_table_name = 'clinical_encounters' then
    if new.encounter_type not in ('pain_follow_up', 'discharge')
      or new.status in ('cancelled', 'no_show') then return new; end if;
    if tg_op = 'UPDATE' and new.status = 'in_progress'
      and old.status in ('in_progress', 'completed')
      and new.case_id = old.case_id and new.episode_id = old.episode_id
      and new.encounter_type = old.encounter_type
      and new.encounter_date is not distinct from old.encounter_date
      and new.scheduled_start is not distinct from old.scheduled_start
      and old.deleted_at is null then return new; end if;
    v_service_date := coalesce(new.encounter_date, new.scheduled_start::date, current_date);
  else
    -- Reopening/resetting a note does not advance the series.
    if tg_op = 'UPDATE' and new.status in ('draft', 'failed') then
      if tg_table_name <> 'discharge_notes' then return new; end if;
      if new.visit_date is not distinct from old.visit_date then return new; end if;
    end if;
    if tg_table_name = 'discharge_notes' then
      v_service_date := new.visit_date;
    end if;
    select coalesce(v_service_date, e.encounter_date, e.scheduled_start::date, current_date)
      into v_service_date from public.clinical_encounters e where e.id = new.encounter_id;
  end if;

  select ce.requires_pain_evaluation into v_required
  from public.care_episodes ce where ce.id = new.episode_id and ce.case_id = new.case_id
  for update;
  if not coalesce(v_required, false) then return new; end if;
  select coalesce(n.visit_date, e.encounter_date, e.scheduled_start::date)
    into v_evaluation_date
  from public.initial_visit_notes n
  join public.clinical_encounters e on e.id = n.encounter_id
    and e.episode_id = n.episode_id and e.case_id = n.case_id
  where n.episode_id = new.episode_id and n.case_id = new.case_id
    and n.visit_type = 'pain_evaluation_visit' and n.status = 'finalized' and n.deleted_at is null
    and e.encounter_type = 'pain_evaluation' and e.status = 'completed' and e.deleted_at is null;
  if v_evaluation_date is null then
    raise exception using errcode = 'P0001', message = 'Finalize this episode''s pain evaluation before follow-up or discharge';
  end if;
  if v_service_date < v_evaluation_date then
    raise exception using errcode = '23514', message = 'Follow-up or discharge date cannot precede this episode''s pain evaluation date';
  end if;
  return new;
end
$$;

create trigger episode_evaluation_sequence_trg
  before insert or update of case_id, episode_id, encounter_type, status, encounter_date, scheduled_start, deleted_at
  on public.clinical_encounters for each row execute function public.guard_episode_evaluation_sequence();
create trigger episode_evaluation_sequence_trg
  before insert or update of case_id, episode_id, encounter_id, status, deleted_at
  on public.pain_follow_up_notes for each row execute function public.guard_episode_evaluation_sequence();
create trigger episode_evaluation_sequence_trg
  before insert or update of case_id, episode_id, encounter_id, status, visit_date, deleted_at
  on public.discharge_notes for each row execute function public.guard_episode_evaluation_sequence();

-- A reopened evaluation can be edited, but its date cannot invalidate existing
-- live downstream visits or precede the previous discharge's service date.
create or replace function public.guard_return_evaluation_date()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
declare
  v_episode public.care_episodes%rowtype;
  v_discharge_date date;
  v_next_date date;
begin
  if new.deleted_at is not null or new.visit_type <> 'pain_evaluation_visit' then return new; end if;
  -- Match audited finalization/reset lock order before the AFTER sync updates it.
  perform 1 from public.clinical_encounters e where e.id = new.encounter_id for update;
  select ce.* into v_episode from public.care_episodes ce
    where ce.id = new.episode_id and ce.case_id = new.case_id for update;
  if not coalesce(v_episode.requires_pain_evaluation, false) then return new; end if;
  if new.visit_date is null then
    raise exception using errcode = '23514', message = 'Return pain evaluation requires a service date';
  end if;
  select coalesce(n.visit_date, e.encounter_date, e.scheduled_start::date)
    into v_discharge_date
  from public.discharge_notes n
  join public.clinical_encounters e on e.id = n.encounter_id
  where n.episode_id = (
    select ce.id from public.care_episodes ce
    where ce.case_id = new.case_id and ce.episode_number < v_episode.episode_number and ce.deleted_at is null
    order by ce.episode_number desc limit 1
  ) and n.status = 'finalized' and n.deleted_at is null and e.deleted_at is null;
  if new.visit_date < v_discharge_date then
    raise exception using errcode = '23514', message = 'Return evaluation date cannot precede the previous discharge date';
  end if;
  select min(coalesce(e.encounter_date, e.scheduled_start::date)) into v_next_date
  from public.clinical_encounters e
  where e.episode_id = new.episode_id and e.case_id = new.case_id
    and e.encounter_type in ('pain_follow_up', 'discharge')
    and e.status not in ('cancelled', 'no_show') and e.deleted_at is null;
  if new.visit_date > v_next_date then
    raise exception using errcode = '23514', message = 'Pain evaluation date cannot follow existing follow-up or discharge visits';
  end if;
  return new;
end
$$;
create trigger return_evaluation_date_trg
  before insert or update of case_id, episode_id, visit_type, visit_date, status, deleted_at
  on public.initial_visit_notes for each row execute function public.guard_return_evaluation_date();

revoke execute on function public.guard_episode_evaluation_sequence(), public.guard_return_evaluation_date(),
  public.enforce_initial_visit_date_order(), public.enforce_procedure_date_after_initial_visit()
  from public, anon, authenticated;

create or replace function public.guard_episode_evaluation_requirement()
returns trigger
language plpgsql security invoker set search_path = ''
as $$
begin
  if old.requires_pain_evaluation and not new.requires_pain_evaluation then
    raise exception using errcode = '23514', message = 'An episode pain evaluation requirement cannot be removed';
  end if;
  return new;
end
$$;
create trigger episode_evaluation_requirement_trg
  before update of requires_pain_evaluation on public.care_episodes
  for each row execute function public.guard_episode_evaluation_requirement();
revoke execute on function public.guard_episode_evaluation_requirement() from public, anon, authenticated;
