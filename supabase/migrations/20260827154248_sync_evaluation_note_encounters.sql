-- Keep legacy Initial Visit / Pain Evaluation note lifecycle synchronized with
-- the encounter-native workflow. A finalized Pain Evaluation is a complete
-- qualifying visit even when an emergency case intentionally skips Initial
-- Evaluation.

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
    status = case when new.status = 'finalized' then 'completed' else 'in_progress' end,
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

-- Repair all live Initial Visit / Pain Evaluation notes written after the
-- episode ownership migration but before the lifecycle trigger existed.
update public.clinical_encounters e
set
  status = case when n.status = 'finalized' then 'completed' else 'in_progress' end,
  encounter_date = coalesce(n.visit_date, e.encounter_date),
  completed_at = case
    when n.status = 'finalized' then coalesce(n.finalized_at, e.completed_at, n.updated_at)
    else null
  end,
  updated_by_user_id = coalesce(n.updated_by_user_id, e.updated_by_user_id)
from public.initial_visit_notes n
where n.encounter_id = e.id
  and n.case_id = e.case_id
  and n.episode_id = e.episode_id
  and n.deleted_at is null
  and e.deleted_at is null
  and e.encounter_type = case n.visit_type
    when 'pain_evaluation_visit' then 'pain_evaluation'
    else 'initial_evaluation'
  end
  and (
    e.status is distinct from case when n.status = 'finalized' then 'completed' else 'in_progress' end
    or e.encounter_date is distinct from coalesce(n.visit_date, e.encounter_date)
    or (n.status = 'finalized' and e.completed_at is null)
    or (n.status <> 'finalized' and e.completed_at is not null)
  );

-- Repair only the known vitals-created phantom pattern. Genuine undocumented
-- encounters are preserved: the candidate must be an in-progress Initial
-- Evaluation with no note or downstream clinical/billing ownership, while a
-- Pain Evaluation note exists in the same episode and its non-procedure vitals
-- are the only remaining child records.
do $$
declare
  candidate record;
begin
  for candidate in
    select
      initial_encounter.id as phantom_encounter_id,
      pain_note.encounter_id as pain_encounter_id,
      pain_note.updated_by_user_id as actor_id
    from public.clinical_encounters initial_encounter
    join public.initial_visit_notes pain_note
      on pain_note.case_id = initial_encounter.case_id
     and pain_note.episode_id = initial_encounter.episode_id
     and pain_note.visit_type = 'pain_evaluation_visit'
     and pain_note.deleted_at is null
    where initial_encounter.encounter_type = 'initial_evaluation'
      and initial_encounter.status = 'in_progress'
      and initial_encounter.modality = 'unknown'
      and initial_encounter.scheduled_start is null
      and initial_encounter.scheduled_end is null
      and initial_encounter.reason_for_visit is null
      and initial_encounter.provider_intake = '{}'::jsonb
      and initial_encounter.patient_reported_pain_min is null
      and initial_encounter.patient_reported_pain_max is null
      and initial_encounter.patient_reported_measurements = '{}'::jsonb
      and initial_encounter.telehealth_consent_obtained is null
      and initial_encounter.deleted_at is null
      and exists (
        select 1 from public.vital_signs v
        where v.encounter_id = initial_encounter.id
          and v.procedure_id is null
          and v.deleted_at is null
      )
      and not exists (
        select 1 from public.initial_visit_notes n
        where n.encounter_id = initial_encounter.id and n.deleted_at is null
      )
      and not exists (
        select 1 from public.discharge_notes n
        where n.encounter_id = initial_encounter.id and n.deleted_at is null
      )
      and not exists (
        select 1 from public.pain_follow_up_notes n
        where n.encounter_id = initial_encounter.id and n.deleted_at is null
      )
      and not exists (
        select 1 from public.documents d
        where d.encounter_id = initial_encounter.id and d.deleted_at is null
      )
      and not exists (
        select 1 from public.clinical_orders o
        where o.encounter_id = initial_encounter.id and o.deleted_at is null
      )
      and not exists (
        select 1 from public.procedure_orders o
        where o.source_encounter_id = initial_encounter.id and o.deleted_at is null
      )
      and not exists (
        select 1 from public.procedures p
        where p.source_encounter_id = initial_encounter.id and p.deleted_at is null
      )
      and not exists (
        select 1 from public.invoice_line_items i
        where i.encounter_id = initial_encounter.id
      )
      and not exists (
        select 1 from public.billing_source_claims b
        where b.encounter_id = initial_encounter.id and b.released_at is null
      )
  loop
    update public.vital_signs
    set
      encounter_id = candidate.pain_encounter_id,
      updated_by_user_id = coalesce(candidate.actor_id, updated_by_user_id)
    where encounter_id = candidate.phantom_encounter_id
      and procedure_id is null
      and deleted_at is null;

    update public.clinical_encounters
    set
      deleted_at = now(),
      updated_by_user_id = coalesce(candidate.actor_id, updated_by_user_id)
    where id = candidate.phantom_encounter_id
      and deleted_at is null;
  end loop;
end
$$;

do $$
begin
  if exists (
    select 1
    from public.initial_visit_notes n
    join public.clinical_encounters e on e.id = n.encounter_id
    where n.deleted_at is null
      and e.deleted_at is null
      and (
        e.encounter_type <> case n.visit_type
          when 'pain_evaluation_visit' then 'pain_evaluation'
          else 'initial_evaluation'
        end
        or (n.status = 'finalized' and e.status <> 'completed')
        or (n.status <> 'finalized' and e.status <> 'in_progress')
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Initial/Pain Evaluation note and encounter lifecycle repair is incomplete';
  end if;
end
$$;
