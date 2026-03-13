-- Fix: update_case_billing_totals() was referencing NEW.invoice_id
-- which doesn't exist on the invoices table (that's a column on invoice_line_items).
-- The trigger only fires on invoices, so we access case_id directly from NEW/OLD.
create or replace function update_case_billing_totals()
returns trigger as $$
declare
  target_case_id uuid;
begin
  if TG_OP = 'DELETE' then
    target_case_id := OLD.case_id;
  else
    target_case_id := NEW.case_id;
  end if;

  update public.cases
  set
    total_billed = coalesce((
      select sum(total_amount) from public.invoices
      where case_id = target_case_id and deleted_at is null
    ), 0),
    total_paid = coalesce((
      select sum(paid_amount) from public.invoices
      where case_id = target_case_id and deleted_at is null
    ), 0),
    balance_due = coalesce((
      select sum(total_amount - paid_amount) from public.invoices
      where case_id = target_case_id and deleted_at is null
    ), 0)
  where id = target_case_id;

  return coalesce(NEW, OLD);
end;
$$ language plpgsql;
