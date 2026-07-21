-- Adds one read-only RPC for retrieving an already-saved HootoDay operation
-- result. Run manually in Supabase SQL Editor after review.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.hooto_day_sync_operations') IS NULL
     OR to_regprocedure('public.is_app_workspace_member(uuid)') IS NULL
     OR to_regprocedure('public.hooto_day_upsert_sync_record(uuid,text,text,jsonb,integer,bigint,uuid,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'HootoDay operation result read apply stopped: prerequisites are missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'hooto_day_get_sync_operation_result'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid)
        <> 'target_operation_id uuid, target_workspace_id uuid, target_entity_type text, target_entity_id text, target_operation_kind text'
  ) THEN
    RAISE EXCEPTION 'HootoDay operation result read apply stopped: unexpected overload exists';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.hooto_day_get_sync_operation_result(
  target_operation_id uuid,
  target_workspace_id uuid,
  target_entity_type text,
  target_entity_id text,
  target_operation_kind text
)
RETURNS TABLE (
  found boolean,
  result_status text,
  workspace_id uuid,
  entity_type text,
  entity_id text,
  operation_kind text,
  request_base_revision bigint,
  request_fingerprint text,
  result_revision bigint,
  result_change_sequence bigint,
  result_server_updated_at timestamptz,
  result_deleted_at timestamptz,
  result_payload jsonb,
  operation_created_at timestamptz,
  conflict boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
WITH matched AS (
  SELECT op.*
  FROM public.hooto_day_sync_operations op
  WHERE auth.uid() IS NOT NULL
    AND target_workspace_id IS NOT NULL
    AND public.is_app_workspace_member(target_workspace_id)
    AND target_operation_id IS NOT NULL
    AND target_entity_type = 'day_memo'
    AND target_entity_id ~ '^\d{4}-\d{2}-\d{2}$'
    AND target_operation_kind IN ('upsert', 'delete')
    AND op.operation_id = target_operation_id
    AND op.workspace_id = target_workspace_id
    AND op.entity_type = target_entity_type
    AND op.entity_id = target_entity_id
    AND op.operation_kind = target_operation_kind
    AND op.requested_by = auth.uid()
)
SELECT true, op.result_status, op.workspace_id, op.entity_type, op.entity_id,
  op.operation_kind, op.request_base_revision, op.request_fingerprint,
  op.result_revision, op.result_change_sequence, op.result_server_updated_at,
  op.result_deleted_at, op.result_payload, op.created_at,
  op.result_status = 'conflict'
FROM matched op
UNION ALL
SELECT false, NULL::text, NULL::uuid, NULL::text, NULL::text, NULL::text,
  NULL::bigint, NULL::text, NULL::bigint, NULL::bigint, NULL::timestamptz,
  NULL::timestamptz, NULL::jsonb, NULL::timestamptz, NULL::boolean
WHERE NOT EXISTS (SELECT 1 FROM matched)
$function$;

REVOKE ALL ON FUNCTION public.hooto_day_get_sync_operation_result(
  uuid, uuid, text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hooto_day_get_sync_operation_result(
  uuid, uuid, text, text, text
) TO authenticated;

DO $postflight$
DECLARE
  target_oid regprocedure :=
    'public.hooto_day_get_sync_operation_result(uuid,uuid,text,text,text)'::regprocedure;
  upsert_oid regprocedure :=
    'public.hooto_day_upsert_sync_record(uuid,text,text,jsonb,integer,bigint,uuid,timestamptz,text)'::regprocedure;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_proc upsert_p ON upsert_p.oid = upsert_oid
    WHERE p.oid = target_oid
      AND (NOT p.prosecdef OR p.provolatile <> 's'
        OR p.proowner <> upsert_p.proowner
        OR position('insert into' IN lower(p.prosrc)) > 0
        OR position('update public.' IN lower(p.prosrc)) > 0
        OR position('delete from' IN lower(p.prosrc)) > 0
        OR position('hooto_day_upsert_sync_record' IN lower(p.prosrc)) > 0
        OR position('hooto_day_sync_records' IN lower(p.prosrc)) > 0
        OR position('nextval' IN lower(p.prosrc)) > 0
        OR position('execute ' IN lower(p.prosrc)) > 0
        OR position('auth.uid()' IN p.prosrc) = 0
        OR position('is_app_workspace_member' IN p.prosrc) = 0
        OR position('requested_by = auth.uid()' IN p.prosrc) = 0
        OR NOT EXISTS (
          SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) setting(value)
          WHERE replace(setting.value, ' ', '') = 'search_path=pg_catalog,public'
        ))
  ) THEN
    RAISE EXCEPTION 'HootoDay operation result read apply stopped: function security is unexpected';
  END IF;

  IF pg_catalog.has_function_privilege('anon', target_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', target_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc p
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
       ) acl
       WHERE p.oid = target_oid AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'HootoDay operation result read apply stopped: EXECUTE privileges are unexpected';
  END IF;
END
$postflight$;

COMMIT;
