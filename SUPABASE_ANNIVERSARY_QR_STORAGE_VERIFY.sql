/*
Phase I-6b-1 anniversary QR private Storage verification.
Read-only. Review all 10 rows in the single section / ok / detail result set.
*/

BEGIN TRANSACTION READ ONLY;

WITH
bucket_rows AS (
  SELECT id, name, public, file_size_limit, allowed_mime_types
  FROM storage.buckets
  WHERE id = 'hooto-day-anniversary-qr'
     OR name = 'hooto-day-anniversary-qr'
),
managed_policy_rows AS (
  SELECT
    policyname,
    roles,
    cmd,
    coalesce(qual, '') || ' ' || coalesce(with_check, '') AS expression,
    CASE policyname
      WHEN 'hooto_day_anniversary_qr_select' THEN cmd = 'SELECT'
      WHEN 'hooto_day_anniversary_qr_insert' THEN cmd = 'INSERT'
      WHEN 'hooto_day_anniversary_qr_delete' THEN cmd = 'DELETE'
      ELSE false
    END
    AND roles = ARRAY['authenticated']::name[]
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      LIKE '%hooto-day-anniversary-qr%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      LIKE '%anniversary-qr%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      LIKE '%storage.foldername%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      LIKE '%storage.filename%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      LIKE '%app_workspace_members%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      LIKE '%auth.uid%' AS is_expected
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'storage'
    AND tablename = 'objects'
    AND (
      policyname LIKE 'hooto_day_anniversary_qr_%'
      OR (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
        LIKE '%hooto-day-anniversary-qr%'
    )
),
checks(sort_order, section, ok, detail) AS (
  VALUES
    (1, 'bucket_exists',
      (SELECT count(*) = 1 FROM bucket_rows),
      CASE
        WHEN (SELECT count(*) FROM bucket_rows) = 1 THEN 'one expected bucket'
        WHEN NOT EXISTS (SELECT 1 FROM bucket_rows) THEN 'missing'
        ELSE 'id/name collision'
      END),
    (2, 'bucket_public_is_false',
      (SELECT count(*) FROM bucket_rows) = 1
      AND coalesce((SELECT public = false FROM bucket_rows LIMIT 1), false),
      CASE
        WHEN (SELECT count(*) FROM bucket_rows) = 1
          AND coalesce((SELECT public = false FROM bucket_rows LIMIT 1), false)
        THEN 'expected: private'
        ELSE 'missing, public, or name collision'
      END),
    (3, 'bucket_file_size_limit_matches',
      (SELECT count(*) FROM bucket_rows) = 1
      AND coalesce((SELECT file_size_limit = 5242880 FROM bucket_rows LIMIT 1), false),
      CASE
        WHEN (SELECT count(*) FROM bucket_rows) = 1
          AND coalesce((SELECT file_size_limit = 5242880 FROM bucket_rows LIMIT 1), false)
        THEN 'expected: 5242880'
        ELSE 'missing, mismatch, or name collision'
      END),
    (4, 'bucket_allowed_mime_types_match',
      (SELECT count(*) FROM bucket_rows) = 1
      AND coalesce((
        SELECT allowed_mime_types = ARRAY['image/png', 'image/jpeg']::text[]
        FROM bucket_rows LIMIT 1
      ), false),
      CASE
        WHEN (SELECT count(*) FROM bucket_rows) = 1
          AND coalesce((
            SELECT allowed_mime_types = ARRAY['image/png', 'image/jpeg']::text[]
            FROM bucket_rows LIMIT 1
          ), false)
        THEN 'expected: image/png,image/jpeg'
        ELSE 'missing, mismatch, or name collision'
      END),
    (5, 'select_policy_exists_and_matches',
      coalesce((
        SELECT count(*) = 1 AND bool_and(is_expected)
        FROM managed_policy_rows
        WHERE policyname = 'hooto_day_anniversary_qr_select'
      ), false),
      CASE
        WHEN (
          SELECT count(*) = 1 AND bool_and(is_expected)
          FROM managed_policy_rows
          WHERE policyname = 'hooto_day_anniversary_qr_select'
        ) THEN 'expected authenticated SELECT policy'
        ELSE 'missing or definition mismatch'
      END),
    (6, 'insert_policy_exists_and_matches',
      coalesce((
        SELECT count(*) = 1 AND bool_and(is_expected)
        FROM managed_policy_rows
        WHERE policyname = 'hooto_day_anniversary_qr_insert'
      ), false),
      CASE
        WHEN (
          SELECT count(*) = 1 AND bool_and(is_expected)
          FROM managed_policy_rows
          WHERE policyname = 'hooto_day_anniversary_qr_insert'
        ) THEN 'expected authenticated INSERT policy'
        ELSE 'missing or definition mismatch'
      END),
    (7, 'delete_policy_exists_and_matches',
      coalesce((
        SELECT count(*) = 1 AND bool_and(is_expected)
        FROM managed_policy_rows
        WHERE policyname = 'hooto_day_anniversary_qr_delete'
      ), false),
      CASE
        WHEN (
          SELECT count(*) = 1 AND bool_and(is_expected)
          FROM managed_policy_rows
          WHERE policyname = 'hooto_day_anniversary_qr_delete'
        ) THEN 'expected authenticated DELETE policy'
        ELSE 'missing or definition mismatch'
      END),
    (8, 'update_policy_absent',
      NOT EXISTS (
        SELECT 1 FROM managed_policy_rows
        WHERE cmd = 'UPDATE'
           OR policyname = 'hooto_day_anniversary_qr_update'
      ),
      CASE
        WHEN EXISTS (
          SELECT 1 FROM managed_policy_rows
          WHERE cmd = 'UPDATE'
             OR policyname = 'hooto_day_anniversary_qr_update'
        ) THEN 'unexpected UPDATE policy found'
        ELSE 'no UPDATE policy'
      END),
    (9, 'unexpected_policy_absent',
      NOT EXISTS (
        SELECT 1 FROM managed_policy_rows
        WHERE policyname NOT IN (
          'hooto_day_anniversary_qr_select',
          'hooto_day_anniversary_qr_insert',
          'hooto_day_anniversary_qr_delete'
        )
        OR NOT is_expected
      )
      AND (SELECT count(*) FROM managed_policy_rows) = 3,
      CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM managed_policy_rows
          WHERE policyname NOT IN (
            'hooto_day_anniversary_qr_select',
            'hooto_day_anniversary_qr_insert',
            'hooto_day_anniversary_qr_delete'
          )
          OR NOT is_expected
        )
        AND (SELECT count(*) FROM managed_policy_rows) = 3
        THEN 'exactly three expected policies; no other bucket-scoped managed policy'
        ELSE 'unexpected, missing, or mismatched managed policy'
      END),
    (10, 'stored_object_count',
      (SELECT count(*) FROM storage.objects
        WHERE bucket_id = 'hooto-day-anniversary-qr') >= 0,
      'count=' || (SELECT count(*)::text FROM storage.objects
        WHERE bucket_id = 'hooto-day-anniversary-qr'))
)
SELECT section, ok, detail
FROM checks
ORDER BY sort_order;

COMMIT;
