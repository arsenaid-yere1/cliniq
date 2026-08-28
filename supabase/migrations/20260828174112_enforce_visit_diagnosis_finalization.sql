-- Enable diagnosis authority gates after application writers persist canonical snapshots.

create or replace function public.guard_note_diagnosis_finalization()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  authority jsonb;
  confirmed_at timestamptz;
  expected_text text;
begin
  if new.status <> 'finalized' or old.status = 'finalized' then
    return new;
  end if;

  if tg_table_name = 'procedure_notes' then
    select p.diagnoses into authority
    from public.procedures p
    where p.id = new.procedure_id and p.deleted_at is null;
    expected_text := 'DIAGNOSES:' || E'\n'
      || public.format_procedure_diagnoses(authority) || E'\n\nPLAN:';
    if authority is null
       or new.diagnoses_snapshot <> authority
       or left(coalesce(new.assessment_and_plan, ''), length(expected_text)) <> expected_text then
      raise exception using errcode = '23514', message = 'Procedure-note diagnoses do not match the procedure record';
    end if;
    return new;
  end if;

  select e.diagnoses, e.diagnoses_confirmed_at
  into authority, confirmed_at
  from public.clinical_encounters e
  where e.id = new.encounter_id and e.deleted_at is null;

  if confirmed_at is null
     or new.diagnoses_snapshot <> authority
     or coalesce(new.diagnoses, '') <> public.format_visit_diagnoses(authority) then
    raise exception using errcode = '23514', message = 'Finalized note diagnoses must match the confirmed encounter diagnoses';
  end if;

  if tg_table_name = 'pain_follow_up_notes' and exists (
    select 1
    from jsonb_array_elements(new.procedure_recommendations) recommendation,
         jsonb_array_elements(coalesce(recommendation -> 'diagnoses', '[]'::jsonb)) diagnosis
    where jsonb_typeof(diagnosis -> 'icd10_code') <> 'string'
       or btrim(diagnosis ->> 'icd10_code') = ''
       or not exists (
         select 1 from jsonb_array_elements(authority) allowed
         where upper(btrim(allowed ->> 'icd10_code')) = upper(btrim(diagnosis ->> 'icd10_code'))
       )
  ) then
    raise exception using errcode = '23514', message = 'Recommendation diagnoses must belong to the confirmed encounter pool';
  end if;
  return new;
end
$$;

create trigger initial_visit_notes_diagnosis_finalize_trg
before update of status on public.initial_visit_notes
for each row execute function public.guard_note_diagnosis_finalization();
create trigger pain_follow_up_notes_diagnosis_finalize_trg
before update of status on public.pain_follow_up_notes
for each row execute function public.guard_note_diagnosis_finalization();
create trigger procedure_notes_diagnosis_finalize_trg
before update of status on public.procedure_notes
for each row execute function public.guard_note_diagnosis_finalization();

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
  v_encounter public.clinical_encounters%rowtype;
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

  select e.* into v_encounter
  from public.clinical_encounters e
  join public.care_episodes ce on ce.id = e.episode_id and ce.case_id = e.case_id
  join public.cases c on c.id = e.case_id
  where e.id = p_encounter_id and e.case_id = p_case_id and e.encounter_type = 'pain_follow_up'
    and e.status = 'in_progress' and e.deleted_at is null
    and ce.status = 'active' and ce.deleted_at is null
    and c.case_status not in ('closed', 'archived') and c.deleted_at is null
  for update of e, ce, c;
  if not found then raise exception using errcode = 'P0001', message = 'Follow-up encounter is not writable'; end if;
  v_episode_id := v_encounter.episode_id;

  if v_encounter.diagnoses_confirmed_at is null
     or v_note.diagnoses_snapshot <> v_encounter.diagnoses
     or v_note.diagnoses <> public.format_visit_diagnoses(v_encounter.diagnoses) then
    raise exception using errcode = '23514', message = 'Follow-up diagnoses do not match the confirmed encounter pool';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(v_note.procedure_recommendations) recommendation,
         jsonb_array_elements(coalesce(recommendation -> 'diagnoses', '[]'::jsonb)) diagnosis
    where jsonb_typeof(diagnosis -> 'icd10_code') <> 'string'
       or btrim(diagnosis ->> 'icd10_code') = ''
       or not exists (
         select 1 from jsonb_array_elements(v_encounter.diagnoses) allowed
         where upper(btrim(allowed ->> 'icd10_code')) = upper(btrim(diagnosis ->> 'icd10_code'))
       )
  ) then
    raise exception using errcode = '23514', message = 'Recommendation diagnoses must belong to the confirmed encounter pool';
  end if;

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

revoke execute on function public.guard_note_diagnosis_finalization() from public, anon;
revoke execute on function public.finalize_pain_follow_up(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.finalize_pain_follow_up(uuid, uuid, uuid, uuid) to authenticated;
