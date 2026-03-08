-- Create private storage bucket for clinic assets (logos, signatures)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clinic-assets',
  'clinic-assets',
  false,
  2097152,  -- 2 MB
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/svg+xml'
  ]
);

-- Authenticated users can upload clinic assets
CREATE POLICY "Authenticated users can upload clinic assets"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'clinic-assets');

-- Authenticated users can read clinic assets
CREATE POLICY "Authenticated users can read clinic assets"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'clinic-assets');

-- Authenticated users can update clinic assets
CREATE POLICY "Authenticated users can update clinic assets"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'clinic-assets');

-- Authenticated users can delete clinic assets
CREATE POLICY "Authenticated users can delete clinic assets"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'clinic-assets');
