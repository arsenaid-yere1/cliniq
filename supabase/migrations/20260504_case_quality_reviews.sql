-- Migration: case_quality_reviews
-- Chain-aware QC reviewer output. One active row per case (partial unique).
-- Mirrors case_summaries DDL pattern.

create table public.case_quality_reviews (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),

  -- AI output payload
  findings jsonb not null default '[]',
  summary text,
  overall_assessment text check (overall_assessment in ('clean', 'minor_issues', 'major_issues', 'incomplete')),

  -- Provider override layer (sidecar). Keyed by finding hash → override entry.
  -- Wiped on regen (soft-delete + re-insert pattern).
  finding_overrides jsonb not null default '{}',

  -- Audit
  ai_model text,
  raw_ai_response jsonb,

  -- Generation tracking (mirrors case_summaries)
  generation_status text not null default 'pending'
    check (generation_status in ('pending', 'processing', 'completed', 'failed')),
  generation_error text,
  generation_attempts integer not null default 0,
  generated_at timestamptz,
  source_data_hash text,
  sections_done integer not null default 0,
  sections_total integer not null default 0,

  -- Standard audit timestamps
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  deleted_at timestamptz
);

create index idx_case_quality_reviews_case_id on public.case_quality_reviews(case_id);
create index idx_case_quality_reviews_generation_status on public.case_quality_reviews(generation_status);
create index idx_case_quality_reviews_findings on public.case_quality_reviews using gin(findings);
create index idx_case_quality_reviews_finding_overrides on public.case_quality_reviews using gin(finding_overrides);

create unique index idx_case_quality_reviews_case_active
  on public.case_quality_reviews(case_id)
  where deleted_at is null;

create trigger set_updated_at before update on public.case_quality_reviews
  for each row execute function update_updated_at();

alter table public.case_quality_reviews enable row level security;

create policy "Authenticated users full access" on public.case_quality_reviews
  for all using (auth.role() = 'authenticated');
