-- Manual rollback paired with SUPABASE_HOOTO_DAY_SYNC_APPLY.sql.
-- WARNING: this permanently deletes all HootoDay cloud DayMemo sync records
-- and operation results. Confirm local data/backup before running it.
-- Shared workspace/member/pairing objects, shared RPCs, app_workspace_state,
-- current_hooto_sync_key_hash(), HootoPost, and HootoSong are not touched.

BEGIN;

DROP FUNCTION IF EXISTS public.hooto_day_pull_sync_records(
  uuid, bigint, integer
);
DROP FUNCTION IF EXISTS public.hooto_day_delete_sync_record(
  uuid, text, text, bigint, uuid, timestamptz, text
);
DROP FUNCTION IF EXISTS public.hooto_day_upsert_sync_record(
  uuid, text, text, jsonb, integer, bigint, uuid, timestamptz, text
);

-- Dedicated indexes and RLS metadata disappear with these tables. PRECHECK is
-- read-only and creates no object, so it has no rollback step.
DROP TABLE IF EXISTS public.hooto_day_sync_operations;
DROP TABLE IF EXISTS public.hooto_day_sync_records;
DROP SEQUENCE IF EXISTS public.hooto_day_sync_change_seq;
DROP TYPE IF EXISTS public.hooto_day_sync_result;

COMMIT;
