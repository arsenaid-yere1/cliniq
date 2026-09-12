-- Allocate the next number from retained procedures, matching the order preview.
-- Both paths retain their existing series lock and idempotency handling.
create or replace function public.complete_procedure_appointment(
  p_appointment_id uuid, p_procedure jsonb, p_vitals jsonb, p_idempotency_key text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_actor uuid:=auth.uid(); v_appt public.procedure_appointments%rowtype;
  v_order public.procedure_orders%rowtype; v_number integer; v_procedure_id uuid;
  v_hash text; v_op public.operation_idempotency%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication required'; end if;
  v_hash:=md5(jsonb_build_array(p_appointment_id,p_procedure,p_vitals)::text);
  insert into public.operation_idempotency(actor_id,operation_type,client_key,input_hash,status)
    values(v_actor,'complete_procedure',btrim(p_idempotency_key),v_hash,'pending') on conflict do nothing;
  select * into v_op from public.operation_idempotency where actor_id=v_actor
    and operation_type='complete_procedure' and client_key=btrim(p_idempotency_key) for update;
  if v_op.input_hash<>v_hash then raise exception using errcode='22023',message='Idempotency key was already used with different input'; end if;
  if v_op.status='completed' then return v_op.result||jsonb_build_object('replayed',true); end if;
  select * into v_appt from public.procedure_appointments where id=p_appointment_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Appointment not found'; end if;
  select id into v_procedure_id from public.procedures where procedure_appointment_id=p_appointment_id and deleted_at is null;
  if v_procedure_id is not null then
    update public.procedure_appointments set status='completed',completed_at=coalesce(completed_at,now()),updated_by_user_id=v_actor where id=p_appointment_id;
    update public.procedure_orders set status='completed',updated_by_user_id=v_actor where id=v_appt.procedure_order_id;
    update public.operation_idempotency set status='completed',case_id=v_appt.case_id,episode_id=v_appt.episode_id,
      procedure_order_id=v_appt.procedure_order_id,procedure_appointment_id=p_appointment_id,
      procedure_id=v_procedure_id,result=jsonb_build_object('procedure_id',v_procedure_id),completed_at=now() where id=v_op.id;
    return jsonb_build_object('procedure_id',v_procedure_id,'replayed',true);
  end if;
  if v_appt.status<>'scheduled' then raise exception using errcode='P0001',message='Appointment is not available to complete'; end if;
  select * into v_order from public.procedure_orders where id=v_appt.procedure_order_id and status='scheduled' and deleted_at is null for update;
  if not found then raise exception using errcode='P0001',message='Procedure order is not scheduled'; end if;
  perform 1 from public.procedure_series s where s.id=v_order.procedure_series_id for update;
  select coalesce(max(p.procedure_number),0)+1 into v_number from public.procedures p
    where p.procedure_series_id=v_order.procedure_series_id and p.deleted_at is null;
  insert into public.procedures(case_id,episode_id,procedure_series_id,source_encounter_id,procedure_appointment_id,
    provider_profile_id,procedure_date,procedure_name,procedure_type,procedure_number,sites,injection_site,diagnoses,
    consent_obtained,pain_rating,blood_draw_volume_ml,centrifuge_duration_min,prep_protocol,kit_lot_number,
    anesthetic_agent,anesthetic_dose_ml,patient_tolerance,injection_volume_ml,needle_gauge,guidance_method,
    target_structure,complications,supplies_used,compression_bandage,activity_restriction_hrs,
    plan_deviation_reason,botox_dosing,created_by_user_id,updated_by_user_id)
  values(v_appt.case_id,v_appt.episode_id,v_order.procedure_series_id,v_order.source_encounter_id,p_appointment_id,
    v_appt.provider_id,coalesce((p_procedure->>'procedure_date')::date,v_appt.scheduled_start::date),
    coalesce(nullif(p_procedure->>'procedure_name',''),upper(v_order.procedure_type)||' Procedure'),v_order.procedure_type,
    v_number,coalesce(p_procedure->'sites',v_order.sites),nullif(p_procedure->>'injection_site',''),
    coalesce(p_procedure->'diagnoses',v_order.diagnoses),coalesce((p_procedure->>'consent_obtained')::boolean,false),
    (p_procedure->>'pain_rating')::integer,(p_procedure->>'blood_draw_volume_ml')::numeric,
    (p_procedure->>'centrifuge_duration_min')::integer,nullif(p_procedure->>'prep_protocol',''),
    nullif(p_procedure->>'kit_lot_number',''),nullif(p_procedure->>'anesthetic_agent',''),
    (p_procedure->>'anesthetic_dose_ml')::numeric,nullif(p_procedure->>'patient_tolerance',''),
    (p_procedure->>'injection_volume_ml')::numeric,nullif(p_procedure->>'needle_gauge',''),
    nullif(p_procedure->>'guidance_method',''),nullif(p_procedure->>'target_structure',''),
    nullif(p_procedure->>'complications',''),nullif(p_procedure->>'supplies_used',''),
    (p_procedure->>'compression_bandage')::boolean,(p_procedure->>'activity_restriction_hrs')::integer,
    nullif(p_procedure->>'plan_deviation_reason',''),p_procedure->'botox_dosing',v_actor,v_actor)
  returning id into v_procedure_id;
  if p_vitals is not null and p_vitals <> '{}'::jsonb then
    insert into public.vital_signs(case_id,procedure_id,encounter_id,bp_systolic,bp_diastolic,heart_rate,
      respiratory_rate,temperature_f,spo2_percent,pain_score_min,pain_score_max,created_by_user_id,updated_by_user_id)
    values(v_appt.case_id,v_procedure_id,null,(p_vitals->>'bp_systolic')::integer,
      (p_vitals->>'bp_diastolic')::integer,(p_vitals->>'heart_rate')::integer,(p_vitals->>'respiratory_rate')::integer,
      (p_vitals->>'temperature_f')::numeric,(p_vitals->>'spo2_percent')::integer,(p_vitals->>'pain_score_min')::integer,
      (p_vitals->>'pain_score_max')::integer,v_actor,v_actor);
  end if;
  update public.procedure_appointments set status='completed',completed_at=now(),updated_by_user_id=v_actor where id=p_appointment_id;
  update public.procedure_orders set status='completed',updated_by_user_id=v_actor where id=v_order.id;
  update public.operation_idempotency set status='completed',case_id=v_appt.case_id,episode_id=v_appt.episode_id,
    procedure_order_id=v_order.id,procedure_appointment_id=p_appointment_id,procedure_id=v_procedure_id,
    result=jsonb_build_object('procedure_id',v_procedure_id),completed_at=now() where id=v_op.id;
  return jsonb_build_object('procedure_id',v_procedure_id,'replayed',false);
end
$$;

create or replace function public.create_direct_episode_procedure(
  p_case_id uuid, p_procedure_type text, p_procedure jsonb, p_vitals jsonb,
  p_idempotency_key text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_actor uuid:=auth.uid(); v_episode_id uuid; v_series_id uuid; v_provider_id uuid;
  v_number integer; v_procedure_id uuid; v_hash text; v_op public.operation_idempotency%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication required'; end if;
  v_hash:=md5(jsonb_build_array(p_case_id,p_procedure_type,p_procedure,p_vitals)::text);
  insert into public.operation_idempotency(actor_id,operation_type,client_key,input_hash,status)
    values(v_actor,'create_direct_procedure',btrim(p_idempotency_key),v_hash,'pending') on conflict do nothing;
  select * into v_op from public.operation_idempotency where actor_id=v_actor
    and operation_type='create_direct_procedure' and client_key=btrim(p_idempotency_key) for update;
  if v_op.input_hash<>v_hash then raise exception using errcode='22023',message='Idempotency key was already used with different input'; end if;
  if v_op.status='completed' then return v_op.result||jsonb_build_object('replayed',true); end if;
  select e.id,c.assigned_provider_id into v_episode_id,v_provider_id
  from public.care_episodes e join public.cases c on c.id=e.case_id
  where e.case_id=p_case_id and e.status='active' and e.deleted_at is null
    and c.case_status not in ('closed','archived') and c.deleted_at is null for update of e,c;
  if not found then raise exception using errcode='P0001',message='An active care episode is required'; end if;
  select s.id into v_series_id from public.procedure_series s
    where s.episode_id=v_episode_id and s.procedure_type=p_procedure_type and s.status='active' and s.deleted_at is null
    order by s.series_number desc limit 1 for update;
  if v_series_id is null then
    insert into public.procedure_series(case_id,episode_id,series_number,procedure_type,created_by_user_id,updated_by_user_id)
    select p_case_id,v_episode_id,coalesce(max(s.series_number),0)+1,p_procedure_type,v_actor,v_actor
    from public.procedure_series s where s.episode_id=v_episode_id returning id into v_series_id;
  end if;
  select coalesce(max(p.procedure_number),0)+1 into v_number from public.procedures p where p.procedure_series_id=v_series_id and p.deleted_at is null;
  insert into public.procedures(case_id,episode_id,procedure_series_id,provider_profile_id,procedure_date,procedure_name,
    procedure_type,procedure_number,sites,injection_site,diagnoses,consent_obtained,blood_draw_volume_ml,
    centrifuge_duration_min,prep_protocol,kit_lot_number,anesthetic_agent,anesthetic_dose_ml,patient_tolerance,
    injection_volume_ml,needle_gauge,guidance_method,target_structure,complications,supplies_used,compression_bandage,
    activity_restriction_hrs,plan_deviation_reason,botox_dosing,created_by_user_id,updated_by_user_id)
  values(p_case_id,v_episode_id,v_series_id,v_provider_id,(p_procedure->>'procedure_date')::date,
    p_procedure->>'procedure_name',p_procedure_type,v_number,coalesce(p_procedure->'sites','[]'::jsonb),
    nullif(p_procedure->>'injection_site',''),coalesce(p_procedure->'diagnoses','[]'::jsonb),
    (p_procedure->>'consent_obtained')::boolean,(p_procedure->>'blood_draw_volume_ml')::numeric,
    (p_procedure->>'centrifuge_duration_min')::integer,nullif(p_procedure->>'prep_protocol',''),
    nullif(p_procedure->>'kit_lot_number',''),nullif(p_procedure->>'anesthetic_agent',''),
    (p_procedure->>'anesthetic_dose_ml')::numeric,nullif(p_procedure->>'patient_tolerance',''),
    (p_procedure->>'injection_volume_ml')::numeric,nullif(p_procedure->>'needle_gauge',''),
    nullif(p_procedure->>'guidance_method',''),nullif(p_procedure->>'target_structure',''),
    nullif(p_procedure->>'complications',''),nullif(p_procedure->>'supplies_used',''),
    (p_procedure->>'compression_bandage')::boolean,(p_procedure->>'activity_restriction_hrs')::integer,
    nullif(p_procedure->>'plan_deviation_reason',''),p_procedure->'botox_dosing',v_actor,v_actor)
  returning id into v_procedure_id;
  if p_vitals is not null and p_vitals<>'{}'::jsonb then
    insert into public.vital_signs(case_id,procedure_id,bp_systolic,bp_diastolic,heart_rate,respiratory_rate,
      temperature_f,spo2_percent,pain_score_min,pain_score_max,created_by_user_id,updated_by_user_id)
    values(p_case_id,v_procedure_id,(p_vitals->>'bp_systolic')::integer,(p_vitals->>'bp_diastolic')::integer,
      (p_vitals->>'heart_rate')::integer,(p_vitals->>'respiratory_rate')::integer,(p_vitals->>'temperature_f')::numeric,
      (p_vitals->>'spo2_percent')::integer,(p_vitals->>'pain_score_min')::integer,(p_vitals->>'pain_score_max')::integer,v_actor,v_actor);
  end if;
  update public.operation_idempotency set status='completed',case_id=p_case_id,episode_id=v_episode_id,
    procedure_id=v_procedure_id,result=jsonb_build_object('procedure_id',v_procedure_id,'procedure_number',v_number),
    completed_at=now() where id=v_op.id;
  return jsonb_build_object('procedure_id',v_procedure_id,'procedure_number',v_number,'replayed',false);
end
$$;
