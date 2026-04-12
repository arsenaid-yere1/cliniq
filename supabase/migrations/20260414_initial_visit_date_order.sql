-- Enforce that the Initial Visit's visit_date precedes the Pain Evaluation
-- Visit's visit_date on the same case. Both rows are independent (one per
-- visit_type), so a single-row CHECK cannot express this — use a trigger
-- that queries the sibling row.
--
-- Rule: if both an initial_visit and a pain_evaluation_visit row exist
-- (live, deleted_at IS NULL) on the same case, then
--     initial_visit.visit_date <= pain_evaluation_visit.visit_date
-- Null visit_date on either side skips the check (we can't order nulls).

create or replace function public.enforce_initial_visit_date_order()
returns trigger
language plpgsql
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
      and visit_type = 'initial_visit'
      and deleted_at is null
    limit 1;

    if sibling_date is not null and new.visit_date < sibling_date then
      raise exception
        'Pain Evaluation Visit date (%) cannot precede the Initial Visit date (%) on the same case',
        new.visit_date, sibling_date
        using errcode = 'check_violation';
    end if;
  elsif new.visit_type = 'initial_visit' then
    -- The Initial Visit must not come after the Pain Evaluation Visit
    select visit_date into sibling_date
    from public.initial_visit_notes
    where case_id = new.case_id
      and visit_type = 'pain_evaluation_visit'
      and deleted_at is null
    limit 1;

    if sibling_date is not null and new.visit_date > sibling_date then
      raise exception
        'Initial Visit date (%) cannot follow the Pain Evaluation Visit date (%) on the same case',
        new.visit_date, sibling_date
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_initial_visit_date_order_trg on public.initial_visit_notes;

create trigger enforce_initial_visit_date_order_trg
  before insert or update of visit_date, visit_type, deleted_at on public.initial_visit_notes
  for each row
  execute function public.enforce_initial_visit_date_order();
