-- Follow-up source review is additive. Report-only until the compatible UI is deployed.
alter table public.pain_follow_up_notes add column source_baseline jsonb, add column source_review jsonb;
create table private.follow_up_review_settings (
  singleton boolean primary key default true check(singleton), enforce boolean not null default false
);
insert into private.follow_up_review_settings default values;
create table private.follow_up_proposals (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.pain_follow_up_notes(id) on delete cascade,
  case_id uuid not null references public.cases(id) on delete cascade,
  encounter_id uuid not null references public.clinical_encounters(id) on delete cascade,
  requester uuid not null references public.users(id),
  base_version timestamptz not null, source_snapshot jsonb not null,
  scope text not null, status text not null default 'pending'
    check(status in ('pending','ready','failed','applied','discarded')),
  proposed jsonb, original_content jsonb, raw_response jsonb, model text, error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create unique index follow_up_one_proposal on private.follow_up_proposals(note_id) where status in ('pending','ready');
revoke all on private.follow_up_proposals,private.follow_up_review_settings from public,anon,authenticated,service_role;

create function private.follow_up_scope_lock(cid uuid) returns void
language plpgsql set search_path='' as $$ begin
 if cid is not null and not pg_try_advisory_xact_lock(hashtextextended('follow-up-source:'||cid::text,0)) then
  raise exception using errcode='55P03',message='Visit sources are being edited. Refresh and try again.';
 end if;
end $$;

-- Never add a blocking scope lock after a source row has been locked by UPDATE.
create function private.follow_up_source_write_lock() returns trigger
language plpgsql security definer set search_path='' as $$
declare a jsonb:=case when tg_op<>'INSERT' then to_jsonb(old) else '{}'::jsonb end;
 b jsonb:=case when tg_op<>'DELETE' then to_jsonb(new) else '{}'::jsonb end; ids uuid[]; cid uuid;
begin
 if tg_table_name='patients' then
  select array_agg(id order by id) into ids from public.cases where patient_id in ((a->>'id')::uuid,(b->>'id')::uuid);
 elsif tg_table_name='provider_profiles' then
  select array_agg(distinct case_id order by case_id) into ids from public.clinical_encounters where provider_id in ((a->>'id')::uuid,(b->>'id')::uuid);
 elsif tg_table_name='cases' then ids:=array[(a->>'id')::uuid,(b->>'id')::uuid];
 else ids:=array[(a->>'case_id')::uuid,(b->>'case_id')::uuid]; end if;
 for cid in select distinct x from unnest(ids) x where x is not null order by x loop
  perform private.follow_up_scope_lock(cid);
 end loop;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$ declare t text; begin
 foreach t in array array['clinical_encounters','procedures','discharge_notes','care_episodes','cases','patients','provider_profiles'] loop
  execute format('create trigger follow_up_source_write_lock before insert or update or delete on public.%I for each row execute function private.follow_up_source_write_lock()',t);
 end loop;
end $$;

create function private.follow_up_fields(value jsonb, keys text[]) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(k,value->k),'{}'::jsonb) from unnest(keys) k
$$;
create function private.follow_up_encounter(value jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select private.follow_up_fields(value,array['id','encounter_date','encounter_type','modality','reason_for_visit',
 'patient_reported_pain_min','patient_reported_pain_max','patient_reported_measurements','telehealth_consent_obtained',
 'telehealth_consent_at','patient_location_state','provider_location','connection_method']) ||
 jsonb_build_object('provider_intake',coalesce(value->'provider_intake','{}'::jsonb)-'history_prefill'-'status_reason'-'status_changed_at')
$$;
create function private.follow_up_content(value jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select private.follow_up_fields(value,array['subjective','interval_history','review_of_systems','telehealth_observations',
 'imaging_review','assessment','diagnoses','treatment_plan','patient_education','follow_up','clinician_disclaimer','procedure_recommendations'])
$$;
create function private.follow_up_fingerprint(value jsonb) returns text
language sql immutable set search_path='' as $$ select encode(sha256(convert_to(value::text,'UTF8')),'hex') $$;

-- Validate stored structured output even when an authenticated caller bypasses the app.
create function private.follow_up_validate_content(value jsonb, partial boolean) returns void
language plpgsql immutable set search_path='' as $$ declare k text; rec jsonb; site jsonb; diagnosis jsonb; ids uuid[]:='{}'; rid uuid; begin
 if jsonb_typeof(value) is distinct from 'object' then raise exception 'Invalid note content'; end if;
 for k in select jsonb_object_keys(value) loop
  if not private.follow_up_content('{}') ? k then raise exception 'Invalid note field'; end if;
 end loop;
 for k in select jsonb_object_keys(private.follow_up_content('{}')) loop
  if partial and not value ? k then continue; end if;
  if k<>'procedure_recommendations' then
   if jsonb_typeof(value->k) is distinct from 'string' then raise exception 'Invalid note section'; end if;
  else
   if jsonb_typeof(value->k) is distinct from 'array' then raise exception 'Invalid recommendations'; end if;
   for rec in select * from jsonb_array_elements(value->k) loop
    if jsonb_typeof(rec) is distinct from 'object' or jsonb_typeof(rec->'recommendation_id') is distinct from 'string'
     or coalesce(rec->>'procedure_type','') not in ('prp','cortisone','hyaluronic','botox')
     or jsonb_typeof(rec->'rationale') is distinct from 'string' or length(btrim(rec->>'rationale'))=0
     or jsonb_typeof(rec->'sites') is distinct from 'array' or jsonb_typeof(rec->'diagnoses') is distinct from 'array'
     then raise exception 'Invalid procedure recommendation'; end if;
    rid:=(rec->>'recommendation_id')::uuid;
    if rid=any(ids) then raise exception 'Duplicate recommendation IDs'; end if; ids:=array_append(ids,rid);
    if jsonb_array_length(rec->'sites')=0 then raise exception 'Recommendation site required'; end if;
    for site in select * from jsonb_array_elements(rec->'sites') loop
     if jsonb_typeof(site)<>'string' or length(btrim(site#>>'{}'))=0 then raise exception 'Invalid recommendation site'; end if;
    end loop;
    for diagnosis in select * from jsonb_array_elements(rec->'diagnoses') loop
     if jsonb_typeof(diagnosis) is distinct from 'object' or jsonb_typeof(diagnosis->'description') is distinct from 'string'
      or length(btrim(diagnosis->>'description'))=0 or coalesce(jsonb_typeof(diagnosis->'icd10_code'),'missing') not in ('string','null') then raise exception 'Invalid recommendation diagnosis'; end if;
    end loop;
    if rec ? 'suggested_timing' and jsonb_typeof(rec->'suggested_timing') not in ('string','null') then raise exception 'Invalid recommendation timing'; end if;
   end loop;
  end if;
 end loop;
end $$;

create function private.follow_up_snapshot(cid uuid,eid uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.clinical_encounters; c public.cases; ep public.care_episodes;
 history jsonb; discharge jsonb; patient jsonb; provider jsonb; procedures jsonb;
 data jsonb; manifest jsonb:='[]'; item jsonb; k text;
begin
 if not exists(select 1 from public.users where id=auth.uid() and is_active) then raise insufficient_privilege using message='Active user account required'; end if;
 perform private.follow_up_scope_lock(cid);
 select * into e from public.clinical_encounters where id=eid and case_id=cid and encounter_type='pain_follow_up' and deleted_at is null for share nowait;
 if not found then raise exception 'Visit not found'; end if;
 if e.encounter_date is null then raise exception 'Save a visit date before preparing or reviewing the note'; end if;
 select * into c from public.cases where id=cid and deleted_at is null for share nowait;
 if not found then raise exception 'Case not found'; end if;
 select * into ep from public.care_episodes where id=e.episode_id and case_id=cid and deleted_at is null for share nowait;
 if not found then raise exception 'Episode not found'; end if;
 select private.follow_up_fields(to_jsonb(p),array['id','first_name','last_name','date_of_birth','gender']) into patient
 from public.patients p where id=c.patient_id and deleted_at is null for share nowait;
 if patient is null then raise exception 'Patient not found'; end if;
 select private.follow_up_fields(to_jsonb(p),array['id','display_name','credentials','npi_number']) into provider
 from public.provider_profiles p where id=e.provider_id and deleted_at is null for share nowait;
 select private.follow_up_encounter(to_jsonb(h)) into history from public.clinical_encounters h
 where h.case_id=cid and h.episode_id=e.episode_id and h.id<>eid and h.status='completed' and h.deleted_at is null
 and h.encounter_date<e.encounter_date order by h.encounter_date desc,h.id limit 1 for share nowait;
 select private.follow_up_fields(to_jsonb(d),array['id','visit_date','subjective','assessment','plan_and_recommendations','prognosis']) into discharge
 from public.discharge_notes d join public.care_episodes prev on prev.id=d.episode_id
 where d.case_id=cid and prev.case_id=cid and prev.episode_number=ep.episode_number-1 and prev.deleted_at is null
 and d.status='finalized' and d.deleted_at is null and d.visit_date<e.encounter_date
 order by d.visit_date desc,d.id limit 1 for share of d,prev nowait;
 select coalesce(jsonb_agg(v order by v->>'procedure_date',v->>'id'),'[]') into procedures from (
 select private.follow_up_fields(to_jsonb(p),array['id','procedure_date','procedure_type','sites','diagnoses','procedure_number']) v
 from public.procedures p where p.case_id=cid and p.episode_id=e.episode_id and p.deleted_at is null
 and p.procedure_date<e.encounter_date order by p.procedure_date,p.id for share nowait) rows;
 data:=jsonb_build_object('encounter',private.follow_up_encounter(to_jsonb(e)),'patient',patient,'provider',provider,
 'latestCompletedEncounter',history,'priorEpisodeDischarge',discharge,'performedProcedures',procedures);
 foreach k in array array['encounter','patient','provider','latestCompletedEncounter','priorEpisodeDischarge'] loop
  item:=data->k;
  if item is not null and item<>'null'::jsonb then
   manifest:=manifest||jsonb_build_array(jsonb_build_object('kind',k,'id',item->>'id','date',coalesce(item->>'encounter_date',item->>'visit_date'),
   'label',case k when 'encounter' then 'Current visit intake' when 'patient' then 'Patient information' when 'provider' then 'Provider information'
    when 'latestCompletedEncounter' then 'Previous visit on '||(item->>'encounter_date') else 'Prior episode discharge' end,
   'fingerprint',private.follow_up_fingerprint(item)));
  end if;
 end loop;
 for item in select * from jsonb_array_elements(procedures) loop
  manifest:=manifest||jsonb_build_array(jsonb_build_object('kind','procedure','id',item->>'id','date',item->>'procedure_date',
   'label','Procedure on '||(item->>'procedure_date'),'fingerprint',private.follow_up_fingerprint(item)));
 end loop;
 return jsonb_build_object('schema_version',1,'data',data,'manifest',manifest,'fingerprint',private.follow_up_fingerprint(data));
end $$;

create function private.follow_up_writable(cid uuid,eid uuid,nid uuid,version timestamptz) returns public.pain_follow_up_notes
language plpgsql security definer set search_path='' as $$ declare n public.pain_follow_up_notes; begin
 if not exists(select 1 from public.users where id=auth.uid() and is_active) then raise insufficient_privilege using message='Active user account required'; end if;
 select * into n from public.pain_follow_up_notes where id=nid and case_id=cid and encounter_id=eid and deleted_at is null for update;
 if not found or n.status<>'draft' then raise exception 'No draft follow-up note found'; end if;
 if version is null or n.updated_at is distinct from version then raise exception 'Note changed. Refresh before saving'; end if;
 perform 1 from public.clinical_encounters where id=eid and case_id=cid and episode_id=n.episode_id and status='in_progress' and deleted_at is null for update;
 if not found then raise exception 'Visit is not writable'; end if;
 perform 1 from public.care_episodes where id=n.episode_id and case_id=cid and status='active' and deleted_at is null for update;
 if not found then raise exception 'Episode is not writable'; end if;
 perform 1 from public.cases where id=cid and deleted_at is null and case_status not in ('pending_settlement','closed','archived') for update;
 if not found then raise exception 'Case is not writable'; end if;
 if exists(select 1 from public.discharge_note_corrections where episode_id=n.episode_id and status='open') then raise exception 'Finish or cancel the open discharge correction first'; end if;
 perform private.follow_up_scope_lock(cid);
 return n;
end $$;

create function private.follow_up_review_valid(n jsonb,snapshot jsonb) returns boolean
language sql immutable set search_path='' as $$ select coalesce(
 n->'source_review'->>'schema_version'='1' and snapshot->>'schema_version'='1'
 and n->'source_review'->>'source_fingerprint'=snapshot->>'fingerprint'
 and n->'source_review'->>'content_fingerprint'=private.follow_up_fingerprint(private.follow_up_content(n)),false) $$;

-- Metadata is writable only inside privileged, authenticated lifecycle RPCs.
create function private.guard_follow_up_review() returns trigger
language plpgsql security invoker set search_path='' as $$ declare snapshot jsonb; begin
 if current_user in ('authenticated','anon','service_role') then
  if (tg_op='INSERT' and (new.source_baseline is not null or new.source_review is not null))
   or (tg_op='UPDATE' and (new.source_baseline is distinct from old.source_baseline or new.source_review is distinct from old.source_review)) then
   raise insufficient_privilege using message='Use the source review workflow';
  end if;
 end if;
 if tg_op='UPDATE' and new.status='finalized' and old.status<>'finalized'
 and (select enforce from private.follow_up_review_settings where singleton) then
  snapshot:=private.follow_up_snapshot(new.case_id,new.encounter_id);
  if (select enforce from private.follow_up_review_settings where singleton) and not private.follow_up_review_valid(to_jsonb(new),snapshot) then
   raise exception 'Visit information changed or has not been reviewed. Review sources before signing';
  end if;
 end if;
 return new;
end $$;
-- Run after the decision guard's BEFORE trigger so content hashing sees its closing.
create trigger zz_follow_up_review_guard before insert or update on public.pain_follow_up_notes for each row execute function private.guard_follow_up_review();

create function private.follow_up_reset_review() returns trigger
language plpgsql security definer set search_path='' as $$
declare wiped boolean := new.source_data_hash is null and new.generation_attempts=0
 and not exists(select 1 from jsonb_each(private.follow_up_content(to_jsonb(new))) f
   where f.key<>'procedure_recommendations' and f.value<>'null'::jsonb)
 and new.procedure_recommendations='[]'::jsonb;
begin
 if new.deleted_at is not null or (old.status='finalized' and new.status='draft') or wiped then
  update private.follow_up_proposals set status='discarded',updated_at=clock_timestamp() where note_id=new.id and status in ('pending','ready');
  update public.pain_follow_up_notes set source_review=null,
   source_baseline=case when not wiped and new.deleted_at is null then source_baseline else null end
   where id=new.id and (source_review is not null or (source_baseline is not null and (wiped or new.deleted_at is not null)));
 end if;
 return new;
end $$;
-- Metadata-only review writes cannot recursively trigger a reset.
create trigger follow_up_reset_review after update of status,deleted_at,source_data_hash,generation_attempts,subjective
 on public.pain_follow_up_notes for each row execute function private.follow_up_reset_review();

create function private.follow_up_review_rpc(action text,cid uuid,eid uuid,version timestamptz,proposal_id uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.pain_follow_up_notes; p private.follow_up_proposals; snapshot jsonb; content jsonb; patch jsonb;
 assignments text; freshness text; active jsonb; method text; note_json jsonb;
begin
 if not exists(select 1 from public.users where id=auth.uid() and is_active) then raise insufficient_privilege using message='Active user account required'; end if;
 select * into n from public.pain_follow_up_notes where case_id=cid and encounter_id=eid and deleted_at is null;
 if action='read' then
  -- Materialize provenance before nested source queries (including toasted snapshots).
  note_json:=to_jsonb(n);
  snapshot:=private.follow_up_snapshot(cid,eid);
  select jsonb_build_object('id',r.id,'status',r.status,'scope',r.scope,'base_version',r.base_version,
   'source_fingerprint',r.source_snapshot->>'fingerprint','proposed',r.proposed,'error',r.error,'created_at',r.created_at) into active
   from private.follow_up_proposals r where r.note_id=n.id and r.requester=auth.uid() and r.status in ('pending','ready','failed') order by r.created_at desc limit 1;
  freshness:=case when coalesce((note_json->'source_review')->'snapshot',nullif(note_json->'source_baseline','null'::jsonb)) is null then 'unknown'
   when coalesce((note_json->'source_review')->>'source_fingerprint',nullif(note_json->'source_baseline','null'::jsonb)->>'fingerprint')=snapshot->>'fingerprint' then 'current' else 'changed' end;
  return jsonb_build_object('snapshot',snapshot,'baseline',coalesce((note_json->'source_review')->'snapshot',nullif(note_json->'source_baseline','null'::jsonb)),'freshness',freshness,
   'reviewed',private.follow_up_review_valid(note_json,snapshot),'note_version',n.updated_at,'proposal',active);
 end if;
 if action='prepare' and n.id is null then
  -- First generation uses the same proposal workflow; no destructive generating state.
  snapshot:=private.follow_up_snapshot(cid,eid);
  insert into public.pain_follow_up_notes(case_id,episode_id,encounter_id,status,created_by_user_id,updated_by_user_id)
   select cid,episode_id,eid,'draft',auth.uid(),auth.uid() from public.clinical_encounters where id=eid
   returning * into n;
  version:=n.updated_at;
 end if;
 if n.id is null then raise exception 'Follow-up note not found'; end if;
 n:=private.follow_up_writable(cid,eid,n.id,version);
 if action='save' then
  patch:=payload;
  perform private.follow_up_validate_content(patch,true);
 elsif action='discard' then
  update private.follow_up_proposals set status='discarded',updated_at=clock_timestamp()
   where id=proposal_id and note_id=n.id and requester=auth.uid() and status in ('pending','ready','failed');
  if not found then raise exception 'Proposal not found'; end if;
  return jsonb_build_object('success',true);
 else
  snapshot:=private.follow_up_snapshot(cid,eid);
  if action='prepare' then
   if payload->>'scope' is null or payload->>'scope'='procedure_recommendations' or (payload->>'scope'<>'full' and not private.follow_up_content(to_jsonb(n)) ? (payload->>'scope')) then raise exception 'Invalid section'; end if;
   update private.follow_up_proposals set status='failed',error='Generation timed out. Please try again.',updated_at=clock_timestamp()
    where note_id=n.id and status='pending' and created_at<clock_timestamp()-interval '5 minutes';
   if exists(select 1 from private.follow_up_proposals where note_id=n.id and status in ('pending','ready')) then raise exception 'Review or discard the existing proposal first'; end if;
   insert into private.follow_up_proposals(note_id,case_id,encounter_id,requester,base_version,source_snapshot,scope,original_content)
    values(n.id,cid,eid,auth.uid(),n.updated_at,snapshot,payload->>'scope',private.follow_up_content(to_jsonb(n))) returning * into p;
   return jsonb_build_object('id',p.id,'snapshot',snapshot,'version',n.updated_at);
  elsif action in ('complete','fail','apply') then
   select * into p from private.follow_up_proposals where id=proposal_id and note_id=n.id and requester=auth.uid() for update;
   if not found then raise exception 'Proposal not found'; end if;
   if action='fail' then
    update private.follow_up_proposals set status='failed',error='Generation could not be completed. Please try again.',updated_at=clock_timestamp() where id=p.id and status='pending';
    return jsonb_build_object('success',true);
   end if;
   if p.base_version is distinct from n.updated_at or p.source_snapshot->>'fingerprint' is distinct from snapshot->>'fingerprint' then raise exception 'Note or sources changed. Discard this proposal and prepare another'; end if;
   if action='complete' then
    if p.status<>'pending' then raise exception 'Proposal is no longer pending'; end if;
    content:=payload->'content';
    perform private.follow_up_validate_content(content,false);
    update private.follow_up_proposals set status='ready',proposed=private.follow_up_content(content),raw_response=payload->'raw_response',model=payload->>'model',updated_at=clock_timestamp() where id=p.id;
    return jsonb_build_object('success',true);
   end if;
   if p.status<>'ready' then raise exception 'Proposal is not ready'; end if;
   patch:=case when p.scope='full' then p.proposed else jsonb_build_object(p.scope,p.proposed->p.scope) end;
   if p.scope='treatment_plan' then patch:=patch||jsonb_build_object('procedure_recommendations',p.proposed->'procedure_recommendations'); end if;
  elsif action='finalize' then
   if payload->>'source_fingerprint' is distinct from snapshot->>'fingerprint'
    or not private.follow_up_review_valid(to_jsonb(n),snapshot) then
    raise exception 'Visit information changed or has not been reviewed. Review sources before signing';
   end if;
   perform private.finish_clinical_note('pain_follow_up_notes',n.id,cid,(payload->>'document_id')::uuid,version);
   return jsonb_build_object('success',true);
  elsif action='review' then
   if payload->>'source_fingerprint' is distinct from snapshot->>'fingerprint' then raise exception 'Sources changed since you opened review. Refresh and review again'; end if;
   -- Binding to expected note version prevents review of unseen edits.
   method:='manual_reconciliation';
  else raise exception 'Invalid review action'; end if;
 end if;
 if patch is not null then
  patch:=patch||jsonb_build_object('updated_by_user_id',auth.uid());
  select string_agg(format('%I=r.%I',k,k),',') into assignments from jsonb_object_keys(patch) k;
  execute format('update public.pain_follow_up_notes n set %s from jsonb_populate_record(null::public.pain_follow_up_notes,$1) r where n.id=$2 returning n.*',assignments) into n using patch,n.id;
 end if;
 if action='apply' then
  update public.pain_follow_up_notes set source_baseline=snapshot,raw_ai_response=p.raw_response,ai_model=p.model,
   generation_attempts=generation_attempts+1,sections_done=11,generation_error=null,source_review=null,
   source_data_hash=snapshot->>'fingerprint' where id=n.id returning * into n;
  update private.follow_up_proposals set status='applied',updated_at=clock_timestamp() where id=p.id;
  if p.scope='full' then method:='generated_proposal'; end if;
 end if;
 if method is not null then
  update public.pain_follow_up_notes set source_review=jsonb_build_object('schema_version',1,'snapshot',snapshot,'source_fingerprint',snapshot->>'fingerprint',
   'content_fingerprint',private.follow_up_fingerprint(private.follow_up_content(to_jsonb(n))),
   'reviewer',auth.uid(),'reviewed_at',clock_timestamp(),'method',method),updated_by_user_id=auth.uid()
   where id=n.id returning * into n;
 end if;
 return jsonb_build_object('note',to_jsonb(n));
end $$;

create function public.follow_up_review(p_action text,p_case_id uuid,p_encounter_id uuid,
 p_expected_updated_at timestamptz default null,p_proposal_id uuid default null,p_payload jsonb default '{}') returns jsonb
language sql security invoker set search_path='' as $$
 select private.follow_up_review_rpc(p_action,p_case_id,p_encounter_id,p_expected_updated_at,p_proposal_id,p_payload)
$$;
revoke all on function private.follow_up_review_rpc(text,uuid,uuid,timestamptz,uuid,jsonb),public.follow_up_review(text,uuid,uuid,timestamptz,uuid,jsonb) from public,anon,service_role;
grant execute on function private.follow_up_review_rpc(text,uuid,uuid,timestamptz,uuid,jsonb),public.follow_up_review(text,uuid,uuid,timestamptz,uuid,jsonb) to authenticated;
-- Invoker guard helpers need execution, but the privileged snapshot always authenticates ownership.
revoke all on function private.follow_up_snapshot(uuid,uuid) from public,anon,service_role;
grant execute on function private.follow_up_snapshot(uuid,uuid) to authenticated;
grant select on private.follow_up_review_settings to authenticated;

-- Protect both RPC entry points before the finalizer writes the note/encounter.
do $$ declare definition text; anchor text:='elsif k=''pain_follow_up_notes'' then'; begin
 definition:=pg_get_functiondef('private.finish_clinical_note(text,uuid,uuid,uuid,timestamptz)'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'Follow-up finalization anchor not found'; end if;
 definition:=replace(definition,anchor,anchor||E'\n  if (select enforce from private.follow_up_review_settings where singleton) and not private.follow_up_review_valid(n,private.follow_up_snapshot(p_case_id,encounter)) then raise exception ''Visit information changed or has not been reviewed. Review sources before signing''; end if;');
 execute definition;
end $$;

-- Only the authenticated facade and trigger entry points may invoke privileged helpers.
revoke all on function private.follow_up_writable(uuid,uuid,uuid,timestamptz),
 private.follow_up_source_write_lock(),private.follow_up_reset_review() from public,anon,authenticated,service_role;
