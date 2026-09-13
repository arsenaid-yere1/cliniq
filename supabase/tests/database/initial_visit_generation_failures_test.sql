begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(1);
insert into auth.users(id,email,raw_user_meta_data) values
 ('11900000-0000-4000-8000-000000000001','diagnostic-admin@test.local','{}'),
 ('11900000-0000-4000-8000-000000000002','diagnostic-staff@test.local','{}'),
 ('11900000-0000-4000-8000-000000000003','diagnostic-inactive@test.local','{}');
update public.users set role='admin',is_active=true where id='11900000-0000-4000-8000-000000000001';
update public.users set is_active=false where id='11900000-0000-4000-8000-000000000003';
insert into public.patients(id,first_name,last_name,date_of_birth) values('21900000-0000-4000-8000-000000000001','Synthetic','Diagnostic','1980-01-01');
insert into public.cases(id,patient_id,case_status) values('31900000-0000-4000-8000-000000000001','21900000-0000-4000-8000-000000000001','active');
insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date)
select '41900000-0000-4000-8000-000000000001',case_id,id,'initial_evaluation','in_progress','2026-09-13' from care_episodes where case_id='31900000-0000-4000-8000-000000000001';
insert into public.initial_visit_notes(id,case_id,episode_id,encounter_id,status)
select '51900000-0000-4000-8000-000000000001',case_id,id,'41900000-0000-4000-8000-000000000001','generating' from care_episodes where case_id='31900000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','11900000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare
 cid uuid:='31900000-0000-4000-8000-000000000001'; nid uuid:='51900000-0000-4000-8000-000000000001';
 run uuid:=gen_random_uuid(); first_id uuid; second_id uuid; failed boolean; p jsonb; req jsonb; d jsonb; bad jsonb;
 payload text:='{"failureOrdinal":1,"validationAttempt":1,"model":"claude-opus-4-6","issues":[{"code":"custom","path":["past_medical_history"],"rule":"current_decision","excerpt":"patient accepted","excerptStart":0,"matchStart":0,"matchEnd":16,"truncated":false}]}';
begin
 first_id:=public.record_initial_visit_generation_failure(cid,nid,run,'full',null,repeat('a',64),'2','2',payload);
 if first_id is null then raise exception 'Failure not recorded'; end if;
 if public.record_initial_visit_generation_failure(cid,nid,run,'full',null,repeat('a',64),'2','2',payload)<>first_id then raise exception 'Idempotency broken'; end if;
 failed:=false;
 begin perform public.record_initial_visit_generation_failure(cid,nid,run,'full',null,repeat('b',64),'2','2',payload); exception when invalid_parameter_value then failed:=true; end;
 if not failed then raise exception 'Conflicting replay accepted'; end if;
 second_id:=public.record_initial_visit_generation_failure(cid,nid,run,'full',null,repeat('a',64),'2','2',(payload::jsonb||'{"failureOrdinal":2,"validationAttempt":2}')::text);
 if second_id=first_id then raise exception 'Attempts collided'; end if;
 failed:=false;
 begin perform public.read_initial_visit_generation_failures(cid); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Non-admin read diagnostics'; end if;
 failed:=false;
 begin perform 1 from private.initial_visit_generation_failures; exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Direct table read allowed'; end if;
 failed:=false;
 begin delete from private.initial_visit_generation_failures; exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Direct delete allowed'; end if;
 failed:=false;
 begin perform public.record_initial_visit_generation_failure(gen_random_uuid(),nid,gen_random_uuid(),'full',null,repeat('a',64),'2','2',payload); exception when invalid_parameter_value then failed:=true; end;
 if not failed then raise exception 'Cross-case capture allowed'; end if;
 failed:=false;
 begin perform public.record_initial_visit_generation_failure(cid,nid,gen_random_uuid(),'section','imaging_findings',repeat('a',64),'2','2',payload); exception when invalid_parameter_value then failed:=true; end;
 if not failed then raise exception 'Wrong note status accepted'; end if;
 for bad in select value from jsonb_array_elements(jsonb_build_array(
  payload::jsonb||'{"failureOrdinal":0}', payload::jsonb||'{"issues":[]}', payload::jsonb||'{"model":null}',
  payload::jsonb||jsonb_build_object('extra',repeat('x',17000)),
  jsonb_set(payload::jsonb,'{issues,0,excerpt}',to_jsonb(repeat('x',1001))),
  jsonb_set(payload::jsonb,'{issues,0,path}','null'),
  jsonb_set(payload::jsonb,'{issues,0,rule}','"unknown"')
 )) loop
  failed:=false;
  begin perform public.record_initial_visit_generation_failure(cid,nid,gen_random_uuid(),'full',null,repeat('a',64),'2','2',bad::text); exception when invalid_parameter_value then failed:=true; end;
  if not failed then raise exception 'Malformed payload accepted'; end if;
 end loop;
 perform set_config('request.jwt.claim.sub','11900000-0000-4000-8000-000000000003',true);
 failed:=false;
 begin perform public.record_initial_visit_generation_failure(cid,nid,gen_random_uuid(),'full',null,repeat('a',64),'2','2',payload); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Inactive writer allowed'; end if;
 failed:=false;
 begin perform public.read_initial_visit_generation_failures(cid); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Inactive reader allowed'; end if;
 perform set_config('request.jwt.claim.sub','11900000-0000-4000-8000-000000000001',true);
 if jsonb_array_length(public.read_initial_visit_generation_failures(cid))<>2 then raise exception 'Admin read failed'; end if;
 if jsonb_array_length(public.read_initial_visit_generation_failures(cid,1,1))<>1 then raise exception 'Pagination failed'; end if;
 if jsonb_array_length(public.read_initial_visit_generation_failures(gen_random_uuid()))<>0 then raise exception 'Reader ignored case'; end if;
 failed:=false;
 begin perform public.read_initial_visit_generation_failures(cid,51,0); exception when invalid_parameter_value then failed:=true; end;
 if not failed then raise exception 'Unbounded read allowed'; end if;
 -- Reset the failed draft through the actual RPC, then simulate regeneration.
 update public.initial_visit_notes set status='failed',generation_error='failure',raw_ai_response='{"synthetic":true}' where id=nid;
 p:=public.preview_clinical_reset(cid);
 req:=jsonb_build_object('case_id',cid,'episode_id',p->>'episode_id','case_version',p->>'case_version','episode_version',p->>'episode_version','reactivate',false,'reason','Diagnostic retention test','request_key',gen_random_uuid(),'notes',
 (select jsonb_agg(jsonb_build_object('kind',x->>'kind','id',x->>'id','updated_at',x->>'updated_at')) from jsonb_array_elements(p->'notes') x));
 perform public.apply_clinical_reset(req);
 if (select raw_ai_response is not null or generation_error is not null from public.initial_visit_notes where id=nid) then raise exception 'Reset did not clear draft'; end if;
 if jsonb_array_length(public.read_initial_visit_generation_failures(cid))<>2 then raise exception 'Reset erased failures'; end if;
 perform public.record_initial_visit_generation_failure(cid,nid,gen_random_uuid(),'section','imaging_findings',repeat('a',64),'2','2',payload);
 update public.initial_visit_notes set status='generating',raw_ai_response=null,generation_error=null where id=nid;
 perform public.record_initial_visit_generation_failure(cid,nid,gen_random_uuid(),'full',null,repeat('a',64),'2','2',payload);
 update public.initial_visit_notes set status='draft',imaging_findings='Pending' where id=nid;
 if jsonb_array_length(public.read_initial_visit_generation_failures(cid))<>4 then raise exception 'Regeneration erased failures'; end if;
end $$;
reset role;
set local role anon;
do $$ declare failed boolean:=false; begin
 begin perform public.read_initial_visit_generation_failures('31900000-0000-4000-8000-000000000001'); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Anonymous read allowed'; end if;
 failed:=false;
 begin perform public.record_initial_visit_generation_failure(null,null,null,null,null,null,null,null,null); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Anonymous write allowed'; end if;
end $$;
reset role;
select pass('Generation failure privacy, bounds, ownership, idempotency and reset retention');
select * from finish();
rollback;
