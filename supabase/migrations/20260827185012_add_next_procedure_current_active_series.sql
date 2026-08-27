do $$
begin
  if exists (
    select 1 from public.procedure_orders
    where deleted_at is null and status in ('ordered', 'scheduled')
    group by procedure_series_id having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Procedure order migration blocked: a series has multiple open orders';
  end if;
end
$$;

create unique index procedure_orders_one_open_per_series_idx
  on public.procedure_orders(procedure_series_id)
  where deleted_at is null and status in ('ordered', 'scheduled');

create or replace function public.create_procedure_order_from_recommendation(
  p_case_id uuid, p_episode_id uuid, p_source_encounter_id uuid,
  p_recommendation_id uuid, p_procedure_type text, p_sites jsonb,
  p_diagnoses jsonb, p_rationale text, p_priority text,
  p_continued_from_series_id uuid default null
)
returns public.procedure_orders
language plpgsql security invoker set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_selected public.procedure_series%rowtype;
  v_series_id uuid;
  v_series_number integer;
  v_order public.procedure_orders%rowtype;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  perform 1 from public.care_episodes e join public.cases c on c.id = e.case_id
  where e.id = p_episode_id and e.case_id = p_case_id and e.status = 'active' and e.deleted_at is null
    and c.case_status not in ('closed', 'archived') and c.deleted_at is null for update of e, c;
  if not found then raise exception using errcode = 'P0001', message = 'Care episode is not writable'; end if;
  if not exists (
    select 1 from public.clinical_encounters e
    join public.pain_follow_up_notes n on n.encounter_id = e.id and n.episode_id = e.episode_id
    cross join lateral jsonb_array_elements(n.procedure_recommendations) recommendation
    where e.id = p_source_encounter_id and e.case_id = p_case_id and e.episode_id = p_episode_id
      and e.status = 'completed' and e.deleted_at is null and n.status = 'finalized' and n.deleted_at is null
      and recommendation ->> 'recommendation_id' = p_recommendation_id::text
      and recommendation ->> 'procedure_type' = p_procedure_type
  ) then raise exception using errcode = 'P0001', message = 'A finalized recommendation is required'; end if;

  if p_continued_from_series_id is not null then
    select * into v_selected from public.procedure_series
    where id = p_continued_from_series_id for update;
    if not found or v_selected.case_id <> p_case_id or v_selected.deleted_at is not null then
      raise exception using errcode = 'P0001', message = 'Selected procedure series is no longer eligible';
    end if;
    if v_selected.procedure_type <> p_procedure_type then
      raise exception using errcode = 'P0001', message = 'Selected procedure series type does not match the recommendation';
    end if;
    if not exists (select 1 from public.procedures p where p.procedure_series_id = v_selected.id and p.deleted_at is null) then
      raise exception using errcode = 'P0001', message = 'Selected procedure series has no completed procedures';
    end if;

    if v_selected.episode_id = p_episode_id then
      if v_selected.status <> 'active' then
        raise exception using errcode = 'P0001', message = 'Selected current procedure series is no longer active';
      end if;
      if exists (select 1 from public.procedure_orders o where o.procedure_series_id = v_selected.id and o.deleted_at is null and o.status in ('ordered', 'scheduled')) then
        raise exception using errcode = 'P0001', message = 'Selected procedure series already has an open order';
      end if;
      v_series_id := v_selected.id;
    else
      if v_selected.status <> 'completed' then
        raise exception using errcode = 'P0001', message = 'Selected prior procedure series is no longer completed';
      end if;
    end if;
  end if;

  if v_series_id is null then
    select coalesce(max(s.series_number), 0) + 1 into v_series_number
    from public.procedure_series s where s.episode_id = p_episode_id;
    insert into public.procedure_series (
      case_id, episode_id, series_number, procedure_type, continued_from_series_id,
      created_by_user_id, updated_by_user_id
    ) values (
      p_case_id, p_episode_id, v_series_number, p_procedure_type,
      case when v_selected.episode_id is distinct from p_episode_id then v_selected.id else null end,
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
  return v_order;
end
$$;

revoke execute on function public.create_procedure_order_from_recommendation(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text,uuid) from public,anon;
grant execute on function public.create_procedure_order_from_recommendation(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text,uuid) to authenticated;
