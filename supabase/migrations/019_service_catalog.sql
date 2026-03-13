-- ============================================
-- SERVICE CATALOG TABLE
-- ============================================
create table public.service_catalog (
  id                    uuid primary key default gen_random_uuid(),
  cpt_code              text not null,
  description           text not null,
  default_price         numeric(10,2) not null default 0,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  created_by_user_id    uuid references public.users(id),
  updated_by_user_id    uuid references public.users(id)
);

create index idx_service_catalog_cpt_code on public.service_catalog(cpt_code);

create trigger set_updated_at before update on public.service_catalog
  for each row execute function update_updated_at();

alter table public.service_catalog enable row level security;

create policy "Authenticated users full access" on public.service_catalog
  for all using (auth.role() = 'authenticated');

-- ============================================
-- SEED DEFAULT CATALOG ENTRIES
-- ============================================
insert into public.service_catalog (cpt_code, description, default_price, sort_order) values
  ('99204', 'Initial exam (45-60min)', 0, 1),
  ('76140', 'MRI review', 0, 2),
  ('0232T', 'PRP preparation and injection', 0, 3),
  ('86999', 'Blood draw and centrifuge', 0, 4),
  ('76942', 'Ultrasound guidance', 0, 5),
  ('99213', 'Follow up / Discharge visit', 0, 6);
