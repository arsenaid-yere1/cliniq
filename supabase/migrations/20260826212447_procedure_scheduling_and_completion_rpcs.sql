-- Phases 4 and 5 procedure scheduling and completion functions.

alter table public.procedure_orders add column cancellation_reason text;

create or replace function public.save_invoice_with_claims(
  p_case_id uuid, p_invoice_id uuid, p_invoice jsonb, p_lines jsonb
)
returns uuid language plpgsql security invoker set search_path = ''
as $$
declare v_actor uuid:=auth.uid(); v_invoice_id uuid:=p_invoice_id; v_line jsonb; v_invoice_type text;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception using errcode='22023',message='At least one invoice line is required'; end if;
  v_invoice_type:=p_invoice->>'invoice_type';
  if p_invoice_id is null then
    insert into public.invoices(case_id,invoice_type,invoice_date,claim_type,indication,diagnoses_snapshot,
      payee_name,payee_address,notes,total_amount,status,created_by_user_id,updated_by_user_id)
    values(p_case_id,v_invoice_type,(p_invoice->>'invoice_date')::date,coalesce(p_invoice->>'claim_type','Personal Injury'),
      nullif(p_invoice->>'indication',''),coalesce(p_invoice->'diagnoses_snapshot','[]'::jsonb),nullif(p_invoice->>'payee_name',''),
      nullif(p_invoice->>'payee_address',''),nullif(p_invoice->>'notes',''),(p_invoice->>'total_amount')::numeric,'draft',v_actor,v_actor)
    returning id into v_invoice_id;
  else
    perform 1 from public.invoices i where i.id=p_invoice_id and i.case_id=p_case_id and i.status='draft' and i.deleted_at is null for update;
    if not found then raise exception using errcode='P0001',message='Only a draft invoice can be edited'; end if;
    update public.invoices set invoice_type=v_invoice_type,invoice_date=(p_invoice->>'invoice_date')::date,
      claim_type=coalesce(p_invoice->>'claim_type','Personal Injury'),indication=nullif(p_invoice->>'indication',''),
      diagnoses_snapshot=coalesce(p_invoice->'diagnoses_snapshot','[]'::jsonb),payee_name=nullif(p_invoice->>'payee_name',''),
      payee_address=nullif(p_invoice->>'payee_address',''),notes=nullif(p_invoice->>'notes',''),
      total_amount=(p_invoice->>'total_amount')::numeric,updated_by_user_id=v_actor where id=v_invoice_id;
    update public.billing_source_claims set released_at=now(),release_reason='invoice edited',updated_by_user_id=v_actor
      where invoice_id=v_invoice_id and released_at is null;
    delete from public.invoice_line_items where invoice_id=v_invoice_id;
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into public.invoice_line_items(invoice_id,procedure_id,encounter_id,service_date,cpt_code,description,quantity,unit_price,total_price,display_order)
    values(v_invoice_id,nullif(v_line->>'procedure_id','')::uuid,nullif(v_line->>'encounter_id','')::uuid,(v_line->>'service_date')::date,
      v_line->>'cpt_code',v_line->>'description',(v_line->>'quantity')::integer,(v_line->>'unit_price')::numeric,
      (v_line->>'total_price')::numeric,(v_line->>'display_order')::integer);
    if nullif(v_line->>'encounter_id','') is not null then
      insert into public.billing_source_claims(invoice_id,encounter_id,claim_kind,created_by_user_id,updated_by_user_id)
      values(v_invoice_id,(v_line->>'encounter_id')::uuid,'visit',v_actor,v_actor);
    elsif nullif(v_line->>'procedure_id','') is not null then
      insert into public.billing_source_claims(invoice_id,procedure_id,claim_kind,created_by_user_id,updated_by_user_id)
      values(v_invoice_id,(v_line->>'procedure_id')::uuid,case when v_invoice_type='facility' then 'facility' else 'medical' end,v_actor,v_actor);
    end if;
  end loop;
  return v_invoice_id;
end
$$;

create or replace function public.release_invoice_claims_on_close()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (new.status='void' and old.status is distinct from 'void') or (new.deleted_at is not null and old.deleted_at is null) then
    update public.billing_source_claims set released_at=now(),release_reason=case when new.status='void' then 'invoice voided' else 'invoice deleted' end,
      updated_by_user_id=coalesce(new.updated_by_user_id,auth.uid()) where invoice_id=new.id and released_at is null;
  end if;
  return new;
end $$;
create trigger invoices_release_claims_trg after update of status,deleted_at on public.invoices
  for each row execute function public.release_invoice_claims_on_close();

revoke execute on function public.save_invoice_with_claims(uuid,uuid,jsonb,jsonb) from public,anon;
grant execute on function public.save_invoice_with_claims(uuid,uuid,jsonb,jsonb) to authenticated;

create or replace function public.create_procedure_order_from_recommendation(
  p_case_id uuid, p_episode_id uuid, p_source_encounter_id uuid,
  p_recommendation_id uuid, p_procedure_type text, p_sites jsonb,
  p_diagnoses jsonb, p_rationale text, p_priority text,
  p_continued_from_series_id uuid default null
)
returns public.procedure_orders
language plpgsql security invoker set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_series_id uuid;
  v_series_number integer;
  v_order public.procedure_orders%rowtype;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  perform 1 from public.care_episodes e join public.cases c on c.id = e.case_id
  where e.id = p_episode_id and e.case_id = p_case_id and e.status = 'active' and e.deleted_at is null
    and c.case_status not in ('closed', 'archived') and c.deleted_at is null for update of e, c;
  if not found then raise exception using errcode = 'P0001', message = 'Care episode is not writable'; end if;
  if not exists (
    select 1 from public.clinical_encounters e
    join public.pain_follow_up_notes n on n.encounter_id = e.id and n.episode_id = e.episode_id
    cross join lateral jsonb_array_elements(n.procedure_recommendations) recommendation
    where e.id = p_source_encounter_id and e.case_id = p_case_id and e.episode_id = p_episode_id
      and e.status = 'completed' and e.deleted_at is null and n.status = 'finalized' and n.deleted_at is null
      and recommendation ->> 'recommendation_id' = p_recommendation_id::text
      and recommendation ->> 'procedure_type' = p_procedure_type
  ) then raise exception using errcode = 'P0001', message = 'A finalized recommendation is required'; end if;
  if p_continued_from_series_id is not null and not exists (
    select 1 from public.procedure_series s where s.id = p_continued_from_series_id
      and s.case_id = p_case_id and s.episode_id <> p_episode_id and s.deleted_at is null
  ) then raise exception using errcode = '23503', message = 'Prior series is invalid'; end if;

  select coalesce(max(s.series_number), 0) + 1 into v_series_number
  from public.procedure_series s where s.episode_id = p_episode_id;
  insert into public.procedure_series (
    case_id, episode_id, series_number, procedure_type, continued_from_series_id,
    created_by_user_id, updated_by_user_id
  ) values (
    p_case_id, p_episode_id, v_series_number, p_procedure_type, p_continued_from_series_id,
    v_actor, v_actor
  ) returning id into v_series_id;
  insert into public.procedure_orders (
    case_id, episode_id, source_encounter_id, source_recommendation_id,
    procedure_series_id, procedure_type, sites, diagnoses, clinical_rationale,
    priority, created_by_user_id, updated_by_user_id
  ) values (
    p_case_id, p_episode_id, p_source_encounter_id, p_recommendation_id,
    v_series_id, p_procedure_type, p_sites, p_diagnoses, btrim(p_rationale),
    p_priority, v_actor, v_actor
  ) returning * into v_order;
  return v_order;
end
$$;

create or replace function public.schedule_procedure_appointment(
  p_order_id uuid, p_scheduled_start timestamptz, p_scheduled_end timestamptz,
  p_provider_id uuid, p_location text, p_notes text, p_idempotency_key text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_actor uuid := auth.uid(); v_order public.procedure_orders%rowtype;
  v_appointment_id uuid; v_hash text; v_op public.operation_idempotency%rowtype;
begin
  if v_actor is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if p_scheduled_end <= p_scheduled_start then raise exception using errcode = '22023', message = 'Scheduled end must be after scheduled start'; end if;
  v_hash := md5(jsonb_build_array(p_order_id,p_scheduled_start,p_scheduled_end,p_provider_id,p_location,p_notes)::text);
  insert into public.operation_idempotency(actor_id,operation_type,client_key,input_hash,status)
    values(v_actor,'schedule_procedure',btrim(p_idempotency_key),v_hash,'pending') on conflict do nothing;
  select * into v_op from public.operation_idempotency where actor_id=v_actor and operation_type='schedule_procedure'
    and client_key=btrim(p_idempotency_key) for update;
  if v_op.input_hash <> v_hash then raise exception using errcode='22023',message='Idempotency key was already used with different input'; end if;
  if v_op.status='completed' then return v_op.result || jsonb_build_object('replayed',true); end if;
  select * into v_order from public.procedure_orders where id=p_order_id and status='ordered' and deleted_at is null for update;
  if not found then raise exception using errcode='P0001',message='Procedure order is not available to schedule'; end if;
  if not exists(select 1 from public.care_episodes e join public.cases c on c.id=e.case_id
      where e.id=v_order.episode_id and e.case_id=v_order.case_id and e.status='active' and e.deleted_at is null
        and c.case_status not in ('closed','archived') and c.deleted_at is null)
  then raise exception using errcode='P0001',message='Care episode is not writable'; end if;
  if not exists(select 1 from public.provider_profiles p where p.id=p_provider_id and p.deleted_at is null)
  then raise exception using errcode='23503',message='Provider is not active'; end if;
  insert into public.procedure_appointments(case_id,episode_id,procedure_order_id,scheduled_start,scheduled_end,
    provider_id,location,notes,created_by_user_id,updated_by_user_id)
  values(v_order.case_id,v_order.episode_id,p_order_id,p_scheduled_start,p_scheduled_end,p_provider_id,
    nullif(btrim(p_location),''),nullif(btrim(p_notes),''),v_actor,v_actor) returning id into v_appointment_id;
  update public.procedure_orders set status='scheduled',updated_by_user_id=v_actor where id=p_order_id;
  update public.operation_idempotency set status='completed',case_id=v_order.case_id,episode_id=v_order.episode_id,
    procedure_order_id=p_order_id,procedure_appointment_id=v_appointment_id,
    result=jsonb_build_object('appointment_id',v_appointment_id),completed_at=now() where id=v_op.id;
  return jsonb_build_object('appointment_id',v_appointment_id,'replayed',false);
end
$$;

create or replace function public.reschedule_procedure_appointment(
  p_appointment_id uuid, p_scheduled_start timestamptz, p_scheduled_end timestamptz,
  p_provider_id uuid, p_location text, p_notes text, p_idempotency_key text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_old public.procedure_appointments%rowtype; v_new_id uuid; v_actor uuid:=auth.uid();
  v_hash text; v_op public.operation_idempotency%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if p_scheduled_end <= p_scheduled_start then raise exception using errcode='22023',message='Scheduled end must be after scheduled start'; end if;
  v_hash:=md5(jsonb_build_array(p_appointment_id,p_scheduled_start,p_scheduled_end,p_provider_id,p_location,p_notes)::text);
  insert into public.operation_idempotency(actor_id,operation_type,client_key,input_hash,status)
    values(v_actor,'reschedule_procedure',btrim(p_idempotency_key),v_hash,'pending') on conflict do nothing;
  select * into v_op from public.operation_idempotency where actor_id=v_actor
    and operation_type='reschedule_procedure' and client_key=btrim(p_idempotency_key) for update;
  if v_op.input_hash<>v_hash then raise exception using errcode='22023',message='Idempotency key was already used with different input'; end if;
  if v_op.status='completed' then return v_op.result||jsonb_build_object('replayed',true); end if;
  select * into v_old from public.procedure_appointments where id=p_appointment_id and status='scheduled' and deleted_at is null for update;
  if not found then
    raise exception using errcode='P0001',message='Appointment is not available to reschedule';
  end if;
  if not exists(select 1 from public.provider_profiles p where p.id=p_provider_id and p.deleted_at is null)
  then raise exception using errcode='23503',message='Provider is not active'; end if;
  if not exists(select 1 from public.care_episodes e join public.cases c on c.id=e.case_id
    where e.id=v_old.episode_id and e.case_id=v_old.case_id and e.status='active' and e.deleted_at is null
      and c.case_status not in ('closed','archived') and c.deleted_at is null)
  then raise exception using errcode='P0001',message='Care episode is not writable'; end if;
  update public.procedure_appointments set status='cancelled',cancellation_reason='rescheduled',updated_by_user_id=v_actor where id=p_appointment_id;
  insert into public.procedure_appointments(case_id,episode_id,procedure_order_id,scheduled_start,scheduled_end,provider_id,location,notes,created_by_user_id,updated_by_user_id)
    values(v_old.case_id,v_old.episode_id,v_old.procedure_order_id,p_scheduled_start,p_scheduled_end,p_provider_id,nullif(btrim(p_location),''),nullif(btrim(p_notes),''),v_actor,v_actor)
    returning id into v_new_id;
  update public.operation_idempotency set status='completed',case_id=v_old.case_id,episode_id=v_old.episode_id,
    procedure_order_id=v_old.procedure_order_id,procedure_appointment_id=v_new_id,
    result=jsonb_build_object('appointment_id',v_new_id),completed_at=now()
    where id=v_op.id;
  return jsonb_build_object('appointment_id',v_new_id,'replayed',false);
end
$$;

create or replace function public.close_procedure_appointment(
  p_appointment_id uuid, p_status text, p_reason text, p_idempotency_key text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_actor uuid:=auth.uid(); v_appt public.procedure_appointments%rowtype;
  v_hash text; v_op public.operation_idempotency%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if p_status not in ('cancelled','no_show') or length(btrim(coalesce(p_reason,'')))=0
  then raise exception using errcode='22023',message='A valid status and reason are required'; end if;
  v_hash:=md5(jsonb_build_array(p_appointment_id,p_status,p_reason)::text);
  insert into public.operation_idempotency(actor_id,operation_type,client_key,input_hash,status)
    values(v_actor,'close_procedure_appointment',btrim(p_idempotency_key),v_hash,'pending') on conflict do nothing;
  select * into v_op from public.operation_idempotency where actor_id=v_actor
    and operation_type='close_procedure_appointment' and client_key=btrim(p_idempotency_key) for update;
  if v_op.input_hash<>v_hash then raise exception using errcode='22023',message='Idempotency key was already used with different input'; end if;
  if v_op.status='completed' then return v_op.result||jsonb_build_object('replayed',true); end if;
  select * into v_appt from public.procedure_appointments where id=p_appointment_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Appointment not found'; end if;
  if v_appt.status=p_status then
    update public.operation_idempotency set status='completed',case_id=v_appt.case_id,episode_id=v_appt.episode_id,
      procedure_order_id=v_appt.procedure_order_id,procedure_appointment_id=p_appointment_id,
      result=jsonb_build_object('appointment_id',p_appointment_id),completed_at=now() where id=v_op.id;
    return jsonb_build_object('appointment_id',p_appointment_id,'replayed',true);
  end if;
  if v_appt.status<>'scheduled' then raise exception using errcode='P0001',message='Appointment transition is not allowed'; end if;
  if not exists(select 1 from public.care_episodes e join public.cases c on c.id=e.case_id
    where e.id=v_appt.episode_id and e.case_id=v_appt.case_id and e.status='active' and e.deleted_at is null
      and c.case_status not in ('closed','archived') and c.deleted_at is null)
  then raise exception using errcode='P0001',message='Care episode is not writable'; end if;
  update public.procedure_appointments set status=p_status,cancellation_reason=btrim(p_reason),updated_by_user_id=v_actor where id=p_appointment_id;
  update public.procedure_orders set status='ordered',updated_by_user_id=v_actor where id=v_appt.procedure_order_id and status='scheduled';
  update public.operation_idempotency set status='completed',case_id=v_appt.case_id,episode_id=v_appt.episode_id,
    procedure_order_id=v_appt.procedure_order_id,procedure_appointment_id=p_appointment_id,
    result=jsonb_build_object('appointment_id',p_appointment_id),completed_at=now() where id=v_op.id;
  return jsonb_build_object('appointment_id',p_appointment_id,'replayed',false);
end
$$;

create or replace function public.cancel_procedure_order(
  p_order_id uuid, p_reason text, p_idempotency_key text
)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare v_actor uuid:=auth.uid(); v_order public.procedure_orders%rowtype;
  v_hash text; v_op public.operation_idempotency%rowtype;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication required'; end if;
  if length(btrim(coalesce(p_reason,'')))=0 then raise exception using errcode='22023',message='Cancellation reason is required'; end if;
  v_hash:=md5(jsonb_build_array(p_order_id,p_reason)::text);
  insert into public.operation_idempotency(actor_id,operation_type,client_key,input_hash,status)
    values(v_actor,'cancel_procedure_order',btrim(p_idempotency_key),v_hash,'pending') on conflict do nothing;
  select * into v_op from public.operation_idempotency where actor_id=v_actor
    and operation_type='cancel_procedure_order' and client_key=btrim(p_idempotency_key) for update;
  if v_op.input_hash<>v_hash then raise exception using errcode='22023',message='Idempotency key was already used with different input'; end if;
  if v_op.status='completed' then return v_op.result||jsonb_build_object('replayed',true); end if;
  select * into v_order from public.procedure_orders where id=p_order_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Procedure order not found'; end if;
  if v_order.status='completed' then raise exception using errcode='P0001',message='Completed orders cannot be cancelled'; end if;
  if v_order.status<>'cancelled' then
    if not exists(select 1 from public.care_episodes e join public.cases c on c.id=e.case_id
      where e.id=v_order.episode_id and e.case_id=v_order.case_id and e.status='active' and e.deleted_at is null
        and c.case_status not in ('closed','archived') and c.deleted_at is null)
    then raise exception using errcode='P0001',message='Care episode is not writable'; end if;
    update public.procedure_appointments set status='cancelled',cancellation_reason=btrim(p_reason),updated_by_user_id=v_actor
      where procedure_order_id=p_order_id and status='scheduled' and deleted_at is null;
    update public.procedure_orders set status='cancelled',cancellation_reason=btrim(p_reason),updated_by_user_id=v_actor
      where id=p_order_id;
  end if;
  update public.operation_idempotency set status='completed',case_id=v_order.case_id,episode_id=v_order.episode_id,
    procedure_order_id=p_order_id,result=jsonb_build_object('order_id',p_order_id),completed_at=now() where id=v_op.id;
  return jsonb_build_object('order_id',p_order_id,'replayed',false);
end
$$;

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
    where p.procedure_series_id=v_order.procedure_series_id;
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
  select coalesce(max(p.procedure_number),0)+1 into v_number from public.procedures p where p.procedure_series_id=v_series_id;
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

create or replace function public.delete_performed_procedure(p_case_id uuid,p_procedure_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_actor uuid:=auth.uid();v_proc public.procedures%rowtype;v_document_id uuid;
begin
  if v_actor is null then raise exception using errcode='42501',message='Authentication required';end if;
  select * into v_proc from public.procedures where id=p_procedure_id and case_id=p_case_id and deleted_at is null for update;
  if not found then raise exception using errcode='P0002',message='Procedure not found';end if;
  if exists(select 1 from public.procedure_notes n where n.procedure_id=p_procedure_id and n.status='finalized' and n.deleted_at is null)
    or exists(select 1 from public.invoice_line_items l join public.invoices i on i.id=l.invoice_id
      where l.procedure_id=p_procedure_id and i.status<>'void' and i.deleted_at is null)
  then raise exception using errcode='P0001',message='Finalized or billed procedures cannot be deleted';end if;
  select document_id into v_document_id from public.procedure_notes where procedure_id=p_procedure_id and deleted_at is null;
  update public.procedure_notes set deleted_at=now(),updated_by_user_id=v_actor where procedure_id=p_procedure_id and deleted_at is null;
  update public.documents set deleted_at=now(),updated_by_user_id=v_actor where id=v_document_id;
  update public.vital_signs set deleted_at=now(),updated_by_user_id=v_actor where procedure_id=p_procedure_id and deleted_at is null;
  update public.procedures set deleted_at=now(),updated_by_user_id=v_actor where id=p_procedure_id;
  if v_proc.procedure_appointment_id is not null then
    update public.procedure_appointments set status='scheduled',completed_at=null,updated_by_user_id=v_actor where id=v_proc.procedure_appointment_id;
    update public.procedure_orders set status='scheduled',updated_by_user_id=v_actor
      where id=(select procedure_order_id from public.procedure_appointments where id=v_proc.procedure_appointment_id);
  end if;
  return jsonb_build_object('document_id',v_document_id,'appointment_id',v_proc.procedure_appointment_id);
end $$;

revoke execute on function public.create_procedure_order_from_recommendation(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text,uuid) from public,anon;
revoke execute on function public.schedule_procedure_appointment(uuid,timestamptz,timestamptz,uuid,text,text,text) from public,anon;
revoke execute on function public.reschedule_procedure_appointment(uuid,timestamptz,timestamptz,uuid,text,text,text) from public,anon;
revoke execute on function public.close_procedure_appointment(uuid,text,text,text) from public,anon;
revoke execute on function public.cancel_procedure_order(uuid,text,text) from public,anon;
revoke execute on function public.complete_procedure_appointment(uuid,jsonb,jsonb,text) from public,anon;
revoke execute on function public.create_direct_episode_procedure(uuid,text,jsonb,jsonb,text) from public,anon;
revoke execute on function public.delete_performed_procedure(uuid,uuid) from public,anon;
grant execute on function public.create_procedure_order_from_recommendation(uuid,uuid,uuid,uuid,text,jsonb,jsonb,text,text,uuid) to authenticated;
grant execute on function public.schedule_procedure_appointment(uuid,timestamptz,timestamptz,uuid,text,text,text) to authenticated;
grant execute on function public.reschedule_procedure_appointment(uuid,timestamptz,timestamptz,uuid,text,text,text) to authenticated;
grant execute on function public.close_procedure_appointment(uuid,text,text,text) to authenticated;
grant execute on function public.cancel_procedure_order(uuid,text,text) to authenticated;
grant execute on function public.complete_procedure_appointment(uuid,jsonb,jsonb,text) to authenticated;
grant execute on function public.create_direct_episode_procedure(uuid,text,jsonb,jsonb,text) to authenticated;
grant execute on function public.delete_performed_procedure(uuid,uuid) to authenticated;
