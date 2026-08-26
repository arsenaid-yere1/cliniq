-- Catch records written by the legacy application after the additive Phase 1
-- migration. This migration deliberately aborts if a case has no Episode 1.

do $$
declare
  note record;
  v_episode_id uuid;
  v_encounter_id uuid;
  v_series_id uuid;
begin
  for note in
    select n.*, c.assigned_provider_id
    from public.initial_visit_notes n
    join public.cases c on c.id = n.case_id
    where n.deleted_at is null
      and (n.episode_id is null or n.encounter_id is null)
    order by n.created_at, n.id
  loop
    select e.id into v_episode_id
    from public.care_episodes e
    where e.case_id = note.case_id and e.episode_number = 1 and e.deleted_at is null;
    if v_episode_id is null then
      raise exception using errcode = 'P0002', message = 'Catch-up blocked: Episode 1 is missing';
    end if;

    insert into public.clinical_encounters (
      case_id, episode_id, encounter_type, modality, status, encounter_date,
      completed_at, provider_id, provider_intake, created_at, updated_at,
      created_by_user_id, updated_by_user_id
    ) values (
      note.case_id, v_episode_id,
      case note.visit_type when 'pain_evaluation_visit' then 'pain_evaluation' else 'initial_evaluation' end,
      'unknown', case when note.status = 'finalized' then 'completed' else 'in_progress' end,
      coalesce(note.visit_date, note.finalized_at::date, note.created_at::date),
      case when note.status = 'finalized' then coalesce(note.finalized_at, note.updated_at) end,
      note.assigned_provider_id, coalesce(note.provider_intake, '{}'::jsonb),
      note.created_at, note.updated_at, note.created_by_user_id, note.updated_by_user_id
    ) returning id into v_encounter_id;

    update public.initial_visit_notes
    set episode_id = v_episode_id, encounter_id = v_encounter_id
    where id = note.id;
  end loop;

  for note in
    select n.*, c.assigned_provider_id
    from public.discharge_notes n
    join public.cases c on c.id = n.case_id
    where n.deleted_at is null
      and (n.episode_id is null or n.encounter_id is null)
    order by n.created_at, n.id
  loop
    select e.id into v_episode_id
    from public.care_episodes e
    where e.case_id = note.case_id and e.episode_number = 1 and e.deleted_at is null;
    if v_episode_id is null then
      raise exception using errcode = 'P0002', message = 'Catch-up blocked: Episode 1 is missing';
    end if;

    insert into public.clinical_encounters (
      case_id, episode_id, encounter_type, modality, status, encounter_date,
      completed_at, provider_id, created_at, updated_at,
      created_by_user_id, updated_by_user_id
    ) values (
      note.case_id, v_episode_id, 'discharge', 'unknown',
      case when note.status = 'finalized' then 'completed' else 'in_progress' end,
      coalesce(note.visit_date, note.finalized_at::date, note.created_at::date),
      case when note.status = 'finalized' then coalesce(note.finalized_at, note.updated_at) end,
      note.assigned_provider_id, note.created_at, note.updated_at,
      note.created_by_user_id, note.updated_by_user_id
    ) returning id into v_encounter_id;

    update public.discharge_notes
    set episode_id = v_episode_id, encounter_id = v_encounter_id
    where id = note.id;
  end loop;

  for note in
    select p.*, c.assigned_provider_id
    from public.procedures p
    join public.cases c on c.id = p.case_id
    where p.deleted_at is null
      and (p.episode_id is null or p.procedure_series_id is null or p.provider_profile_id is null)
    order by p.created_at, p.id
  loop
    select e.id into v_episode_id
    from public.care_episodes e
    where e.case_id = note.case_id and e.episode_number = 1 and e.deleted_at is null;
    if v_episode_id is null then
      raise exception using errcode = 'P0002', message = 'Catch-up blocked: Episode 1 is missing';
    end if;

    select s.id into v_series_id
    from public.procedure_series s
    where s.episode_id = v_episode_id and s.deleted_at is null
    order by s.series_number
    limit 1;

    if v_series_id is null then
      insert into public.procedure_series (
        case_id, episode_id, series_number, procedure_type, status,
        created_by_user_id, updated_by_user_id
      ) values (
        note.case_id, v_episode_id, 1,
        case when note.procedure_type in ('prp', 'cortisone', 'hyaluronic', 'botox')
          then note.procedure_type else 'legacy_mixed' end,
        'active', note.created_by_user_id, note.updated_by_user_id
      ) returning id into v_series_id;
    end if;

    update public.procedures
    set episode_id = v_episode_id,
        procedure_series_id = v_series_id,
        provider_profile_id = coalesce(provider_profile_id, note.assigned_provider_id)
    where id = note.id;
  end loop;

  update public.clinical_orders o
  set episode_id = n.episode_id, encounter_id = n.encounter_id
  from public.initial_visit_notes n
  where o.initial_visit_note_id = n.id and o.deleted_at is null and n.deleted_at is null
    and (o.episode_id is null or o.encounter_id is null);

  update public.vital_signs v
  set encounter_id = n.encounter_id
  from public.initial_visit_notes n
  where n.case_id = v.case_id and n.visit_type = 'initial_visit'
    and n.deleted_at is null and v.deleted_at is null
    and v.procedure_id is null and v.encounter_id is null;
  update public.vital_signs v
  set encounter_id = n.encounter_id
  from public.initial_visit_notes n
  where n.case_id = v.case_id and n.visit_type = 'pain_evaluation_visit'
    and n.deleted_at is null and v.deleted_at is null
    and v.procedure_id is null and v.encounter_id is null;

  update public.case_quality_reviews q
  set episode_id = e.id
  from public.care_episodes e
  where e.case_id = q.case_id and e.episode_number = 1 and e.deleted_at is null
    and q.deleted_at is null and q.episode_id is null;

  update public.documents d set episode_id = n.episode_id, encounter_id = n.encounter_id
  from public.initial_visit_notes n
  where n.document_id = d.id and n.deleted_at is null and d.deleted_at is null
    and (d.episode_id is null or d.encounter_id is null);
  update public.documents d set episode_id = n.episode_id, encounter_id = n.encounter_id
  from public.discharge_notes n
  where n.document_id = d.id and n.deleted_at is null and d.deleted_at is null
    and (d.episode_id is null or d.encounter_id is null);
  update public.documents d set episode_id = p.episode_id
  from public.procedure_notes pn join public.procedures p on p.id = pn.procedure_id
  where pn.document_id = d.id and pn.deleted_at is null and p.deleted_at is null
    and d.deleted_at is null and d.episode_id is null;
  update public.documents d set episode_id = o.episode_id, encounter_id = o.encounter_id
  from public.clinical_orders o
  where o.document_id = d.id and o.deleted_at is null and d.deleted_at is null
    and (d.episode_id is null or (d.encounter_id is null and o.encounter_id is not null));
end
$$;

do $$
begin
  if exists (select 1 from public.initial_visit_notes where deleted_at is null and (episode_id is null or encounter_id is null))
    or exists (select 1 from public.discharge_notes where deleted_at is null and (episode_id is null or encounter_id is null))
    or exists (select 1 from public.procedures where deleted_at is null and (episode_id is null or procedure_series_id is null))
    or exists (select 1 from public.clinical_orders where deleted_at is null and episode_id is null)
    or exists (select 1 from public.case_quality_reviews where deleted_at is null and episode_id is null)
  then
    raise exception using errcode = '23502', message = 'Episode ownership catch-up is incomplete';
  end if;
end
$$;
