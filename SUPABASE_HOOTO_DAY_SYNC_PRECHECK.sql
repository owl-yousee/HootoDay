-- HootoDay APPLY precheck baseline (read-only; run before APPLY).
--
-- 1. Open Supabase SQL Editor and create a new query.
-- 2. Paste this entire file and run it before APPLY. BEGIN/COMMIT produce no
--    tabular data; the query produces one tabular result set.
-- 3. Download that result set as CSV and keep it unchanged.
-- 4. After APPLY, run VERIFY, then rerun this PRECHECK and compare the complete
--    second CSV with the saved pre-APPLY CSV. Matching rows show that the
--    signatures and RPC hashes selected by this query did not change. This is
--    strong comparison evidence, not proof that every unselected database
--    property, effective inherited privilege, or external dependency is equal;
--    those still require VERIFY and authenticated-client behavior checks.
--
-- This query reads catalog/schema metadata only. It never selects workspace
-- rows, UUID values, members, pairing codes/hashes, payloads, keys, or tokens.
-- OIDs are used internally for joins but are not emitted or hashed.

BEGIN READ ONLY;

WITH target_tables(table_name) AS (
  VALUES
    ('app_workspaces'),
    ('app_workspace_members'),
    ('app_pairing_codes'),
    ('app_workspace_state')
),
table_presence_rows AS (
  SELECT
    t.table_name,
    'exists=' || (to_regclass('public.' || t.table_name) IS NOT NULL)::text
      AS signature
  FROM target_tables t
),
column_rows AS (
  SELECT
    c.table_name,
    jsonb_agg(
      jsonb_build_object(
        'ordinal_position', c.ordinal_position,
        'column_name', c.column_name,
        'data_type', c.data_type,
        'udt_schema', c.udt_schema,
        'udt_name', c.udt_name,
        'is_nullable', c.is_nullable,
        'column_default', c.column_default,
        'character_maximum_length', c.character_maximum_length,
        'character_octet_length', c.character_octet_length,
        'numeric_precision', c.numeric_precision,
        'numeric_precision_radix', c.numeric_precision_radix,
        'numeric_scale', c.numeric_scale,
        'datetime_precision', c.datetime_precision,
        'interval_type', c.interval_type,
        'interval_precision', c.interval_precision,
        'character_set_schema', c.character_set_schema,
        'character_set_name', c.character_set_name,
        'collation_schema', c.collation_schema,
        'collation_name', c.collation_name,
        'domain_schema', c.domain_schema,
        'domain_name', c.domain_name,
        'is_identity', c.is_identity,
        'identity_generation', c.identity_generation,
        'identity_start', c.identity_start,
        'identity_increment', c.identity_increment,
        'identity_maximum', c.identity_maximum,
        'identity_minimum', c.identity_minimum,
        'identity_cycle', c.identity_cycle,
        'is_generated', c.is_generated,
        'generation_expression', c.generation_expression,
        'is_updatable', c.is_updatable
      ) ORDER BY c.ordinal_position
    )::text AS signature
  FROM information_schema.columns c
  JOIN target_tables t ON t.table_name = c.table_name
  WHERE c.table_schema = 'public'
  GROUP BY c.table_name
),
constraint_rows AS (
  SELECT
    c.relname AS table_name,
    string_agg(
      con.conname || ':' || con.contype::text || ':' ||
      pg_get_constraintdef(con.oid, true),
      '|' ORDER BY con.conname
    ) AS signature
  FROM pg_catalog.pg_constraint con
  JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN target_tables t ON t.table_name = c.relname
  WHERE n.nspname = 'public'
  GROUP BY c.relname
),
index_rows AS (
  SELECT
    i.tablename AS table_name,
    string_agg(i.indexname || ':' || i.indexdef, '|' ORDER BY i.indexname)
      AS signature
  FROM pg_catalog.pg_indexes i
  JOIN target_tables t ON t.table_name = i.tablename
  WHERE i.schemaname = 'public'
  GROUP BY i.tablename
),
rls_policy_rows AS (
  SELECT
    c.relname AS table_name,
    'rls=' || c.relrowsecurity::text || ';force=' || c.relforcerowsecurity::text ||
    ';policies=' || coalesce(string_agg(
      p.policyname || ':' || p.cmd || ':' || p.permissive || ':' ||
      array_to_string(p.roles, ',') || ':' || coalesce(p.qual, '<null>') || ':' ||
      coalesce(p.with_check, '<null>'),
      '|' ORDER BY p.policyname
    ), '<none>') AS signature
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  JOIN target_tables t ON t.table_name = c.relname
  LEFT JOIN pg_catalog.pg_policies p
    ON p.schemaname = n.nspname AND p.tablename = c.relname
  WHERE n.nspname = 'public'
  GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
),
rpc_rows AS (
  SELECT
    'public.' || p.proname || '(' ||
      pg_get_function_identity_arguments(p.oid) || ')' AS object_name,
    'result=' || pg_get_function_result(p.oid) ||
      ';security_definer=' || p.prosecdef::text ||
      ';settings=' || coalesce(array_to_string(p.proconfig, ','), '<none>')
      AS signature,
    pg_catalog.md5(pg_get_functiondef(p.oid)) AS definition_hash
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'create_app_workspace',
    'create_app_pairing_code',
    'consume_app_pairing_code',
    'is_app_workspace_member',
    'is_app_workspace_owner',
    'current_hooto_sync_key_hash'
  )
),
all_rows AS (
  SELECT 'table_presence'::text AS section,
    'public.' || table_name AS object_name, signature,
    pg_catalog.md5(signature) AS definition_hash
  FROM table_presence_rows
  UNION ALL
  SELECT 'table_columns'::text AS section,
    'public.' || table_name AS object_name, signature,
    pg_catalog.md5(signature) AS definition_hash
  FROM column_rows
  UNION ALL
  SELECT 'table_constraints', 'public.' || table_name, signature,
    pg_catalog.md5(signature)
  FROM constraint_rows
  UNION ALL
  SELECT 'table_indexes', 'public.' || table_name, signature,
    pg_catalog.md5(signature)
  FROM index_rows
  UNION ALL
  SELECT 'table_rls_policies', 'public.' || table_name, signature,
    pg_catalog.md5(signature)
  FROM rls_policy_rows
  UNION ALL
  SELECT 'rpc_definition', object_name, signature, definition_hash
  FROM rpc_rows
)
SELECT
  section,
  object_name,
  signature,
  definition_hash,
  'Save this complete result as the pre-APPLY baseline CSV'::text AS instruction
FROM all_rows
ORDER BY section, object_name;

COMMIT;
