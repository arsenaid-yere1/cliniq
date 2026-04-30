-- Backfill procedures.diagnoses to match the deterministic rewrite added at
-- the action layer (createPrpProcedure / updatePrpProcedure). Targets rows
-- persisted before that change.
--
-- Two passes:
--   (1) procedure_number >= 2: strip V/W/X/Y external-cause codes AND rewrite
--       A-suffix → D-suffix (with description "initial encounter" →
--       "subsequent encounter").
--   (2) procedure_number = 1: strip V/W/X/Y only. A-suffix permitted on
--       first procedure (intake encounter) per Filter (D).
--
-- Idempotent: re-running is a no-op because rewritten rows no longer match
-- the WHERE clauses.

create or replace function _backfill_rewrite_diagnoses(
  diagnoses jsonb,
  procedure_number int
) returns jsonb language plpgsql as $$
declare
  result jsonb := '[]'::jsonb;
  item jsonb;
  code text;
  desc_text text;
  new_code text;
  new_desc text;
begin
  if diagnoses is null or jsonb_typeof(diagnoses) <> 'array' then
    return diagnoses;
  end if;

  for item in select * from jsonb_array_elements(diagnoses) loop
    code := upper(trim(item->>'icd10_code'));
    desc_text := coalesce(item->>'description', '');

    -- Strip external-cause V/W/X/Y on every procedure note.
    if code ~ '^[VWXY][0-9]{2}' then
      continue;
    end if;

    -- A→D rewrite for procedure_number >= 2 only.
    if procedure_number >= 2
       and code ~ '^[A-Z][0-9]{2}\.[A-Z0-9]{1,4}A$'
    then
      new_code := substring(code from 1 for length(code) - 1) || 'D';
      new_desc := regexp_replace(
        desc_text,
        'initial encounter',
        'subsequent encounter',
        'gi'
      );
    else
      new_code := code;
      new_desc := desc_text;
    end if;

    result := result || jsonb_build_array(
      jsonb_build_object(
        'icd10_code', new_code,
        'description', new_desc
      )
    );
  end loop;

  return result;
end;
$$;

-- Pass 1: procedure_number >= 2 — A→D + V/W/X/Y strip.
update public.procedures
set diagnoses = _backfill_rewrite_diagnoses(diagnoses, procedure_number),
    updated_at = now()
where procedure_number >= 2
  and diagnoses is not null
  and (
    diagnoses @? '$[*] ? (@.icd10_code like_regex "^[VWXY][0-9]{2}")'
    or
    diagnoses @? '$[*] ? (@.icd10_code like_regex "^[A-Z][0-9]{2}\\.[A-Z0-9]{1,4}A$")'
  );

-- Pass 2: procedure_number = 1 — V/W/X/Y strip only.
update public.procedures
set diagnoses = _backfill_rewrite_diagnoses(diagnoses, procedure_number),
    updated_at = now()
where procedure_number = 1
  and diagnoses is not null
  and diagnoses @? '$[*] ? (@.icd10_code like_regex "^[VWXY][0-9]{2}")';

drop function _backfill_rewrite_diagnoses(jsonb, int);
