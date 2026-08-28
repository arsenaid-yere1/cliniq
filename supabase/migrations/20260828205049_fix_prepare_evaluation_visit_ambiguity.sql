-- Qualify note columns that collide with RETURNS TABLE output variables.
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
    update public.clinical_encounters e
    set provider_id = assigned_provider_id, updated_by_user_id = actor_id
    where e.id = target_encounter_id and e.provider_id is null;
  end if;

  insert into public.initial_visit_notes (
    case_id, episode_id, encounter_id, visit_type, visit_date, status,
    provider_intake, created_by_user_id, updated_by_user_id
  ) values (
    p_case_id, target_episode_id, target_encounter_id, p_visit_type, current_date, 'draft',
    '{}'::jsonb, actor_id, actor_id
  ) on conflict do nothing;

  update public.initial_visit_notes n
  set episode_id = target_episode_id, encounter_id = target_encounter_id, updated_by_user_id = actor_id
  where n.case_id = p_case_id and n.visit_type = p_visit_type and n.deleted_at is null
    and (n.episode_id is distinct from target_episode_id or n.encounter_id is distinct from target_encounter_id);

  return query select target_episode_id, target_encounter_id;
end
$$;

revoke execute on function public.prepare_evaluation_visit(uuid, text) from public, anon;
grant execute on function public.prepare_evaluation_visit(uuid, text) to authenticated;
