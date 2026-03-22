-- ============================================
-- FEE ESTIMATE CONFIGURATION
-- Configurable line items for the cost estimate
-- sub-section in the Initial Visit Treatment Plan.
-- Each item has a fee category and min/max range.
-- ============================================
create table public.fee_estimate_config (
  id                    uuid primary key default gen_random_uuid(),
  description           text not null,
  fee_category          text not null default 'professional'
                        check (fee_category in ('professional', 'practice_center')),
  price_min             numeric(10,2) not null default 0,
  price_max             numeric(10,2) not null default 0,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  created_by_user_id    uuid references public.users(id),
  updated_by_user_id    uuid references public.users(id)
);

create index idx_fee_estimate_config_category on public.fee_estimate_config(fee_category);

create trigger set_updated_at before update on public.fee_estimate_config
  for each row execute function update_updated_at();

alter table public.fee_estimate_config enable row level security;

create policy "Authenticated users full access" on public.fee_estimate_config
  for all using (auth.role() = 'authenticated');

-- ============================================
-- SEED DEFAULT FEE ESTIMATE ITEMS
-- All at $0 — admin sets real ranges in Settings
-- ============================================
insert into public.fee_estimate_config (description, fee_category, price_min, price_max, sort_order) values
  ('Initial Consultation',              'professional',     0, 0, 1),
  ('PRP Injection (per region)',         'professional',     0, 0, 2),
  ('MRI Review',                         'professional',     0, 0, 3),
  ('Follow-up / Discharge Visit',        'professional',     0, 0, 4),
  ('Practice/Surgery Center Fee',        'practice_center',  0, 0, 5);
