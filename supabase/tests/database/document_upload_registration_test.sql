begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(8);
insert into auth.users(id,email,raw_user_meta_data) values
 ('11940000-0000-4000-8000-000000000001','upload-staff@test.local','{}'),
 ('11940000-0000-4000-8000-000000000002','upload-provider@test.local','{}'),
 ('11940000-0000-4000-8000-000000000003','upload-admin@test.local','{}'),
 ('11940000-0000-4000-8000-000000000004','upload-inactive@test.local','{}');
update public.users set role='provider' where id='11940000-0000-4000-8000-000000000002';
update public.users set role='admin' where id='11940000-0000-4000-8000-000000000003';
update public.users set is_active=false where id='11940000-0000-4000-8000-000000000004';
insert into public.patients(id,first_name,last_name,date_of_birth) values
 ('21940000-0000-4000-8000-000000000001','Synthetic','Upload','1980-01-01');
insert into public.cases(id,patient_id,case_status) values
 ('31940000-0000-4000-8000-000000000001','21940000-0000-4000-8000-000000000001','intake'),
 ('31940000-0000-4000-8000-000000000002','21940000-0000-4000-8000-000000000001','closed'),
 ('31940000-0000-4000-8000-000000000003','21940000-0000-4000-8000-000000000001','intake');
create function pg_temp.register_test(c uuid, d uuid, kind text default 'other', allow_locked boolean default false)
returns boolean language sql as $$
 select created from public.register_uploaded_document(d,c,kind,'test.pdf','cases/'||c||'/'||d||'-test.pdf',10,'application/pdf',allow_locked);
$$;
select ok(not has_function_privilege('anon','public.register_uploaded_document(uuid,uuid,text,text,text,bigint,text,boolean,boolean)','execute'),'anon cannot execute');
select ok(not (select prosecdef from pg_proc where oid='public.register_uploaded_document(uuid,uuid,text,text,text,bigint,text,boolean,boolean)'::regprocedure),'invoker preserves RLS');
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select throws_ok($$select pg_temp.register_test('31940000-0000-4000-8000-000000000001','41940000-0000-4000-8000-000000000001')$$,'42501','Not authenticated','no auth denied');
select set_config('request.jwt.claim.sub','11940000-0000-4000-8000-000000000004',true);
select throws_ok($$select pg_temp.register_test('31940000-0000-4000-8000-000000000001','41940000-0000-4000-8000-000000000001')$$,'42501','Active user required','inactive denied');
select set_config('request.jwt.claim.sub','11940000-0000-4000-8000-000000000099',true);
select throws_ok($$select pg_temp.register_test('31940000-0000-4000-8000-000000000001','41940000-0000-4000-8000-000000000001')$$,'42501','Active user required','missing actor denied');
select set_config('request.jwt.claim.sub','11940000-0000-4000-8000-000000000001',true);
do $$
declare c uuid := '31940000-0000-4000-8000-000000000001'; d uuid := '41940000-0000-4000-8000-000000000001';
begin
 if not pg_temp.register_test(c,d,'lien_agreement') then raise exception 'first registration not created'; end if;
 if pg_temp.register_test(c,d,'lien_agreement') then raise exception 'replay inserted'; end if;
 if (select count(*) from public.documents where id=d)<>1 then raise exception 'duplicate documents'; end if;
 if (select case_status from public.cases where id=c)<>'active' or not (select lien_on_file from public.cases where id=c) then raise exception 'missing effects'; end if;
 if (select count(*) from public.case_status_history where case_id=c and previous_status='intake')<>1 then raise exception 'duplicate history'; end if;
 update public.cases set case_status='pending_imaging',lien_on_file=false where id=c;
 perform pg_temp.register_test(c,d,'lien_agreement');
 if (select case_status from public.cases where id=c)<>'pending_imaging' or (select lien_on_file from public.cases where id=c) then raise exception 'replay repeated effects'; end if;
 begin
  perform pg_temp.register_test(c,d,'other'); raise exception 'collision accepted';
 exception when unique_violation then null; end;
 update public.documents set deleted_at=now() where id=d;
 begin
  perform pg_temp.register_test(c,d,'lien_agreement'); raise exception 'deleted identity accepted';
 exception when unique_violation then null; end;
 begin
  perform pg_temp.register_test('31940000-0000-4000-8000-000000000002',gen_random_uuid(),'other',true); raise exception 'staff bypassed lock';
 exception when insufficient_privilege then null; end;
 begin
  perform public.register_uploaded_document(gen_random_uuid(),c,'other','test.pdf','cases/wrong',10,'application/pdf'); raise exception 'bad path accepted';
 exception when invalid_parameter_value then null; end;
end;
$$;
select pass('staff registration, atomic effects, replay, conflicts, lock and path checks');
select set_config('request.jwt.claim.sub','11940000-0000-4000-8000-000000000002',true);
do $$
begin
 perform pg_temp.register_test('31940000-0000-4000-8000-000000000001',gen_random_uuid());
 begin
  perform pg_temp.register_test('31940000-0000-4000-8000-000000000002',gen_random_uuid(),'other',true); raise exception 'provider bypassed lock';
 exception when insufficient_privilege then null; end;
end;
$$;
select set_config('request.jwt.claim.sub','11940000-0000-4000-8000-000000000003',true);
do $$
begin
 begin
  perform pg_temp.register_test('31940000-0000-4000-8000-000000000002',gen_random_uuid()); raise exception 'implicit admin bypass';
 exception when insufficient_privilege then null; end;
 perform pg_temp.register_test('31940000-0000-4000-8000-000000000002',gen_random_uuid(),'other',true);
end;
$$;
select pass('provider access and explicit active-admin lock bypass');
reset role;
create function pg_temp.fail_upload_effect() returns trigger language plpgsql as $$
begin raise exception 'injected effect failure'; end;
$$;
create trigger upload_history_failure before insert on public.case_status_history for each row execute function pg_temp.fail_upload_effect();
set local role authenticated;
do $$
declare c uuid := '31940000-0000-4000-8000-000000000003'; d uuid := gen_random_uuid();
begin
 begin
  perform pg_temp.register_test(c,d,'lien_agreement'); raise exception 'missing injected failure';
 exception when raise_exception then if sqlerrm <> 'injected effect failure' then raise; end if; end;
 if exists(select 1 from public.documents where id=d) or (select case_status from public.cases where id=c)<>'intake'
   or (select lien_on_file from public.cases where id=c) then raise exception 'partial history transaction'; end if;
end;
$$;
reset role;
drop trigger upload_history_failure on public.case_status_history;
create trigger upload_lien_failure before update of lien_on_file on public.cases for each row execute function pg_temp.fail_upload_effect();
set local role authenticated;
do $$
declare c uuid := '31940000-0000-4000-8000-000000000003'; d uuid := gen_random_uuid();
begin
 begin
  perform pg_temp.register_test(c,d,'lien_agreement'); raise exception 'missing injected failure';
 exception when raise_exception then if sqlerrm <> 'injected effect failure' then raise; end if; end;
 if exists(select 1 from public.documents where id=d) or (select case_status from public.cases where id=c)<>'intake'
   or exists(select 1 from public.case_status_history where case_id=c) then raise exception 'partial lien transaction'; end if;
end;
$$;
select pass('history and lien failures roll back document and every effect');
select * from finish();
rollback;
