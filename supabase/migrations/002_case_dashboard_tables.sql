-- ============================================
-- DOCUMENTS TABLE
-- ============================================
create table public.documents (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id),
  document_type text not null check (document_type in ('mri_report', 'chiro_report', 'generated', 'other')),
  file_name text not null,
  file_path text not null,
  file_size_bytes bigint,
  mime_type text,
  status text not null default 'pending_review' check (status in ('pending_review', 'reviewed')),
  notes text,
  uploaded_by_user_id uuid references public.users(id),
  reviewed_by_user_id uuid references public.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id)
);

-- ============================================
-- PROCEDURES TABLE
-- ============================================
create table public.procedures (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id),
  procedure_date date not null,
  procedure_name text not null,
  cpt_code text,
  provider_id uuid references public.users(id),
  notes text,
  charge_amount numeric(10,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id)
);

-- ============================================
-- INVOICES TABLE
-- ============================================
create table public.invoices (
  id uuid primary key default uuid_generate_v4(),
  case_id uuid not null references public.cases(id),
  invoice_number text not null unique,
  invoice_date date not null default current_date,
  due_date date,
  status text not null default 'draft' check (status in ('draft', 'pending', 'paid', 'partial', 'denied', 'overdue')),
  total_amount numeric(10,2) not null default 0,
  paid_amount numeric(10,2) not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by_user_id uuid references public.users(id),
  updated_by_user_id uuid references public.users(id)
);

-- ============================================
-- INVOICE LINE ITEMS TABLE
-- ============================================
create table public.invoice_line_items (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid not null references public.invoices(id),
  procedure_id uuid references public.procedures(id),
  description text not null,
  cpt_code text,
  quantity integer not null default 1,
  unit_price numeric(10,2) not null,
  total_price numeric(10,2) not null,
  created_at timestamptz not null default now()
);

-- ============================================
-- PAYMENTS TABLE
-- ============================================
create table public.payments (
  id uuid primary key default uuid_generate_v4(),
  invoice_id uuid not null references public.invoices(id),
  payment_date date not null default current_date,
  amount numeric(10,2) not null,
  payment_method text,
  reference_number text,
  notes text,
  created_at timestamptz not null default now(),
  created_by_user_id uuid references public.users(id)
);

-- ============================================
-- INDEXES
-- ============================================
create index idx_documents_case_id on public.documents(case_id);
create index idx_documents_type on public.documents(document_type);
create index idx_procedures_case_id on public.procedures(case_id);
create index idx_procedures_date on public.procedures(procedure_date);
create index idx_invoices_case_id on public.invoices(case_id);
create index idx_invoices_status on public.invoices(status);
create index idx_invoice_line_items_invoice_id on public.invoice_line_items(invoice_id);
create index idx_payments_invoice_id on public.payments(invoice_id);

-- ============================================
-- UPDATED_AT TRIGGERS
-- ============================================
create trigger set_updated_at before update on public.documents for each row execute function update_updated_at();
create trigger set_updated_at before update on public.procedures for each row execute function update_updated_at();
create trigger set_updated_at before update on public.invoices for each row execute function update_updated_at();

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================
alter table public.documents enable row level security;
alter table public.procedures enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.payments enable row level security;

create policy "Authenticated users full access" on public.documents
  for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access" on public.procedures
  for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access" on public.invoices
  for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access" on public.invoice_line_items
  for all using (auth.role() = 'authenticated');

create policy "Authenticated users full access" on public.payments
  for all using (auth.role() = 'authenticated');
