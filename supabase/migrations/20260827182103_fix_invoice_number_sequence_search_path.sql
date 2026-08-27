-- save_invoice_with_claims() intentionally runs with an empty search path.
-- Harden the legacy invoice-number trigger so it resolves its sequence in that
-- context instead of failing with 42P01.
create or replace function public.generate_invoice_number()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.invoice_number := 'INV-'
    || extract(year from now())::text
    || '-'
    || lpad(nextval('public.invoice_number_seq'::regclass)::text, 4, '0');
  return new;
end
$$;
