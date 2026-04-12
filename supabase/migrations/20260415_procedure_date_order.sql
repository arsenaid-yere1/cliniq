-- Enforce that a procedure's procedure_date does not precede the latest
-- live Initial Visit row (either visit_type) on the same case.
-- Live = deleted_at IS NULL. Null visit_date on the sibling skips the check.

create or replace function public.enforce_procedure_date_after_initial_visit()
returns trigger
language plpgsql
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
    and deleted_at is null
    and visit_date is not null;

  if floor_date is not null and new.procedure_date < floor_date then
    raise exception
      'Procedure date (%) cannot precede the Initial Visit date (%) on the same case',
      new.procedure_date, floor_date
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_procedure_date_after_initial_visit_trg on public.procedures;

create trigger enforce_procedure_date_after_initial_visit_trg
  before insert or update of procedure_date, deleted_at on public.procedures
  for each row
  execute function public.enforce_procedure_date_after_initial_visit();
