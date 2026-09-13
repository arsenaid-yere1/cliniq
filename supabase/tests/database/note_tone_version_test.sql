begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(1);
insert into auth.users(id,email,raw_user_meta_data) values('13999999-0000-4000-8000-000000000001','tone-version@test.local','{}');
update public.users set role='admin',is_active=true where id='13999999-0000-4000-8000-000000000001';
insert into public.patients(id,first_name,last_name,date_of_birth) values('23999999-0000-4000-8000-000000000001','Tone','Version','1980-01-01');
insert into public.cases(id,patient_id,case_status) values('33999999-0000-4000-8000-000000000001','23999999-0000-4000-8000-000000000001','active');
select set_config('request.jwt.claim.sub','13999999-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
do $$
declare cid uuid:='33999999-0000-4000-8000-000000000001'; eid uuid; enc uuid; nid uuid; family text; k text; old_version timestamptz; saved_version timestamptz; changed_rows integer; row_data jsonb;
begin
 select id into eid from care_episodes where case_id=cid;
 foreach family in array array['initial_visit','pain_evaluation_visit','discharge'] loop
  k:=case when family='discharge' then 'discharge_notes' else 'initial_visit_notes' end;
  insert into clinical_encounters(case_id,episode_id,encounter_type,status,encounter_date)
   values(cid,eid,case family when 'initial_visit' then 'initial_evaluation' when 'pain_evaluation_visit' then 'pain_evaluation' else 'discharge' end,'in_progress','2026-09-13') returning id into enc;
  if family='discharge' then
   insert into discharge_notes(case_id,episode_id,encounter_id,status,patient_education)
    values(cid,eid,enc,'draft','Keep this counseling.') returning id,updated_at into nid,old_version;
  else
   insert into initial_visit_notes(case_id,episode_id,encounter_id,status,visit_type,patient_education)
    values(cid,eid,enc,'draft',family,'Keep this counseling.') returning id,updated_at into nid,old_version;
  end if;
  execute format('update public.%I set tone_hint=''Concise'',updated_by_user_id=auth.uid() where id=$1 and case_id=$2 and status=''draft'' and deleted_at is null and updated_at=$3 returning updated_at',k)
   into saved_version using nid,cid,old_version;
  if saved_version is null or saved_version=old_version then raise exception 'Tone save did not advance version for %',family; end if;
  execute format('update public.%I set tone_hint=''Stale'' where id=$1 and case_id=$2 and status=''draft'' and deleted_at is null and updated_at=$3',k)
   using nid,cid,old_version;
  get diagnostics changed_rows=row_count;
  if changed_rows<>0 then raise exception 'Stale tone write accepted for %',family; end if;
  execute format('select to_jsonb(n) from public.%I n where id=$1',k) into row_data using nid;
  if row_data->>'patient_education'<>'Keep this counseling.' or row_data->>'tone_hint'<>'Concise' then raise exception 'Tone write changed prose or accepted stale tone for %',family; end if;
  execute format('update public.%I set tone_hint=''Detailed'',updated_by_user_id=auth.uid() where id=$1 and case_id=$2 and status=''draft'' and deleted_at is null and updated_at=$3',k)
   using nid,cid,saved_version;
  get diagnostics changed_rows=row_count;
  if changed_rows<>1 then raise exception 'Acknowledged version rejected for %',family; end if;
 end loop;
end $$;
reset role;
select pass('Tone CAS advances versions, rejects stale writes, preserves prose, and accepts the returned version for all three draft families');
select * from finish();
rollback;
