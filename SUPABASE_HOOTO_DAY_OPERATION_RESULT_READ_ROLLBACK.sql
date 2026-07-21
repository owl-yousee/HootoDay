-- Removes only the read-only HootoDay operation-result RPC added by the paired
-- APPLY file. It does not touch records, operation history, policies, or types.

BEGIN;

DROP FUNCTION IF EXISTS public.hooto_day_get_sync_operation_result(
  uuid, uuid, text, text, text
);

COMMIT;
