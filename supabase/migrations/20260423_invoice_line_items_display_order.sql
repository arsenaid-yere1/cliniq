alter table public.invoice_line_items
  add column if not exists display_order integer not null default 0;

create index if not exists invoice_line_items_invoice_order_idx
  on public.invoice_line_items (invoice_id, display_order);
