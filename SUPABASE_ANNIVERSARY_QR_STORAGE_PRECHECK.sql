/*
Phase I-6b-1 anniversary QR private Storage precheck.
Read-only. Run before APPLY and review all 14 rows in the single result set.

For *_matches and *_available_or_expected rows, ok = true is safe.
For *_conflict rows, ok = true means no conflict was found; detail retains
the requested conflict vocabulary so the result is unambiguous.
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
      WHEN 'hooto_day_anniversary_qr_select' THEN
        cmd = 'SELECT'
      WHEN 'hooto_day_anniversary_qr_insert' THEN
        cmd = 'INSERT'
      WHEN 'hooto_day_anniversary_qr_delete' THEN
        cmd = 'DELETE'
      ELSE false
    END
    AND roles = ARRAY['authenticated']::name[]
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      LIKE '%hooto-day-anniversary-qr%'
    AND (coalesce(qual, '') || ' ' || coalesce(with_check, ''))
      LIKE '%anniversary-qr%'
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
    (1, 'app_workspace_members',
      to_regclass('public.app_workspace_members') IS NOT NULL,
      coalesce(to_regclass('public.app_workspace_members')::text, 'missing')),
    (2, 'membership_helper',
      to_regprocedure('public.is_app_workspace_member(uuid)') IS NOT NULL,
      coalesce(to_regprocedure('public.is_app_workspace_member(uuid)')::text, 'missing')),
    (3, 'storage_buckets',
      to_regclass('storage.buckets') IS NOT NULL,
      coalesce(to_regclass('storage.buckets')::text, 'missing')),
    (4, 'storage_objects',
      to_regclass('storage.objects') IS NOT NULL,
      coalesce(to_regclass('storage.objects')::text, 'missing')),
    (5, 'bucket_exists',
      EXISTS (SELECT 1 FROM bucket_rows),
      CASE
        WHEN EXISTS (SELECT 1 FROM bucket_rows) THEN 'exists; inspect configuration rows'
        ELSE 'absent; safe for APPLY to create'
      END),
    (6, 'bucket_configuration_matches',
      NOT EXISTS (SELECT 1 FROM bucket_rows)
      OR (
        (SELECT count(*) FROM bucket_rows) = 1
        AND EXISTS (
          SELECT 1 FROM bucket_rows
          WHERE id = 'hooto-day-anniversary-qr'
            AND name = 'hooto-day-anniversary-qr'
            AND public = false
            AND file_size_limit = 5242880
            AND allowed_mime_types = ARRAY['image/png', 'image/jpeg']::text[]
        )
      ),
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM bucket_rows) THEN 'absent; no configuration conflict'
        WHEN (
          (SELECT count(*) FROM bucket_rows) = 1
          AND EXISTS (
            SELECT 1 FROM bucket_rows
            WHERE id = 'hooto-day-anniversary-qr'
              AND name = 'hooto-day-anniversary-qr'
              AND public = false
              AND file_size_limit = 5242880
              AND allowed_mime_types = ARRAY['image/png', 'image/jpeg']::text[]
          )
        ) THEN 'expected'
        ELSE 'mismatch or id/name collision'
      END),
    (7, 'bucket_public_is_false',
      NOT EXISTS (SELECT 1 FROM bucket_rows)
      OR (
        (SELECT count(*) FROM bucket_rows) = 1
        AND coalesce((SELECT public = false FROM bucket_rows LIMIT 1), false)
      ),
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM bucket_rows) THEN 'absent; APPLY will create private'
        WHEN (SELECT count(*) FROM bucket_rows) = 1
          AND coalesce((SELECT public = false FROM bucket_rows LIMIT 1), false) THEN 'expected'
        ELSE 'public or name collision'
      END),
    (8, 'bucket_file_size_limit_matches',
      NOT EXISTS (SELECT 1 FROM bucket_rows)
      OR (
        (SELECT count(*) FROM bucket_rows) = 1
        AND coalesce((SELECT file_size_limit = 5242880 FROM bucket_rows LIMIT 1), false)
      ),
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM bucket_rows) THEN 'absent; APPLY will set 5242880'
        WHEN (SELECT count(*) FROM bucket_rows) = 1
          AND coalesce((SELECT file_size_limit = 5242880 FROM bucket_rows LIMIT 1), false)
          THEN 'expected: 5242880'
        ELSE 'mismatch or name collision'
      END),
    (9, 'bucket_allowed_mime_types_match',
      NOT EXISTS (SELECT 1 FROM bucket_rows)
      OR (
        (SELECT count(*) FROM bucket_rows) = 1
        AND coalesce((SELECT allowed_mime_types = ARRAY['image/png', 'image/jpeg']::text[]
          FROM bucket_rows LIMIT 1), false)
      ),
      CASE
        WHEN NOT EXISTS (SELECT 1 FROM bucket_rows) THEN 'absent; APPLY will allow PNG and JPEG'
        WHEN (SELECT count(*) FROM bucket_rows) = 1
          AND coalesce((SELECT allowed_mime_types = ARRAY['image/png', 'image/jpeg']::text[]
            FROM bucket_rows LIMIT 1), false) THEN 'expected: image/png,image/jpeg'
        ELSE 'mismatch or name collision'
      END),
    (10, 'select_policy_name_available_or_expected',
      NOT EXISTS (
        SELECT 1 FROM managed_policy_rows
        WHERE policyname = 'hooto_day_anniversary_qr_select'
      )
      OR (
        SELECT count(*) = 1 AND bool_and(is_expected)
        FROM managed_policy_rows
        WHERE policyname = 'hooto_day_anniversary_qr_select'
      ),
      CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM managed_policy_rows
          WHERE policyname = 'hooto_day_anniversary_qr_select'
        ) THEN 'available'
        WHEN (
          SELECT count(*) = 1 AND bool_and(is_expected)
          FROM managed_policy_rows
          WHERE policyname = 'hooto_day_anniversary_qr_select'
        ) THEN 'existing expected policy'
        ELSE 'name conflict'
      END),
    (11, 'insert_policy_name_available_or_expected',
      NOT EXISTS (
        SELECT 1 FROM managed_policy_rows
        WHERE policyname = 'hooto_day_anniversary_qr_insert'
      )
      OR (
        SELECT count(*) = 1 AND bool_and(is_expected)
        FROM managed_policy_rows
        WHERE policyname = 'hooto_day_anniversary_qr_insert'
      ),
      CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM managed_policy_rows
          WHERE policyname = 'hooto_day_anniversary_qr_insert'
        ) THEN 'available'
        WHEN (
          SELECT count(*) = 1 AND bool_and(is_expected)
          FROM managed_policy_rows
          WHERE policyname = 'hooto_day_anniversary_qr_insert'
        ) THEN 'existing expected policy'
        ELSE 'name conflict'
      END),
    (12, 'delete_policy_name_available_or_expected',
      NOT EXISTS (
        SELECT 1 FROM managed_policy_rows
        WHERE policyname = 'hooto_day_anniversary_qr_delete'
      )
      OR (
        SELECT count(*) = 1 AND bool_and(is_expected)
        FROM managed_policy_rows
        WHERE policyname = 'hooto_day_anniversary_qr_delete'
      ),
      CASE
        WHEN NOT EXISTS (
          SELECT 1 FROM managed_policy_rows
          WHERE policyname = 'hooto_day_anniversary_qr_delete'
        ) THEN 'available'
        WHEN (
          SELECT count(*) = 1 AND bool_and(is_expected)
          FROM managed_policy_rows
          WHERE policyname = 'hooto_day_anniversary_qr_delete'
        ) THEN 'existing expected policy'
        ELSE 'name conflict'
      END),
    (13, 'unexpected_managed_policy_conflict',
      NOT EXISTS (
        SELECT 1 FROM managed_policy_rows
        WHERE policyname NOT IN (
          'hooto_day_anniversary_qr_select',
          'hooto_day_anniversary_qr_insert',
          'hooto_day_anniversary_qr_delete'
        )
        OR NOT is_expected
      ),
      CASE
        WHEN EXISTS (
          SELECT 1 FROM managed_policy_rows
          WHERE policyname NOT IN (
            'hooto_day_anniversary_qr_select',
            'hooto_day_anniversary_qr_insert',
            'hooto_day_anniversary_qr_delete'
          )
          OR NOT is_expected
        ) THEN 'conflict found'
        ELSE 'no conflict'
      END),
    (14, 'update_policy_conflict',
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
        ) THEN 'conflict found'
        ELSE 'no conflict'
      END)
)
SELECT section, ok, detail
FROM checks
ORDER BY sort_order;

COMMIT;
