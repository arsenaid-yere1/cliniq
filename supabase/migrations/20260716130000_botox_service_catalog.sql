-- Seed BOTOX billing catalog entries read by the BOTOX invoice-line generation
-- (src/lib/billing/botox-lines.ts via billing.ts). Prices are the clinic's
-- current values (per the NPMD packet): $15/unit drug+admin, $200 flat facility.
-- Without these rows, billing falls back to the same $15 / $200 hard-coded
-- defaults; seeding them makes the prices catalog-editable.
--
-- Guarded with `where not exists` since service_catalog has no unique constraint
-- on cpt_code (a plain re-run must not duplicate the rows).

insert into public.service_catalog (cpt_code, description, default_price, sort_order)
select 'BOTOX-UNIT', 'BOTOX onabotulinumtoxinA per unit (drug + administration)', 15, 7
where not exists (
  select 1 from public.service_catalog
  where cpt_code = 'BOTOX-UNIT' and deleted_at is null
);

insert into public.service_catalog (cpt_code, description, default_price, sort_order)
select 'BOTOX-FACILITY', 'BOTOX procedure-room/site utilization and disposables', 200, 8
where not exists (
  select 1 from public.service_catalog
  where cpt_code = 'BOTOX-FACILITY' and deleted_at is null
);
