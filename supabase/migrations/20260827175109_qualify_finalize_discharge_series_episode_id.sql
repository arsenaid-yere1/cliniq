-- The RETURNS TABLE output column `episode_id` is also a PL/pgSQL variable.
-- Qualify procedure_series columns so finalization does not fail with 42702.
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
  update public.procedure_series as series set status = 'completed', updated_by_user_id = v_actor
    where series.episode_id = p_episode_id and series.status = 'active' and series.deleted_at is null;
  update public.care_episodes set status = 'discharged', ended_at = now(),
    end_reason = 'finalized_discharge', updated_by_user_id = v_actor where id = p_episode_id;
  return query select p_note_id, p_episode_id, false;
end
$$;

revoke execute on function public.finalize_episode_discharge(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.finalize_episode_discharge(uuid, uuid, uuid, uuid) to authenticated;
