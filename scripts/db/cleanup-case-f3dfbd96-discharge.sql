-- Hard-delete every discharge visit record for case
-- f3dfbd96-f2ca-4327-8453-c49e82391de5 and reopen its episode.
-- Invoice headers and non-discharge clinical records are preserved.
-- Storage objects are not touched; this is a database-only cleanup.

begin;

do $$
begin
  if not exists (
    select 1
    from public.cases
    where id = 'f3dfbd96-f2ca-4327-8453-c49e82391de5'::uuid
  ) then
    raise exception 'Case f3dfbd96-f2ca-4327-8453-c49e82391de5 does not exist';
  end if;
end
$$;

create temp table cleanup_discharge_encounters on commit drop as
select id, episode_id
from public.clinical_encounters
where case_id = 'f3dfbd96-f2ca-4327-8453-c49e82391de5'::uuid
  and encounter_type = 'discharge';

create temp table cleanup_discharge_notes on commit drop as
select id, document_id
from public.discharge_notes
where case_id = 'f3dfbd96-f2ca-4327-8453-c49e82391de5'::uuid;

create temp table cleanup_discharge_documents on commit drop as
select document_id as id
from cleanup_discharge_notes
where document_id is not null
union
select correction.original_document_id
from public.discharge_note_corrections correction
where correction.discharge_note_id in (select id from cleanup_discharge_notes)
union
select correction.replacement_document_id
from public.discharge_note_corrections correction
where correction.discharge_note_id in (select id from cleanup_discharge_notes)
  and correction.replacement_document_id is not null
union
select id
from public.documents
where case_id = 'f3dfbd96-f2ca-4327-8453-c49e82391de5'::uuid
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
  and case_id = 'f3dfbd96-f2ca-4327-8453-c49e82391de5'::uuid
  and status = 'discharged'
  and end_reason = 'finalized_discharge';

do $$
begin
  if exists (
    select 1
    from public.clinical_encounters
    where case_id = 'f3dfbd96-f2ca-4327-8453-c49e82391de5'::uuid
      and encounter_type = 'discharge'
  ) or exists (
    select 1
    from public.discharge_notes
    where case_id = 'f3dfbd96-f2ca-4327-8453-c49e82391de5'::uuid
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
