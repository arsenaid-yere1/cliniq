-- ============================================
-- EXTEND PROCEDURES TABLE WITH PRP FIELDS
-- ============================================
alter table public.procedures
  add column injection_site       text,
  add column laterality           text check (laterality in ('left', 'right', 'bilateral')),
  add column diagnoses            jsonb not null default '[]',
  add column consent_obtained     boolean,
  add column pain_rating          integer check (pain_rating >= 0 and pain_rating <= 10),
  add column procedure_number     integer;  -- 1st, 2nd, 3rd injection in series

-- GIN index for diagnoses search
create index idx_procedures_diagnoses on public.procedures using gin(diagnoses);

-- ============================================
-- VITAL SIGNS TABLE
-- ============================================
create table public.vital_signs (
  id                    uuid primary key default gen_random_uuid(),
  case_id               uuid not null references public.cases(id),
  procedure_id          uuid references public.procedures(id),
  recorded_at           timestamptz not null default now(),

  -- Vitals
  bp_systolic           integer,
  bp_diastolic          integer,
  heart_rate            integer,
  respiratory_rate      integer,
  temperature_f         numeric(4,1),
  spo2_percent          integer check (spo2_percent >= 0 and spo2_percent <= 100),

  -- Audit
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  created_by_user_id    uuid references public.users(id),
  updated_by_user_id    uuid references public.users(id)
);

create index idx_vital_signs_case_id on public.vital_signs(case_id);
create index idx_vital_signs_procedure_id on public.vital_signs(procedure_id);

create trigger set_updated_at before update on public.vital_signs
  for each row execute function update_updated_at();

alter table public.vital_signs enable row level security;

create policy "Authenticated users full access" on public.vital_signs
  for all using (auth.role() = 'authenticated');
