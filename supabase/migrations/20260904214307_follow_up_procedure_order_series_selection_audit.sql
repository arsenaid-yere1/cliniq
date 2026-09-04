create table public.procedure_order_series_selections (
  procedure_order_id uuid primary key,
  case_id uuid not null,
  relationship text not null check (relationship in ('current', 'prior', 'separate')),
  selected_series_id uuid,
  created_by_user_id uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  constraint procedure_order_series_selections_relationship_pair check (
    (relationship in ('current', 'prior') and selected_series_id is not null)
    or (relationship = 'separate' and selected_series_id is null)
  ),
  constraint procedure_order_series_selections_order_case_fkey
    foreign key (procedure_order_id, case_id)
    references public.procedure_orders(id, case_id),
  constraint procedure_order_series_selections_selected_series_case_fkey
    foreign key (selected_series_id, case_id)
    references public.procedure_series(id, case_id)
);

create index procedure_order_series_selections_case_idx
  on public.procedure_order_series_selections(case_id, created_at desc);

create or replace function private.validate_procedure_order_series_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.procedure_orders%rowtype;
  v_resolved public.procedure_series%rowtype;
  v_selected public.procedure_series%rowtype;
begin
  select * into v_order
  from public.procedure_orders
  where id = new.procedure_order_id and case_id = new.case_id;
  if not found then
    raise exception using errcode = '23503', message = 'Procedure order does not belong to the selected case';
  end if;

  select * into v_resolved from public.procedure_series where id = v_order.procedure_series_id;
  if new.selected_series_id is not null then
    select * into v_selected from public.procedure_series where id = new.selected_series_id;
  end if;

  if new.relationship = 'current' and (
    new.selected_series_id is distinct from v_order.procedure_series_id
    or v_selected.episode_id is distinct from v_order.episode_id
  ) then
    raise exception using errcode = '23514', message = 'Current relationship must select the resolved current-episode series';
  elsif new.relationship = 'prior' and (
    v_selected.episode_id is not distinct from v_order.episode_id
    or v_resolved.episode_id is distinct from v_order.episode_id
    or v_resolved.continued_from_series_id is distinct from new.selected_series_id
  ) then
    raise exception using errcode = '23514', message = 'Prior relationship must match the resolved series lineage';
  elsif new.relationship = 'separate' and v_resolved.continued_from_series_id is not null then
    raise exception using errcode = '23514', message = 'Separate relationship must resolve to an unlinked series';
  end if;

  return new;
end
$$;

create or replace function private.prevent_procedure_order_series_selection_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Procedure order series selections are immutable';
end
$$;

create trigger procedure_order_series_selections_validate_trg
  before insert on public.procedure_order_series_selections
  for each row execute function private.validate_procedure_order_series_selection();

create trigger procedure_order_series_selections_immutable_trg
  before update or delete on public.procedure_order_series_selections
  for each row execute function private.prevent_procedure_order_series_selection_mutation();

alter table public.procedure_order_series_selections enable row level security;
revoke all on table public.procedure_order_series_selections from public, anon, authenticated;
grant select on table public.procedure_order_series_selections to authenticated;

create policy procedure_order_series_selections_authenticated_select
  on public.procedure_order_series_selections
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and exists (
      select 1 from public.cases clinical_case
      where clinical_case.id = case_id and clinical_case.deleted_at is null
    )
  );

create or replace function private.create_procedure_order_from_recommendation_v2(
  p_case_id uuid, p_episode_id uuid, p_source_encounter_id uuid,
  p_recommendation_id uuid, p_procedure_type text, p_sites jsonb,
  p_diagnoses jsonb, p_rationale text, p_priority text,
  p_series_relationship text, p_selected_series_id uuid
)
returns public.procedure_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_selected public.procedure_series%rowtype;
  v_series_id uuid;
  v_series_number integer;
  v_order public.procedure_orders%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_series_relationship not in ('current', 'prior', 'separate') then
    raise exception using errcode = '22023', message = 'Invalid series relationship';
  end if;
  if (p_series_relationship = 'separate' and p_selected_series_id is not null)
    or (p_series_relationship in ('current', 'prior') and p_selected_series_id is null)
  then
    raise exception using errcode = '22023', message = 'Selected series does not match the relationship';
  end if;

  perform 1 from public.care_episodes episode
  join public.cases clinical_case on clinical_case.id = episode.case_id
  where episode.id = p_episode_id and episode.case_id = p_case_id
    and episode.status = 'active' and episode.deleted_at is null
    and clinical_case.case_status not in ('closed', 'archived')
    and clinical_case.deleted_at is null
  for update of episode, clinical_case;
  if not found then
    raise exception using errcode = 'P0001', message = 'Care episode is not writable';
  end if;

  if not exists (
    select 1 from public.clinical_encounters encounter
    join public.pain_follow_up_notes note
      on note.encounter_id = encounter.id and note.episode_id = encounter.episode_id
    cross join lateral jsonb_array_elements(note.procedure_recommendations) recommendation
    where encounter.id = p_source_encounter_id and encounter.case_id = p_case_id
      and encounter.episode_id = p_episode_id and encounter.status = 'completed'
      and encounter.deleted_at is null and note.status = 'finalized'
      and note.deleted_at is null
      and recommendation ->> 'recommendation_id' = p_recommendation_id::text
      and recommendation ->> 'procedure_type' = p_procedure_type
  ) then
    raise exception using errcode = 'P0001', message = 'A finalized recommendation is required';
  end if;

  if p_selected_series_id is not null then
    select * into v_selected from public.procedure_series
    where id = p_selected_series_id for update;
    if not found or v_selected.case_id <> p_case_id or v_selected.deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'Selected procedure series is no longer eligible';
    end if;
    if v_selected.procedure_type <> p_procedure_type then
      raise exception using errcode = 'P0001', message = 'Selected procedure series type does not match the recommendation';
    end if;
    if not exists (
      select 1 from public.procedures procedure
      where procedure.procedure_series_id = v_selected.id and procedure.deleted_at is null
    ) then
      raise exception using errcode = 'P0001', message = 'Selected procedure series has no completed procedures';
    end if;

    if p_series_relationship = 'current' then
      if v_selected.episode_id <> p_episode_id or v_selected.status <> 'active' then
        raise exception using errcode = 'P0001', message = 'Selected current procedure series is no longer active';
      end if;
      if exists (
        select 1 from public.procedure_orders procedure_order
        where procedure_order.procedure_series_id = v_selected.id
          and procedure_order.deleted_at is null
          and procedure_order.status in ('ordered', 'scheduled')
      ) then
        raise exception using errcode = 'P0001', message = 'Selected procedure series already has an open order';
      end if;
      v_series_id := v_selected.id;
    elsif v_selected.episode_id = p_episode_id or v_selected.status <> 'completed' then
      raise exception using errcode = 'P0001', message = 'Selected prior procedure series is no longer completed';
    end if;
  end if;

  if v_series_id is null then
    select coalesce(max(series.series_number), 0) + 1 into v_series_number
    from public.procedure_series series where series.episode_id = p_episode_id;
    insert into public.procedure_series (
      case_id, episode_id, series_number, procedure_type, continued_from_series_id,
      created_by_user_id, updated_by_user_id
    ) values (
      p_case_id, p_episode_id, v_series_number, p_procedure_type,
      case when p_series_relationship = 'prior' then p_selected_series_id else null end,
      v_actor, v_actor
    ) returning id into v_series_id;
  end if;

  insert into public.procedure_orders (
    case_id, episode_id, source_encounter_id, source_recommendation_id,
    procedure_series_id, procedure_type, sites, diagnoses, clinical_rationale,
    priority, created_by_user_id, updated_by_user_id
  ) values (
    p_case_id, p_episode_id, p_source_encounter_id, p_recommendation_id,
    v_series_id, p_procedure_type, p_sites, p_diagnoses, btrim(p_rationale),
    p_priority, v_actor, v_actor
  ) returning * into v_order;

  insert into public.procedure_order_series_selections (
    procedure_order_id, case_id, relationship, selected_series_id, created_by_user_id
  ) values (
    v_order.id, p_case_id, p_series_relationship, p_selected_series_id, v_actor
  );

  return v_order;
end
$$;

create or replace function public.create_procedure_order_from_recommendation_v2(
  p_case_id uuid, p_episode_id uuid, p_source_encounter_id uuid,
  p_recommendation_id uuid, p_procedure_type text, p_sites jsonb,
  p_diagnoses jsonb, p_rationale text, p_priority text,
  p_series_relationship text, p_selected_series_id uuid
)
returns public.procedure_orders
language sql
security invoker
set search_path = ''
as $$
  select private.create_procedure_order_from_recommendation_v2(
    p_case_id, p_episode_id, p_source_encounter_id, p_recommendation_id,
    p_procedure_type, p_sites, p_diagnoses, p_rationale, p_priority,
    p_series_relationship, p_selected_series_id
  )
$$;

revoke all on function private.validate_procedure_order_series_selection() from public, anon, authenticated;
revoke all on function private.prevent_procedure_order_series_selection_mutation() from public, anon, authenticated;
revoke all on function private.create_procedure_order_from_recommendation_v2(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text,text,uuid) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.create_procedure_order_from_recommendation_v2(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text,text,uuid) to authenticated;

revoke all on function public.create_procedure_order_from_recommendation_v2(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text,text,uuid) from public, anon;
grant execute on function public.create_procedure_order_from_recommendation_v2(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text,text,uuid) to authenticated;
