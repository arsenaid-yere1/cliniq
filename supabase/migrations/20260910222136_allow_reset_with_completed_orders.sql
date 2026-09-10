-- Completed orders record performed care and remain linked to their original
-- encounter/recommendation. They do not block a fresh documentation draft.
-- Active order and unreleased billing blockers retain their existing behavior.
create or replace function private.clinical_reset_blockers(p_kind text,p_note jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(b), '[]'::jsonb) from (
  select jsonb_build_object('kind','billing','id',c.invoice_id,'message','Resolve the invoice before resetting this note') b
  from public.billing_source_claims c where c.released_at is null and
   ((p_kind='procedure_notes' and c.procedure_id=(p_note->>'procedure_id')::uuid) or
    (p_kind<>'procedure_notes' and c.encounter_id=(p_note->>'encounter_id')::uuid))
  union all
  select jsonb_build_object('kind','procedure_order','id',o.id,'message','Resolve the dependent procedure order before resetting this note')
  from public.procedure_orders o where o.deleted_at is null and o.status <> 'completed' and o.source_encounter_id=(p_note->>'encounter_id')::uuid
 ) blockers
$$;
