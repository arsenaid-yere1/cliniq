-- Therapeutic BOTOX procedure type.
-- Widens the procedure_type CHECK on procedures + procedure_defaults to include
-- 'botox', and adds a nullable botox_dosing jsonb column for product/vial/units.
-- Additive & non-breaking: existing PRP rows leave botox_dosing null and keep
-- validating under the widened constraint.
--
-- The original constraints (20260503) were added inline via `add column ... check(...)`,
-- so their names are Postgres-auto-generated. Drop them by discovering the name
-- from pg_constraint rather than guessing, then re-add named constraints.

do $$
declare
  c record;
begin
  for c in
    select conrelid::regclass::text as tbl, conname
    from pg_constraint
    where conrelid in ('public.procedures'::regclass, 'public.procedure_defaults'::regclass)
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%procedure_type%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;

-- Re-add as explicitly-named constraints including 'botox'.
alter table public.procedures
  add constraint procedures_procedure_type_check
  check (procedure_type in ('prp', 'cortisone', 'hyaluronic', 'botox'));

alter table public.procedure_defaults
  add constraint procedure_defaults_procedure_type_check
  check (procedure_type in ('prp', 'cortisone', 'hyaluronic', 'botox'));

-- BOTOX dosing block (product / NDC / lot / expiration / reconstitution / units).
-- Nullable — only populated for procedure_type = 'botox'.
alter table public.procedures
  add column if not exists botox_dosing jsonb;

comment on column public.procedures.botox_dosing is
  'BOTOX (onabotulinumtoxinA) dosing: product_name, ndc, lot_number, expiration, '
  'reconstitution_units, reconstitution_diluent_ml, units_administered, units_discarded. '
  'Null for non-botox procedures.';
