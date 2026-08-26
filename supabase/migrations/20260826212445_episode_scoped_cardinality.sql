-- Phase 2 episode-scoped cardinality constraints.

drop index if exists public.idx_discharge_notes_case_active;
create unique index discharge_notes_episode_active_idx
  on public.discharge_notes(episode_id)
  where episode_id is not null and deleted_at is null;

drop index if exists public.idx_case_quality_reviews_case_active;
create unique index case_quality_reviews_episode_active_idx
  on public.case_quality_reviews(episode_id)
  where episode_id is not null and deleted_at is null;

create unique index clinical_encounters_initial_per_episode_idx
  on public.clinical_encounters(episode_id, encounter_type)
  where encounter_type in ('initial_evaluation', 'pain_evaluation', 'discharge')
    and deleted_at is null;

create or replace function public.enforce_episode_note_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_encounter public.clinical_encounters%rowtype;
begin
  if new.deleted_at is null and (new.episode_id is null or new.encounter_id is null) then
    raise exception using errcode = '23502', message = 'Live clinical notes require episode and encounter ownership';
  end if;
  if new.episode_id is null and new.encounter_id is null then return new; end if;

  select e.* into v_encounter from public.clinical_encounters e where e.id = new.encounter_id;
  if not found or v_encounter.case_id <> new.case_id or v_encounter.episode_id <> new.episode_id then
    raise exception using errcode = '23503', message = 'Note, encounter, episode, and case ownership must agree';
  end if;
  return new;
end
$$;

create trigger initial_visit_notes_episode_ownership_trg
  before insert or update of case_id, episode_id, encounter_id, deleted_at
  on public.initial_visit_notes
  for each row execute function public.enforce_episode_note_ownership();
create trigger discharge_notes_episode_ownership_trg
  before insert or update of case_id, episode_id, encounter_id, deleted_at
  on public.discharge_notes
  for each row execute function public.enforce_episode_note_ownership();

revoke execute on function public.enforce_episode_note_ownership() from public, anon;
