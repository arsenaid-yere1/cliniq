-- Preview and mutation share the same series eligibility decision.
create or replace function private.procedure_series_choice(p_case_id uuid, p_episode_id uuid, p_series_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  s public.procedure_series%rowtype; episode_number integer;
  relationship text; reason text; latest_number integer; open_order uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Authentication required'; end if;
  select * into s from public.procedure_series where id=p_series_id and case_id=p_case_id;
  if not found then return null; end if;
  select e.episode_number into episode_number from public.care_episodes e where e.id=s.episode_id;
  relationship := case when s.episode_id<>p_episode_id then 'prior'
    when s.status='completed' then 'reopen' else 'current' end;
  select coalesce(max(p.procedure_number),0) into latest_number from public.procedures p
    where p.procedure_series_id=s.id and p.deleted_at is null;
  select o.id into open_order from public.procedure_orders o where o.procedure_series_id=s.id
    and o.deleted_at is null and o.status in ('ordered','scheduled') order by o.created_at limit 1;
  if not exists(select 1 from public.care_episodes e join public.cases c on c.id=e.case_id
    where e.id=p_episode_id and e.case_id=p_case_id and e.status='active' and e.deleted_at is null
      and c.deleted_at is null and c.case_status not in ('closed','archived'))
    or exists(select 1 from public.discharge_note_corrections where episode_id=p_episode_id and status='open') then
    reason := 'episode_not_writable';
  elsif s.deleted_at is not null then reason := 'deleted';
  elsif latest_number=0 then reason := 'no_performed_procedures';
  elsif relationship in ('current','reopen') and s.status not in ('active','completed') then reason := 'current_not_active';
  elsif relationship in ('current','reopen') and open_order is not null then reason := 'current_has_open_order';
  elsif relationship='prior' and s.status<>'completed' then reason := 'prior_not_completed';
  end if;
  return jsonb_build_object('id',s.id,'relationship',relationship,'episodeId',s.episode_id,
    'episodeNumber',episode_number,'seriesNumber',s.series_number,'procedureType',s.procedure_type,
    'latestProcedureNumber',latest_number,'hasOpenOrder',open_order is not null,'blockingOrderId',open_order,
    'eligible',reason is null,'unavailableReason',reason);
end $$;

create or replace function public.preview_procedure_series_choices(p_case_id uuid,p_episode_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(private.procedure_series_choice(p_case_id,p_episode_id,s.id)
    order by (s.episode_id=p_episode_id) desc,s.series_number desc),'[]'::jsonb)
  from public.procedure_series s where s.case_id=p_case_id and auth.uid() is not null
$$;
revoke all on function private.procedure_series_choice(uuid,uuid,uuid) from public,anon;
revoke all on function public.preview_procedure_series_choices(uuid,uuid) from public,anon;
grant execute on function private.procedure_series_choice(uuid,uuid,uuid) to authenticated;
grant execute on function public.preview_procedure_series_choices(uuid,uuid) to authenticated;

alter table public.procedure_order_series_selections
  drop constraint procedure_order_series_selections_relationship_check,
  drop constraint procedure_order_series_selections_relationship_pair,
  add constraint procedure_order_series_selections_relationship_check check (relationship in ('current','prior','separate','reopen')),
  add constraint procedure_order_series_selections_relationship_pair check (
    (relationship in ('current','prior','reopen') and selected_series_id is not null)
    or (relationship='separate' and selected_series_id is null));

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

  if new.relationship in ('current', 'reopen') and (
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
  v_choice jsonb;
  v_selected public.procedure_series%rowtype;
  v_series_id uuid;
  v_series_number integer;
  v_order public.procedure_orders%rowtype;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_series_relationship is null or p_series_relationship not in ('current', 'prior', 'separate', 'reopen') then
    raise exception using errcode = '22023', message = 'Invalid series relationship';
  end if;
  if (p_series_relationship = 'separate' and p_selected_series_id is not null)
    or (p_series_relationship in ('current', 'prior', 'reopen') and p_selected_series_id is null)
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

  if exists(select 1 from public.discharge_note_corrections where episode_id=p_episode_id and status='open') then
    raise exception using errcode='P0001',message='Care episode is not writable';
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
    v_choice := private.procedure_series_choice(p_case_id,p_episode_id,p_selected_series_id);
    if v_choice->>'unavailableReason'='no_performed_procedures' then
      raise exception using errcode='P0001',message='Selected procedure series has no completed procedures';
    elsif v_choice->>'unavailableReason'='current_has_open_order' then
      raise exception using errcode='P0001',message='Selected procedure series already has an open order';
    elsif v_choice->>'unavailableReason'='episode_not_writable' then
      raise exception using errcode='P0001',message='Care episode is not writable';
    elsif not coalesce((v_choice->>'eligible')::boolean,false)
      or v_choice->>'relationship' is distinct from p_series_relationship then
      raise exception using errcode='P0001',message='Selected procedure series is no longer eligible';
    end if;
    if p_series_relationship in ('current','reopen') then
      v_series_id := v_selected.id;
    end if;
    if p_series_relationship='reopen' then
      update public.procedure_series set status='active',updated_by_user_id=v_actor where id=v_selected.id;
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

  if p_series_relationship='reopen' then
    insert into public.audit_logs(table_name,record_id,action,old_data,new_data,performed_by_user_id)
    values('procedure_series',v_selected.id,'UPDATE',to_jsonb(v_selected),
      (select to_jsonb(s) from public.procedure_series s where s.id=v_selected.id)
        || jsonb_build_object('reopening_order_id',v_order.id,'reason','Explicit reopen and continue from finalized recommendation'),v_actor);
  end if;
  return v_order;
end
$$;
