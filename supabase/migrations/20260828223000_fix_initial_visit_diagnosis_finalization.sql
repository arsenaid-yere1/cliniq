-- Keep table-specific fields inside table-specific branches. PostgreSQL resolves
-- NEW fields for the trigger's actual row type, so a combined boolean expression
-- cannot safely reference pain_follow_up_notes.procedure_recommendations when the
-- same trigger function is running for initial_visit_notes.

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

  if tg_table_name = 'pain_follow_up_notes' then
    if exists (
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
  end if;

  return new;
end
$$;

revoke execute on function public.guard_note_diagnosis_finalization() from public, anon;
