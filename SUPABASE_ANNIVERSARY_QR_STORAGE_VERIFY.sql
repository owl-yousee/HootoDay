/*
Phase I-6b-1 anniversary QR private Storage verification.
Read-only. Confirm expected bucket and exactly three managed policies.
*/

BEGIN TRANSACTION READ ONLY;

SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  public = false
    AND file_size_limit = 5242880
    AND allowed_mime_types = ARRAY['image/png', 'image/jpeg']::text[] AS is_expected
FROM storage.buckets
WHERE id = 'hooto-day-anniversary-qr';

SELECT
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check,
  roles = ARRAY['authenticated']::name[] AS authenticated_only,
  (
    coalesce(qual, '') || coalesce(with_check, '')
  ) LIKE '%app_workspace_members%' AS checks_membership,
  (
    coalesce(qual, '') || coalesce(with_check, '')
  ) LIKE '%anniversary-qr%' AS checks_path_scope
FROM pg_catalog.pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE 'hooto_day_anniversary_qr_%'
ORDER BY policyname;

SELECT
  count(*) FILTER (WHERE cmd = 'SELECT') = 1 AS has_one_select,
  count(*) FILTER (WHERE cmd = 'INSERT') = 1 AS has_one_insert,
  count(*) FILTER (WHERE cmd = 'DELETE') = 1 AS has_one_delete,
  count(*) FILTER (WHERE cmd = 'UPDATE') = 0 AS has_no_update,
  count(*) = 3 AS has_exact_policy_count
FROM pg_catalog.pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE 'hooto_day_anniversary_qr_%';

SELECT
  count(*) AS stored_object_count
FROM storage.objects
WHERE bucket_id = 'hooto-day-anniversary-qr';

COMMIT;
