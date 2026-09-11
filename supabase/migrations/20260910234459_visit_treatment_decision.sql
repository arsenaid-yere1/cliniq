-- The existing evaluation lifecycle trigger is required by draft-save/reset
-- invariants. Fail before changing schema if the target has drifted.
do $$ begin
 if not exists(select 1 from pg_trigger where tgrelid='public.initial_visit_notes'::regclass
   and tgname='sync_initial_visit_note_encounter_trg' and tgenabled in ('O','A')) then
  raise exception 'Restore migration 20260827154248 (evaluation encounter synchronization) before installing visit treatment decisions';
 end if;
end $$;

-- Visit decisions only: no procedure consent changes or historical backfill.
alter table public.initial_visit_notes add column visit_treatment_decision jsonb;
alter table public.discharge_notes add column visit_treatment_decision jsonb;
alter table public.pain_follow_up_notes add column visit_treatment_decision jsonb;

create function private.visit_decision_closing(p_value jsonb) returns text
language sql immutable set search_path='' as $$
 select case p_value->>'decision'
  when 'accepted' then 'The patient agreed to the treatment plan discussed at this visit, as outlined above.'
  when 'partially_accepted' then 'The patient partially agreed to the treatment plan discussed at this visit.'
  when 'deferred' then 'The patient deferred a decision on the treatment plan discussed at this visit.'
  when 'declined' then 'The patient declined the treatment plan discussed at this visit.'
  else '' end || case when p_value->>'decision' in ('partially_accepted','deferred','declined') and nullif(btrim(p_value->>'details'),'') is not null then ' Decision details: '||btrim(p_value->>'details') else '' end
$$;

-- This invoker trigger also runs on generation/manual updates. The confirmed
-- closing is reconciled in the same write as narrative and raw model output.
create function private.guard_visit_decision() returns trigger
language plpgsql security invoker set search_path='' as $$
declare previous text:=''; closing text; plan text; visit text; d jsonb; changed boolean; wrapper text;
begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_op='INSERT' and new.visit_treatment_decision is not null then raise exception using errcode='42501',message='Use Save Draft to confirm the visit decision'; end if;
  if tg_op='UPDATE' and new.visit_treatment_decision is distinct from old.visit_treatment_decision then raise exception using errcode='42501',message='Use Save Draft to confirm the visit decision'; end if;
 end if;
 -- Narrative-only corrections preserve historical evidence. The existing
 -- correction RPCs own prose updates and restoration of the signed snapshot.
 if tg_table_name='discharge_notes' and exists(select 1 from public.discharge_note_corrections where discharge_note_id=new.id and status='open') then return new; end if;
 -- A date change on the encounter does not update the note version. Reject
 -- signing a decision whose reviewed date/plan no longer matches the visit.
 if tg_op='UPDATE' and new.status='finalized' and old.status<>'finalized' and new.visit_treatment_decision is not null then
  plan:=btrim(regexp_replace(coalesce(to_jsonb(new)->>'treatment_plan',to_jsonb(new)->>'plan_and_recommendations',''),'\s+',' ','g'));
  visit:=coalesce(to_jsonb(new)->>'visit_date',(select encounter_date::text from public.clinical_encounters where id=new.encounter_id));
  if (new.visit_treatment_decision->>'reviewed_plan_hash') is distinct from md5(plan) or (new.visit_treatment_decision->>'visit_date') is distinct from visit then
   raise exception 'Treatment plan or visit date changed. Review and save the decision before signing';
  end if;
 end if;
 -- Existing signed/correction controls own historical narrative and snapshots.
 if new.status='finalized' or (tg_op='UPDATE' and old.status='finalized') then return new; end if;
 d:=new.visit_treatment_decision;
 if tg_op='UPDATE' then
  previous:=private.visit_decision_closing(old.visit_treatment_decision);
  changed:=new.patient_education is distinct from old.patient_education
   or new.visit_treatment_decision is distinct from old.visit_treatment_decision
   or new.raw_ai_response is distinct from old.raw_ai_response
   or (to_jsonb(new)->>'treatment_plan') is distinct from (to_jsonb(old)->>'treatment_plan')
   or (to_jsonb(new)->>'plan_and_recommendations') is distinct from (to_jsonb(old)->>'plan_and_recommendations')
   or (to_jsonb(new)->>'visit_date') is distinct from (to_jsonb(old)->>'visit_date');
  if not changed then return new; end if;
 end if;
 if d is null and previous='' then return new; end if;
 if previous<>'' and new.patient_education is not null then new.patient_education:=btrim(replace(new.patient_education,previous,'')); end if;
 closing:=private.visit_decision_closing(d);
 -- Strip an existing exact application fragment before potentially reappending.
 if closing<>'' and new.patient_education is not null then new.patient_education:=btrim(replace(new.patient_education,closing,'')); end if;
 plan:=btrim(regexp_replace(coalesce(to_jsonb(new)->>'treatment_plan',to_jsonb(new)->>'plan_and_recommendations',''),'\s+',' ','g'));
 visit:=coalesce(to_jsonb(new)->>'visit_date',(select encounter_date::text from public.clinical_encounters where id=new.encounter_id));
 if closing<>'' and d->>'reviewed_plan_hash'=md5(plan) and (d->>'visit_date') is not distinct from visit then
  new.patient_education:=concat_ws(E'\n\n',nullif(new.patient_education,''),closing);
 end if;
 if jsonb_typeof(new.raw_ai_response)='object' then
  if new.raw_ai_response ? 'patient_education' then new.raw_ai_response:=jsonb_set(new.raw_ai_response,'{patient_education}',coalesce(to_jsonb(new.patient_education),'null')); end if;
  foreach wrapper in array array['data','raw'] loop
   if jsonb_typeof(new.raw_ai_response->wrapper)='object' and new.raw_ai_response->wrapper ? 'patient_education' then
    new.raw_ai_response:=jsonb_set(new.raw_ai_response,array[wrapper,'patient_education'],coalesce(to_jsonb(new.patient_education),'null'));
   end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.visit_decision_closing(jsonb),private.guard_visit_decision() from public,anon,authenticated,service_role;
-- The invoker trigger needs this pure, data-only helper.
grant execute on function private.visit_decision_closing(jsonb) to authenticated,service_role;
create trigger visit_decision_guard before insert or update on public.initial_visit_notes for each row execute function private.guard_visit_decision();
create trigger visit_decision_guard before insert or update on public.discharge_notes for each row execute function private.guard_visit_decision();
create trigger visit_decision_guard before insert or update on public.pain_follow_up_notes for each row execute function private.guard_visit_decision();

create function private.save_visit_note_decision(p_kind text,p_note_id uuid,p_case_id uuid,p_expected_updated_at timestamptz,p_patch jsonb,p_decision jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n jsonb; eid uuid; enc uuid; actor uuid:=auth.uid(); key text; assignments text; plan text; decision text; details text; visit text;
 allowed text[]:=array['visit_date','introduction','history_of_accident','post_accident_history','chief_complaint','past_medical_history','social_history','review_of_systems','physical_exam','imaging_findings','medical_necessity','diagnoses','treatment_plan','patient_education','prognosis','time_complexity_attestation','clinician_disclaimer','subjective','interval_history','telehealth_observations','imaging_review','assessment','follow_up','procedure_recommendations','objective_vitals','objective_general','objective_cervical','objective_lumbar','objective_neurological','plan_and_recommendations','prp_target_recommendations'];
begin
 if not exists(select 1 from public.users where id=actor and is_active) then raise exception using errcode='42501',message='Active user account required'; end if;
 if p_kind is null or p_kind<>all(array['initial_visit_notes','discharge_notes','pain_follow_up_notes']) then raise exception 'Invalid visit note'; end if;
 execute format('select to_jsonb(n) from public.%I n where id=$1 for update',p_kind) into n using p_note_id;
 if n is null or n->>'deleted_at' is not null or (n->>'case_id')::uuid is distinct from p_case_id then raise exception 'Visit note not found'; end if;
 if n->>'status'<>'draft' then raise exception 'Only a draft visit can be saved'; end if;
 if p_expected_updated_at is null or (n->>'updated_at')::timestamptz is distinct from p_expected_updated_at then raise exception 'Note changed. Reload before saving'; end if;
 eid:=(n->>'episode_id')::uuid; enc:=(n->>'encounter_id')::uuid;
 -- Same note -> encounter -> episode -> case order as reset/finalization.
 perform 1 from public.clinical_encounters where id=enc and case_id=p_case_id and episode_id=eid and status='in_progress' and deleted_at is null for update;
 if not found then raise exception 'Visit is not writable'; end if;
 perform 1 from public.care_episodes where id=eid and case_id=p_case_id and status='active' and deleted_at is null for update;
 if not found then raise exception 'Episode is not writable'; end if;
 perform 1 from public.cases where id=p_case_id and deleted_at is null and case_status not in ('pending_settlement','closed','archived') for update;
 if not found then raise exception 'Case is not writable'; end if;
 if exists(select 1 from public.discharge_note_corrections where episode_id=eid and status='open') then raise exception 'Finish or cancel the open discharge correction first'; end if;
 if jsonb_typeof(p_patch) is distinct from 'object' or jsonb_typeof(p_decision) is distinct from 'object' or not p_decision ?& array['decision','details'] then raise exception 'Invalid visit decision'; end if;
 for key in select jsonb_object_keys(p_decision) loop
  if key<>all(array['decision','details']) then raise exception 'Invalid decision field'; end if;
 end loop;
 decision:=p_decision->>'decision'; details:=nullif(btrim(p_decision->>'details'),'');
 if decision is null or decision<>all(array['accepted','partially_accepted','deferred','declined','not_documented']) then raise exception 'Invalid treatment decision'; end if;
 if jsonb_typeof(p_decision->'details') not in ('null','string') or length(p_decision->>'details')>2000 then raise exception 'Invalid decision details'; end if;
 if decision='partially_accepted' and details is null then raise exception 'Describe which treatments were accepted and which were deferred or declined'; end if;
 if p_kind='pain_follow_up_notes' then
  if not p_patch ? 'reviewed_visit_date' or (p_patch->>'reviewed_visit_date') is distinct from (select encounter_date::text from public.clinical_encounters where id=enc) then
   raise exception 'Visit date changed. Reload before confirming the treatment decision';
  end if;
  p_patch:=p_patch-'reviewed_visit_date';
 end if;
 for key in select jsonb_object_keys(p_patch) loop
  if key<>all(allowed) or not n ? key then raise exception 'Invalid visit note field: %',key; end if;
 end loop;
 if not p_patch ? 'patient_education' or jsonb_typeof(p_patch->'patient_education')<>'string' then raise exception 'Patient education is required'; end if;
 key:=case when p_kind='discharge_notes' then 'plan_and_recommendations' else 'treatment_plan' end;
 if not p_patch ? key or jsonb_typeof(p_patch->key)<>'string' then raise exception 'Reviewed treatment plan is required'; end if;
 plan:=btrim(regexp_replace(p_patch->>key,'\s+',' ','g'));
 if decision in ('accepted','partially_accepted') and plan='' then raise exception 'Review a treatment plan before confirming acceptance'; end if;
 visit:=coalesce(case when p_patch ? 'visit_date' then p_patch->>'visit_date' else n->>'visit_date' end,(select encounter_date::text from public.clinical_encounters where id=enc));
 p_patch:=p_patch||jsonb_build_object('updated_by_user_id',actor,'visit_treatment_decision',jsonb_build_object('schema_version',1,'decision',decision,'details',details,'reviewed_plan_hash',md5(plan),'reviewed_plan',plan,'visit_date',visit,'confirmed_by',actor,'confirmed_at',clock_timestamp()));
 select string_agg(format('%I=r.%I',k,k),',') into assignments from jsonb_object_keys(p_patch) k;
 execute format('update public.%I n set %s from jsonb_populate_record(null::public.%I,$1) r where n.id=$2 returning to_jsonb(n)',p_kind,assignments,p_kind) into n using p_patch,p_note_id;
 return n;
end $$;
create function public.save_visit_note_decision(p_kind text,p_note_id uuid,p_case_id uuid,p_expected_updated_at timestamptz,p_patch jsonb,p_decision jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.save_visit_note_decision(p_kind,p_note_id,p_case_id,p_expected_updated_at,p_patch,p_decision) $$;
revoke all on function private.save_visit_note_decision(text,uuid,uuid,timestamptz,jsonb,jsonb),public.save_visit_note_decision(text,uuid,uuid,timestamptz,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function private.save_visit_note_decision(text,uuid,uuid,timestamptz,jsonb,jsonb),public.save_visit_note_decision(text,uuid,uuid,timestamptz,jsonb,jsonb) to authenticated;

-- Full-row signed snapshots already retain the field. Wipe resets clear it;
-- keep-content resets and narrative-only corrections retain original evidence.
do $$ declare definition text; anchor text:='patch:=patch || jsonb_build_object(''updated_by_user_id'',actor.id);'; begin
 definition:=pg_get_functiondef('private.apply_clinical_reset(jsonb)'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'Reset patch anchor not found'; end if;
 definition:=replace(definition,anchor,'if k<>''procedure_notes'' and not coalesce((item->>''keep_content'')::boolean,false) then patch:=patch || ''{"visit_treatment_decision":null}''::jsonb; end if;'||chr(10)||anchor);
 execute definition;
end $$;
