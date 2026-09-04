begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(14);

insert into auth.users (id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('12000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','series-rpc@test.local','',now(),' {"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,now(),now());
insert into public.patients (id,first_name,last_name,date_of_birth)
values ('22000000-0000-4000-8000-000000000001','Series','Patient','1980-01-01');
insert into public.cases (id,case_number,patient_id,case_status)
values ('32000000-0000-4000-8000-000000000001','SERIES-RPC-TEST','22000000-0000-4000-8000-000000000001','active');

update public.care_episodes set id='42000000-0000-4000-8000-000000000001',status='discharged',ended_at=now()
where case_id='32000000-0000-4000-8000-000000000001' and episode_number=1;
insert into public.care_episodes (id,case_id,episode_number,status)
values ('42000000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001',2,'active');

insert into public.procedure_series (id,case_id,episode_id,series_number,procedure_type,status) values
('82000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001',1,'prp','completed'),
('82000000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002',1,'prp','active'),
('82000000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002',2,'botox','active'),
('82000000-0000-4000-8000-000000000004','32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002',3,'prp','active');
insert into public.procedures (id,case_id,episode_id,procedure_series_id,procedure_date,procedure_name,procedure_type,procedure_number,sites) values
('92000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001',current_date,'PRP #1','prp',1,'[{"label":"knee"}]'),
('92000000-0000-4000-8000-000000000002','32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000002',current_date,'PRP #1','prp',1,'[{"label":"knee"}]'),
('92000000-0000-4000-8000-000000000003','32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000003',current_date,'Botox #1','botox',1,'[{"label":"head"}]');

insert into public.clinical_encounters (id,case_id,episode_id,encounter_type,status,encounter_date)
values ('52000000-0000-4000-8000-000000000001','32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','pain_follow_up','completed',current_date);
insert into public.pain_follow_up_notes (case_id,episode_id,encounter_id,status,procedure_recommendations)
values ('32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','finalized',jsonb_build_array(
  jsonb_build_object('recommendation_id','62000000-0000-4000-8000-000000000001','procedure_type','prp'),
  jsonb_build_object('recommendation_id','62000000-0000-4000-8000-000000000002','procedure_type','prp'),
  jsonb_build_object('recommendation_id','62000000-0000-4000-8000-000000000003','procedure_type','prp'),
  jsonb_build_object('recommendation_id','62000000-0000-4000-8000-000000000004','procedure_type','prp'),
  jsonb_build_object('recommendation_id','62000000-0000-4000-8000-000000000005','procedure_type','prp')
));

select set_config('request.jwt.claim.sub','12000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;

select lives_ok($$select public.create_procedure_order_from_recommendation_v2('32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','prp','["knee"]','[]','next','routine','current','82000000-0000-4000-8000-000000000002')$$,'current active series can be reused');
select results_eq($$select procedure_series_id from public.procedure_orders where source_recommendation_id='62000000-0000-4000-8000-000000000001'$$,$$values ('82000000-0000-4000-8000-000000000002'::uuid)$$,'order uses the current series');
select results_eq($$select relationship,selected_series_id from public.procedure_order_series_selections where procedure_order_id=(select id from public.procedure_orders where source_recommendation_id='62000000-0000-4000-8000-000000000001')$$,$$values ('current'::text,'82000000-0000-4000-8000-000000000002'::uuid)$$,'current choice is audited');
select results_eq($$select count(*)::integer from public.procedure_series where episode_id='42000000-0000-4000-8000-000000000002'$$,$$values (3)$$,'reusing a series does not insert another series');
select throws_ok($$select public.create_procedure_order_from_recommendation('32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002','prp','["knee"]','[]','next','routine','82000000-0000-4000-8000-000000000002')$$,'P0001','Selected procedure series already has an open order','a second open order is rejected');
select throws_ok($$select public.create_procedure_order_from_recommendation('32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002','prp','["knee"]','[]','next','routine','82000000-0000-4000-8000-000000000003')$$,'P0001','Selected procedure series type does not match the recommendation','a mismatched current series is rejected');
select throws_ok($$select public.create_procedure_order_from_recommendation('32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002','prp','["knee"]','[]','next','routine','82000000-0000-4000-8000-000000000004')$$,'P0001','Selected procedure series has no completed procedures','an empty current series is rejected');
select lives_ok($$select public.create_procedure_order_from_recommendation_v2('32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000002','prp','["knee"]','[]','separate','routine','separate',null)$$,'independent ordering still works');
select results_eq($$select relationship,selected_series_id from public.procedure_order_series_selections where procedure_order_id=(select id from public.procedure_orders where source_recommendation_id='62000000-0000-4000-8000-000000000002')$$,$$values ('separate'::text,null::uuid)$$,'separate choice is audited');
select lives_ok($$select public.create_procedure_order_from_recommendation_v2('32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000003','prp','["knee"]','[]','prior','routine','prior','82000000-0000-4000-8000-000000000001')$$,'prior completed series continuation still works');
select results_eq($$select relationship,selected_series_id from public.procedure_order_series_selections where procedure_order_id=(select id from public.procedure_orders where source_recommendation_id='62000000-0000-4000-8000-000000000003')$$,$$values ('prior'::text,'82000000-0000-4000-8000-000000000001'::uuid)$$,'prior choice is audited');
select results_eq($$select count(*)::integer from public.procedure_series where episode_id='42000000-0000-4000-8000-000000000002' and continued_from_series_id='82000000-0000-4000-8000-000000000001'$$,$$values (1)$$,'prior continuation creates a new linked current-episode series');

select lives_ok($$select public.create_procedure_order_from_recommendation('32000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000002','52000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000005','prp','["knee"]','[]','legacy','routine',null)$$,'legacy RPC remains available');
select results_eq($$select count(*)::integer from public.procedure_order_series_selections selection join public.procedure_orders procedure_order on procedure_order.id=selection.procedure_order_id where procedure_order.source_recommendation_id='62000000-0000-4000-8000-000000000005'$$,$$values (0)$$,'legacy order remains honestly unaudited');

select * from finish();
rollback;
