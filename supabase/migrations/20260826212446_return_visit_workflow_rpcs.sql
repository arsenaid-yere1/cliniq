-- Phase 3 return-visit workflow functions.

create or replace function public.finalize_pain_follow_up(
  p_case_id uuid,
  p_encounter_id uuid,
  p_note_id uuid,
  p_document_id uuid
)
returns table (note_id uuid, encounter_id uuid, replayed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_episode_id uuid;
  v_note public.pain_follow_up_notes%rowtype;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;

  select n.* into v_note
  from public.pain_follow_up_notes n
  where n.id = p_note_id and n.case_id = p_case_id and n.encounter_id = p_encounter_id
    and n.deleted_at is null
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Follow-up note not found'; end if;
  if v_note.status = 'finalized' then
    return query select v_note.id, v_note.encounter_id, true;
    return;
  end if;

  select e.episode_id into v_episode_id
  from public.clinical_encounters e
  join public.care_episodes ce on ce.id = e.episode_id and ce.case_id = e.case_id
  join public.cases c on c.id = e.case_id
  where e.id = p_encounter_id and e.case_id = p_case_id and e.encounter_type = 'pain_follow_up'
    and e.status = 'in_progress' and e.deleted_at is null
    and ce.status = 'active' and ce.deleted_at is null
    and c.case_status not in ('closed', 'archived') and c.deleted_at is null
  for update of e, ce, c;
  if not found then raise exception using errcode = 'P0001', message = 'Follow-up encounter is not writable'; end if;

  if not exists (
    select 1 from public.documents d
    where d.id = p_document_id and d.case_id = p_case_id and d.deleted_at is null
  ) then raise exception using errcode = '23503', message = 'Generated document not found'; end if;

  update public.documents set episode_id = v_episode_id, encounter_id = p_encounter_id,
    updated_by_user_id = v_actor where id = p_document_id;
  update public.pain_follow_up_notes set status = 'finalized', document_id = p_document_id,
    finalized_at = now(), finalized_by_user_id = v_actor, updated_by_user_id = v_actor
    where id = p_note_id;
  update public.clinical_encounters set status = 'completed',
    encounter_date = coalesce(encounter_date, scheduled_start::date, current_date),
    completed_at = now(), updated_by_user_id = v_actor
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
  v_encounter_id uuid;
  v_document_id uuid;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select n.encounter_id, n.document_id into v_encounter_id, v_document_id
  from public.pain_follow_up_notes n
  join public.care_episodes e on e.id = n.episode_id and e.case_id = n.case_id
  join public.cases c on c.id = n.case_id
  where n.id = p_note_id and n.case_id = p_case_id and n.status = 'finalized'
    and n.deleted_at is null and e.status = 'active' and e.deleted_at is null
    and c.case_status not in ('closed', 'archived') and c.deleted_at is null
  for update of n, e, c;
  if not found then raise exception using errcode = 'P0001', message = 'Finalized note is not writable'; end if;
  if exists (select 1 from public.procedure_orders o where o.source_encounter_id = v_encounter_id and o.deleted_at is null)
    or exists (select 1 from public.billing_source_claims b where b.encounter_id = v_encounter_id and b.released_at is null)
  then raise exception using errcode = 'P0001', message = 'Remove procedure orders and billing claims before reopening this note'; end if;

  update public.pain_follow_up_notes set status = 'draft', finalized_at = null,
    finalized_by_user_id = null, document_id = null, updated_by_user_id = v_actor where id = p_note_id;
  update public.documents set deleted_at = now(), updated_by_user_id = v_actor
    where id = v_document_id and deleted_at is null;
  update public.clinical_encounters set status = 'in_progress', completed_at = null,
    updated_by_user_id = v_actor where id = v_encounter_id;
  return v_encounter_id;
end
$$;

create or replace function public.finalize_episode_discharge(
  p_case_id uuid,
  p_episode_id uuid,
  p_note_id uuid,
  p_document_id uuid
)
returns table (note_id uuid, episode_id uuid, replayed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_encounter_id uuid;
  v_note_status text;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select n.encounter_id, n.status into v_encounter_id, v_note_status
  from public.discharge_notes n
  where n.id = p_note_id and n.case_id = p_case_id and n.episode_id = p_episode_id
    and n.deleted_at is null for update;
  if not found then raise exception using errcode = 'P0002', message = 'Discharge note not found'; end if;
  if v_note_status = 'finalized' then return query select p_note_id, p_episode_id, true; return; end if;

  perform 1 from public.care_episodes e join public.cases c on c.id = e.case_id
  where e.id = p_episode_id and e.case_id = p_case_id and e.status = 'active'
    and e.deleted_at is null and c.case_status not in ('closed', 'archived') and c.deleted_at is null
  for update of e, c;
  if not found then raise exception using errcode = 'P0001', message = 'Care episode is not writable'; end if;

  if exists (select 1 from public.clinical_encounters e where e.episode_id = p_episode_id
      and e.id <> v_encounter_id and e.status in ('scheduled', 'in_progress') and e.deleted_at is null)
    or exists (select 1 from public.procedure_orders o where o.episode_id = p_episode_id
      and o.status in ('ordered', 'scheduled') and o.deleted_at is null)
    or exists (select 1 from public.procedure_appointments a where a.episode_id = p_episode_id
      and a.status = 'scheduled' and a.deleted_at is null)
  then raise exception using errcode = 'P0001', message = 'Resolve open visits and procedures before discharge'; end if;

  if not exists (select 1 from public.documents d where d.id = p_document_id and d.case_id = p_case_id and d.deleted_at is null)
  then raise exception using errcode = '23503', message = 'Generated document not found'; end if;

  update public.documents set episode_id = p_episode_id, encounter_id = v_encounter_id,
    updated_by_user_id = v_actor where id = p_document_id;
  update public.discharge_notes set status = 'finalized', document_id = p_document_id,
    finalized_at = now(), finalized_by_user_id = v_actor, updated_by_user_id = v_actor
    where id = p_note_id;
  update public.clinical_encounters set status = 'completed',
    encounter_date = coalesce(encounter_date, current_date), completed_at = now(),
    updated_by_user_id = v_actor where id = v_encounter_id;
  update public.procedure_series set status = 'completed', updated_by_user_id = v_actor
    where episode_id = p_episode_id and status = 'active' and deleted_at is null;
  update public.care_episodes set status = 'discharged', ended_at = now(),
    end_reason = 'finalized_discharge', updated_by_user_id = v_actor where id = p_episode_id;
  return query select p_note_id, p_episode_id, false;
end
$$;

revoke execute on function public.finalize_pain_follow_up(uuid, uuid, uuid, uuid) from public, anon;
revoke execute on function public.unfinalize_pain_follow_up(uuid, uuid) from public, anon;
revoke execute on function public.finalize_episode_discharge(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.finalize_pain_follow_up(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.unfinalize_pain_follow_up(uuid, uuid) to authenticated;
grant execute on function public.finalize_episode_discharge(uuid, uuid, uuid, uuid) to authenticated;
