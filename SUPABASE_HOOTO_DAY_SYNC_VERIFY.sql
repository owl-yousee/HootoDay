-- Read-only structural verification to run only after APPLY is reviewed and
-- manually applied. No record rows, UUID values, payloads, codes, or hashes
-- from user data are selected. Run one A-section at a time when SQL Editor CSV
-- download shows only the last result set.
--
-- A = safe SQL Editor structure checks below.
-- B = authenticated-client behavior cases in the final comment. Do not mimic
-- those as postgres; that would not represent anonymous authenticated RLS.

BEGIN READ ONLY;

-- A1: required shared and dedicated objects.
SELECT 'A1_objects' AS section, expected.kind, expected.name,
  CASE expected.kind
    WHEN 'table' THEN to_regclass(expected.name) IS NOT NULL
    WHEN 'sequence' THEN to_regclass(expected.name) IS NOT NULL
    WHEN 'type' THEN to_regtype(expected.name) IS NOT NULL
    WHEN 'function' THEN to_regprocedure(expected.name) IS NOT NULL
  END AS exists
FROM (VALUES
  ('table', 'public.app_workspaces'),
  ('table', 'public.app_workspace_members'),
  ('table', 'public.app_pairing_codes'),
  ('table', 'public.app_workspace_state'),
  ('table', 'public.hooto_day_sync_records'),
  ('table', 'public.hooto_day_sync_operations'),
  ('sequence', 'public.hooto_day_sync_change_seq'),
  ('type', 'public.hooto_day_sync_result'),
  ('function', 'public.is_app_workspace_member(uuid)'),
  ('function', 'public.is_app_workspace_owner(uuid)'),
  ('function', 'public.hooto_day_upsert_sync_record(uuid,text,text,jsonb,integer,bigint,uuid,timestamptz,text)'),
  ('function', 'public.hooto_day_delete_sync_record(uuid,text,text,bigint,uuid,timestamptz,text)'),
  ('function', 'public.hooto_day_pull_sync_records(uuid,bigint,integer)')
) expected(kind, name)
ORDER BY expected.kind, expected.name;

-- A2: column metadata only.
SELECT 'A2_columns' AS section, table_name, ordinal_position, column_name,
  data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('hooto_day_sync_records', 'hooto_day_sync_operations')
ORDER BY table_name, ordinal_position;

-- A3: constraints.
SELECT 'A3_constraints' AS section, c.relname AS table_name,
  con.conname AS constraint_name, con.contype AS constraint_type,
  pg_get_constraintdef(con.oid, true) AS definition
FROM pg_catalog.pg_constraint con
JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('hooto_day_sync_records', 'hooto_day_sync_operations')
ORDER BY c.relname, con.conname;

-- A4: indexes.
SELECT 'A4_indexes' AS section, tablename AS table_name,
  indexname AS index_name, indexdef AS definition
FROM pg_catalog.pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('hooto_day_sync_records', 'hooto_day_sync_operations')
ORDER BY tablename, indexname;

-- A4a: the pull cursor index must be a valid, unconditional, single-column
-- unique index on change_sequence.
SELECT 'A4a_pull_index_expectation' AS section,
  index_class.relname AS index_name,
  i.indisunique AS is_unique,
  i.indisvalid AS is_valid,
  i.indisready AS is_ready,
  i.indnkeyatts AS key_column_count,
  i.indnatts AS total_attribute_count,
  i.indexprs IS NULL AS has_no_expression,
  i.indpred IS NULL AS has_no_predicate,
  attribute.attname AS first_key_column
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = index_class.relnamespace
JOIN pg_catalog.pg_attribute attribute
  ON attribute.attrelid = i.indrelid AND attribute.attnum = i.indkey[0]
WHERE n.nspname = 'public'
  AND index_class.relname = 'hooto_day_sync_records_pull_cursor_idx';

-- A4aa: operation retention lookup index used by a future reviewed cleanup.
SELECT 'A4aa_operation_index_expectation' AS section,
  index_class.relname AS index_name,
  i.indisunique AS is_unique,
  i.indisvalid AS is_valid,
  i.indisready AS is_ready,
  i.indnkeyatts AS key_column_count,
  first_column.attname AS first_key_column,
  second_column.attname AS second_key_column,
  third_column.attname AS third_key_column,
  i.indexprs IS NULL AS has_no_expression,
  i.indpred IS NULL AS has_no_predicate
FROM pg_catalog.pg_index i
JOIN pg_catalog.pg_class index_class ON index_class.oid = i.indexrelid
JOIN pg_catalog.pg_namespace n ON n.oid = index_class.relnamespace
JOIN pg_catalog.pg_attribute first_column
  ON first_column.attrelid = i.indrelid AND first_column.attnum = i.indkey[0]
JOIN pg_catalog.pg_attribute second_column
  ON second_column.attrelid = i.indrelid AND second_column.attnum = i.indkey[1]
JOIN pg_catalog.pg_attribute third_column
  ON third_column.attrelid = i.indrelid AND third_column.attnum = i.indkey[2]
WHERE n.nspname = 'public'
  AND index_class.relname = 'hooto_day_sync_operations_workspace_created_idx';

-- A4b: sequence definition only; the current/last value is deliberately not
-- selected because it is runtime state rather than a structural baseline.
SELECT 'A4b_sequence' AS section, sequence_schema, sequence_name,
  data_type, start_value, minimum_value, maximum_value, increment, cycle_option
FROM information_schema.sequences
WHERE sequence_schema = 'public'
  AND sequence_name = 'hooto_day_sync_change_seq';

-- A4c: internal sequence attributes used by APPLY postflight. No current or
-- last sequence value is selected.
SELECT 'A4c_sequence_expectation' AS section, c.relname AS sequence_name,
  s.seqtypid = 'pg_catalog.int8'::regtype AS is_bigint,
  s.seqstart = 1 AS starts_at_one,
  s.seqincrement = 1 AS increments_by_one,
  s.seqmin = 1 AS minimum_is_one,
  s.seqmax = 9223372036854775807 AS maximum_is_bigint,
  s.seqcache = 1 AS cache_is_one,
  NOT s.seqcycle AS does_not_cycle
FROM pg_catalog.pg_sequence s
JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'hooto_day_sync_change_seq';

-- A5: RLS enabled; RPC-only design expects zero policies/DELETE policies.
SELECT 'A5_rls' AS section, c.relname AS table_name,
  c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS force_rls,
  count(p.policyname) AS policy_count,
  count(p.policyname) FILTER (WHERE p.cmd = 'DELETE') AS delete_policy_count
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_policies p
  ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relname IN ('hooto_day_sync_records', 'hooto_day_sync_operations')
GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
ORDER BY c.relname;

-- A6: SECURITY DEFINER and fixed search_path are visible in these settings.
-- The body flags also confirm that mutation RPCs call nextval and pull uses
-- change_sequence; they do not execute the functions or read records.
SELECT 'A6_rpc_security' AS section, p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS identity_arguments,
  p.prosecdef AS security_definer, p.proconfig AS function_settings,
  pg_get_function_result(p.oid) AS result_type,
  position('change_sequence' IN pg_get_functiondef(p.oid)) > 0
    AS references_change_sequence,
  CASE WHEN p.proname IN (
    'hooto_day_upsert_sync_record', 'hooto_day_delete_sync_record'
  ) THEN position('nextval' IN pg_get_functiondef(p.oid)) > 0 ELSE NULL END
    AS mutation_uses_nextval,
  CASE WHEN p.proname IN (
    'hooto_day_upsert_sync_record', 'hooto_day_delete_sync_record'
  ) THEN position('request_fingerprint' IN pg_get_functiondef(p.oid)) > 0 ELSE NULL END
    AS mutation_checks_request_fingerprint
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN (
  'hooto_day_upsert_sync_record',
  'hooto_day_delete_sync_record',
  'hooto_day_pull_sync_records'
)
ORDER BY p.proname;

-- A7: expected authenticated=true, anon/PUBLIC=false. ACL inspection avoids
-- treating the special PUBLIC grantee as if it were a login role. Static ACL
-- output cannot completely prove privileges inherited through other roles;
-- authenticated/anon behavior must also be tested from real clients.
SELECT 'A7_rpc_execute' AS section, p.proname AS function_name, role_name,
  EXISTS (
    SELECT 1
    FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE acl.grantee = role_oid AND acl.privilege_type = 'EXECUTE'
  ) AS can_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
CROSS JOIN LATERAL (VALUES
  ('PUBLIC', 0::oid),
  ('anon', (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon')),
  ('authenticated', (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'))
) roles(role_name, role_oid)
WHERE n.nspname = 'public' AND p.proname IN (
  'hooto_day_upsert_sync_record',
  'hooto_day_delete_sync_record',
  'hooto_day_pull_sync_records'
)
ORDER BY p.proname, role_name;

-- A8: expected false for all direct table privileges.
SELECT 'A8_table_privileges' AS section, c.relname AS table_name,
  role_name, privilege_name,
  EXISTS (
    SELECT 1
    FROM aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    WHERE acl.grantee = role_oid AND acl.privilege_type = privilege_name
  ) AS has_privilege
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL (VALUES
  ('PUBLIC', 0::oid),
  ('anon', (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon')),
  ('authenticated', (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'))
) roles(role_name, role_oid)
CROSS JOIN (VALUES
  ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
  ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
)
  privileges(privilege_name)
WHERE n.nspname = 'public'
  AND c.relname IN ('hooto_day_sync_records', 'hooto_day_sync_operations')
ORDER BY c.relname, role_name, privilege_name;

-- A8b: expected false for direct sequence privileges for every client role.
SELECT 'A8b_sequence_privileges' AS section, c.relname AS sequence_name,
  role_name, privilege_name,
  EXISTS (
    SELECT 1
    FROM aclexplode(coalesce(c.relacl, '{}'::aclitem[])) acl
    WHERE acl.grantee = role_oid AND acl.privilege_type = privilege_name
  ) AS has_privilege
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN LATERAL (VALUES
  ('PUBLIC', 0::oid),
  ('anon', (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon')),
  ('authenticated', (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'))
) roles(role_name, role_oid)
CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) privileges(privilege_name)
WHERE n.nspname = 'public'
  AND c.relkind = 'S'
  AND c.relname = 'hooto_day_sync_change_seq'
ORDER BY role_name, privilege_name;

-- A9: compare shared RPC definition hashes with the saved PRECHECK CSV.
-- Definitions are inspected, never executed.
SELECT 'A9_shared_rpc_hash' AS section,
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
  'create_app_workspace', 'create_app_pairing_code',
  'consume_app_pairing_code', 'is_app_workspace_member',
  'is_app_workspace_owner', 'current_hooto_sync_key_hash'
)
ORDER BY object_name;

-- A10: compare this metadata signature with the pre-apply inspection to show
-- app_workspace_state was not altered. No state rows are read.
SELECT 'A10_workspace_state_structure' AS section, table_name,
  string_agg(
    ordinal_position::text || ':' || column_name || ':' || udt_name || ':' || is_nullable,
    '|' ORDER BY ordinal_position
  ) AS column_signature
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'app_workspace_state'
GROUP BY table_name;

-- For an exact comparison of all four shared tables (columns, constraints,
-- indexes, RLS/policies), rerun SUPABASE_HOOTO_DAY_SYNC_PRECHECK.sql after
-- APPLY and diff its complete result against the saved pre-APPLY CSV.

COMMIT;

-- B. Authenticated-client behavior specification (not executed by this file)
--  1. owner creates a visibly named HootoDay-only workspace.
--  2. owner issues a pairing code with the unchanged shared RPC.
--  3. a different anonymous authenticated member consumes the code.
--  4. owner pushes a new DayMemo with base_revision=0 and fresh operation ID;
--     revision=1 and a positive change_sequence are returned.
--  5. member pulls it.
--  6. member updates it with the returned revision.
--  7. owner uses the old revision; receives conflict and cannot overwrite.
--  8. resend the same request and operation ID; result, revision, and
--     change_sequence are identical. Change payload or another input while
--     reusing that ID and confirm the request_fingerprint mismatch is rejected.
--  9. member creates a tombstone using the current revision.
-- 10. owner pulls and applies the deletion.
-- 11. old revision upsert cannot resurrect; explicit restore requires the
--     latest tombstone revision.
-- 12. authenticated nonmember cannot pull.
-- 13. authenticated nonmember cannot upsert/delete.
-- 14. a member cannot obtain another workspace's records.
-- 15. empty iPhone only pulls; absence alone cannot invoke cloud deletion.
-- 16. forced sync/network/validation failure leaves localStorage unchanged.
--
-- Use only the anon key after anonymous sign-in, never service_role. Use no
-- private real content in tests and clean up only the disposable test workspace
-- after review; this verification file itself creates no test data.
