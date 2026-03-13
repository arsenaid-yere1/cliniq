-- ============================================
-- INVOICE NUMBER SEQUENCE
-- ============================================
create sequence invoice_number_seq start 1;

-- ============================================
-- AUTO-GENERATE INVOICE NUMBER
-- ============================================
create or replace function generate_invoice_number()
returns trigger as $$
begin
  new.invoice_number := 'INV-' || extract(year from now())::text || '-' || lpad(nextval('invoice_number_seq')::text, 4, '0');
  return new;
end;
$$ language plpgsql;

create trigger set_invoice_number
  before insert on public.invoices
  for each row
  execute function generate_invoice_number();

-- ============================================
-- ADD COLUMNS TO INVOICES
-- ============================================
alter table public.invoices
  add column invoice_type text not null default 'visit' check (invoice_type in ('visit', 'facility')),
  add column claim_type text not null default 'Personal Injury',
  add column indication text,
  add column diagnoses_snapshot jsonb not null default '[]',
  add column payee_name text,
  add column payee_address text;

-- ============================================
-- ADD SERVICE_DATE TO LINE ITEMS
-- ============================================
alter table public.invoice_line_items
  add column service_date date;

-- ============================================
-- UPDATE CASE BILLING TOTALS FUNCTION
-- ============================================
create or replace function update_case_billing_totals()
returns trigger as $$
declare
  target_case_id uuid;
begin
  -- Get the case_id from the invoice
  if TG_OP = 'DELETE' then
    select case_id into target_case_id from public.invoices where id = OLD.invoice_id;
  else
    select case_id into target_case_id from public.invoices where id = NEW.invoice_id;
  end if;

  -- If triggered from invoices table directly
  if TG_TABLE_NAME = 'invoices' then
    if TG_OP = 'DELETE' then
      target_case_id := OLD.case_id;
    else
      target_case_id := NEW.case_id;
    end if;
  end if;

  -- Recalculate totals
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

-- Trigger on invoice insert/update/delete
create trigger update_billing_totals_on_invoice
  after insert or update or delete on public.invoices
  for each row execute function update_case_billing_totals();
