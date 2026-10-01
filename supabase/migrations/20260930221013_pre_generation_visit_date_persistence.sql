-- Atomic preparation shared by date, intake, vitals and first generation.
-- No historical rows are rewritten. Caller-controlled kinds are a closed union.
create function private.prepare_pre_generation_visit_note(
  p_case_id uuid, p_episode_id uuid, p_kind text, p_seed_date date,
  p_encounter_only boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid := auth.uid(); tab text; encounter_kind text; n jsonb;
  e public.clinical_encounters%rowtype; ep public.care_episodes%rowtype;
  c public.cases%rowtype; seed date;
begin
  if not exists(select 1 from public.users where id=actor and is_active) then
    raise exception using errcode='42501',message='Active user account required';
  end if;
  if p_kind is null or p_kind not in ('initial_visit','pain_evaluation_visit','discharge') then
    raise exception using errcode='22023',message='Invalid visit type';
  end if;
  tab := case when p_kind='discharge' then 'discharge_notes' else 'initial_visit_notes' end;
  encounter_kind := case p_kind when 'initial_visit' then 'initial_evaluation' when 'pain_evaluation_visit' then 'pain_evaluation' else 'discharge' end;
  perform pg_advisory_xact_lock(hashtextextended(p_episode_id::text||':'||p_kind,0));
  execute format('select to_jsonb(n) from public.%I n where case_id=$1 and episode_id=$2 and deleted_at is null %s for update',
    tab,case when p_kind='discharge' then '' else 'and visit_type=$3' end)
    into n using p_case_id,p_episode_id,p_kind;
  -- Match existing note -> encounter -> episode -> case lock order.
  select * into e from public.clinical_encounters
    where case_id=p_case_id and episode_id=p_episode_id and encounter_type=encounter_kind and deleted_at is null for update;
  select * into ep from public.care_episodes where id=p_episode_id and case_id=p_case_id and deleted_at is null for update;
  select * into c from public.cases where id=p_case_id and deleted_at is null for update;
  if ep.id is null or c.id is null then raise exception using errcode='42501',message='Visit scope not found'; end if;
  if ep.status<>'active' or c.case_status in ('pending_settlement','closed','archived') then
    raise exception using errcode='42501',message='This visit is locked for changes';
  end if;
  if p_kind='initial_visit' and ep.episode_number>1 then raise exception 'Return episodes start with a Pain Evaluation Visit'; end if;
  if exists(select 1 from public.discharge_note_corrections where episode_id=p_episode_id and status='open') then
    raise exception using errcode='42501',message='Finish or cancel the open discharge correction first';
  end if;
  if e.id is not null and e.status not in ('scheduled','in_progress') then
    raise exception using errcode='42501',message='Visit encounter is not editable';
  end if;
  if n is not null then
    if n->>'status' not in ('draft','failed') or (n->>'encounter_id')::uuid is distinct from e.id then
      raise exception using errcode='42501',message='Visit note is not editable';
    end if;
    return jsonb_build_object('note',n,'encounterId',e.id,'episodeId',ep.id);
  end if;
  seed := coalesce(p_seed_date,e.encounter_date,(now() at time zone 'UTC')::date);
  if e.id is null then
    insert into public.clinical_encounters(case_id,episode_id,encounter_type,modality,status,encounter_date,provider_id,created_by_user_id,updated_by_user_id)
      values(p_case_id,p_episode_id,encounter_kind,'unknown','in_progress',seed,c.assigned_provider_id,actor,actor)
      on conflict do nothing returning * into e;
    if e.id is null then
      select * into e from public.clinical_encounters where case_id=p_case_id and episode_id=p_episode_id
        and encounter_type=encounter_kind and deleted_at is null for update;
      if e.id is null or e.status not in ('scheduled','in_progress') then raise exception 'Visit encounter changed. Retry'; end if;
    end if;
  end if;
  if p_encounter_only then return jsonb_build_object('note',null,'encounterId',e.id,'episodeId',ep.id); end if;
  if p_kind='discharge' then
    insert into public.discharge_notes(case_id,episode_id,encounter_id,status,visit_date,created_by_user_id,updated_by_user_id)
      values(p_case_id,p_episode_id,e.id,'draft',seed,actor,actor) on conflict do nothing returning to_jsonb(discharge_notes.*) into n;
  else
    insert into public.initial_visit_notes(case_id,episode_id,encounter_id,visit_type,status,visit_date,provider_intake,created_by_user_id,updated_by_user_id)
      values(p_case_id,p_episode_id,e.id,p_kind,'draft',seed,'{}',actor,actor) on conflict do nothing returning to_jsonb(initial_visit_notes.*) into n;
  end if;
  if n is null then
    execute format('select to_jsonb(n) from public.%I n where case_id=$1 and episode_id=$2 and deleted_at is null %s for update',
      tab,case when p_kind='discharge' then '' else 'and visit_type=$3' end) into n using p_case_id,p_episode_id,p_kind;
    if n is null or n->>'status' not in ('draft','failed') or (n->>'encounter_id')::uuid is distinct from e.id then
      raise exception 'Visit note changed. Retry';
    end if;
  end if;
  return jsonb_build_object('note',n,'encounterId',e.id,'episodeId',ep.id);
end $$;

create function public.prepare_pre_generation_visit_note(
  p_case_id uuid,p_episode_id uuid,p_kind text,p_encounter_only boolean default false
) returns jsonb language sql security invoker set search_path='' as $$
  select private.prepare_pre_generation_visit_note(p_case_id,p_episode_id,p_kind,null,p_encounter_only)
$$;

create function private.save_pre_generation_visit_date(
  p_case_id uuid,p_episode_id uuid,p_kind text,p_date date,p_expected_note_id uuid,p_expected_date date
) returns jsonb language plpgsql security definer set search_path='' as $$
declare prepared jsonb; n jsonb; tab text; floor_date date; key text; token jsonb;
begin
  if p_date is null or p_date not between date '0001-01-01' and date '9999-12-31' then raise exception using errcode='22007',message='A valid visit date is required'; end if;
  -- An observed note must still exist; never create a replacement for stale clients.
  if p_expected_note_id is not null then
    if p_kind='discharge' then
      perform 1 from public.discharge_notes where id=p_expected_note_id and case_id=p_case_id and episode_id=p_episode_id and deleted_at is null;
    elsif p_kind in ('initial_visit','pain_evaluation_visit') then
      perform 1 from public.initial_visit_notes where id=p_expected_note_id and case_id=p_case_id and episode_id=p_episode_id and visit_type=p_kind and deleted_at is null;
    else raise exception using errcode='22023',message='Invalid visit type'; end if;
    if not found then raise exception using errcode='P0002',message='Visit note changed. Reload before saving'; end if;
  end if;
  prepared := private.prepare_pre_generation_visit_note(p_case_id,p_episode_id,p_kind,p_date,false);
  n := prepared->'note';
  if p_expected_note_id is not null and p_expected_note_id is distinct from (n->>'id')::uuid then
    raise exception using errcode='P0002',message='Visit note changed. Reload before saving';
  end if;
  -- Date-only editing cannot alter generated narrative or reviewed decisions.
  foreach key in array array['introduction','history_of_accident','post_accident_history','chief_complaint','past_medical_history','social_history','review_of_systems','physical_exam','imaging_findings','medical_necessity','diagnoses','treatment_plan','patient_education','prognosis','time_complexity_attestation','clinician_disclaimer','subjective','objective_vitals','objective_general','objective_cervical','objective_lumbar','objective_neurological','assessment','plan_and_recommendations'] loop
    if nullif(btrim(n->>key),'') is not null then raise exception using errcode='42501',message='Use Save Draft to change the date of a generated note'; end if;
  end loop;
  if n->'visit_treatment_decision' is distinct from 'null'::jsonb and n->'visit_treatment_decision' is not null then
    raise exception using errcode='42501',message='Use Save Draft to change a reviewed visit date';
  end if;
  token := jsonb_build_object('noteId',n->>'id','visitDate',n->>'visit_date','updatedAt',n->>'updated_at');
  if (p_expected_note_id is not null and p_expected_note_id is distinct from (n->>'id')::uuid)
    or ((n->>'visit_date')::date is distinct from p_date and (
      (p_expected_note_id is not null and (n->>'visit_date')::date is distinct from p_expected_date)
      or (p_expected_note_id is null and (n->>'visit_date')::date is distinct from p_expected_date)
    )) then
    return jsonb_build_object('conflict',token);
  end if;
  if p_kind='discharge' then
    select max(visit_date) into floor_date from public.initial_visit_notes where case_id=p_case_id and episode_id=p_episode_id and deleted_at is null;
    if p_date<floor_date then raise exception using errcode='23514',message='Discharge date cannot precede the latest evaluation date'; end if;
  end if;
  if (n->>'visit_date')::date is distinct from p_date then
    tab := case when p_kind='discharge' then 'discharge_notes' else 'initial_visit_notes' end;
    execute format('update public.%I n set visit_date=$1,updated_by_user_id=auth.uid() where id=$2 returning to_jsonb(n)',tab)
      into n using p_date,(n->>'id')::uuid;
  end if;
  -- Also repair date agreement on idempotent acknowledgment, without advancing status.
  update public.clinical_encounters set encounter_date=p_date,updated_by_user_id=auth.uid()
    where id=(prepared->>'encounterId')::uuid and encounter_date is distinct from p_date;
  return jsonb_build_object('data',jsonb_build_object('noteId',n->>'id','visitDate',n->>'visit_date','updatedAt',n->>'updated_at'));
end $$;
create function public.save_pre_generation_visit_date(
  p_case_id uuid,p_episode_id uuid,p_kind text,p_date date,p_expected_note_id uuid,p_expected_date date
) returns jsonb language sql security invoker set search_path='' as $$
 select private.save_pre_generation_visit_date(p_case_id,p_episode_id,p_kind,p_date,p_expected_note_id,p_expected_date)
$$;
revoke all on function private.prepare_pre_generation_visit_note(uuid,uuid,text,date,boolean),public.prepare_pre_generation_visit_note(uuid,uuid,text,boolean),private.save_pre_generation_visit_date(uuid,uuid,text,date,uuid,date),public.save_pre_generation_visit_date(uuid,uuid,text,date,uuid,date) from public,anon,authenticated,service_role;
grant execute on function private.prepare_pre_generation_visit_note(uuid,uuid,text,date,boolean),public.prepare_pre_generation_visit_note(uuid,uuid,text,boolean),private.save_pre_generation_visit_date(uuid,uuid,text,date,uuid,date),public.save_pre_generation_visit_date(uuid,uuid,text,date,uuid,date) to authenticated;
