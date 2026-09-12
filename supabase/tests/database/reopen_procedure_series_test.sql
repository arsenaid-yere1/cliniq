begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(25);

insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('13000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','numbering@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());
insert into public.provider_profiles (id,user_id,display_name)
values ('13000000-0000-4000-8000-000000000002','13000000-0000-4000-8000-000000000001','Numbering test');
insert into public.patients (id,first_name,last_name,date_of_birth)
values ('23000000-0000-4000-8000-000000000001','Numbering','Patient','1980-01-01');
insert into public.cases (id,case_number,patient_id,case_status,assigned_provider_id)
values ('33000000-0000-4000-8000-000000000001','REOPEN-TEST','23000000-0000-4000-8000-000000000001','active','13000000-0000-4000-8000-000000000002');
update public.care_episodes set id='43000000-0000-4000-8000-000000000001'
where case_id='33000000-0000-4000-8000-000000000001';
insert into public.procedure_series (id,case_id,episode_id,series_number,procedure_type)
values ('83000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',1,'prp'),
('83000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001',2,'botox');
insert into public.procedures (case_id,episode_id,procedure_series_id,procedure_date,procedure_name,procedure_type,procedure_number,deleted_at,sites)
select '33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001',current_date,'PRP','prp',n,case when n=2 then now() end,'[{"label":"knee"}]'::jsonb from generate_series(1,2) n;
-- A different series must not affect allocation.
insert into public.procedures (case_id,episode_id,procedure_series_id,procedure_date,procedure_name,procedure_type,procedure_number,sites)
values ('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000002',current_date,'Botox','botox',9,'[{"label":"head"}]');
insert into public.clinical_encounters (id,case_id,episode_id,encounter_type,status,encounter_date)
values ('53000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','pain_follow_up','completed',current_date);
insert into public.procedure_orders (id,case_id,episode_id,source_encounter_id,source_recommendation_id,procedure_series_id,procedure_type,status,sites)
values ('63000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000002','83000000-0000-4000-8000-000000000001','prp','scheduled','[{"label":"knee"}]');
insert into public.procedure_appointments (id,case_id,episode_id,procedure_order_id,scheduled_start,scheduled_end,provider_id)
values ('73000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000001',now(),now()+interval '1 hour','13000000-0000-4000-8000-000000000002');

-- A completed series remains completed when its case is reactivated.
update public.procedure_series set status='completed' where id='83000000-0000-4000-8000-000000000001';
update public.procedure_orders set status='completed' where id='63000000-0000-4000-8000-000000000001';
update public.procedure_appointments set status='completed',completed_at=now() where id='73000000-0000-4000-8000-000000000001';
update public.users set role='admin' where id='13000000-0000-4000-8000-000000000001';
insert into public.pain_follow_up_notes(case_id,episode_id,encounter_id,status,procedure_recommendations)
values('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','finalized',
 '[{"recommendation_id":"63000000-0000-4000-8000-000000000003","procedure_type":"prp"}]');
insert into public.clinical_encounters (id,case_id,episode_id,encounter_type,status,encounter_date)
values ('53000000-0000-4000-8000-000000000002','33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','discharge','in_progress',current_date);
insert into public.discharge_notes(case_id,episode_id,encounter_id,status,subjective)
values('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000002','draft','Generated text to reset');
update public.care_episodes set status='discharged',ended_at=now() where id='43000000-0000-4000-8000-000000000001';
update public.cases set case_status='closed' where id='33000000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','13000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select is(private.procedure_series_choice('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')->>'unavailableReason','episode_not_writable','discharged case cannot reopen a series');
do $$ declare p jsonb; begin
 p:=public.preview_clinical_reset('33000000-0000-4000-8000-000000000001');
 perform public.apply_clinical_reset(jsonb_build_object('case_id',p->>'case_id','episode_id',p->>'episode_id',
 'case_version',p->>'case_version','episode_version',p->>'episode_version','reactivate',true,
 'reason','Resume existing course and reset draft discharge','request_key',gen_random_uuid(),
 'notes',(select jsonb_agg(jsonb_build_object('kind','discharge_notes','id',n.id,'updated_at',n.updated_at)) from public.discharge_notes n where n.case_id='33000000-0000-4000-8000-000000000001')));
end $$;
select is((select status from public.procedure_series where id='83000000-0000-4000-8000-000000000001'),'completed','reactivation does not silently reopen the series');
select ok((select subjective is null from public.discharge_notes where case_id='33000000-0000-4000-8000-000000000001'),'reactivation resets the selected draft note');
select is(private.procedure_series_choice('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')->>'relationship','reopen','completed current series offers explicit reopening');
select is(private.procedure_series_choice('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')->>'latestProcedureNumber','1','preview ignores deleted procedure 2');
select ok((select choice->>'eligible'='true' from jsonb_array_elements(public.preview_procedure_series_choices('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001')) choice where choice->>'id'='83000000-0000-4000-8000-000000000001'),'public preview uses shared eligibility');
select throws_ok($$select public.create_procedure_order_from_recommendation_v2('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003','prp','["knee"]','[]','Continue treatment','routine','current','83000000-0000-4000-8000-000000000001')$$,'P0001','Selected procedure series is no longer eligible','old current selection cannot implicitly reopen');
select throws_ok($$select public.create_procedure_order_from_recommendation_v2('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003','prp','["knee"]','[]','Continue treatment','routine','reopen','83000000-0000-4000-8000-000000000002')$$,'P0001','Selected procedure series type does not match the recommendation','reopening rejects a mismatched recommendation type');
update public.procedure_series set status='cancelled' where id='83000000-0000-4000-8000-000000000001';
select is(private.procedure_series_choice('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')->>'unavailableReason','current_not_active','cancelled current series remains unavailable');
select throws_ok($$select public.create_procedure_order_from_recommendation_v2('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003','prp','["knee"]','[]','Continue treatment','routine','reopen','83000000-0000-4000-8000-000000000001')$$,'P0001','Selected procedure series is no longer eligible','saving also rejects a cancelled series');
update public.procedure_series set status='completed',deleted_at=now() where id='83000000-0000-4000-8000-000000000001';
select is(private.procedure_series_choice('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')->>'unavailableReason','deleted','deleted series remains unavailable');
select throws_ok($$select public.create_procedure_order_from_recommendation_v2('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003','prp','["knee"]','[]','Continue treatment','routine','reopen','83000000-0000-4000-8000-000000000001')$$,'P0001','Selected procedure series is no longer eligible','saving also rejects a deleted series');
update public.procedure_series set deleted_at=null where id='83000000-0000-4000-8000-000000000001';
update public.procedures set deleted_at=now() where procedure_series_id='83000000-0000-4000-8000-000000000001' and procedure_number=1;
select is(private.procedure_series_choice('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')->>'unavailableReason','no_performed_procedures','only-deleted history cannot be reopened');
select throws_ok($$select public.create_procedure_order_from_recommendation_v2('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003','prp','["knee"]','[]','Continue treatment','routine','reopen','83000000-0000-4000-8000-000000000001')$$,'P0001','Selected procedure series has no completed procedures','saving also rejects an empty series');
update public.procedures set deleted_at=null where procedure_series_id='83000000-0000-4000-8000-000000000001' and procedure_number=1;
-- Failure after the status update must roll back both reopening and audit.
do $$ begin
 begin
  perform public.create_procedure_order_from_recommendation_v2('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003','prp','["knee"]','[]','Continue treatment','invalid','reopen','83000000-0000-4000-8000-000000000001');
  raise exception 'Expected invalid priority failure';
 exception when check_violation then null;
 end;
end $$;
select is((select status from public.procedure_series where id='83000000-0000-4000-8000-000000000001'),'completed','failed order rolls back reopening');
select is((select count(*)::integer from public.audit_logs where record_id='83000000-0000-4000-8000-000000000001'),0,'failed order leaves no reopening audit');
create temporary table reopened_order as select * from public.create_procedure_order_from_recommendation_v2('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003','prp','["knee"]','[]','Continue treatment','routine','reopen','83000000-0000-4000-8000-000000000001');
select is((select procedure_series_id from reopened_order),'83000000-0000-4000-8000-000000000001'::uuid,'reopening uses the same series');
select is((select status from public.procedure_series where id='83000000-0000-4000-8000-000000000001'),'active','successful order activates the series');
select is((select relationship from public.procedure_order_series_selections where procedure_order_id=(select id from reopened_order)),'reopen','immutable relationship records the explicit choice');
select ok((select old_data->>'status'='completed' and new_data->>'status'='active' and performed_by_user_id='13000000-0000-4000-8000-000000000001' from public.audit_logs where record_id='83000000-0000-4000-8000-000000000001'),'status transition is attributed to the authenticated user');
select throws_ok($$select public.create_procedure_order_from_recommendation_v2('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','53000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000003','prp','["knee"]','[]','Continue treatment','routine','reopen','83000000-0000-4000-8000-000000000001')$$,'P0001','Selected procedure series already has an open order','stale or duplicate reopen cannot add another order');
select is(private.procedure_series_choice('33000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000001')->>'unavailableReason','current_has_open_order','preview agrees with mutation about an open order');
create temporary table reopened_appointment as select public.schedule_procedure_appointment((select id from reopened_order),now(),now()+interval '1 hour','13000000-0000-4000-8000-000000000002',null,null,'reopen-schedule') as result;
create temporary table reopened_procedure as select public.complete_procedure_appointment((select (result->>'appointment_id')::uuid from reopened_appointment),'{"sites":[{"label":"knee"}]}','{}','reopen-complete') as result;
select is((select procedure_number from public.procedures where id=(select (result->>'procedure_id')::uuid from reopened_procedure)),2,'full reopened workflow records procedure 2 after deleted procedure 2');
select ok(not has_function_privilege('anon','public.preview_procedure_series_choices(uuid,uuid)','EXECUTE'),'anonymous role cannot load the preview');
select ok(not has_function_privilege('anon','private.procedure_series_choice(uuid,uuid,uuid)','EXECUTE'),'anonymous role cannot call the private helper');
select * from finish();
rollback;
