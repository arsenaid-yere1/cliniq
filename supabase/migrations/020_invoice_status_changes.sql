-- ============================================================
-- 020_invoice_status_changes.sql
-- Invoice status lifecycle: history table + status value updates
-- ============================================================

-- 1. Create invoice_status_history table (follows case_status_history pattern)
create table public.invoice_status_history (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  previous_status text,
  new_status text not null,
  changed_at timestamptz not null default now(),
  changed_by_user_id uuid references public.users(id),
  reason text,
  metadata jsonb
);

-- Indexes
create index idx_invoice_status_history_invoice on public.invoice_status_history(invoice_id);
create index idx_invoice_status_history_changed_at on public.invoice_status_history(changed_at);

-- RLS: same pattern as case_status_history
alter table public.invoice_status_history enable row level security;

create policy "Users can view invoice status history"
  on public.invoice_status_history for select
  using (auth.role() = 'authenticated');

create policy "Users can insert invoice status history"
  on public.invoice_status_history for insert
  with check (auth.role() = 'authenticated');

-- Append-only: no update or delete policies (HIPAA audit requirement)

-- 2. Migrate existing status values to new set
-- pending → issued (renamed)
update public.invoices set status = 'issued' where status = 'pending';
-- partial → paid (no partial status; treat as paid)
update public.invoices set status = 'paid' where status = 'partial';
-- denied → void (denied removed from MVP)
update public.invoices set status = 'void' where status = 'denied';

-- 3. Replace CHECK constraint with new status values
alter table public.invoices drop constraint invoices_status_check;
alter table public.invoices add constraint invoices_status_check
  check (status in ('draft', 'issued', 'paid', 'void', 'overdue', 'uncollectible'));

-- 4. Seed history for all existing non-draft invoices (audit backfill)
-- This creates a single "initial" history entry so the audit trail has a starting point
insert into public.invoice_status_history (invoice_id, previous_status, new_status, reason)
select id, null, status, 'Backfill: status at time of migration 020'
from public.invoices
where status != 'draft' and deleted_at is null;
