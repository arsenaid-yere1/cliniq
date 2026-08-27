-- Hard-delete every pain follow-up visit and procedure workflow record for one case.
-- Intentionally preserves the case, care episodes, initial/discharge visits, and invoices.
-- Generated document rows are removed, but objects in Supabase Storage are not touched.

begin;

do $$
begin
  if not exists (
    select 1
    from public.cases
    where id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  ) then
    raise exception 'Case 9a49c0a2-9464-4ae2-8174-620a1932acd8 does not exist';
  end if;
end
$$;

create temp table cleanup_followup_encounters on commit drop as
select id
from public.clinical_encounters
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  and encounter_type = 'pain_follow_up';

create temp table cleanup_procedures on commit drop as
select id
from public.procedures
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid;

create temp table cleanup_procedure_orders on commit drop as
select id
from public.procedure_orders
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid;

create temp table cleanup_procedure_appointments on commit drop as
select id
from public.procedure_appointments
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid;

create temp table cleanup_documents on commit drop as
select document_id as id
from public.pain_follow_up_notes
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  and document_id is not null
union
select document_id
from public.procedure_notes
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  and document_id is not null
union
select id
from public.documents
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  and encounter_id in (select id from cleanup_followup_encounters);

-- Remove billing links before their encounter/procedure parents. Invoices remain.
delete from public.billing_source_claims
where encounter_id in (select id from cleanup_followup_encounters)
   or procedure_id in (select id from cleanup_procedures);

delete from public.invoice_line_items
where encounter_id in (select id from cleanup_followup_encounters)
   or procedure_id in (select id from cleanup_procedures);

-- Remove idempotency records that could replay a deleted workflow.
delete from public.operation_idempotency
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  and (
    operation_type = 'start_return_episode'
    or procedure_id in (select id from cleanup_procedures)
    or procedure_order_id in (select id from cleanup_procedure_orders)
    or procedure_appointment_id in (select id from cleanup_procedure_appointments)
  );

delete from public.vital_signs
where procedure_id in (select id from cleanup_procedures)
   or encounter_id in (select id from cleanup_followup_encounters);

delete from public.procedure_notes
where procedure_id in (select id from cleanup_procedures);

delete from public.pain_follow_up_notes
where encounter_id in (select id from cleanup_followup_encounters);

delete from public.clinical_orders
where encounter_id in (select id from cleanup_followup_encounters);

delete from public.documents
where id in (select id from cleanup_documents);

delete from public.procedures
where id in (select id from cleanup_procedures);

delete from public.procedure_appointments
where id in (select id from cleanup_procedure_appointments);

delete from public.procedure_orders
where id in (select id from cleanup_procedure_orders);

delete from public.procedure_series
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid;

delete from public.clinical_encounters
where id in (select id from cleanup_followup_encounters);

-- Abort the transaction if any requested records remain.
do $$
begin
  if exists (
    select 1 from public.clinical_encounters
    where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
      and encounter_type = 'pain_follow_up'
  ) or exists (
    select 1 from public.pain_follow_up_notes
    where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  ) or exists (
    select 1 from public.procedures
    where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  ) or exists (
    select 1 from public.procedure_orders
    where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  ) or exists (
    select 1 from public.procedure_appointments
    where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  ) or exists (
    select 1 from public.procedure_series
    where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  ) then
    raise exception 'Cleanup verification failed; transaction rolled back';
  end if;
end
$$;

commit;
