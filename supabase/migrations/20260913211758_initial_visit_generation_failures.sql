-- Failure excerpts are diagnostic data, not signed clinical statements. They
-- survive note resets; only active admins may retrieve them through the RPC.
create table private.initial_visit_generation_failures (
 id uuid primary key default gen_random_uuid(),
 generation_run_id uuid not null,
 note_id uuid not null references public.initial_visit_notes(id),
 case_id uuid not null references public.cases(id),
 episode_id uuid references public.care_episodes(id),
 encounter_id uuid references public.clinical_encounters(id),
 visit_type text not null check (visit_type in ('initial_visit','pain_evaluation_visit')),
 actor_id uuid not null references public.users(id),
 created_at timestamptz not null default clock_timestamp(),
 operation text not null check (operation in ('full','section')),
 section_key text,
 source_hash text not null,
 prompt_version text not null,
 validator_version text not null,
 failure_ordinal integer not null check (failure_ordinal > 0),
 validation_attempt integer not null check (validation_attempt > 0),
 model text not null,
 diagnostics jsonb not null,
 unique (generation_run_id, operation, failure_ordinal),
 check ((operation='full' and section_key is null) or (operation='section' and section_key is not null))
);
create index initial_visit_generation_failures_case_idx on private.initial_visit_generation_failures(case_id,created_at desc,id desc);
create index initial_visit_generation_failures_note_idx on private.initial_visit_generation_failures(note_id,created_at desc);
alter table private.initial_visit_generation_failures enable row level security;
revoke all on private.initial_visit_generation_failures from public,anon,authenticated,service_role;

create function private.record_initial_visit_generation_failure(
 p_case_id uuid,p_note_id uuid,p_run_id uuid,p_operation text,p_section text,
 p_source_hash text,p_prompt_version text,p_validator_version text,p_payload text
) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); n public.initial_visit_notes%rowtype;
 old private.initial_visit_generation_failures%rowtype;
 d jsonb; issue jsonb; ordinal integer; attempt integer; result uuid;
 sections text[]:=array['introduction','history_of_accident','post_accident_history','chief_complaint','past_medical_history','social_history','review_of_systems','physical_exam','imaging_findings','diagnoses','medical_necessity','treatment_plan','patient_education','prognosis','time_complexity_attestation','clinician_disclaimer','prp_target_recommendations'];
begin
 if not exists(select 1 from public.users where id=actor and is_active) then
  raise exception using errcode='42501',message='Active user account required';
 end if;
 if p_run_id is null or p_operation is null or p_operation not in ('full','section')
  or (p_operation='full' and p_section is not null)
  or (p_operation='section' and (p_section is null or not p_section=any(sections) or p_section='prp_target_recommendations'))
  or p_source_hash is null or p_source_hash !~ '^[0-9a-f]{64}$'
  or p_prompt_version is null or p_prompt_version !~ '^[a-zA-Z0-9._-]{1,64}$'
  or p_validator_version is null or p_validator_version !~ '^[a-zA-Z0-9._-]{1,64}$'
  or p_payload is null or octet_length(p_payload)>16384 then
  raise exception using errcode='22023',message='Invalid diagnostic payload';
 end if;
 d:=p_payload::jsonb;
 if jsonb_typeof(d) is distinct from 'object'
  or d - array['failureOrdinal','validationAttempt','model','issues'] <> '{}'::jsonb
  or coalesce(d->>'failureOrdinal','') !~ '^[1-9][0-9]{0,5}$'
  or coalesce(d->>'validationAttempt','') !~ '^[1-9][0-9]{0,5}$'
  or jsonb_typeof(d->'failureOrdinal') is distinct from 'number'
  or jsonb_typeof(d->'validationAttempt') is distinct from 'number'
  or jsonb_typeof(d->'model') is distinct from 'string'
  or coalesce(d->>'model','') !~ '^claude-[a-zA-Z0-9._-]{1,100}$'
  or jsonb_typeof(d->'issues') is distinct from 'array' then
  raise exception using errcode='22023',message='Invalid diagnostic payload';
 end if;
 if jsonb_array_length(d->'issues') not between 1 and 5 then
  raise exception using errcode='22023',message='Invalid diagnostic issues';
 end if;
 for issue in select value from jsonb_array_elements(d->'issues') loop
  if jsonb_typeof(issue) is distinct from 'object'
   or issue - array['code','path','rule','excerpt','excerptStart','matchStart','matchEnd','truncated'] <> '{}'::jsonb
   or jsonb_typeof(issue->'code') is distinct from 'string' or coalesce(issue->>'code','') !~ '^[a-z_]{1,64}$'
   or jsonb_typeof(issue->'path') is distinct from 'array'
   or jsonb_typeof(issue->'truncated') is distinct from 'boolean'
   or not issue ?& array['rule','excerpt','excerptStart','matchStart','matchEnd'] then
   raise exception using errcode='22023',message='Invalid diagnostic issue';
  end if;
  if jsonb_array_length(issue->'path')>8 or exists(select 1 from jsonb_array_elements(issue->'path') x where jsonb_typeof(x) <> 'string' or length(x#>>'{}')>80) then
   raise exception using errcode='22023',message='Invalid diagnostic path';
  end if;
  if issue->'rule' <> 'null'::jsonb and (issue->>'rule') not in ('current_decision','continued_decision','passive_decision','agreement','procedure_consent','unsupported_telehealth_consent') then
   raise exception using errcode='22023',message='Invalid diagnostic rule';
  end if;
  if issue->'excerpt'='null'::jsonb then
   if issue->'excerptStart'<>'null'::jsonb or issue->'matchStart'<>'null'::jsonb or issue->'matchEnd'<>'null'::jsonb then
    raise exception using errcode='22023',message='Invalid diagnostic offsets';
   end if;
  else
   if jsonb_typeof(issue->'excerpt') is distinct from 'string' or length(issue->>'excerpt')>1000
    or coalesce(issue->>'excerptStart','') !~ '^[0-9]{1,9}$'
    or coalesce(issue->>'matchStart','') !~ '^[0-9]{1,9}$'
    or coalesce(issue->>'matchEnd','') !~ '^[0-9]{1,9}$'
    or jsonb_typeof(issue->'excerptStart') is distinct from 'number'
    or jsonb_typeof(issue->'matchStart') is distinct from 'number'
    or jsonb_typeof(issue->'matchEnd') is distinct from 'number' then
    raise exception using errcode='22023',message='Invalid diagnostic excerpt';
   end if;
   if (issue->>'matchStart')::integer >= (issue->>'matchEnd')::integer then
    raise exception using errcode='22023',message='Invalid diagnostic offsets';
   end if;
  end if;
 end loop;
 ordinal:=(d->>'failureOrdinal')::integer; attempt:=(d->>'validationAttempt')::integer;
 select * into n from public.initial_visit_notes where id=p_note_id and case_id=p_case_id and deleted_at is null;
 if not found or not exists(select 1 from public.cases where id=p_case_id and deleted_at is null) then
  raise exception using errcode='22023',message='Diagnostic note ownership mismatch';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_run_id::text||p_operation||ordinal::text,0));
 select * into old from private.initial_visit_generation_failures where generation_run_id=p_run_id and operation=p_operation and failure_ordinal=ordinal;
 if found then
  if old.note_id is distinct from p_note_id or old.case_id is distinct from p_case_id or old.actor_id is distinct from actor
   or old.section_key is distinct from p_section or old.source_hash is distinct from p_source_hash
   or old.prompt_version is distinct from p_prompt_version or old.validator_version is distinct from p_validator_version
   or old.diagnostics is distinct from d then
   raise exception using errcode='22023',message='Diagnostic idempotency conflict';
  end if;
  return old.id;
 end if;
 if (p_operation='full' and n.status<>'generating') or (p_operation='section' and n.status<>'draft') then
  raise exception using errcode='22023',message='Note is not generating or writable';
 end if;
 insert into private.initial_visit_generation_failures(generation_run_id,note_id,case_id,episode_id,encounter_id,visit_type,actor_id,operation,section_key,source_hash,prompt_version,validator_version,failure_ordinal,validation_attempt,model,diagnostics)
 values(p_run_id,n.id,n.case_id,n.episode_id,n.encounter_id,n.visit_type,actor,p_operation,p_section,p_source_hash,p_prompt_version,p_validator_version,ordinal,attempt,d->>'model',d)
 returning id into result;
 return result;
end $$;

create function public.record_initial_visit_generation_failure(
 p_case_id uuid,p_note_id uuid,p_run_id uuid,p_operation text,p_section text,
 p_source_hash text,p_prompt_version text,p_validator_version text,p_payload text
) returns uuid language sql security invoker set search_path='' as $$
 select private.record_initial_visit_generation_failure(p_case_id,p_note_id,p_run_id,p_operation,p_section,p_source_hash,p_prompt_version,p_validator_version,p_payload)
$$;

create function private.read_initial_visit_generation_failures(p_case_id uuid,p_limit integer default 20,p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.users where id=auth.uid() and is_active and role='admin') then
  raise exception using errcode='42501',message='Active administrator required';
 end if;
 if p_case_id is null or p_limit is null or p_limit not between 1 and 50 or p_offset is null or p_offset<0 then
  raise exception using errcode='22023',message='Invalid diagnostic page';
 end if;
 return coalesce((select jsonb_agg(to_jsonb(f)) from (
  select * from private.initial_visit_generation_failures where case_id=p_case_id order by created_at desc,id desc limit p_limit offset p_offset
 ) f),'[]'::jsonb);
end $$;
create function public.read_initial_visit_generation_failures(p_case_id uuid,p_limit integer default 20,p_offset integer default 0)
returns jsonb language sql security invoker set search_path='' as $$
 select private.read_initial_visit_generation_failures(p_case_id,p_limit,p_offset)
$$;

revoke all on function private.record_initial_visit_generation_failure(uuid,uuid,uuid,text,text,text,text,text,text),public.record_initial_visit_generation_failure(uuid,uuid,uuid,text,text,text,text,text,text),private.read_initial_visit_generation_failures(uuid,integer,integer),public.read_initial_visit_generation_failures(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function private.record_initial_visit_generation_failure(uuid,uuid,uuid,text,text,text,text,text,text),public.record_initial_visit_generation_failure(uuid,uuid,uuid,text,text,text,text,text,text),private.read_initial_visit_generation_failures(uuid,integer,integer),public.read_initial_visit_generation_failures(uuid,integer,integer) to authenticated;
