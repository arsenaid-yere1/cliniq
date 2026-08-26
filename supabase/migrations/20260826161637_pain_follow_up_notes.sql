create table public.pain_follow_up_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  episode_id uuid not null,
  encounter_id uuid not null,
  subjective text,
  interval_history text,
  review_of_systems text,
  telehealth_observations text,
  imaging_review text,
  assessment text,
  diagnoses text,
  treatment_plan text,
  patient_education text,
  follow_up text,
  clinician_disclaimer text,
  procedure_recommendations jsonb not null default '[]'::jsonb,
  ai_model text,
  raw_ai_response jsonb,
  status text not null default 'draft'
    check (status in ('generating', 'draft', 'finalized', 'failed')),
  generation_error text,
  generation_attempts integer not null default 0,
  source_data_hash text,
  sections_done integer not null default 0,
  sections_total integer not null default 11,
  tone_hint text,
  finalized_by_user_id uuid references public.users(id),
  finalized_at timestamptz,
  document_id uuid references public.documents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  constraint pain_follow_up_notes_recommendations_array
    check (jsonb_typeof(procedure_recommendations) = 'array'),
  constraint pain_follow_up_notes_episode_case_fkey
    foreign key (episode_id, case_id)
    references public.care_episodes(id, case_id),
  constraint pain_follow_up_notes_encounter_ownership_fkey
    foreign key (encounter_id, episode_id, case_id)
    references public.clinical_encounters(id, episode_id, case_id)
);

create unique index pain_follow_up_notes_encounter_active_idx
  on public.pain_follow_up_notes(encounter_id)
  where deleted_at is null;
create index pain_follow_up_notes_case_idx
  on public.pain_follow_up_notes(case_id, created_at desc)
  where deleted_at is null;
create index pain_follow_up_notes_episode_idx
  on public.pain_follow_up_notes(episode_id, created_at desc)
  where deleted_at is null;
create index pain_follow_up_notes_status_idx
  on public.pain_follow_up_notes(status)
  where deleted_at is null;
create index pain_follow_up_notes_recommendations_idx
  on public.pain_follow_up_notes using gin(procedure_recommendations);

create trigger pain_follow_up_notes_updated_at_trg
  before update on public.pain_follow_up_notes
  for each row execute function public.update_updated_at();

alter table public.pain_follow_up_notes enable row level security;
revoke all on table public.pain_follow_up_notes from anon, authenticated;
grant select, insert, update, delete on table public.pain_follow_up_notes to authenticated;

create policy pain_follow_up_notes_authenticated_select
  on public.pain_follow_up_notes for select to authenticated
  using ((select auth.uid()) is not null);
create policy pain_follow_up_notes_authenticated_insert
  on public.pain_follow_up_notes for insert to authenticated
  with check ((select auth.uid()) is not null);
create policy pain_follow_up_notes_authenticated_update
  on public.pain_follow_up_notes for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);
create policy pain_follow_up_notes_authenticated_delete
  on public.pain_follow_up_notes for delete to authenticated
  using ((select auth.uid()) is not null);

alter publication supabase_realtime add table public.pain_follow_up_notes;
