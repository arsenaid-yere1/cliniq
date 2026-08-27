begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '11000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'invoice-rpc@test.local', '',
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.patients (id, first_name, last_name, date_of_birth)
values ('21000000-0000-4000-8000-000000000001', 'Invoice', 'Patient', '1980-01-01');

insert into public.cases (id, case_number, patient_id, case_status)
values (
  '31000000-0000-4000-8000-000000000001',
  'INVOICE-RPC-TEST',
  '21000000-0000-4000-8000-000000000001',
  'active'
);

select set_config('request.jwt.claim.sub', '11000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
  $$select public.save_invoice_with_claims(
    '31000000-0000-4000-8000-000000000001',
    null,
    jsonb_build_object(
      'invoice_type', 'visit',
      'invoice_date', '2026-08-27',
      'claim_type', 'Personal Injury',
      'diagnoses_snapshot', '[]'::jsonb,
      'total_amount', 150
    ),
    jsonb_build_array(jsonb_build_object(
      'procedure_id', null,
      'encounter_id', null,
      'service_date', '2026-08-27',
      'cpt_code', '99213',
      'description', 'Pain management follow-up visit',
      'quantity', 1,
      'unit_price', 150,
      'total_price', 150,
      'display_order', 0
    ))
  )$$,
  'invoice creation resolves the schema-qualified invoice number sequence'
);

select results_eq(
  $$select count(*)::integer from public.invoices
    where case_id = '31000000-0000-4000-8000-000000000001'$$,
  $$values (1)$$,
  'the invoice is created'
);

select ok(
  (select invoice_number ~ '^INV-[0-9]{4}-[0-9]{4,}$'
   from public.invoices
   where case_id = '31000000-0000-4000-8000-000000000001'),
  'the invoice receives a generated invoice number'
);

select results_eq(
  $$select count(*)::integer
    from public.invoice_line_items line
    join public.invoices invoice on invoice.id = line.invoice_id
    where invoice.case_id = '31000000-0000-4000-8000-000000000001'$$,
  $$values (1)$$,
  'the invoice line is created'
);

select * from finish();
rollback;
