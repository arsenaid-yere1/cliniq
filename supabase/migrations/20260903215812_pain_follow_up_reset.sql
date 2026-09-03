-- Add transactional reset support and make all pain follow-up note lifecycle
-- transitions use the same note -> encounter -> episode -> case lock order.

create or replace function public.reset_pain_follow_up(
  p_case_id uuid,
  p_encounter_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_note public.pain_follow_up_notes%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select n.* into v_note
  from public.pain_follow_up_notes n
  where n.case_id = p_case_id
    and n.encounter_id = p_encounter_id
    and n.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Follow-up note not found';
  end if;

  if v_note.status not in ('draft', 'failed') then
    raise exception using
      errcode = 'P0001',
      message = 'Only draft or failed follow-up notes can be reset';
  end if;

  perform 1
  from public.clinical_encounters e
  where e.id = p_encounter_id
    and e.case_id = p_case_id
    and e.episode_id = v_note.episode_id
    and e.encounter_type = 'pain_follow_up'
    and e.status = 'in_progress'
    and e.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Follow-up encounter is not writable';
  end if;

  perform 1
  from public.care_episodes ce
  where ce.id = v_note.episode_id
    and ce.case_id = p_case_id
    and ce.status = 'active'
    and ce.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Care episode is not writable';
  end if;

  perform 1
  from public.cases c
  where c.id = p_case_id
    and c.case_status not in ('pending_settlement', 'closed', 'archived')
    and c.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Case is not writable';
  end if;

  update public.pain_follow_up_notes
  set status = 'draft',
      subjective = null,
      interval_history = null,
      review_of_systems = null,
      telehealth_observations = null,
      imaging_review = null,
      assessment = null,
      diagnoses = null,
      treatment_plan = null,
      patient_education = null,
      follow_up = null,
      clinician_disclaimer = null,
      procedure_recommendations = '[]'::jsonb,
      ai_model = null,
      raw_ai_response = null,
      generation_error = null,
      source_data_hash = null,
      generation_attempts = 0,
      sections_done = 0,
      sections_total = 11,
      updated_by_user_id = v_actor
  where id = v_note.id;

  return v_note.id;
end
$$;

drop function if exists public.finalize_pain_follow_up(uuid, uuid, uuid, uuid);

create function public.finalize_pain_follow_up(
  p_case_id uuid,
  p_encounter_id uuid,
  p_note_id uuid,
  p_document_id uuid,
  p_expected_updated_at timestamptz
)
returns table (note_id uuid, encounter_id uuid, replayed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_note public.pain_follow_up_notes%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select n.* into v_note
  from public.pain_follow_up_notes n
  where n.id = p_note_id
    and n.case_id = p_case_id
    and n.encounter_id = p_encounter_id
    and n.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Follow-up note not found';
  end if;

  if v_note.status = 'finalized' then
    if v_note.document_id is distinct from p_document_id then
      raise exception using
        errcode = 'P0001',
        message = 'Follow-up note changed; review and finalize again';
    end if;
    return query select v_note.id, v_note.encounter_id, true;
    return;
  end if;

  if v_note.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'Follow-up note is not a draft';
  end if;

  if v_note.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = 'P0001',
      message = 'Follow-up note changed; review and finalize again';
  end if;

  perform 1
  from public.clinical_encounters e
  where e.id = p_encounter_id
    and e.case_id = p_case_id
    and e.episode_id = v_note.episode_id
    and e.encounter_type = 'pain_follow_up'
    and e.status = 'in_progress'
    and e.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Follow-up encounter is not writable';
  end if;

  perform 1
  from public.care_episodes ce
  where ce.id = v_note.episode_id
    and ce.case_id = p_case_id
    and ce.status = 'active'
    and ce.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Care episode is not writable';
  end if;

  perform 1
  from public.cases c
  where c.id = p_case_id
    and c.case_status not in ('pending_settlement', 'closed', 'archived')
    and c.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Case is not writable';
  end if;

  if not exists (
    select 1
    from public.documents d
    where d.id = p_document_id
      and d.case_id = p_case_id
      and d.deleted_at is null
  ) then
    raise exception using errcode = '23503', message = 'Generated document not found';
  end if;

  update public.documents
  set episode_id = v_note.episode_id,
      encounter_id = p_encounter_id,
      updated_by_user_id = v_actor
  where id = p_document_id;

  update public.pain_follow_up_notes
  set status = 'finalized',
      document_id = p_document_id,
      finalized_at = now(),
      finalized_by_user_id = v_actor,
      updated_by_user_id = v_actor
  where id = p_note_id;

  update public.clinical_encounters
  set status = 'completed',
      encounter_date = coalesce(encounter_date, scheduled_start::date, current_date),
      completed_at = now(),
      updated_by_user_id = v_actor
  where id = p_encounter_id;

  return query select p_note_id, p_encounter_id, false;
end
$$;

create or replace function public.unfinalize_pain_follow_up(
  p_case_id uuid,
  p_note_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_note public.pain_follow_up_notes%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select n.* into v_note
  from public.pain_follow_up_notes n
  where n.id = p_note_id
    and n.case_id = p_case_id
    and n.deleted_at is null
  for update;

  if not found or v_note.status <> 'finalized' then
    raise exception using errcode = 'P0001', message = 'Finalized note is not writable';
  end if;

  perform 1
  from public.clinical_encounters e
  where e.id = v_note.encounter_id
    and e.case_id = p_case_id
    and e.episode_id = v_note.episode_id
    and e.encounter_type = 'pain_follow_up'
    and e.status = 'completed'
    and e.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Finalized note is not writable';
  end if;

  perform 1
  from public.care_episodes ce
  where ce.id = v_note.episode_id
    and ce.case_id = p_case_id
    and ce.status = 'active'
    and ce.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Finalized note is not writable';
  end if;

  perform 1
  from public.cases c
  where c.id = p_case_id
    and c.case_status not in ('pending_settlement', 'closed', 'archived')
    and c.deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'Finalized note is not writable';
  end if;

  if exists (
    select 1
    from public.procedure_orders o
    where o.source_encounter_id = v_note.encounter_id
      and o.deleted_at is null
  ) or exists (
    select 1
    from public.billing_source_claims b
    where b.encounter_id = v_note.encounter_id
      and b.released_at is null
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'Remove procedure orders and billing claims before reopening this note';
  end if;

  update public.pain_follow_up_notes
  set status = 'draft',
      finalized_at = null,
      finalized_by_user_id = null,
      document_id = null,
      updated_by_user_id = v_actor
  where id = v_note.id;

  update public.documents
  set deleted_at = now(),
      updated_by_user_id = v_actor
  where id = v_note.document_id
    and deleted_at is null;

  update public.clinical_encounters
  set status = 'in_progress',
      completed_at = null,
      updated_by_user_id = v_actor
  where id = v_note.encounter_id;

  return v_note.encounter_id;
end
$$;

revoke execute on function public.reset_pain_follow_up(uuid, uuid) from public, anon;
revoke execute on function public.finalize_pain_follow_up(uuid, uuid, uuid, uuid, timestamptz) from public, anon;
revoke execute on function public.unfinalize_pain_follow_up(uuid, uuid) from public, anon;

grant execute on function public.reset_pain_follow_up(uuid, uuid) to authenticated;
grant execute on function public.finalize_pain_follow_up(uuid, uuid, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.unfinalize_pain_follow_up(uuid, uuid) to authenticated;
