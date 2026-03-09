-- Allow application/json in case-documents bucket for generated clinical notes
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/json'
]
WHERE id = 'case-documents';
