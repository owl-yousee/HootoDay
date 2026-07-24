/*
Phase I-6b-1 anniversary QR private Storage precheck.
Read-only. Run before APPLY and review every result row.
*/

BEGIN TRANSACTION READ ONLY;

WITH checks(section, ok, detail) AS (
  VALUES
    ('app_workspace_members',
      to_regclass('public.app_workspace_members') IS NOT NULL,
      coalesce(to_regclass('public.app_workspace_members')::text, 'missing')),
    ('membership_helper',
      to_regprocedure('public.is_app_workspace_member(uuid)') IS NOT NULL,
      coalesce(to_regprocedure('public.is_app_workspace_member(uuid)')::text, 'missing')),
    ('storage_buckets',
      to_regclass('storage.buckets') IS NOT NULL,
      coalesce(to_regclass('storage.buckets')::text, 'missing')),
    ('storage_objects',
      to_regclass('storage.objects') IS NOT NULL,
      coalesce(to_regclass('storage.objects')::text, 'missing'))
)
SELECT section, ok, detail FROM checks ORDER BY section;

SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  CASE
    WHEN public = false
      AND file_size_limit = 5242880
      AND allowed_mime_types = ARRAY['image/png', 'image/jpeg']::text[]
    THEN 'expected'
    ELSE 'unexpected'
  END AS configuration
FROM storage.buckets
WHERE id = 'hooto-day-anniversary-qr'
   OR name = 'hooto-day-anniversary-qr';

SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_catalog.pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname IN (
    'hooto_day_anniversary_qr_select',
    'hooto_day_anniversary_qr_insert',
    'hooto_day_anniversary_qr_delete',
    'hooto_day_anniversary_qr_update'
  )
ORDER BY policyname;

COMMIT;
