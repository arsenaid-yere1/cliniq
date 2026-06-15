-- Add document types for uploaded historical clinical/billing PDFs:
-- initial_visit, procedure, discharge, invoice.
-- Also includes x_ray, which is present in the zod enum but was missing from the
-- prior DB CHECK (20260408) — added here to keep DB and app in sync.
alter table public.documents
  drop constraint if exists documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in (
      'mri_report',
      'chiro_report',
      'pain_management',
      'pt_report',
      'orthopedic_report',
      'ct_scan',
      'x_ray',
      'generated',
      'lien_agreement',
      'procedure_consent',
      'other',
      'initial_visit',
      'procedure',
      'discharge',
      'invoice'
    ));
