-- Restore the return-visit workflow that existed before visit-specific
-- diagnosis authority was introduced. Historical migrations remain intact;
-- this forward migration removes their schema and trigger effects.

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

revoke execute on function public.finalize_pain_follow_up(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.finalize_pain_follow_up(uuid, uuid, uuid, uuid) to authenticated;

drop trigger if exists initial_visit_notes_diagnosis_finalize_trg on public.initial_visit_notes;
drop trigger if exists pain_follow_up_notes_diagnosis_finalize_trg on public.pain_follow_up_notes;
drop trigger if exists procedure_notes_diagnosis_finalize_trg on public.procedure_notes;

drop trigger if exists initial_visit_notes_diagnosis_snapshot_trg on public.initial_visit_notes;
drop trigger if exists pain_follow_up_notes_diagnosis_snapshot_trg on public.pain_follow_up_notes;
drop trigger if exists procedure_notes_diagnosis_snapshot_trg on public.procedure_notes;

drop trigger if exists clinical_encounters_confirm_diagnoses_trg on public.clinical_encounters;

drop function if exists public.guard_note_diagnosis_finalization();
drop function if exists public.guard_note_diagnosis_snapshot();
drop function if exists public.authorize_encounter_diagnosis_confirmation();
drop function if exists public.prepare_evaluation_visit(uuid, text);

alter table public.initial_visit_notes
  drop column if exists diagnoses_snapshot;

alter table public.pain_follow_up_notes
  drop column if exists diagnoses_snapshot;

alter table public.procedure_notes
  drop column if exists diagnoses_snapshot;

alter table public.clinical_encounters
  drop column if exists diagnoses_confirmed_by_user_id,
  drop column if exists diagnoses_confirmed_at,
  drop column if exists diagnoses;

drop function if exists public.format_visit_diagnoses(jsonb);
drop function if exists public.format_procedure_diagnoses(jsonb);
drop function if exists public.valid_diagnosis_array(jsonb);
