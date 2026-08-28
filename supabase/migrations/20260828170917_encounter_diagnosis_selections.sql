-- Encounter-owned diagnosis selections and immutable note snapshots.

create or replace function public.valid_diagnosis_array(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    jsonb_typeof(value) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(value) as item
      where jsonb_typeof(item) <> 'object'
        or not (item ? 'icd10_code' and item ? 'description')
        or (select count(*) from jsonb_object_keys(item)) <> 2
        or jsonb_typeof(item -> 'icd10_code') <> 'string'
        or jsonb_typeof(item -> 'description') <> 'string'
        or btrim(item ->> 'icd10_code') = ''
        or btrim(item ->> 'description') = ''
    )
$$;

create or replace function public.format_visit_diagnoses(value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_array_length(value) = 0 then 'No diagnoses selected for this encounter.'
    else (
      select string_agg(
        '• ' || btrim(item ->> 'icd10_code') || ' — ' || btrim(item ->> 'description'),
        E'\n' order by ordinal
      )
      from jsonb_array_elements(value) with ordinality as entries(item, ordinal)
    )
  end
$$;

create or replace function public.format_procedure_diagnoses(value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when jsonb_array_length(value) = 0 then 'No diagnoses selected for this procedure.'
    else (
      select string_agg(
        btrim(item ->> 'icd10_code') || ' - ' || btrim(item ->> 'description'),
        E'\n' order by ordinal
      )
      from jsonb_array_elements(value) with ordinality as entries(item, ordinal)
    )
  end
$$;

alter table public.clinical_encounters
  add column diagnoses jsonb not null default '[]'::jsonb,
  add column diagnoses_confirmed_at timestamptz,
  add column diagnoses_confirmed_by_user_id uuid references public.users(id),
  add constraint clinical_encounters_diagnoses_shape
    check (public.valid_diagnosis_array(diagnoses)),
  add constraint clinical_encounters_diagnosis_confirmation_pair
    check ((diagnoses_confirmed_at is null) = (diagnoses_confirmed_by_user_id is null));

alter table public.initial_visit_notes
  add column diagnoses_snapshot jsonb not null default '[]'::jsonb,
  add constraint initial_visit_notes_diagnoses_snapshot_shape
    check (public.valid_diagnosis_array(diagnoses_snapshot));

alter table public.pain_follow_up_notes
  add column diagnoses_snapshot jsonb not null default '[]'::jsonb,
  add constraint pain_follow_up_notes_diagnoses_snapshot_shape
    check (public.valid_diagnosis_array(diagnoses_snapshot));

alter table public.procedure_notes
  add column diagnoses_snapshot jsonb not null default '[]'::jsonb,
  add constraint procedure_notes_diagnoses_snapshot_shape
    check (public.valid_diagnosis_array(diagnoses_snapshot));

create or replace function public.authorize_encounter_diagnosis_confirmation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_role text;
  actor_active boolean;
  owns_encounter boolean;
begin
  if actor_id is null then
    raise exception using errcode = '42501', message = 'Authentication required to confirm diagnoses';
  end if;

  select u.role, u.is_active
  into actor_role, actor_active
  from public.users u
  where u.id = actor_id;

  select exists (
    select 1
    from public.provider_profiles p
    where p.id = new.provider_id
      and p.user_id = actor_id
      and p.deleted_at is null
  ) into owns_encounter;

  if actor_active is distinct from true
     or not (actor_role = 'admin' or (actor_role = 'provider' and owns_encounter)) then
    raise exception using errcode = '42501', message = 'Only the encounter provider or an administrator may confirm diagnoses';
  end if;

  if new.status in ('completed', 'cancelled', 'no_show') then
    raise exception using errcode = 'P0001', message = 'Diagnoses cannot be changed on a locked encounter';
  end if;

  new.diagnoses_confirmed_at := now();
  new.diagnoses_confirmed_by_user_id := actor_id;
  new.updated_by_user_id := actor_id;
  return new;
end
$$;

create trigger clinical_encounters_confirm_diagnoses_trg
before update of diagnoses, diagnoses_confirmed_at, diagnoses_confirmed_by_user_id
on public.clinical_encounters
for each row execute function public.authorize_encounter_diagnosis_confirmation();

create or replace function public.guard_note_diagnosis_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  authority jsonb;
  confirmed_at timestamptz;
begin
  if tg_table_name = 'procedure_notes' then
    select p.diagnoses into authority
    from public.procedures p
    where p.id = new.procedure_id and p.deleted_at is null;
  else
    select e.diagnoses, e.diagnoses_confirmed_at
    into authority, confirmed_at
    from public.clinical_encounters e
    where e.id = new.encounter_id and e.deleted_at is null;
    if confirmed_at is null then
      raise exception using errcode = '23514', message = 'Visit diagnoses must be confirmed before writing a note snapshot';
    end if;
  end if;

  if authority is null or new.diagnoses_snapshot <> authority then
    raise exception using errcode = '23514', message = 'Note diagnosis snapshot must match its structured source';
  end if;
  return new;
end
$$;

create trigger initial_visit_notes_diagnosis_snapshot_trg
before update of diagnoses_snapshot on public.initial_visit_notes
for each row execute function public.guard_note_diagnosis_snapshot();
create trigger pain_follow_up_notes_diagnosis_snapshot_trg
before update of diagnoses_snapshot on public.pain_follow_up_notes
for each row execute function public.guard_note_diagnosis_snapshot();
create trigger procedure_notes_diagnosis_snapshot_trg
before update of diagnoses_snapshot on public.procedure_notes
for each row execute function public.guard_note_diagnosis_snapshot();

create or replace function public.prepare_evaluation_visit(
  p_case_id uuid,
  p_visit_type text
)
returns table (episode_id uuid, encounter_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_episode_id uuid;
  target_encounter_id uuid;
  target_encounter_type text;
  assigned_provider_id uuid;
begin
  if actor_id is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if p_visit_type not in ('initial_visit', 'pain_evaluation_visit') then
    raise exception using errcode = '22023', message = 'Unsupported evaluation visit type';
  end if;
  target_encounter_type := case p_visit_type when 'pain_evaluation_visit' then 'pain_evaluation' else 'initial_evaluation' end;

  select ce.id, c.assigned_provider_id
  into target_episode_id, assigned_provider_id
  from public.cases c
  join public.care_episodes ce on ce.case_id = c.id and ce.episode_number = 1 and ce.deleted_at is null
  where c.id = p_case_id and c.deleted_at is null
  for update of c, ce;
  if target_episode_id is null then raise exception using errcode = 'P0002', message = 'Episode 1 is required for the evaluation'; end if;
  if assigned_provider_id is null then raise exception using errcode = '23502', message = 'Assign a provider before preparing this visit'; end if;

  select e.id into target_encounter_id
  from public.clinical_encounters e
  where e.episode_id = target_episode_id and e.encounter_type = target_encounter_type and e.deleted_at is null
  for update;

  if target_encounter_id is null then
    insert into public.clinical_encounters (
      case_id, episode_id, encounter_type, modality, status, encounter_date,
      provider_id, provider_intake, created_by_user_id, updated_by_user_id
    ) values (
      p_case_id, target_episode_id, target_encounter_type, 'unknown', 'in_progress', current_date,
      assigned_provider_id, '{}'::jsonb, actor_id, actor_id
    ) returning id into target_encounter_id;
  else
    update public.clinical_encounters
    set provider_id = assigned_provider_id, updated_by_user_id = actor_id
    where id = target_encounter_id and provider_id is null;
  end if;

  insert into public.initial_visit_notes (
    case_id, episode_id, encounter_id, visit_type, visit_date, status,
    provider_intake, created_by_user_id, updated_by_user_id
  ) values (
    p_case_id, target_episode_id, target_encounter_id, p_visit_type, current_date, 'draft',
    '{}'::jsonb, actor_id, actor_id
  ) on conflict do nothing;

  update public.initial_visit_notes
  set episode_id = target_episode_id, encounter_id = target_encounter_id, updated_by_user_id = actor_id
  where case_id = p_case_id and visit_type = p_visit_type and deleted_at is null
    and (episode_id is distinct from target_episode_id or encounter_id is distinct from target_encounter_id);

  return query select target_episode_id, target_encounter_id;
end
$$;

revoke execute on function public.valid_diagnosis_array(jsonb) from public, anon;
revoke execute on function public.format_visit_diagnoses(jsonb) from public, anon;
revoke execute on function public.format_procedure_diagnoses(jsonb) from public, anon;
revoke execute on function public.authorize_encounter_diagnosis_confirmation() from public, anon;
revoke execute on function public.guard_note_diagnosis_snapshot() from public, anon;
revoke execute on function public.prepare_evaluation_visit(uuid, text) from public, anon;
grant execute on function public.prepare_evaluation_visit(uuid, text) to authenticated;
