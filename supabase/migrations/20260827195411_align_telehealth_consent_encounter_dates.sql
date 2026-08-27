-- Consent is documented as part of the clinical encounter. Preserve the
-- captured UTC time, but align its calendar date with the encounter service
-- date so late entry and browser timezone conversion cannot create conflicting
-- dates in the chart.
create or replace function public.align_telehealth_consent_encounter_date()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_consent_at timestamptz;
begin
  if new.telehealth_consent_obtained is true and new.encounter_date is not null then
    v_consent_at := coalesce(new.telehealth_consent_at, now());
    new.telehealth_consent_at := (
      new.encounter_date::timestamp
      + (v_consent_at at time zone 'UTC')::time
    ) at time zone 'UTC';
  elsif new.telehealth_consent_obtained is distinct from true then
    new.telehealth_consent_at := null;
  end if;

  return new;
end
$$;

revoke execute on function public.align_telehealth_consent_encounter_date()
  from public, anon, authenticated;

create trigger clinical_encounters_align_telehealth_consent_date_trg
before insert or update of encounter_date, telehealth_consent_obtained, telehealth_consent_at
on public.clinical_encounters
for each row
execute function public.align_telehealth_consent_encounter_date();

update public.clinical_encounters
set telehealth_consent_at = (
  encounter_date::timestamp
  + coalesce(
      (telehealth_consent_at at time zone 'UTC')::time,
      time '12:00:00'
    )
) at time zone 'UTC'
where telehealth_consent_obtained is true
  and encounter_date is not null
  and (
    telehealth_consent_at is null
    or (telehealth_consent_at at time zone 'UTC')::date is distinct from encounter_date
  );

alter table public.clinical_encounters
  add constraint clinical_encounters_telehealth_consent_date_matches
  check (
    telehealth_consent_obtained is distinct from true
    or encounter_date is null
    or (
      telehealth_consent_at is not null
      and (telehealth_consent_at at time zone 'UTC')::date = encounter_date
    )
  ) not valid;

alter table public.clinical_encounters
  validate constraint clinical_encounters_telehealth_consent_date_matches;
