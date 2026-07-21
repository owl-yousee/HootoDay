-- Read-only structural verification for the operation-result RPC.
-- Run manually after APPLY. It does not read operation rows or payloads.

BEGIN READ ONLY;

SELECT 'V1_function' AS section,
  to_regprocedure('public.hooto_day_get_sync_operation_result(uuid,uuid,text,text,text)') IS NOT NULL AS exists;

SELECT 'V2_properties' AS section,
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  pg_catalog.pg_get_function_result(p.oid) AS result_type,
  p.prosecdef AS security_definer,
  p.provolatile = 's' AS stable,
  pg_catalog.pg_get_userbyid(p.proowner) AS owner,
  p.proowner = (
    SELECT existing.proowner FROM pg_catalog.pg_proc existing
    WHERE existing.oid = 'public.hooto_day_upsert_sync_record(uuid,text,text,jsonb,integer,bigint,uuid,timestamptz,text)'::regprocedure
  ) AS same_owner_as_existing_rpc,
  p.proconfig AS configuration
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE p.oid = 'public.hooto_day_get_sync_operation_result(uuid,uuid,text,text,text)'::regprocedure;

SELECT 'V3_execute' AS section,
  pg_catalog.has_function_privilege(
    'authenticated',
    'public.hooto_day_get_sync_operation_result(uuid,uuid,text,text,text)',
    'EXECUTE'
  ) AS authenticated_execute,
  pg_catalog.has_function_privilege(
    'anon',
    'public.hooto_day_get_sync_operation_result(uuid,uuid,text,text,text)',
    'EXECUTE'
  ) AS anon_execute,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    WHERE p.oid = 'public.hooto_day_get_sync_operation_result(uuid,uuid,text,text,text)'::regprocedure
      AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) AS public_execute_absent;

SELECT 'V4_table_access' AS section,
  pg_catalog.has_table_privilege('authenticated', 'public.hooto_day_sync_operations', 'SELECT') AS authenticated_select,
  pg_catalog.has_table_privilege('anon', 'public.hooto_day_sync_operations', 'SELECT') AS anon_select,
  c.relrowsecurity AS rls_enabled,
  NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies policy
    WHERE policy.schemaname = 'public' AND policy.tablename = 'hooto_day_sync_operations'
  ) AS has_no_policies
FROM pg_catalog.pg_class c
WHERE c.oid = 'public.hooto_day_sync_operations'::regclass;

SELECT 'V5_definition' AS section,
  position('auth.uid()' IN pg_catalog.pg_get_functiondef(p.oid)) > 0 AS checks_auth,
  position('is_app_workspace_member' IN pg_catalog.pg_get_functiondef(p.oid)) > 0 AS checks_membership,
  position('requested_by = auth.uid()' IN pg_catalog.pg_get_functiondef(p.oid)) > 0 AS checks_operation_user,
  position('hooto_day_sync_records' IN pg_catalog.pg_get_functiondef(p.oid)) = 0 AS does_not_access_current_records,
  position('hooto_day_upsert_sync_record' IN pg_catalog.pg_get_functiondef(p.oid)) = 0 AS does_not_call_upsert,
  position('nextval' IN lower(pg_catalog.pg_get_functiondef(p.oid))) = 0 AS does_not_allocate_sequence,
  position('insert into' IN lower(p.prosrc)) = 0
    AND position('update public.' IN lower(p.prosrc)) = 0
    AND position('delete from' IN lower(p.prosrc)) = 0 AS has_no_dml,
  position('execute ' IN lower(p.prosrc)) = 0 AS has_no_dynamic_sql
FROM pg_catalog.pg_proc p
WHERE p.oid = 'public.hooto_day_get_sync_operation_result(uuid,uuid,text,text,text)'::regprocedure;

SELECT 'V6_existing_objects_unchanged' AS section, c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  NOT pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authenticated_direct_dml_absent,
  NOT pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon_direct_dml_absent,
  count(policy.policyname) = 0 AS has_no_policies
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_policies policy
  ON policy.schemaname = n.nspname AND policy.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relname IN ('hooto_day_sync_records', 'hooto_day_sync_operations')
GROUP BY c.oid, c.relname, c.relrowsecurity
ORDER BY c.relname;

COMMIT;
