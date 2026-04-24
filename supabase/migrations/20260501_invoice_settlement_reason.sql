-- ============================================================
-- 20260501_invoice_settlement_reason.sql
-- Add settlement_reason column for invoices marked paid below total_amount.
-- Used when a PI settlement is accepted as final payment for a lower amount.
-- ============================================================

alter table public.invoices add column settlement_reason text;
