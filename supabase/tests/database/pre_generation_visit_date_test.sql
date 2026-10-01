begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(1);
insert into auth.users(id,email,raw_user_meta_data) values
 ('11930000-0000-4000-8000-000000000001','visit-date@test.local','{}'),
 ('11930000-0000-4000-8000-000000000002','visit-date-inactive@test.local','{}');
update public.users set is_active=false where id='11930000-0000-4000-8000-000000000002';
insert into public.patients(id,first_name,last_name,date_of_birth) values('21930000-0000-4000-8000-000000000001','Synthetic','VisitDate','1980-01-01');
insert into public.cases(id,patient_id,case_status) values('31930000-0000-4000-8000-000000000001','21930000-0000-4000-8000-000000000001','active');
select set_config('request.jwt.claim.sub','11930000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare cid uuid:='31930000-0000-4000-8000-000000000001'; eid uuid; r jsonb; n uuid; e uuid; k text; failed boolean;
begin
 select id into eid from public.care_episodes where case_id=cid;
 foreach k in array array['initial_visit','pain_evaluation_visit','discharge'] loop
  r:=public.save_pre_generation_visit_date(cid,eid,k,'2026-09-01',null,null);
  n:=(r->'data'->>'noteId')::uuid;
  if n is null or r->'data'->>'visitDate'<>'2026-09-01' then raise exception 'First date save failed for %: %',k,r; end if;
  r:=public.prepare_pre_generation_visit_note(cid,eid,k);
  e:=(r->>'encounterId')::uuid;
  if (r->'note'->>'id')::uuid<>n then raise exception 'Preparation replaced the note'; end if;
  if (select encounter_date from public.clinical_encounters where id=e)<>date '2026-09-01' then raise exception 'Encounter date mismatch'; end if;
  -- Original no-note token can retry a committed write after losing its acknowledgment.
  r:=public.save_pre_generation_visit_date(cid,eid,k,'2026-09-01',null,null);
  if r->'data'->>'noteId'<>n::text then raise exception 'Lost first acknowledgment was not idempotent'; end if;
  r:=public.save_pre_generation_visit_date(cid,eid,k,'2026-09-02',n,'2026-09-01');
  if r->'data'->>'visitDate'<>'2026-09-02' then raise exception 'Date update failed'; end if;
  r:=public.save_pre_generation_visit_date(cid,eid,k,'2026-09-02',n,'2026-09-01');
  if r->'data'->>'visitDate'<>'2026-09-02' then raise exception 'Lost update acknowledgment conflicted'; end if;
  r:=public.save_pre_generation_visit_date(cid,eid,k,'2026-09-03',n,'2026-09-01');
  if r->'conflict'->>'visitDate'<>'2026-09-02' then raise exception 'Stale date overwritten'; end if;
  r:=public.save_pre_generation_visit_date(cid,eid,k,'2026-09-03',null,'2026-09-01');
  if not r ? 'conflict' then raise exception 'Unobserved independently chosen date overwritten'; end if;
  if (select encounter_date from public.clinical_encounters where id=e)<>date '2026-09-02' then raise exception 'Conflict modified encounter'; end if;
  update public.initial_visit_notes set visit_date='2026-09-01' where episode_id=eid and visit_type='initial_visit';
  update public.initial_visit_notes set visit_date='2026-09-01' where episode_id=eid and visit_type='pain_evaluation_visit';
 end loop;
 select id into n from public.initial_visit_notes where episode_id=eid and visit_type='initial_visit' and deleted_at is null;
 update public.initial_visit_notes set provider_intake='{"preserve":"intake"}' where id=n;
 r:=public.save_pre_generation_visit_date(cid,eid,'initial_visit','2026-09-01',n,'2026-09-01');
 if (select provider_intake->>'preserve' from public.initial_visit_notes where id=n)<>'intake' then raise exception 'Date erased intake'; end if;
 failed:=false;
 begin perform public.save_pre_generation_visit_date(cid,eid,'initial_visit','2026-09-04',n,'2026-09-01'); exception when check_violation then failed:=true; end;
 if not failed then raise exception 'Sibling date bound bypassed'; end if;
 if (select visit_date from public.initial_visit_notes where id=n)<>date '2026-09-01' then raise exception 'Failed write did not roll back'; end if;
 update public.initial_visit_notes set introduction='Existing generated narrative' where id=n;
 failed:=false;
 begin perform public.save_pre_generation_visit_date(cid,eid,'initial_visit','2026-09-01',n,'2026-09-01'); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Generated note date changed'; end if;
 update public.initial_visit_notes set introduction=null,status='generating' where id=n;
 failed:=false;
 begin perform public.save_pre_generation_visit_date(cid,eid,'initial_visit','2026-09-01',n,'2026-09-01'); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Generating note date changed'; end if;
 update public.initial_visit_notes set status='draft' where id=n;
 failed:=false;
 begin perform public.save_pre_generation_visit_date(cid,gen_random_uuid(),'initial_visit','2026-09-01',n,'2026-09-01'); exception when no_data_found then failed:=true; end;
 if not failed then raise exception 'Wrong episode accepted'; end if;
 failed:=false;
 begin perform public.save_pre_generation_visit_date(cid,eid,'discharge','2026-08-01',null,'2026-09-02'); exception when check_violation then failed:=true; end;
 if not failed then raise exception 'Discharge floor bypassed'; end if;
 failed:=false;
 begin perform public.save_pre_generation_visit_date(cid,eid,'initial_visit','infinity',n,'2026-09-01'); exception when invalid_datetime_format then failed:=true; end;
 if not failed then raise exception 'Infinite date accepted'; end if;
 -- Scope and lifecycle guards must reject even idempotent requests.
 failed:=false;
 begin perform public.save_pre_generation_visit_date(cid,eid,'pain_evaluation_visit','2026-09-01',n,'2026-09-01'); exception when no_data_found then failed:=true; end;
 if not failed then raise exception 'Wrong note type accepted'; end if;
 failed:=false;
 begin perform public.save_pre_generation_visit_date(gen_random_uuid(),eid,'initial_visit','2026-09-01',n,'2026-09-01'); exception when no_data_found then failed:=true; end;
 if not failed then raise exception 'Wrong case accepted'; end if;
 failed:=false;
 begin perform public.save_pre_generation_visit_date(cid,eid,'initial_visit',null,n,'2026-09-01'); exception when invalid_datetime_format then failed:=true; end;
 if not failed then raise exception 'Null date accepted'; end if;
 update public.cases set case_status='closed' where id=cid;
 failed:=false;
 begin perform public.save_pre_generation_visit_date(cid,eid,'initial_visit','2026-09-01',n,'2026-09-01'); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Closed case accepted'; end if;
 update public.cases set case_status='active' where id=cid;
 begin
 update public.care_episodes set status='discharged',ended_at=now() where id=eid;
 failed:=false;
 begin perform public.save_pre_generation_visit_date(cid,eid,'initial_visit','2026-09-01',n,'2026-09-01'); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Inactive episode accepted'; end if;
 raise exception using errcode='ZX001',message='Roll back fixture lifecycle change';
 exception when sqlstate 'ZX001' then null; end;
 if (select created_by_user_id from public.initial_visit_notes where id=n) is distinct from auth.uid() then raise exception 'Missing creator attribution'; end if;
 perform set_config('request.jwt.claim.sub','11930000-0000-4000-8000-000000000002',true);
 failed:=false;
 begin perform public.save_pre_generation_visit_date(cid,eid,'initial_visit','2026-09-01',n,'2026-09-01'); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Inactive writer accepted'; end if;
end $$;
reset role;
-- Signed/correction fixtures require the database owner; calls still run authenticated.
update public.initial_visit_notes set status='finalized'
where case_id='31930000-0000-4000-8000-000000000001' and visit_type='initial_visit';
select set_config('request.jwt.claim.sub','11930000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$ declare n public.initial_visit_notes%rowtype; failed boolean:=false; begin
 select * into n from public.initial_visit_notes where case_id='31930000-0000-4000-8000-000000000001' and visit_type='initial_visit';
 begin perform public.save_pre_generation_visit_date(n.case_id,n.episode_id,n.visit_type,n.visit_date,n.id,n.visit_date); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Finalized note accepted'; end if;
end $$;
reset role;
insert into public.documents(id,case_id,document_type,file_name,file_path,status)
values('61930000-0000-4000-8000-000000000001','31930000-0000-4000-8000-000000000001','generated','Synthetic correction','test/date-correction.pdf','reviewed');
insert into public.discharge_note_corrections(case_id,episode_id,discharge_note_id,revision_number,reason,original_document_id,original_note_snapshot,opened_by_user_id)
select case_id,episode_id,id,2,'Synthetic correction guard','61930000-0000-4000-8000-000000000001','{}','11930000-0000-4000-8000-000000000001'
from public.discharge_notes where case_id='31930000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ declare n public.discharge_notes%rowtype; failed boolean:=false; begin
 select * into n from public.discharge_notes where case_id='31930000-0000-4000-8000-000000000001';
 begin perform public.save_pre_generation_visit_date(n.case_id,n.episode_id,'discharge',n.visit_date,n.id,n.visit_date); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Open discharge correction accepted'; end if;
end $$;
reset role;
insert into public.cases(id,patient_id,case_status)
values('31930000-0000-4000-8000-000000000002','21930000-0000-4000-8000-000000000001','active');
insert into public.clinical_encounters(id,case_id,episode_id,encounter_type,status,encounter_date)
select '51930000-0000-4000-8000-000000000002',case_id,id,'initial_evaluation','scheduled','2026-09-01'
from public.care_episodes where case_id='31930000-0000-4000-8000-000000000002';
set local role authenticated;
do $$ declare eid uuid; r jsonb; n uuid; begin
 select id into eid from public.care_episodes where case_id='31930000-0000-4000-8000-000000000002';
 r:=public.save_pre_generation_visit_date('31930000-0000-4000-8000-000000000002',eid,'initial_visit','2026-09-02',null,null);
 n:=(r->'data'->>'noteId')::uuid;
 if (select encounter_id from public.initial_visit_notes where id=n)<>'51930000-0000-4000-8000-000000000002' then raise exception 'Scheduled encounter replaced'; end if;
 if (select status from public.clinical_encounters where id='51930000-0000-4000-8000-000000000002')<>'scheduled' then raise exception 'Date save advanced encounter status'; end if;
 update public.initial_visit_notes set visit_date=null where id=n;
 r:=public.save_pre_generation_visit_date('31930000-0000-4000-8000-000000000002',eid,'initial_visit','2026-09-03',n,null);
 if r->'data'->>'visitDate'<>'2026-09-03' then raise exception 'Legacy null date not saved'; end if;
end $$;
reset role;
update public.care_episodes set status='discharged',ended_at=now() where case_id='31930000-0000-4000-8000-000000000002';
insert into public.care_episodes(case_id,episode_number,status)
values('31930000-0000-4000-8000-000000000002',2,'active');
set local role authenticated;
do $$ declare eid uuid; failed boolean:=false; begin
 select id into eid from public.care_episodes where case_id='31930000-0000-4000-8000-000000000002' and episode_number=2;
 begin perform public.save_pre_generation_visit_date('31930000-0000-4000-8000-000000000002',eid,'initial_visit','2026-09-04',null,null);
 exception when raise_exception then failed:=true; end;
 if not failed then raise exception 'Return episode Initial Visit accepted'; end if;
 if exists(select 1 from public.initial_visit_notes where episode_id=eid) then raise exception 'Rejected return Initial Visit left a note'; end if;
end $$;
reset role;
set local role anon;
do $$ declare failed boolean:=false; begin
 begin perform public.save_pre_generation_visit_date(null,null,'initial_visit','2026-09-01',null,null); exception when insufficient_privilege then failed:=true; end;
 if not failed then raise exception 'Anonymous writer accepted'; end if;
end $$;
reset role;
select pass('Date persistence, identity, lost acknowledgments, guards, ordering, atomicity and preserved intake');
select * from finish();
rollback;
