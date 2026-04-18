alter table public.procedures
  add column site_count integer not null default 1
  check (site_count >= 1);
