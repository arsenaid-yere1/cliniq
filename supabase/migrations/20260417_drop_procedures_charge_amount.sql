-- Remove per-procedure pricing. All pricing flows from the product catalog
-- (PRP bundle: 0232T + 86999 + 76942; Medical Site Utilization for facility invoices).
alter table public.procedures drop column if exists charge_amount;
