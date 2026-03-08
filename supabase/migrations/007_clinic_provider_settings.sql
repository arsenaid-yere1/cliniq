-- ============================================
-- CLINIC SETTINGS (singleton — one per clinic)
-- ============================================
create table public.clinic_settings (
  id uuid primary key default gen_random_uuid(),
  clinic_name text not null,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip_code text,
  phone text,
  email text,
  website text,
  logo_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  deleted_at timestamptz
);

create trigger set_updated_at before update on public.clinic_settings
  for each row execute function update_updated_at();

alter table public.clinic_settings enable row level security;
create policy "Authenticated users full access" on public.clinic_settings
  for all using (auth.role() = 'authenticated');

-- ============================================
-- PROVIDER PROFILES (one per user)
-- ============================================
create table public.provider_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  display_name text not null,
  credentials text,
  license_number text,
  npi_number text,
  signature_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  deleted_at timestamptz
);

-- One active profile per user
create unique index idx_provider_profiles_user_active
  on public.provider_profiles (user_id)
  where deleted_at is null;

create trigger set_updated_at before update on public.provider_profiles
  for each row execute function update_updated_at();

alter table public.provider_profiles enable row level security;
create policy "Authenticated users full access" on public.provider_profiles
  for all using (auth.role() = 'authenticated');
