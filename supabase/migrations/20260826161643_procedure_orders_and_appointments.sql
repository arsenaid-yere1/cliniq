create table public.procedure_orders (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  episode_id uuid not null,
  source_encounter_id uuid not null,
  source_recommendation_id uuid not null,
  procedure_series_id uuid not null,
  procedure_type text not null
    check (procedure_type in ('prp', 'cortisone', 'hyaluronic', 'botox')),
  sites jsonb not null default '[]'::jsonb,
  diagnoses jsonb not null default '[]'::jsonb,
  clinical_rationale text,
  priority text not null default 'routine'
    check (priority in ('routine', 'urgent')),
  status text not null default 'ordered'
    check (status in ('ordered', 'scheduled', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  constraint procedure_orders_sites_array check (jsonb_typeof(sites) = 'array'),
  constraint procedure_orders_diagnoses_array check (jsonb_typeof(diagnoses) = 'array'),
  constraint procedure_orders_episode_case_fkey
    foreign key (episode_id, case_id)
    references public.care_episodes(id, case_id),
  constraint procedure_orders_encounter_ownership_fkey
    foreign key (source_encounter_id, episode_id, case_id)
    references public.clinical_encounters(id, episode_id, case_id),
  constraint procedure_orders_series_ownership_fkey
    foreign key (procedure_series_id, episode_id, case_id)
    references public.procedure_series(id, episode_id, case_id),
  constraint procedure_orders_id_case_unique unique (id, case_id),
  constraint procedure_orders_id_episode_case_unique unique (id, episode_id, case_id)
);

create unique index procedure_orders_recommendation_active_idx
  on public.procedure_orders(source_encounter_id, source_recommendation_id)
  where deleted_at is null;
create index procedure_orders_episode_status_idx
  on public.procedure_orders(episode_id, status) where deleted_at is null;
create index procedure_orders_case_idx
  on public.procedure_orders(case_id, created_at desc) where deleted_at is null;

create table public.procedure_appointments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  episode_id uuid not null,
  procedure_order_id uuid not null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  provider_id uuid not null references public.provider_profiles(id),
  location text,
  notes text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled', 'no_show', 'completed')),
  cancellation_reason text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  constraint procedure_appointments_schedule_order
    check (scheduled_end > scheduled_start),
  constraint procedure_appointments_completed_at
    check (status <> 'completed' or completed_at is not null),
  constraint procedure_appointments_cancel_reason
    check (status <> 'cancelled' or length(btrim(cancellation_reason)) > 0),
  constraint procedure_appointments_episode_case_fkey
    foreign key (episode_id, case_id)
    references public.care_episodes(id, case_id),
  constraint procedure_appointments_order_ownership_fkey
    foreign key (procedure_order_id, episode_id, case_id)
    references public.procedure_orders(id, episode_id, case_id),
  constraint procedure_appointments_id_case_unique unique (id, case_id),
  constraint procedure_appointments_id_episode_case_unique unique (id, episode_id, case_id)
);

create unique index procedure_appointments_one_scheduled_idx
  on public.procedure_appointments(procedure_order_id)
  where status = 'scheduled' and deleted_at is null;
create index procedure_appointments_case_start_idx
  on public.procedure_appointments(case_id, scheduled_start desc)
  where deleted_at is null;
create index procedure_appointments_episode_start_idx
  on public.procedure_appointments(episode_id, scheduled_start desc)
  where deleted_at is null;
create index procedure_appointments_provider_start_idx
  on public.procedure_appointments(provider_id, scheduled_start)
  where status = 'scheduled' and deleted_at is null;

alter table public.procedures
  add column procedure_appointment_id uuid references public.procedure_appointments(id),
  add constraint procedures_appointment_ownership_fkey
    foreign key (procedure_appointment_id, episode_id, case_id)
    references public.procedure_appointments(id, episode_id, case_id);

create unique index procedures_appointment_active_idx
  on public.procedures(procedure_appointment_id)
  where procedure_appointment_id is not null and deleted_at is null;

create table public.billing_source_claims (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  encounter_id uuid references public.clinical_encounters(id),
  procedure_id uuid references public.procedures(id),
  claim_kind text not null check (claim_kind in ('visit', 'medical', 'facility')),
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  constraint billing_source_claims_one_source check (
    (encounter_id is not null and procedure_id is null and claim_kind = 'visit')
    or
    (encounter_id is null and procedure_id is not null and claim_kind in ('medical', 'facility'))
  )
);

create unique index billing_source_claims_encounter_active_idx
  on public.billing_source_claims(encounter_id, claim_kind)
  where encounter_id is not null and released_at is null;
create unique index billing_source_claims_procedure_active_idx
  on public.billing_source_claims(procedure_id, claim_kind)
  where procedure_id is not null and released_at is null;
create index billing_source_claims_invoice_idx
  on public.billing_source_claims(invoice_id) where released_at is null;

-- Existing invoices may legitimately have many CPT rows for one procedure on
-- one invoice, but one source/category cannot be active on multiple invoices.
do $$
begin
  if exists (
    select 1
    from public.invoice_line_items line
    join public.invoices invoice on invoice.id = line.invoice_id
    where line.procedure_id is not null
      and invoice.deleted_at is null
      and invoice.status <> 'void'
    group by
      line.procedure_id,
      case invoice.invoice_type when 'facility' then 'facility' else 'medical' end
    having count(distinct line.invoice_id) > 1
  ) then
    raise exception using
      errcode = 'unique_violation',
      message = 'Billing claim backfill blocked: a procedure/category is on multiple non-void invoices';
  end if;
end
$$;

insert into public.billing_source_claims (
  invoice_id,
  procedure_id,
  claim_kind,
  created_at
)
select distinct
  line.invoice_id,
  line.procedure_id,
  case invoice.invoice_type when 'facility' then 'facility' else 'medical' end,
  invoice.created_at
from public.invoice_line_items line
join public.invoices invoice on invoice.id = line.invoice_id
where line.procedure_id is not null
  and invoice.deleted_at is null
  and invoice.status <> 'void';

create table public.operation_idempotency (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.users(id),
  operation_type text not null check (length(btrim(operation_type)) > 0),
  client_key text not null check (length(btrim(client_key)) > 0),
  input_hash text not null check (length(btrim(input_hash)) > 0),
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed')),
  case_id uuid references public.cases(id),
  episode_id uuid references public.care_episodes(id),
  procedure_order_id uuid references public.procedure_orders(id),
  procedure_appointment_id uuid references public.procedure_appointments(id),
  procedure_id uuid references public.procedures(id),
  result jsonb not null default '{}'::jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint operation_idempotency_actor_operation_key_unique
    unique (actor_id, operation_type, client_key)
);

create index operation_idempotency_aggregate_idx
  on public.operation_idempotency(case_id, operation_type, created_at desc);

create or replace function public.enforce_billing_source_claim_ownership()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  invoice_case_id uuid;
  invoice_type_value text;
  source_case_id uuid;
  expected_kind text;
begin
  select invoice.case_id, invoice.invoice_type
  into invoice_case_id, invoice_type_value
  from public.invoices invoice
  where invoice.id = new.invoice_id;

  if new.encounter_id is not null then
    select encounter.case_id into source_case_id
    from public.clinical_encounters encounter
    where encounter.id = new.encounter_id;
    expected_kind := 'visit';
  else
    select procedure.case_id into source_case_id
    from public.procedures procedure
    where procedure.id = new.procedure_id;
    expected_kind := case invoice_type_value when 'facility' then 'facility' else 'medical' end;
  end if;

  if invoice_case_id is distinct from source_case_id or new.claim_kind <> expected_kind then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'Billing source claim must match the invoice case and category';
  end if;

  return new;
end
$$;

create trigger billing_source_claims_ownership_trg
  before insert or update of invoice_id, encounter_id, procedure_id, claim_kind
  on public.billing_source_claims
  for each row execute function public.enforce_billing_source_claim_ownership();

create trigger procedure_orders_updated_at_trg
  before update on public.procedure_orders
  for each row execute function public.update_updated_at();
create trigger procedure_appointments_updated_at_trg
  before update on public.procedure_appointments
  for each row execute function public.update_updated_at();
create trigger billing_source_claims_updated_at_trg
  before update on public.billing_source_claims
  for each row execute function public.update_updated_at();
create trigger operation_idempotency_updated_at_trg
  before update on public.operation_idempotency
  for each row execute function public.update_updated_at();

alter table public.procedure_orders enable row level security;
alter table public.procedure_appointments enable row level security;
alter table public.billing_source_claims enable row level security;
alter table public.operation_idempotency enable row level security;

revoke all on table public.procedure_orders from anon, authenticated;
revoke all on table public.procedure_appointments from anon, authenticated;
revoke all on table public.billing_source_claims from anon, authenticated;
revoke all on table public.operation_idempotency from anon, authenticated;
grant select, insert, update, delete on table public.procedure_orders to authenticated;
grant select, insert, update, delete on table public.procedure_appointments to authenticated;
grant select, insert, update, delete on table public.billing_source_claims to authenticated;
grant select, insert, update on table public.operation_idempotency to authenticated;

create policy procedure_orders_authenticated_select
  on public.procedure_orders for select to authenticated
  using ((select auth.uid()) is not null);
create policy procedure_orders_authenticated_insert
  on public.procedure_orders for insert to authenticated
  with check ((select auth.uid()) is not null);
create policy procedure_orders_authenticated_update
  on public.procedure_orders for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);
create policy procedure_orders_authenticated_delete
  on public.procedure_orders for delete to authenticated
  using ((select auth.uid()) is not null);

create policy procedure_appointments_authenticated_select
  on public.procedure_appointments for select to authenticated
  using ((select auth.uid()) is not null);
create policy procedure_appointments_authenticated_insert
  on public.procedure_appointments for insert to authenticated
  with check ((select auth.uid()) is not null);
create policy procedure_appointments_authenticated_update
  on public.procedure_appointments for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);
create policy procedure_appointments_authenticated_delete
  on public.procedure_appointments for delete to authenticated
  using ((select auth.uid()) is not null);

create policy billing_source_claims_authenticated_select
  on public.billing_source_claims for select to authenticated
  using ((select auth.uid()) is not null);
create policy billing_source_claims_authenticated_insert
  on public.billing_source_claims for insert to authenticated
  with check ((select auth.uid()) is not null);
create policy billing_source_claims_authenticated_update
  on public.billing_source_claims for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);
create policy billing_source_claims_authenticated_delete
  on public.billing_source_claims for delete to authenticated
  using ((select auth.uid()) is not null);

create policy operation_idempotency_actor_select
  on public.operation_idempotency for select to authenticated
  using ((select auth.uid()) = actor_id);
create policy operation_idempotency_actor_insert
  on public.operation_idempotency for insert to authenticated
  with check ((select auth.uid()) = actor_id);
create policy operation_idempotency_actor_update
  on public.operation_idempotency for update to authenticated
  using ((select auth.uid()) = actor_id)
  with check ((select auth.uid()) = actor_id);
