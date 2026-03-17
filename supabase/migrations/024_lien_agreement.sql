-- Add supervising provider to provider profiles
alter table public.provider_profiles
  add column supervising_provider_id uuid references public.users(id);

-- Add lien_agreement to document types
alter table public.documents
  drop constraint documents_document_type_check,
  add constraint documents_document_type_check
    check (document_type in ('mri_report', 'chiro_report', 'pain_management', 'pt_report', 'orthopedic_report', 'ct_scan', 'generated', 'lien_agreement', 'other'));
