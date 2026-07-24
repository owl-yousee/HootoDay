/*
Phase I-6b-1 anniversary QR private Storage rollback.
Drops only the three policies created by APPLY.
It never deletes stored objects and intentionally keeps the bucket.
After verifying the bucket was created only for this phase and is empty,
an administrator may remove the empty bucket separately.
*/

BEGIN;

DROP POLICY IF EXISTS hooto_day_anniversary_qr_select ON storage.objects;
DROP POLICY IF EXISTS hooto_day_anniversary_qr_insert ON storage.objects;
DROP POLICY IF EXISTS hooto_day_anniversary_qr_delete ON storage.objects;

DO $rollback_verify$
DECLARE
  object_count bigint;
BEGIN
  SELECT count(*) INTO object_count
  FROM storage.objects
  WHERE bucket_id = 'hooto-day-anniversary-qr';

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname IN (
        'hooto_day_anniversary_qr_select',
        'hooto_day_anniversary_qr_insert',
        'hooto_day_anniversary_qr_delete',
        'hooto_day_anniversary_qr_update'
      )
  ) THEN
    RAISE EXCEPTION 'Anniversary QR Storage rollback stopped: managed policy remains';
  END IF;

  RAISE NOTICE 'Anniversary QR bucket retained; stored object count is %', object_count;
END
$rollback_verify$;

COMMIT;

-- Deliberately not executed:
-- DELETE FROM storage.buckets
-- WHERE id = 'hooto-day-anniversary-qr'
--   AND NOT EXISTS (
--     SELECT 1 FROM storage.objects
--     WHERE bucket_id = 'hooto-day-anniversary-qr'
--   );
