-- Phase 1: additive care-episode and encounter ownership.
-- Existing case-owned records remain readable while compatibility writers roll out.

create table public.care_episodes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  episode_number integer not null check (episode_number > 0),
  status text not null default 'active'
    check (status in ('active', 'discharged', 'cancelled')),
  opened_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  return_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  constraint care_episodes_end_after_open
    check (ended_at is null or ended_at >= opened_at),
  constraint care_episodes_case_number_unique unique (case_id, episode_number),
  constraint care_episodes_id_case_unique unique (id, case_id)
);

create unique index care_episodes_one_active_per_case_idx
  on public.care_episodes(case_id)
  where status = 'active' and deleted_at is null;
create index care_episodes_case_status_idx
  on public.care_episodes(case_id, status) where deleted_at is null;

create table public.clinical_encounters (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  episode_id uuid not null,
  encounter_type text not null check (encounter_type in (
    'initial_evaluation', 'pain_evaluation', 'pain_follow_up', 'discharge'
  )),
  modality text not null default 'unknown'
    check (modality in ('unknown', 'in_person', 'telehealth', 'phone')),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_progress', 'completed', 'cancelled', 'no_show')),
  scheduled_start timestamptz,
  scheduled_end timestamptz,
  encounter_date date,
  completed_at timestamptz,
  provider_id uuid references public.provider_profiles(id),
  reason_for_visit text,
  provider_intake jsonb not null default '{}'::jsonb,
  patient_reported_pain_min integer check (
    patient_reported_pain_min between 0 and 10
  ),
  patient_reported_pain_max integer check (
    patient_reported_pain_max between 0 and 10
  ),
  patient_reported_measurements jsonb not null default '{}'::jsonb,
  telehealth_consent_obtained boolean,
  telehealth_consent_at timestamptz,
  patient_location_state text,
  provider_location text,
  connection_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  constraint clinical_encounters_schedule_order
    check (scheduled_end is null or scheduled_start is null or scheduled_end > scheduled_start),
  constraint clinical_encounters_completed_date
    check (status <> 'completed' or encounter_date is not null),
  constraint clinical_encounters_pain_range
    check (
      patient_reported_pain_min is null
      or patient_reported_pain_max is null
      or patient_reported_pain_min <= patient_reported_pain_max
    ),
  constraint clinical_encounters_episode_case_fkey
    foreign key (episode_id, case_id)
    references public.care_episodes(id, case_id),
  constraint clinical_encounters_id_case_unique unique (id, case_id),
  constraint clinical_encounters_id_episode_case_unique unique (id, episode_id, case_id)
);

create index clinical_encounters_case_date_idx
  on public.clinical_encounters(case_id, encounter_date desc)
  where deleted_at is null;
create index clinical_encounters_episode_date_idx
  on public.clinical_encounters(episode_id, encounter_date desc)
  where deleted_at is null;
create index clinical_encounters_provider_idx
  on public.clinical_encounters(provider_id, scheduled_start)
  where deleted_at is null;
create index clinical_encounters_status_idx
  on public.clinical_encounters(status, scheduled_start)
  where deleted_at is null;

create table public.procedure_series (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  episode_id uuid not null,
  series_number integer not null check (series_number > 0),
  procedure_type text not null check (procedure_type in (
    'prp', 'cortisone', 'hyaluronic', 'botox', 'legacy_mixed'
  )),
  status text not null default 'active'
    check (status in ('active', 'completed', 'cancelled')),
  continued_from_series_id uuid references public.procedure_series(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id),
  constraint procedure_series_episode_case_fkey
    foreign key (episode_id, case_id)
    references public.care_episodes(id, case_id),
  constraint procedure_series_episode_number_unique
    unique (episode_id, series_number),
  constraint procedure_series_id_case_unique unique (id, case_id),
  constraint procedure_series_id_episode_case_unique unique (id, episode_id, case_id),
  constraint procedure_series_not_self_continued
    check (continued_from_series_id is null or continued_from_series_id <> id)
);

create index procedure_series_case_idx
  on public.procedure_series(case_id, series_number) where deleted_at is null;
create index procedure_series_episode_status_idx
  on public.procedure_series(episode_id, status) where deleted_at is null;

alter table public.initial_visit_notes
  add column episode_id uuid references public.care_episodes(id),
  add column encounter_id uuid references public.clinical_encounters(id);

alter table public.discharge_notes
  add column episode_id uuid references public.care_episodes(id),
  add column encounter_id uuid references public.clinical_encounters(id);

alter table public.procedures
  add column episode_id uuid references public.care_episodes(id),
  add column procedure_series_id uuid references public.procedure_series(id),
  add column source_encounter_id uuid references public.clinical_encounters(id),
  add column provider_profile_id uuid references public.provider_profiles(id);

alter table public.vital_signs
  add column encounter_id uuid references public.clinical_encounters(id);

alter table public.clinical_orders
  add column episode_id uuid references public.care_episodes(id),
  add column encounter_id uuid references public.clinical_encounters(id);

alter table public.documents
  add column episode_id uuid references public.care_episodes(id),
  add column encounter_id uuid references public.clinical_encounters(id);

alter table public.invoice_line_items
  add column encounter_id uuid references public.clinical_encounters(id);

alter table public.case_quality_reviews
  add column episode_id uuid references public.care_episodes(id);

alter table public.clinic_settings
  add column timezone text not null default 'America/Los_Angeles'
    check (length(btrim(timezone)) > 0);

create unique index initial_visit_notes_encounter_active_idx
  on public.initial_visit_notes(encounter_id)
  where encounter_id is not null and deleted_at is null;
create unique index discharge_notes_encounter_active_idx
  on public.discharge_notes(encounter_id)
  where encounter_id is not null and deleted_at is null;

-- Refuse ambiguous historical upgrades instead of inventing episode boundaries.
do $$
begin
  if exists (
    select 1
    from public.procedures p
    join public.discharge_notes d
      on d.case_id = p.case_id
     and d.status = 'finalized'
     and d.deleted_at is null
    where p.deleted_at is null
      and p.procedure_date > coalesce(d.visit_date, d.finalized_at::date, d.created_at::date)
  ) then
    raise exception using
      errcode = 'check_violation',
      message = 'Episode backfill blocked: a procedure is dated after finalized discharge';
  end if;

  if exists (
    select 1
    from public.procedures p
    where p.deleted_at is null and p.procedure_number is not null
    group by p.case_id, p.procedure_number
    having count(*) > 1
  ) then
    raise exception using
      errcode = 'unique_violation',
      message = 'Episode backfill blocked: duplicate live procedure numbers exist within a case';
  end if;
end
$$;

insert into public.care_episodes (
  case_id,
  episode_number,
  status,
  opened_at,
  ended_at,
  end_reason,
  created_at,
  updated_at,
  created_by_user_id,
  updated_by_user_id
)
select
  c.id,
  1,
  case
    when finalized_discharge.ended_at is not null then 'discharged'
    when c.case_status in ('pending_settlement', 'closed', 'archived') then 'cancelled'
    else 'active'
  end,
  coalesce(first_event.opened_at, c.created_at),
  case
    when finalized_discharge.ended_at is not null then finalized_discharge.ended_at
    when c.case_status in ('pending_settlement', 'closed', 'archived')
      then coalesce(c.case_close_date::timestamptz, c.updated_at)
    else null
  end,
  case
    when finalized_discharge.ended_at is not null then 'finalized_discharge'
    when c.case_status in ('pending_settlement', 'closed', 'archived')
      then 'case_locked_without_finalized_discharge'
    else null
  end,
  c.created_at,
  c.updated_at,
  c.created_by_user_id,
  c.updated_by_user_id
from public.cases c
left join lateral (
  select min(event_at) as opened_at
  from (
    select coalesce(iv.visit_date::timestamptz, iv.created_at) as event_at
    from public.initial_visit_notes iv
    where iv.case_id = c.id and iv.deleted_at is null
    union all
    select coalesce(dn.visit_date::timestamptz, dn.created_at)
    from public.discharge_notes dn
    where dn.case_id = c.id and dn.deleted_at is null
    union all
    select coalesce(p.procedure_date::timestamptz, p.created_at)
    from public.procedures p
    where p.case_id = c.id and p.deleted_at is null
  ) events
) first_event on true
left join lateral (
  select max(coalesce(dn.visit_date::timestamptz, dn.finalized_at, dn.created_at)) as ended_at
  from public.discharge_notes dn
  where dn.case_id = c.id
    and dn.status = 'finalized'
    and dn.deleted_at is null
) finalized_discharge on true
where c.deleted_at is null;

insert into public.clinical_encounters (
  case_id,
  episode_id,
  encounter_type,
  modality,
  status,
  encounter_date,
  completed_at,
  provider_id,
  provider_intake,
  created_at,
  updated_at,
  created_by_user_id,
  updated_by_user_id
)
select
  n.case_id,
  e.id,
  case n.visit_type
    when 'pain_evaluation_visit' then 'pain_evaluation'
    else 'initial_evaluation'
  end,
  'unknown',
  case
    when n.status = 'finalized' then 'completed'
    when e.status = 'active' then 'in_progress'
    else 'cancelled'
  end,
  coalesce(n.visit_date, n.finalized_at::date, n.created_at::date),
  case when n.status = 'finalized' then coalesce(n.finalized_at, n.updated_at) end,
  c.assigned_provider_id,
  coalesce(n.provider_intake, '{}'::jsonb),
  n.created_at,
  n.updated_at,
  n.created_by_user_id,
  n.updated_by_user_id
from public.initial_visit_notes n
join public.care_episodes e on e.case_id = n.case_id and e.episode_number = 1
join public.cases c on c.id = n.case_id
where n.deleted_at is null;

update public.initial_visit_notes n
set
  episode_id = encounter.episode_id,
  encounter_id = encounter.id
from public.clinical_encounters encounter
where encounter.case_id = n.case_id
  and encounter.encounter_type = case n.visit_type
    when 'pain_evaluation_visit' then 'pain_evaluation'
    else 'initial_evaluation'
  end
  and encounter.deleted_at is null
  and n.deleted_at is null;

insert into public.clinical_encounters (
  case_id,
  episode_id,
  encounter_type,
  modality,
  status,
  encounter_date,
  completed_at,
  provider_id,
  created_at,
  updated_at,
  created_by_user_id,
  updated_by_user_id
)
select
  n.case_id,
  e.id,
  'discharge',
  'unknown',
  case
    when n.status = 'finalized' then 'completed'
    when e.status = 'active' then 'in_progress'
    else 'cancelled'
  end,
  coalesce(n.visit_date, n.finalized_at::date, n.created_at::date),
  case when n.status = 'finalized' then coalesce(n.finalized_at, n.updated_at) end,
  c.assigned_provider_id,
  n.created_at,
  n.updated_at,
  n.created_by_user_id,
  n.updated_by_user_id
from public.discharge_notes n
join public.care_episodes e on e.case_id = n.case_id and e.episode_number = 1
join public.cases c on c.id = n.case_id
where n.deleted_at is null;

update public.discharge_notes n
set
  episode_id = encounter.episode_id,
  encounter_id = encounter.id
from public.clinical_encounters encounter
where encounter.case_id = n.case_id
  and encounter.encounter_type = 'discharge'
  and encounter.deleted_at is null
  and n.deleted_at is null;

insert into public.procedure_series (
  case_id,
  episode_id,
  series_number,
  procedure_type,
  status,
  created_at,
  updated_at,
  created_by_user_id,
  updated_by_user_id
)
select
  p.case_id,
  e.id,
  1,
  case when count(distinct p.procedure_type) = 1
    then min(p.procedure_type)
    else 'legacy_mixed'
  end,
  case e.status when 'active' then 'active' when 'cancelled' then 'cancelled' else 'completed' end,
  min(p.created_at),
  max(p.updated_at),
  min(p.created_by_user_id::text)::uuid,
  min(p.updated_by_user_id::text)::uuid
from public.procedures p
join public.care_episodes e on e.case_id = p.case_id and e.episode_number = 1
where p.deleted_at is null
group by p.case_id, e.id, e.status;

update public.procedures p
set
  episode_id = s.episode_id,
  procedure_series_id = s.id,
  provider_profile_id = c.assigned_provider_id
from public.procedure_series s
join public.cases c on c.id = s.case_id
where s.case_id = p.case_id
  and s.series_number = 1
  and s.deleted_at is null
  and p.deleted_at is null;

update public.clinical_orders o
set
  episode_id = e.id,
  encounter_id = (
    select n.encounter_id
    from public.initial_visit_notes n
    where n.id = o.initial_visit_note_id
      and n.deleted_at is null
  )
from public.care_episodes e
where e.case_id = o.case_id
  and e.episode_number = 1
  and o.deleted_at is null;

update public.case_quality_reviews q
set episode_id = e.id
from public.care_episodes e
where e.case_id = q.case_id
  and e.episode_number = 1
  and q.deleted_at is null;

update public.documents d
set
  episode_id = n.episode_id,
  encounter_id = n.encounter_id
from public.initial_visit_notes n
where n.document_id = d.id
  and n.deleted_at is null
  and d.deleted_at is null;

update public.documents d
set
  episode_id = n.episode_id,
  encounter_id = n.encounter_id
from public.discharge_notes n
where n.document_id = d.id
  and n.deleted_at is null
  and d.deleted_at is null;

update public.documents d
set episode_id = p.episode_id
from public.procedure_notes pn
join public.procedures p on p.id = pn.procedure_id
where pn.document_id = d.id
  and pn.deleted_at is null
  and p.deleted_at is null
  and d.deleted_at is null;

update public.documents d
set
  episode_id = o.episode_id,
  encounter_id = o.encounter_id
from public.clinical_orders o
where o.document_id = d.id
  and o.deleted_at is null
  and d.deleted_at is null
  and d.episode_id is null;

do $$
begin
  if exists (
    select 1 from public.initial_visit_notes
    where deleted_at is null and (episode_id is null or encounter_id is null)
  ) or exists (
    select 1 from public.discharge_notes
    where deleted_at is null and (episode_id is null or encounter_id is null)
  ) or exists (
    select 1 from public.procedures
    where deleted_at is null and (episode_id is null or procedure_series_id is null)
  ) or exists (
    select 1 from public.clinical_orders
    where deleted_at is null and episode_id is null
  ) or exists (
    select 1 from public.case_quality_reviews
    where deleted_at is null and episode_id is null
  ) then
    raise exception using
      errcode = 'not_null_violation',
      message = 'Episode backfill incomplete for one or more live clinical records';
  end if;
end
$$;

alter table public.initial_visit_notes
  add constraint initial_visit_notes_episode_case_fkey
  foreign key (episode_id, case_id)
  references public.care_episodes(id, case_id),
  add constraint initial_visit_notes_encounter_ownership_fkey
  foreign key (encounter_id, episode_id, case_id)
  references public.clinical_encounters(id, episode_id, case_id);

alter table public.discharge_notes
  add constraint discharge_notes_episode_case_fkey
  foreign key (episode_id, case_id)
  references public.care_episodes(id, case_id),
  add constraint discharge_notes_encounter_ownership_fkey
  foreign key (encounter_id, episode_id, case_id)
  references public.clinical_encounters(id, episode_id, case_id);

alter table public.procedures
  add constraint procedures_episode_case_fkey
    foreign key (episode_id, case_id)
    references public.care_episodes(id, case_id),
  add constraint procedures_series_ownership_fkey
    foreign key (procedure_series_id, episode_id, case_id)
    references public.procedure_series(id, episode_id, case_id),
  add constraint procedures_source_encounter_ownership_fkey
    foreign key (source_encounter_id, episode_id, case_id)
    references public.clinical_encounters(id, episode_id, case_id);

alter table public.vital_signs
  add constraint vital_signs_encounter_case_fkey
  foreign key (encounter_id, case_id)
  references public.clinical_encounters(id, case_id);

alter table public.clinical_orders
  add constraint clinical_orders_episode_case_fkey
  foreign key (episode_id, case_id)
  references public.care_episodes(id, case_id),
  add constraint clinical_orders_encounter_ownership_fkey
  foreign key (encounter_id, episode_id, case_id)
  references public.clinical_encounters(id, episode_id, case_id);

alter table public.documents
  add constraint documents_episode_case_fkey
  foreign key (episode_id, case_id)
  references public.care_episodes(id, case_id),
  add constraint documents_encounter_ownership_fkey
  foreign key (encounter_id, episode_id, case_id)
  references public.clinical_encounters(id, episode_id, case_id);

alter table public.case_quality_reviews
  add constraint case_quality_reviews_episode_case_fkey
  foreign key (episode_id, case_id)
  references public.care_episodes(id, case_id);

create unique index procedures_series_number_active_idx
  on public.procedures(procedure_series_id, procedure_number)
  where deleted_at is null
    and procedure_series_id is not null
    and procedure_number is not null;

create unique index invoice_line_items_invoice_encounter_idx
  on public.invoice_line_items(invoice_id, encounter_id)
  where encounter_id is not null;

create or replace function public.enforce_invoice_line_encounter_case()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  invoice_case_id uuid;
  encounter_case_id uuid;
begin
  if new.encounter_id is null then
    return new;
  end if;

  select i.case_id into invoice_case_id
  from public.invoices i
  where i.id = new.invoice_id;

  select e.case_id into encounter_case_id
  from public.clinical_encounters e
  where e.id = new.encounter_id;

  if invoice_case_id is distinct from encounter_case_id then
    raise exception using
      errcode = 'foreign_key_violation',
      message = 'Invoice line encounter must belong to the invoice case';
  end if;

  return new;
end
$$;

create trigger invoice_line_items_encounter_case_trg
  before insert or update of invoice_id, encounter_id
  on public.invoice_line_items
  for each row execute function public.enforce_invoice_line_encounter_case();

create trigger care_episodes_updated_at_trg
  before update on public.care_episodes
  for each row execute function public.update_updated_at();
create trigger clinical_encounters_updated_at_trg
  before update on public.clinical_encounters
  for each row execute function public.update_updated_at();
create trigger procedure_series_updated_at_trg
  before update on public.procedure_series
  for each row execute function public.update_updated_at();

alter table public.care_episodes enable row level security;
alter table public.clinical_encounters enable row level security;
alter table public.procedure_series enable row level security;

revoke all on table public.care_episodes from anon, authenticated;
revoke all on table public.clinical_encounters from anon, authenticated;
revoke all on table public.procedure_series from anon, authenticated;
grant select, insert, update, delete on table public.care_episodes to authenticated;
grant select, insert, update, delete on table public.clinical_encounters to authenticated;
grant select, insert, update, delete on table public.procedure_series to authenticated;

create policy care_episodes_authenticated_select
  on public.care_episodes for select to authenticated
  using ((select auth.uid()) is not null);
create policy care_episodes_authenticated_insert
  on public.care_episodes for insert to authenticated
  with check ((select auth.uid()) is not null);
create policy care_episodes_authenticated_update
  on public.care_episodes for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);
create policy care_episodes_authenticated_delete
  on public.care_episodes for delete to authenticated
  using ((select auth.uid()) is not null);

create policy clinical_encounters_authenticated_select
  on public.clinical_encounters for select to authenticated
  using ((select auth.uid()) is not null);
create policy clinical_encounters_authenticated_insert
  on public.clinical_encounters for insert to authenticated
  with check ((select auth.uid()) is not null);
create policy clinical_encounters_authenticated_update
  on public.clinical_encounters for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);
create policy clinical_encounters_authenticated_delete
  on public.clinical_encounters for delete to authenticated
  using ((select auth.uid()) is not null);

create policy procedure_series_authenticated_select
  on public.procedure_series for select to authenticated
  using ((select auth.uid()) is not null);
create policy procedure_series_authenticated_insert
  on public.procedure_series for insert to authenticated
  with check ((select auth.uid()) is not null);
create policy procedure_series_authenticated_update
  on public.procedure_series for update to authenticated
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);
create policy procedure_series_authenticated_delete
  on public.procedure_series for delete to authenticated
  using ((select auth.uid()) is not null);
