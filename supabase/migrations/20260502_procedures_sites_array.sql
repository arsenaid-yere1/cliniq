-- Sites array on procedures: replaces scalar laterality + scalar
-- target_confirmed_imaging with structured per-site jsonb. Keeps
-- denormalized injection_site text + injection_volume_ml numeric for
-- back-compat with the ~13 downstream readers (PDF, billing,
-- plan-alignment, discharge LLM, procedure-table, procedure-note-editor,
-- generate-procedure-note input shape).

-- Add sites column (default empty so backfill can populate before constraint)
alter table public.procedures
  add column if not exists sites jsonb not null default '[]'::jsonb;

-- Backfill ALL rows (including soft-deleted) — the non-empty constraint
-- below applies to every row regardless of deleted_at. First site inherits
-- row's injection_volume_ml + target_confirmed_imaging; subsequent sites
-- get volume_ml=null, target_confirmed_imaging=null. All sites inherit
-- row's laterality.
update public.procedures
set sites = (
  with parts as (
    select
      trim(part) as label,
      ord
    from regexp_split_to_table(
      coalesce(injection_site, ''),
      '\s*(?:,|;|/|&|\+|\s+and\s+)\s*'
    ) with ordinality as t(part, ord)
    where trim(part) <> ''
  ),
  enriched as (
    select
      jsonb_build_object(
        'label', label,
        'laterality', laterality,
        'volume_ml', case when ord = 1 then injection_volume_ml else null end,
        'target_confirmed_imaging', case when ord = 1 then target_confirmed_imaging else null end
      ) as site
    from parts
  )
  select coalesce(jsonb_agg(site), '[]'::jsonb) from enriched
)
where jsonb_array_length(sites) = 0;

-- Defensive: any row that still has empty sites (empty injection_site or
-- injection_site is null) gets a placeholder so length >= 1 holds.
update public.procedures
set sites = jsonb_build_array(jsonb_build_object(
  'label', coalesce(nullif(injection_site, ''), '[unspecified]'),
  'laterality', laterality,
  'volume_ml', injection_volume_ml,
  'target_confirmed_imaging', target_confirmed_imaging
))
where jsonb_array_length(sites) = 0;

-- Enforce non-empty array now that backfill is done
alter table public.procedures
  drop constraint if exists procedures_sites_nonempty;
alter table public.procedures
  add constraint procedures_sites_nonempty
  check (jsonb_array_length(sites) >= 1);

-- Drop top-level laterality (5 readers migrated to lateralityFromSites
-- helper in same PR).
alter table public.procedures
  drop column if exists laterality;

-- Drop top-level target_confirmed_imaging (now per-site inside sites[]).
alter table public.procedures
  drop column if exists target_confirmed_imaging;
