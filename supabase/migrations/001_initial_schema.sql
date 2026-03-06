-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ============================================
-- USERS TABLE (extends Supabase auth.users)
-- ============================================
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null default 'staff' check (role in ('admin', 'provider', 'staff')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================
-- ATTORNEYS TABLE
-- ============================================
create table public.attorneys (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_name text not null,
  firm_name text,
  phone text,
  email text,
  fax text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip_code text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id)
);

-- ============================================
-- PATIENTS TABLE
-- ============================================
create table public.patients (
  id uuid primary key default uuid_generate_v4(),
  first_name text not null,
  last_name text not null,
  middle_name text,
  date_of_birth date not null,
  gender text check (gender in ('male', 'female', 'other', 'prefer_not_to_say')),
  phone_primary text,
  phone_secondary text,
  email text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id)
);

-- ============================================
-- CASE NUMBER SEQUENCE
-- ============================================
create sequence case_number_seq start 1;

-- ============================================
-- CASES TABLE
-- ============================================
create table public.cases (
  id uuid primary key default uuid_generate_v4(),
  case_number text not null unique,
  patient_id uuid not null references public.patients(id),
  attorney_id uuid references public.attorneys(id),
  accident_date date,
  accident_description text,
  accident_type text check (accident_type in ('auto', 'slip_and_fall', 'workplace', 'other')),
  case_status text not null default 'intake' check (case_status in ('intake', 'active', 'pending_settlement', 'closed', 'archived')),
  case_open_date date not null default current_date,
  case_close_date date,
  lien_on_file boolean not null default false,
  assigned_provider_id uuid references public.users(id),
  total_billed numeric(10,2) not null default 0,
  total_paid numeric(10,2) not null default 0,
  balance_due numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id)
);

-- ============================================
-- CASE NUMBER GENERATION FUNCTION
-- ============================================
create or replace function generate_case_number()
returns trigger as $$
begin
  new.case_number := 'PI-' || extract(year from now())::text || '-' || lpad(nextval('case_number_seq')::text, 4, '0');
  return new;
end;
$$ language plpgsql;

create trigger set_case_number
  before insert on public.cases
  for each row
  execute function generate_case_number();

-- ============================================
-- CASE STATUS HISTORY (audit)
-- ============================================
create table public.case_status_history (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id),
  previous_status text,
  new_status text not null,
  changed_at timestamptz not null default now(),
  changed_by_user_id uuid references public.users(id),
  notes text
);

-- ============================================
-- AUDIT LOG (append-only)
-- ============================================
create table public.audit_logs (
  id uuid primary key default uuid_generate_v4(),
  table_name text not null,
  record_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  performed_at timestamptz not null default now(),
  performed_by_user_id uuid
);

-- ============================================
-- UPDATED_AT TRIGGER (reusable)
-- ============================================
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on public.patients for each row execute function update_updated_at();
create trigger set_updated_at before update on public.cases for each row execute function update_updated_at();
create trigger set_updated_at before update on public.attorneys for each row execute function update_updated_at();
create trigger set_updated_at before update on public.users for each row execute function update_updated_at();

-- ============================================
-- INDEXES
-- ============================================
create index idx_patients_name on public.patients(last_name, first_name);
create index idx_patients_dob on public.patients(date_of_birth);
create index idx_cases_patient_id on public.cases(patient_id);
create index idx_cases_case_number on public.cases(case_number);
create index idx_cases_status on public.cases(case_status);
create index idx_cases_attorney_id on public.cases(attorney_id);
create index idx_case_status_history_case_id on public.case_status_history(case_id);
create index idx_audit_logs_table_record on public.audit_logs(table_name, record_id);

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table public.users enable row level security;
alter table public.patients enable row level security;
alter table public.cases enable row level security;
alter table public.attorneys enable row level security;
alter table public.case_status_history enable row level security;
alter table public.audit_logs enable row level security;

-- Authenticated users can read/write all records (single-clinic MVP)
create policy "Authenticated users full access" on public.users
  for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access" on public.patients
  for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access" on public.cases
  for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access" on public.attorneys
  for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access" on public.case_status_history
  for all using (auth.role() = 'authenticated');

create policy "Authenticated users can read audit logs" on public.audit_logs
  for select using (auth.role() = 'authenticated');

create policy "System can insert audit logs" on public.audit_logs
  for insert with check (true);

-- ============================================
-- USER SYNC: auto-create public.users on signup
-- ============================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'staff'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
