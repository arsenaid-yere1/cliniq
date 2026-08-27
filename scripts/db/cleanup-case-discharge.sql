-- Hard-delete every discharge visit record for one case and reopen its episode.
-- Intentionally preserves the case, non-discharge encounters, and invoice headers.
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

create temp table cleanup_discharge_encounters on commit drop as
select id, episode_id
from public.clinical_encounters
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  and encounter_type = 'discharge';

create temp table cleanup_discharge_notes on commit drop as
select id, document_id
from public.discharge_notes
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid;

create temp table cleanup_discharge_documents on commit drop as
select document_id as id
from cleanup_discharge_notes
where document_id is not null
union
select id
from public.documents
where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  and encounter_id in (select id from cleanup_discharge_encounters);

delete from public.billing_source_claims
where encounter_id in (select id from cleanup_discharge_encounters);

delete from public.invoice_line_items
where encounter_id in (select id from cleanup_discharge_encounters);

delete from public.vital_signs
where encounter_id in (select id from cleanup_discharge_encounters);

delete from public.clinical_orders
where encounter_id in (select id from cleanup_discharge_encounters);

delete from public.discharge_note_corrections
where discharge_note_id in (select id from cleanup_discharge_notes);

delete from public.discharge_notes
where id in (select id from cleanup_discharge_notes);

delete from public.documents
where id in (select id from cleanup_discharge_documents);

delete from public.clinical_encounters
where id in (select id from cleanup_discharge_encounters);

update public.care_episodes
set
  status = 'active',
  ended_at = null,
  end_reason = null,
  updated_at = now()
where id in (select episode_id from cleanup_discharge_encounters)
  and case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  and status = 'discharged'
  and end_reason = 'finalized_discharge';

-- Abort the transaction if discharge data remains or the affected episode is closed.
do $$
begin
  if exists (
    select 1
    from public.clinical_encounters
    where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
      and encounter_type = 'discharge'
  ) or exists (
    select 1
    from public.discharge_notes
    where case_id = '9a49c0a2-9464-4ae2-8174-620a1932acd8'::uuid
  ) or exists (
    select 1
    from public.care_episodes
    where id in (select episode_id from cleanup_discharge_encounters)
      and status = 'discharged'
  ) then
    raise exception 'Discharge cleanup verification failed; transaction rolled back';
  end if;
end
$$;

commit;
