begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(1);
insert into auth.users(id,email,raw_user_meta_data) values('14000000-0000-4000-8000-000000000001','source-review@test.local','{}');
update public.users set role='admin',is_active=true where id='14000000-0000-4000-8000-000000000001';
insert into patients(id,first_name,last_name,date_of_birth) values('24000000-0000-4000-8000-000000000001','Synthetic','Review','1980-01-01');
insert into cases(id,patient_id,case_status) values('34000000-0000-4000-8000-000000000001','24000000-0000-4000-8000-000000000001','active');
update private.follow_up_review_settings set enforce=true;
select set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare cid uuid:='34000000-0000-4000-8000-000000000001'; ep uuid; enc uuid; hist uuid; nid uuid;
 a jsonb; b jsonb; n jsonb; p jsonb; result jsonb; body jsonb; version timestamptz; failed boolean; k text; doc uuid; request jsonb; signed jsonb; series uuid;
begin
 select id into ep from care_episodes where case_id=cid;
 insert into clinical_encounters(case_id,episode_id,encounter_type,status,encounter_date,provider_intake)
 values(cid,ep,'pain_follow_up','in_progress','2026-05-02','{"symptoms":"Neck pain"}') returning id into enc;
 insert into procedure_series(case_id,episode_id,series_number,procedure_type,status) values(cid,ep,1,'prp','active') returning id into series;
 insert into procedures(case_id,episode_id,procedure_series_id,procedure_date,procedure_type,procedure_name,sites)
 values(cid,ep,series,'2026-04-20','prp','Synthetic procedure','["Lumbar"]'),
 (cid,ep,series,'2026-04-01','prp','Synthetic procedure','["Lumbar"]'),
 (cid,ep,series,'2026-05-02','prp','Synthetic procedure','["Lumbar"]'),
 (cid,ep,series,'2026-05-03','prp','Synthetic procedure','["Lumbar"]');
 insert into clinical_encounters(case_id,episode_id,encounter_type,status,encounter_date,provider_intake)
 values(cid,ep,'pain_follow_up','completed','2026-04-13','{"symptoms":"Shoulder pain"}') returning id into hist;
 insert into clinical_encounters(case_id,episode_id,encounter_type,status,encounter_date)
 values(cid,ep,'pain_follow_up','completed','2026-05-03'),(cid,ep,'pain_follow_up','completed','2026-05-02'),(cid,ep,'pain_follow_up','scheduled',null);
 a:=public.follow_up_review('read',cid,enc);
 if a->'snapshot'->'data'->'latestCompletedEncounter'->>'id'<>hist::text then raise exception 'Future/same-day/undated source selected'; end if;
 if jsonb_array_length(a->'snapshot'->'data'->'performedProcedures')<>2 or a->'snapshot'->'data'->'performedProcedures'->0->>'procedure_date'<>'2026-04-01' then raise exception 'Procedure history cutoff or ordering incorrect'; end if;
 if a->>'freshness'<>'unknown' then raise exception 'Legacy source reported current'; end if;
 update clinical_encounters set provider_intake=provider_intake||'{"history_prefill":{"reviewed_at":"2026-05-01"}}',updated_at=clock_timestamp() where id=enc;
 b:=public.follow_up_review('read',cid,enc);
 if a->'snapshot'->>'fingerprint'<>b->'snapshot'->>'fingerprint' then raise exception 'Metadata changed clinical fingerprint'; end if;
 update clinical_encounters set patient_reported_pain_min=3 where id=enc;
 b:=public.follow_up_review('read',cid,enc);
 if a->'snapshot'->>'fingerprint'=b->'snapshot'->>'fingerprint' then raise exception 'Clinical change missed'; end if;
 p:=public.follow_up_review('prepare',cid,enc,null,null,'{"scope":"full"}');
 select to_jsonb(t) into n from pain_follow_up_notes t where encounter_id=enc; nid:=(n->>'id')::uuid;
 version:=(n->>'updated_at')::timestamptz;
 failed:=false;
 begin perform public.follow_up_review('prepare',cid,enc,version,null,'{"scope":"full"}'); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Concurrent proposal allowed'; end if;
 failed:=false;
 begin update pain_follow_up_notes set source_review='{}' where id=nid; exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Forged review allowed'; end if;
 failed:=false;
 begin update pain_follow_up_notes set status='finalized' where id=nid; exception when raise_exception or insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Direct unreviewed signing allowed'; end if;
 body:=private.follow_up_content(n);
 for k in select jsonb_object_keys(body) loop
  body:=jsonb_set(body,array[k],case when k='procedure_recommendations' then '[]'::jsonb else '"Synthetic narrative"'::jsonb end);
 end loop;
 failed:=false;
 begin perform public.follow_up_review('complete',cid,enc,version,(p->>'id')::uuid,jsonb_build_object('content',body||'{"procedure_recommendations":[{"procedure_type":"invalid"}]}'));
 exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Malformed structured recommendations accepted'; end if;
 perform public.follow_up_review('complete',cid,enc,version,(p->>'id')::uuid,jsonb_build_object('content',body));
 if (select subjective from pain_follow_up_notes where id=nid) is not null then raise exception 'Generation overwrote draft'; end if;
 result:=public.follow_up_review('apply',cid,enc,version,(p->>'id')::uuid);
 n:=result->'note'; version:=(n->>'updated_at')::timestamptz;
 a:=public.follow_up_review('read',cid,enc);
 if not (a->>'reviewed')::boolean then raise exception 'Full apply did not bind resulting content'; end if;
 failed:=false;
 begin perform public.follow_up_review('apply',cid,enc,version,(p->>'id')::uuid); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Duplicate apply allowed'; end if;
 n:=public.follow_up_review('save',cid,enc,version,null,'{"subjective":"Provider correction"}')->'note';
 failed:=false;
 begin perform public.follow_up_review('save',cid,enc,version,null,'{"subjective":"Lost update"}'); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Stale ordinary save allowed'; end if;
 version:=(n->>'updated_at')::timestamptz;
 a:=public.follow_up_review('read',cid,enc);
 if (a->>'reviewed')::boolean then raise exception 'Content edit retained valid review'; end if;
 n:=public.follow_up_review('review',cid,enc,version,null,jsonb_build_object('source_fingerprint',a->'snapshot'->>'fingerprint'))->'note';
 version:=(n->>'updated_at')::timestamptz;
 update clinical_encounters set provider_intake='{"symptoms":"New current symptoms"}' where id=enc;
 a:=public.follow_up_review('read',cid,enc);
 if a->>'freshness'<>'changed' or (a->>'reviewed')::boolean then raise exception 'Source edit retained review'; end if;
 failed:=false;
 begin perform public.follow_up_review('review',cid,enc,version,null,'{"source_fingerprint":"old"}'); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Unseen sources reviewed'; end if;
 p:=public.follow_up_review('prepare',cid,enc,version,null,'{"scope":"subjective"}');
 perform public.follow_up_review('complete',cid,enc,version,(p->>'id')::uuid,jsonb_build_object('content',body));
 n:=public.follow_up_review('apply',cid,enc,version,(p->>'id')::uuid)->'note';
 version:=(n->>'updated_at')::timestamptz;
 a:=public.follow_up_review('read',cid,enc);
 if (a->>'reviewed')::boolean then raise exception 'Section replacement certified whole note'; end if;
 p:=public.follow_up_review('prepare',cid,enc,version,null,'{"scope":"full"}');
 update clinical_encounters set patient_reported_pain_min=4 where id=enc;
 failed:=false;
 begin perform public.follow_up_review('complete',cid,enc,version,(p->>'id')::uuid,jsonb_build_object('content',body)); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Stale source proposal accepted'; end if;
 perform public.follow_up_review('discard',cid,enc,version,(p->>'id')::uuid);
 if (select subjective from pain_follow_up_notes where id=nid)<>'Synthetic narrative' then raise exception 'Discard changed original'; end if;
 -- Treatment plan and structured recommendations are one replacement group.
 n:=public.save_visit_note_decision('pain_follow_up_notes',nid,cid,version,
 jsonb_build_object('treatment_plan',n->>'treatment_plan','patient_education','Education reviewed.','reviewed_visit_date','2026-05-02'),'{"decision":"accepted","details":null}');
 version:=(n->>'updated_at')::timestamptz;
 p:=public.follow_up_review('prepare',cid,enc,version,null,'{"scope":"treatment_plan"}');
 body:=body||'{"treatment_plan":"A changed conditional plan","procedure_recommendations":[{"recommendation_id":"44000000-0000-4000-8000-000000000001","procedure_type":"prp","sites":["Lumbar"],"diagnoses":[],"rationale":"Persistent symptoms"}]}';
 perform public.follow_up_review('complete',cid,enc,version,(p->>'id')::uuid,jsonb_build_object('content',body));
 n:=public.follow_up_review('apply',cid,enc,version,(p->>'id')::uuid)->'note';
 version:=(n->>'updated_at')::timestamptz;
 if n->'procedure_recommendations'<>body->'procedure_recommendations' or n->>'treatment_plan'<>body->>'treatment_plan' then raise exception 'Plan/recommendation group diverged'; end if;
 if n->>'patient_education' like '%The patient agreed%' then raise exception 'Replacement reconfirmed old treatment decision'; end if;
 -- Both supported legacy finalizers must enforce the same review gate.
 insert into documents(case_id,episode_id,encounter_id,document_type,file_name,file_path,status,uploaded_by_user_id)
 values(cid,ep,enc,'generated','Synthetic follow-up','cases/synthetic/source-review.pdf','reviewed',auth.uid()) returning id into doc;
 failed:=false;
 begin perform public.finish_clinical_note('pain_follow_up_notes',nid,cid,doc,version);
 exception when raise_exception then
  if sqlerrm not like 'Visit information%' then raise; end if; failed:=true;
 end;
 if not failed then raise exception 'Generic finalizer accepted unreviewed note'; end if;
 failed:=false;
 begin perform public.finalize_pain_follow_up(cid,enc,nid,doc,version);
 exception when raise_exception then
  if sqlerrm not like 'Visit information%' then raise; end if; failed:=true;
 end;
 if not failed then raise exception 'Dedicated finalizer accepted unreviewed note'; end if;
 n:=public.save_visit_note_decision('pain_follow_up_notes',nid,cid,version,
 jsonb_build_object('treatment_plan',n->>'treatment_plan','patient_education',n->>'patient_education','reviewed_visit_date','2026-05-02'),'{"decision":"accepted","details":null}');
 version:=(n->>'updated_at')::timestamptz;
 a:=public.follow_up_review('read',cid,enc);
 n:=public.follow_up_review('review',cid,enc,version,null,jsonb_build_object('source_fingerprint',a->'snapshot'->>'fingerprint'))->'note';
 version:=(n->>'updated_at')::timestamptz;
 perform public.follow_up_review('finalize',cid,enc,version,null,jsonb_build_object('source_fingerprint',a->'snapshot'->>'fingerprint','document_id',doc));
 select to_jsonb(t) into signed from pain_follow_up_notes t where id=nid;
 if signed->>'status'<>'finalized' then raise exception 'Reviewed finalization failed'; end if;
 update clinical_encounters set patient_reported_pain_min=2 where id=hist;
 -- Replays leave signed records intact despite later source changes.
 perform public.finalize_pain_follow_up(cid,enc,nid,doc,version);
 perform public.finish_clinical_note('pain_follow_up_notes',nid,cid,doc,version);
 if (select to_jsonb(t) from pain_follow_up_notes t where id=nid) is distinct from signed then raise exception 'Replay changed signed record'; end if;
 a:=public.preview_clinical_reset(cid);
 request:=jsonb_build_object('case_id',cid,'episode_id',ep,'case_version',a->>'case_version','episode_version',a->>'episode_version',
 'reactivate',false,'reason','Synthetic source review test','request_key',gen_random_uuid(),
 'notes',jsonb_build_array(jsonb_build_object('kind','pain_follow_up_notes','id',nid,'updated_at',signed->>'updated_at','keep_content',true)));
 perform public.apply_clinical_reset(request);
 select to_jsonb(t) into n from pain_follow_up_notes t where id=nid;
 if n->'source_review'<>'null'::jsonb or n->'source_baseline' is distinct from signed->'source_baseline' then raise exception 'Keep-content provenance incorrect'; end if;
 if not exists(select 1 from clinical_note_revisions where note_id=nid and original_snapshot->'source_review'=signed->'source_review') then raise exception 'Signed review not archived'; end if;
 p:=public.follow_up_review('prepare',cid,enc,(n->>'updated_at')::timestamptz,null,'{"scope":"full"}');
 perform public.reset_pain_follow_up(cid,enc);
 a:=public.follow_up_review('read',cid,enc);
 if a->'baseline'<>'null'::jsonb or a->'proposal'<>'null'::jsonb or (a->>'reviewed')::boolean then raise exception 'Reset retained source review/proposal'; end if;
 -- Legacy manual review has no generation hash; reset must still clear it.
 select updated_at into version from pain_follow_up_notes where id=nid;
 n:=public.follow_up_review('save',cid,enc,version,null,'{"subjective":"Manually reconciled legacy draft"}')->'note';
 n:=public.follow_up_review('review',cid,enc,(n->>'updated_at')::timestamptz,null,jsonb_build_object('source_fingerprint',a->'snapshot'->>'fingerprint'))->'note';
 perform public.reset_pain_follow_up(cid,enc);
 if (select source_review from pain_follow_up_notes where id=nid) is not null then raise exception 'Legacy review survived reset'; end if;
 failed:=false;
 begin perform public.follow_up_review('read',gen_random_uuid(),enc); exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Cross-case read allowed'; end if;
 perform set_config('request.jwt.claim.sub','14000000-0000-4000-8000-000000000099',true);
 failed:=false;
 begin perform public.follow_up_review('read',cid,enc); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Inactive user read allowed'; end if;
end $$;
reset role;
select pass('Source chronology, fingerprints, proposal lifecycle, review binding, authorization, and stale saves');
select * from finish();
rollback;
