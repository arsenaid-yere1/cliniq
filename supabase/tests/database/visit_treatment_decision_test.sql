begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(1);
insert into auth.users(id,email,raw_user_meta_data) values('13000000-0000-4000-8000-000000000001','visit-decision@test.local','{}');
update public.users set role='admin',is_active=true where id='13000000-0000-4000-8000-000000000001';
insert into public.patients(id,first_name,last_name,date_of_birth) values('23000000-0000-4000-8000-000000000001','Visit','Decision','1980-01-01');
insert into public.cases(id,patient_id,case_status) values('33000000-0000-4000-8000-000000000001','23000000-0000-4000-8000-000000000001','active');
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare cid uuid:='33000000-0000-4000-8000-000000000001'; eid uuid; enc uuid; nid uuid; k text; field text; n jsonb; saved jsonb; patch jsonb; version timestamptz; failed boolean; choice text; family text; repeat_save integer; expected_education text;
begin
 select id into eid from care_episodes where case_id=cid;
 foreach family in array array['initial_visit','pain_evaluation_visit','discharge_notes','pain_follow_up_notes'] loop
  k:=case when family in ('initial_visit','pain_evaluation_visit') then 'initial_visit_notes' else family end;
  insert into clinical_encounters(case_id,episode_id,encounter_type,status,encounter_date) values(cid,eid,case family when 'initial_visit' then 'initial_evaluation' when 'pain_evaluation_visit' then 'pain_evaluation' when 'discharge_notes' then 'discharge' else 'pain_follow_up' end,'in_progress','2026-09-10') returning id into enc;
  if k='initial_visit_notes' then
   insert into initial_visit_notes(case_id,episode_id,encounter_id,status,visit_type) values(cid,eid,enc,'draft',family) returning id,updated_at into nid,version;
  else
  execute format('insert into public.%I(case_id,episode_id,encounter_id,status) values($1,$2,$3,''draft'') returning id,updated_at',k) into nid,version using cid,eid,enc;
  end if;
  field:=case when k='discharge_notes' then 'plan_and_recommendations' else 'treatment_plan' end;
  patch:=jsonb_build_object(field,'Home exercise','patient_education','Home exercise was reviewed.');
  if k='pain_follow_up_notes' then patch:=patch||jsonb_build_object('reviewed_visit_date','2026-09-10'); end if;
  failed:=false;
  begin perform public.save_visit_note_decision(k,nid,cid,version,patch,'{"decision":"partially_accepted","details":null}'); exception when raise_exception then failed:=true; end;
  if not failed then raise exception 'Partial accepted without details'; end if;
  failed:=false;
  begin perform public.save_visit_note_decision(k,nid,cid,version,patch,'{"decision":"accepted","details":null,"confirmed_by":"spoof"}'); exception when raise_exception then failed:=true; end;
  if not failed then raise exception 'Spoofed actor accepted'; end if;
  failed:=false;
  begin perform public.save_visit_note_decision(k,nid,gen_random_uuid(),version,patch,'{"decision":"accepted","details":null}'); exception when raise_exception then failed:=true; end;
  if not failed then raise exception 'Wrong case accepted'; end if;
  perform set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000099',true);
  failed:=false;
  begin perform public.save_visit_note_decision(k,nid,cid,version,patch,'{"decision":"accepted","details":null}'); exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Missing active user accepted'; end if;
  perform set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
  saved:=public.save_visit_note_decision(k,nid,cid,version,patch,'{"decision":"accepted","details":null}');
  if saved->'visit_treatment_decision'->>'confirmed_by'<>auth.uid()::text or saved->>'patient_education' not like '%The patient agreed to the treatment plan discussed at this visit, as outlined above.' then raise exception 'Missing confirmed acceptance'; end if;
  failed:=false;
  begin perform public.save_visit_note_decision(k,nid,cid,version,patch,'{"decision":"declined","details":null}'); exception when raise_exception then failed:=true; end;
  if not failed then raise exception 'Stale save accepted'; end if;
  failed:=false;
  begin execute format('update public.%I set visit_treatment_decision=null where id=$1',k) using nid; exception when insufficient_privilege then failed:=true; end;
  if not failed then raise exception 'Direct metadata mutation accepted'; end if;
  -- Saving existing generated closings must not accumulate whitespace.
  expected_education:='Home exercise was reviewed. The patient agreed to the treatment plan discussed at this visit, as outlined above.';
  patch:=patch||jsonb_build_object('patient_education',E'Home exercise was reviewed.\r\n\n\t  '||private.visit_decision_closing(saved->'visit_treatment_decision'));
  for repeat_save in 1..4 loop
   saved:=public.save_visit_note_decision(k,nid,cid,(saved->>'updated_at')::timestamptz,patch,'{"decision":"accepted","details":null}');
   if saved->>'patient_education' is distinct from expected_education then raise exception 'Decision spacing accumulated for % on save %',family,repeat_save; end if;
   patch:=patch||jsonb_build_object('patient_education',saved->>'patient_education');
  end loop;
  -- Explicit unknown removes the closing and its separator, retaining prose.
  saved:=public.save_visit_note_decision(k,nid,cid,(saved->>'updated_at')::timestamptz,patch,'{"decision":"not_documented","details":null}');
  if saved->>'patient_education'<>'Home exercise was reviewed.' then raise exception 'Removing closing left whitespace'; end if;
  patch:=patch||jsonb_build_object('patient_education',saved->>'patient_education');
  saved:=public.save_visit_note_decision(k,nid,cid,(saved->>'updated_at')::timestamptz,patch,'{"decision":"accepted","details":null}');
  -- A generated section uses the existing decision only for its reviewed plan.
  execute format('update public.%I set patient_education=''Exercise reviewed.'',raw_ai_response='' {"patient_education":"Exercise reviewed."}''::jsonb where id=$1 returning to_jsonb(%I)',k,k) into n using nid;
  if n->>'patient_education' not like '%The patient agreed%' or n->'raw_ai_response'->>'patient_education' is distinct from n->>'patient_education' then raise exception 'Generated text/raw response lost parity'; end if;
  execute format('update public.%I set %I=''New treatment plan'' where id=$1 returning to_jsonb(%I)',k,field,k) into n using nid;
  if n->>'patient_education' like '%The patient agreed%' or n->'visit_treatment_decision' is distinct from saved->'visit_treatment_decision' then raise exception 'Plan edit extended or erased prior confirmation'; end if;
  saved:=public.save_visit_note_decision(k,nid,cid,(n->>'updated_at')::timestamptz,patch,'{"decision":"not_documented","details":null}');
  if saved->>'patient_education' like '%The patient agreed%' then raise exception 'Unknown asserted agreement'; end if;
  foreach choice in array array['partially_accepted','deferred','declined'] loop
   saved:=public.save_visit_note_decision(k,nid,cid,(saved->>'updated_at')::timestamptz,patch,jsonb_build_object('decision',choice,'details','Exercise only; injection deferred.'));
   if position('Decision details: Exercise only; injection deferred.' in saved->>'patient_education')=0 then raise exception 'Decision details lost for %',choice; end if;
   if (length(saved->>'patient_education')-length(replace(saved->>'patient_education','Decision details:','')))/length('Decision details:')<>1 then raise exception 'Duplicate decision closing'; end if;
   -- Full regeneration retains the same visit row and recorded response, but
   -- cannot carry its closing onto a replacement plan or reconfirm metadata.
   execute format('update public.%I set status=''generating'' where id=$1',k) using nid;
   execute format('update public.%I set status=''draft'',%I=''Regenerated plan'',patient_education=''Generated education.'' where id=$1 returning to_jsonb(%I)',k,field,k) into n using nid;
   if n->'visit_treatment_decision' is distinct from saved->'visit_treatment_decision' or n->>'patient_education'<>'Generated education.' then raise exception 'Full regeneration erased or reconfirmed %',choice; end if;
   saved:=n;
  end loop;
  -- A date change cannot be silently acknowledged from an old follow-up page.
  if k='pain_follow_up_notes' then
   update clinical_encounters set encounter_date='2026-09-11' where id=enc;
   failed:=false;
   begin perform public.save_visit_note_decision(k,nid,cid,(saved->>'updated_at')::timestamptz,patch,'{"decision":"accepted","details":null}'); exception when raise_exception then failed:=true; end;
   if not failed then raise exception 'Unreviewed encounter date accepted'; end if;
   update clinical_encounters set encounter_date='2026-09-10' where id=enc;
  end if;
  update clinical_encounters set status='cancelled' where id=enc;
  failed:=false;
  begin perform public.save_visit_note_decision(k,nid,cid,(saved->>'updated_at')::timestamptz,patch,'{"decision":"accepted","details":null}'); exception when raise_exception then failed:=true; end;
  if not failed then raise exception 'Cancelled encounter accepted decision'; end if;
  update clinical_encounters set status='in_progress' where id=enc;
  execute format('update public.%I set status=''generating'' where id=$1 returning updated_at',k) into version using nid;
  failed:=false;
  begin perform public.save_visit_note_decision(k,nid,cid,version,patch,'{"decision":"accepted","details":null}'); exception when raise_exception then failed:=true; end;
  if not failed then raise exception 'Generating note accepted confirmation'; end if;
 end loop;
end $$;
reset role;
select pass('Visit decision defaults, atomic saves, versions, metadata protection, and closing reconciliation');
select * from finish();
rollback;
