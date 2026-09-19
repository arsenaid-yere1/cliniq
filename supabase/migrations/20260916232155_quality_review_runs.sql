-- Additive rollout: attempts never replace the last successful snapshot.
alter table public.case_quality_reviews
  add column review_version text,
  add column review_coverage jsonb,
  add column source_versions jsonb;

create table public.case_quality_review_runs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id),
  episode_id uuid not null references public.care_episodes(id),
  actor_user_id uuid not null references public.users(id),
  kind text not null default 'review' check (kind in ('review','fix')),
  status text not null default 'processing' check (status in ('processing','completed','failed','superseded','expired')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  lease_expires_at timestamptz not null default clock_timestamp() + interval '2 minutes',
  sections_done integer not null default 0 check (sections_done >= 0),
  source_hash text,
  error_category text,
  error_message text,
  published_review_id uuid references public.case_quality_reviews(id),
  finding_transitions jsonb not null default '[]',
  fix_target jsonb,
  foreign key (episode_id,case_id) references public.care_episodes(id,case_id)
);
create unique index case_quality_review_runs_processing_episode on public.case_quality_review_runs(episode_id) where status='processing';
create index case_quality_review_runs_history on public.case_quality_review_runs(episode_id,started_at desc,id);
alter table public.case_quality_review_runs enable row level security;
create policy quality_review_runs_read on public.case_quality_review_runs for select to authenticated
  using (exists(select 1 from public.users u where u.id=auth.uid() and u.is_active));
revoke all on public.case_quality_review_runs from anon,authenticated;
grant select on public.case_quality_review_runs to authenticated;

-- Recover only episodes whose live legacy row is not a successful review.
-- The historical records themselves are retained, including their failure data.
do $$ declare item record; previous_id uuid; begin
 for item in select * from public.case_quality_reviews where deleted_at is null and generation_status in ('pending','processing','failed') loop
  if item.created_by_user_id is not null then
   insert into public.case_quality_review_runs(case_id,episode_id,actor_user_id,status,started_at,finished_at,error_category,error_message)
    values(item.case_id,item.episode_id,item.created_by_user_id,'failed',item.created_at,clock_timestamp(),'legacy_attempt',coalesce(item.generation_error,'Legacy unfinished attempt recovered during migration'));
  end if;
  update public.case_quality_reviews set deleted_at=clock_timestamp() where id=item.id;
  select r.id into previous_id from public.case_quality_reviews r where r.episode_id=item.episode_id and r.case_id=item.case_id and r.generation_status='completed'
   order by r.generated_at desc nulls last,r.created_at desc,r.id desc limit 1;
  if previous_id is not null then update public.case_quality_reviews set deleted_at=null where id=previous_id; end if;
 end loop;
end $$;

-- All operations acquire their subset of note -> encounter -> episode -> case -> run -> review.
create function private.quality_review_run(p_action text,p_case_id uuid,p_episode_id uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); run public.case_quality_review_runs; previous public.case_quality_reviews; eid uuid; rid uuid; result jsonb; current_status text;
begin
 if not exists(select 1 from public.users where id=actor and is_active) then raise exception using errcode='42501',message='Active user account required'; end if;
 perform 1 from public.care_episodes where id=p_episode_id and case_id=p_case_id and deleted_at is null for update;
 if not found then raise exception 'Care episode not found'; end if;
 select case_status into current_status from public.cases where id=p_case_id and deleted_at is null for update;
 if not found then raise exception 'Case not found'; end if;
 if p_action in ('begin','publish') then
  if current_status in ('pending_settlement','closed','archived') then raise exception 'Case is locked'; end if;
  select e.id into eid from public.care_episodes e where e.case_id=p_case_id and e.deleted_at is null order by (e.status='active') desc,e.episode_number desc limit 1;
  if eid is distinct from p_episode_id then raise exception 'Care episode changed; reload the review'; end if;
 end if;
 if p_action='begin' then
  update public.case_quality_review_runs set status='expired',finished_at=clock_timestamp(),error_category='lease_expired',error_message='Review attempt expired'
   where episode_id=p_episode_id and status='processing' and lease_expires_at<=clock_timestamp();
  if exists(select 1 from public.case_quality_review_runs where episode_id=p_episode_id and status='processing') then raise exception 'A Quality Review operation is already in progress'; end if;
  insert into public.case_quality_review_runs(case_id,episode_id,actor_user_id,kind,fix_target)
   values(p_case_id,p_episode_id,actor,coalesce(p_payload->>'kind','review'),p_payload->'fix_target') returning * into run;
  return to_jsonb(run);
 end if;
 select * into run from public.case_quality_review_runs where id=(p_payload->>'run_id')::uuid and case_id=p_case_id and episode_id=p_episode_id for update;
 if not found or run.actor_user_id<>actor then raise exception using errcode='42501',message='Review attempt not found'; end if;
 if run.status<>'processing' then raise exception 'Review attempt is no longer processing'; end if;
 if p_action='fail' then
  if coalesce(p_payload->>'status','failed') not in ('failed','superseded') then raise exception 'Invalid failure status'; end if;
  update public.case_quality_review_runs set status=coalesce(p_payload->>'status','failed'),finished_at=clock_timestamp(),error_category=p_payload->>'error_category',error_message=p_payload->>'error_message' where id=run.id returning to_jsonb(case_quality_review_runs) into result;
  return result;
 end if;
 if run.lease_expires_at<=clock_timestamp() then raise exception 'Review lease expired'; end if;
 if p_action='heartbeat' then
  update public.case_quality_review_runs set lease_expires_at=clock_timestamp()+interval '2 minutes',sections_done=greatest(sections_done,coalesce((p_payload->>'sections_done')::integer,0)) where id=run.id;
  return jsonb_build_object('id',run.id);
 elsif p_action='publish' then
  select * into previous from public.case_quality_reviews where case_id=p_case_id and episode_id=p_episode_id and deleted_at is null for update;
  if previous.id is distinct from (p_payload->>'expected_review_id')::uuid or previous.updated_at is distinct from (p_payload->>'expected_updated_at')::timestamptz then
   return jsonb_build_object('conflict',true);
  end if;
  if jsonb_typeof(p_payload->'findings') is distinct from 'array' or jsonb_typeof(p_payload->'finding_overrides') is distinct from 'object' then raise exception 'Invalid review payload'; end if;
  if previous.id is not null then update public.case_quality_reviews set deleted_at=clock_timestamp(),updated_by_user_id=actor where id=previous.id; end if;
  insert into public.case_quality_reviews(case_id,episode_id,findings,finding_overrides,summary,overall_assessment,ai_model,generation_status,generated_at,source_data_hash,sections_done,sections_total,created_by_user_id,updated_by_user_id,review_version,review_coverage,source_versions)
   values(p_case_id,p_episode_id,p_payload->'findings',p_payload->'finding_overrides',p_payload->>'summary',p_payload->>'overall_assessment','claude-opus-4-7','completed',clock_timestamp(),p_payload->>'source_hash',3,3,actor,actor,'qc-v3',p_payload->'coverage',p_payload->'source_versions') returning id into rid;
  update public.case_quality_review_runs set status='completed',finished_at=clock_timestamp(),source_hash=p_payload->>'source_hash',published_review_id=rid,sections_done=3,finding_transitions=coalesce(p_payload->'transitions','[]') where id=run.id;
  return jsonb_build_object('id',rid);
 end if;
 raise exception 'Unknown review operation';
end $$;
create function public.quality_review_run(p_action text,p_case_id uuid,p_episode_id uuid,p_payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.quality_review_run(p_action,p_case_id,p_episode_id,p_payload) $$;
revoke all on function private.quality_review_run(text,uuid,uuid,jsonb),public.quality_review_run(text,uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.quality_review_run(text,uuid,uuid,jsonb),public.quality_review_run(text,uuid,uuid,jsonb) to authenticated;

create function private.quality_review_disposition(p_review_id uuid,p_finding_key text,p_expected_entry jsonb,p_entry jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); r public.case_quality_reviews; eid uuid; cid uuid; entry jsonb;
begin
 if not exists(select 1 from public.users where id=actor and is_active) then raise exception using errcode='42501',message='Active user account required'; end if;
 select episode_id,case_id into eid,cid from public.case_quality_reviews where id=p_review_id;
 perform 1 from public.care_episodes where id=eid and case_id=cid and deleted_at is null for update;
 if not found then raise exception 'Review episode not found'; end if;
 perform 1 from public.cases where id=cid and deleted_at is null and case_status not in ('pending_settlement','closed','archived') for update;
 if not found then raise exception 'Case is locked'; end if;
 if eid is distinct from (select e.id from public.care_episodes e where e.case_id=cid and e.deleted_at is null order by (e.status='active') desc,e.episode_number desc limit 1) then raise exception 'Care episode changed; reload the review'; end if;
 select * into r from public.case_quality_reviews where id=p_review_id and deleted_at is null and review_version='qc-v3' for update;
 if not found then raise exception 'Review changed; reload before editing'; end if;
 if not exists(select 1 from jsonb_array_elements(r.findings) f where f->>'key'=p_finding_key) then raise exception 'Finding not found'; end if;
 if coalesce(r.finding_overrides->p_finding_key,'null') is distinct from coalesce(p_expected_entry,'null') then raise exception 'Finding disposition changed; reload'; end if;
 if p_entry is null or p_entry='null' then
  update public.case_quality_reviews set finding_overrides=finding_overrides-p_finding_key,updated_by_user_id=actor where id=p_review_id returning to_jsonb(case_quality_reviews) into entry;
 else
  if jsonb_typeof(p_entry)<>'object' or coalesce(p_entry->>'status','') not in ('acknowledged','dismissed','edited','resolved','fix_in_progress') then raise exception 'Invalid finding disposition'; end if;
  entry:=p_entry||jsonb_build_object('actor_user_id',actor,'set_at',clock_timestamp());
  update public.case_quality_reviews set finding_overrides=jsonb_set(finding_overrides,array[p_finding_key],entry),updated_by_user_id=actor where id=p_review_id returning to_jsonb(case_quality_reviews) into entry;
 end if;
 return entry;
end $$;
create function public.quality_review_disposition(p_review_id uuid,p_finding_key text,p_expected_entry jsonb,p_entry jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.quality_review_disposition(p_review_id,p_finding_key,p_expected_entry,p_entry) $$;
revoke all on function private.quality_review_disposition(uuid,text,jsonb,jsonb),public.quality_review_disposition(uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.quality_review_disposition(uuid,text,jsonb,jsonb),public.quality_review_disposition(uuid,text,jsonb,jsonb) to authenticated;

create function private.quality_review_save_fix(p_run_id uuid,p_table text,p_note_id uuid,p_expected_updated_at timestamptz,p_patch jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); n jsonb; eid uuid; cid uuid; enc uuid; run public.case_quality_review_runs; key text; assignments text; allowed text[];
begin
 if not exists(select 1 from public.users where id=actor and is_active) then raise exception using errcode='42501',message='Active user account required'; end if;
 if p_table is null or p_table<>all(array['initial_visit_notes','procedure_notes','discharge_notes','pain_follow_up_notes']) then raise exception 'Invalid note table'; end if;
 execute format('select to_jsonb(n) from public.%I n where id=$1 for update',p_table) into n using p_note_id;
 if n is null or n->>'deleted_at' is not null or n->>'status'<>'draft' or (n->>'updated_at')::timestamptz is distinct from p_expected_updated_at then raise exception 'Note changed or is not editable'; end if;
 cid:=(n->>'case_id')::uuid; eid:=(n->>'episode_id')::uuid; enc:=(n->>'encounter_id')::uuid;
 if p_table='procedure_notes' then
  select p.episode_id,p.encounter_id into eid,enc from public.procedures p where p.id=(n->>'procedure_id')::uuid and p.case_id=cid and p.deleted_at is null;
 end if;
 perform 1 from public.clinical_encounters where id=enc and episode_id=eid and case_id=cid and status='in_progress' and deleted_at is null for update;
 if not found then raise exception 'Visit is not writable'; end if;
 perform 1 from public.care_episodes where id=eid and case_id=cid and status='active' and deleted_at is null for update;
 if not found then raise exception 'Episode is not writable'; end if;
 perform 1 from public.cases where id=cid and deleted_at is null and case_status not in ('pending_settlement','closed','archived') for update;
 if not found then raise exception 'Case is not writable'; end if;
 select * into run from public.case_quality_review_runs where id=p_run_id and case_id=cid and episode_id=eid and actor_user_id=actor for update;
 if not found or run.kind<>'fix' or run.status<>'processing' or run.lease_expires_at<=clock_timestamp() then raise exception 'Fix attempt expired or changed'; end if;
 if run.fix_target->>'table' is distinct from p_table or (run.fix_target->>'note_id')::uuid is distinct from p_note_id or (run.fix_target->>'updated_at')::timestamptz is distinct from p_expected_updated_at then raise exception 'Fix target changed'; end if;
 if exists(select 1 from public.discharge_note_corrections where episode_id=eid and status='open') then raise exception 'Finish or cancel the open discharge correction first'; end if;
 allowed:=case p_table
  when 'initial_visit_notes' then array['introduction','history_of_accident','post_accident_history','chief_complaint','past_medical_history','social_history','review_of_systems','physical_exam','imaging_findings','diagnoses','medical_necessity','treatment_plan','patient_education','prognosis','time_complexity_attestation','clinician_disclaimer']
  when 'procedure_notes' then array['subjective','past_medical_history','allergies','current_medications','social_history','review_of_systems','objective_vitals','objective_physical_exam','assessment_summary','procedure_indication','procedure_preparation','procedure_prp_prep','procedure_anesthesia','procedure_injection','procedure_post_care','procedure_followup','assessment_and_plan','patient_education','prognosis','clinician_disclaimer']
  when 'discharge_notes' then array['subjective','objective_vitals','objective_general','objective_cervical','objective_lumbar','objective_neurological','diagnoses','assessment','plan_and_recommendations','patient_education','prognosis','clinician_disclaimer']
  else array['subjective','interval_history','review_of_systems','telehealth_observations','imaging_review','assessment','diagnoses','treatment_plan','patient_education','follow_up','clinician_disclaimer'] end;
 key:=run.fix_target->>'section';
 if key is null or key<>all(allowed) or jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(p_patch->key) is distinct from 'string' then raise exception 'Invalid fix section'; end if;
 allowed:=array[key,'raw_ai_response'];
 if p_table='initial_visit_notes' and key='treatment_plan' then allowed:=allowed||array['prp_target_recommendations','prp_target_evidence_hash']; end if;
 if p_table='discharge_notes' then allowed:=allowed||array['pain_trajectory_text','discharge_pain_estimate_min','discharge_pain_estimate_max','discharge_pain_estimated']; end if;
 for key in select jsonb_object_keys(p_patch) loop
  if key<>all(allowed) or not n ? key then raise exception 'Invalid fix patch field'; end if;
 end loop;
 p_patch:=p_patch||jsonb_build_object('updated_by_user_id',actor);
 select string_agg(format('%I=r.%I',k,k),',') into assignments from jsonb_object_keys(p_patch) k;
 execute format('update public.%I n set %s from jsonb_populate_record(null::public.%I,$1) r where n.id=$2 returning to_jsonb(n)',p_table,assignments,p_table) into n using p_patch,p_note_id;
 return n;
end $$;
create function public.quality_review_save_fix(p_run_id uuid,p_table text,p_note_id uuid,p_expected_updated_at timestamptz,p_patch jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.quality_review_save_fix(p_run_id,p_table,p_note_id,p_expected_updated_at,p_patch) $$;
revoke all on function private.quality_review_save_fix(uuid,text,uuid,timestamptz,jsonb),public.quality_review_save_fix(uuid,text,uuid,timestamptz,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.quality_review_save_fix(uuid,text,uuid,timestamptz,jsonb),public.quality_review_save_fix(uuid,text,uuid,timestamptz,jsonb) to authenticated;
