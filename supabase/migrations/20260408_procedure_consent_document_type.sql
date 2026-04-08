-- Add procedure_consent to document types
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in (
      'mri_report',
      'chiro_report',
      'pain_management',
      'pt_report',
      'orthopedic_report',
      'ct_scan',
      'generated',
      'lien_agreement',
      'procedure_consent',
      'other'
    ));
