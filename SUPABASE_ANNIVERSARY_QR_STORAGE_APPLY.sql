/*
Phase I-6b-1 anniversary QR private Storage apply.
Creates one private bucket and SELECT / INSERT / DELETE policies.
It intentionally creates no UPDATE policy and never removes existing objects.
*/

BEGIN;

DO $precheck$
DECLARE
  existing_bucket storage.buckets%ROWTYPE;
  conflicting_policy_count integer;
BEGIN
  IF to_regclass('public.app_workspace_members') IS NULL
     OR to_regprocedure('public.is_app_workspace_member(uuid)') IS NULL
     OR to_regclass('storage.buckets') IS NULL
     OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'Anniversary QR Storage apply stopped: required workspace or Storage object is missing';
  END IF;

  SELECT * INTO existing_bucket
  FROM storage.buckets
  WHERE id = 'hooto-day-anniversary-qr'
     OR name = 'hooto-day-anniversary-qr';

  IF FOUND AND (
    existing_bucket.id <> 'hooto-day-anniversary-qr'
    OR existing_bucket.name <> 'hooto-day-anniversary-qr'
    OR existing_bucket.public IS DISTINCT FROM false
    OR existing_bucket.file_size_limit IS DISTINCT FROM 5242880
    OR existing_bucket.allowed_mime_types IS DISTINCT FROM ARRAY['image/png', 'image/jpeg']::text[]
  ) THEN
    RAISE EXCEPTION 'Anniversary QR Storage apply stopped: bucket name or configuration conflicts';
  END IF;

  SELECT count(*) INTO conflicting_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname IN (
      'hooto_day_anniversary_qr_select',
      'hooto_day_anniversary_qr_insert',
      'hooto_day_anniversary_qr_delete',
      'hooto_day_anniversary_qr_update'
    );
  IF conflicting_policy_count <> 0 THEN
    RAISE EXCEPTION 'Anniversary QR Storage apply stopped: a managed policy name already exists; run VERIFY instead of replacing it';
  END IF;
END
$precheck$;

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'hooto-day-anniversary-qr',
  'hooto-day-anniversary-qr',
  false,
  5242880,
  ARRAY['image/png', 'image/jpeg']::text[]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY hooto_day_anniversary_qr_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'hooto-day-anniversary-qr'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[2] = 'anniversary-qr'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g)$'
  AND EXISTS (
    SELECT 1
    FROM public.app_workspace_members member
    WHERE member.workspace_id::text = (storage.foldername(name))[1]
      AND member.user_id = auth.uid()
      AND member.role IN ('owner', 'member')
  )
);

CREATE POLICY hooto_day_anniversary_qr_insert
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'hooto-day-anniversary-qr'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[2] = 'anniversary-qr'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g)$'
  AND EXISTS (
    SELECT 1
    FROM public.app_workspace_members member
    WHERE member.workspace_id::text = (storage.foldername(name))[1]
      AND member.user_id = auth.uid()
      AND member.role IN ('owner', 'member')
  )
);

CREATE POLICY hooto_day_anniversary_qr_delete
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'hooto-day-anniversary-qr'
  AND array_length(storage.foldername(name), 1) = 3
  AND (storage.foldername(name))[2] = 'anniversary-qr'
  AND (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND (storage.foldername(name))[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND storage.filename(name) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpe?g)$'
  AND EXISTS (
    SELECT 1
    FROM public.app_workspace_members member
    WHERE member.workspace_id::text = (storage.foldername(name))[1]
      AND member.user_id = auth.uid()
      AND member.role IN ('owner', 'member')
  )
);

DO $postflight$
DECLARE
  policy_count integer;
  update_policy_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id = 'hooto-day-anniversary-qr'
      AND name = 'hooto-day-anniversary-qr'
      AND public = false
      AND file_size_limit = 5242880
      AND allowed_mime_types = ARRAY['image/png', 'image/jpeg']::text[]
  ) THEN
    RAISE EXCEPTION 'Anniversary QR Storage apply stopped: bucket postflight failed';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE cmd = 'UPDATE')
  INTO policy_count, update_policy_count
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND policyname LIKE 'hooto_day_anniversary_qr_%';
  IF policy_count <> 3 OR update_policy_count <> 0 THEN
    RAISE EXCEPTION 'Anniversary QR Storage apply stopped: policy postflight failed';
  END IF;
END
$postflight$;

COMMIT;
