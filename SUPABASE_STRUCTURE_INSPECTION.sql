/*
HootoDay / hooto-platform 構造確認SQL

ユーザー向け実行手順:
1. Supabaseのhooto-platformプロジェクトを開く。
2. SQL Editorを開く。
3. New queryを作る。
4. このファイルのSQL全文を貼る。
5. Runを押す。
6. 各sectionの結果を確認する。
7. 結果をChatGPT/Codexへ共有する。

共有前の注意:
- 結果にworkspace UUID、user UUID、メール、code hash、実データ本文などが
  含まれていないことを確認する。
- 想定外にそれらが含まれた場合は、必ず伏せ字にしてから共有する。
- このSQLはcatalogとinformation_schemaから構造を読むだけで、データを変更しない。
- RPC・関数は実行せず、定義と権限だけを確認する。
*/

BEGIN TRANSACTION READ ONLY;

-- ==================================================
-- 01. 実行環境
-- ==================================================

SELECT
  '01_environment' AS section,
  current_database() AS database_name,
  current_schema() AS current_schema_name,
  current_user AS current_user_name,
  version() AS postgres_version;

SELECT
  '01_schema_presence' AS section,
  required.schema_name,
  EXISTS (
    SELECT 1
    FROM information_schema.schemata AS s
    WHERE s.schema_name = required.schema_name
  ) AS schema_exists
FROM (
  VALUES ('public'), ('auth'), ('extensions')
) AS required(schema_name)
ORDER BY required.schema_name;

-- ==================================================
-- 02. 関連テーブルの存在
-- ==================================================

WITH target_names(table_name) AS (
  VALUES
    ('app_workspaces'),
    ('app_workspace_members'),
    ('app_pairing_codes'),
    ('app_devices'),
    ('hooto_day_sync_records')
)
SELECT
  '02_candidate_table_presence' AS section,
  target_names.table_name,
  tables.table_schema,
  tables.table_type,
  (tables.table_name IS NOT NULL) AS table_exists
FROM target_names
LEFT JOIN information_schema.tables AS tables
  ON tables.table_schema = 'public'
 AND tables.table_name = target_names.table_name
ORDER BY target_names.table_name;

SELECT
  '02_related_public_tables' AS section,
  tables.table_schema,
  tables.table_name,
  tables.table_type
FROM information_schema.tables AS tables
WHERE tables.table_schema = 'public'
  AND lower(tables.table_name) ~ '(workspace|member|pairing|device|sync|hooto|song|post|memo)'
ORDER BY tables.table_name;

-- ==================================================
-- 03. 関連テーブルのカラム
-- ==================================================

WITH related_tables AS (
  SELECT tables.table_schema, tables.table_name
  FROM information_schema.tables AS tables
  WHERE tables.table_schema = 'public'
    AND (
      tables.table_name IN (
        'app_workspaces',
        'app_workspace_members',
        'app_pairing_codes',
        'app_devices',
        'hooto_day_sync_records'
      )
      OR lower(tables.table_name) ~ '(workspace|member|pairing|device|sync|hooto)'
    )
)
SELECT
  '03_related_columns' AS section,
  columns.table_schema,
  columns.table_name,
  columns.ordinal_position,
  columns.column_name,
  columns.data_type,
  columns.udt_name,
  columns.is_nullable,
  columns.column_default,
  columns.character_maximum_length
FROM information_schema.columns AS columns
JOIN related_tables
  ON related_tables.table_schema = columns.table_schema
 AND related_tables.table_name = columns.table_name
ORDER BY columns.table_name, columns.ordinal_position;

-- ==================================================
-- 04. 主キー・外部キー・UNIQUE・CHECK制約
-- ==================================================

SELECT
  '04_related_constraints' AS section,
  namespace.nspname AS schema_name,
  relation.relname AS table_name,
  constraint_record.conname AS constraint_name,
  CASE constraint_record.contype
    WHEN 'p' THEN 'PRIMARY KEY'
    WHEN 'f' THEN 'FOREIGN KEY'
    WHEN 'u' THEN 'UNIQUE'
    WHEN 'c' THEN 'CHECK'
  END AS constraint_type,
  pg_get_constraintdef(constraint_record.oid, true) AS constraint_definition
FROM pg_catalog.pg_constraint AS constraint_record
JOIN pg_catalog.pg_class AS relation
  ON relation.oid = constraint_record.conrelid
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND constraint_record.contype IN ('p', 'f', 'u', 'c')
  AND (
    relation.relname IN (
      'app_workspaces',
      'app_workspace_members',
      'app_pairing_codes',
      'app_devices',
      'hooto_day_sync_records'
    )
    OR lower(relation.relname) ~ '(workspace|member|pairing|device|sync|hooto)'
  )
ORDER BY relation.relname, constraint_type, constraint_record.conname;

-- ==================================================
-- 05. インデックス
-- ==================================================

SELECT
  '05_related_indexes' AS section,
  namespace.nspname AS schema_name,
  table_relation.relname AS table_name,
  index_relation.relname AS index_name,
  pg_get_indexdef(index_record.indexrelid) AS index_definition,
  index_record.indisunique AS is_unique,
  index_record.indisprimary AS is_primary
FROM pg_catalog.pg_index AS index_record
JOIN pg_catalog.pg_class AS table_relation
  ON table_relation.oid = index_record.indrelid
JOIN pg_catalog.pg_class AS index_relation
  ON index_relation.oid = index_record.indexrelid
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = table_relation.relnamespace
WHERE namespace.nspname = 'public'
  AND (
    table_relation.relname IN (
      'app_workspaces',
      'app_workspace_members',
      'app_pairing_codes',
      'app_devices',
      'hooto_day_sync_records'
    )
    OR lower(table_relation.relname) ~ '(workspace|member|pairing|device|sync|hooto)'
  )
ORDER BY table_relation.relname, index_relation.relname;

-- ==================================================
-- 06. RLS有効状態
-- ==================================================

SELECT
  '06_related_rls_status' AS section,
  namespace.nspname AS schema_name,
  relation.relname AS table_name,
  relation.relrowsecurity AS row_security_enabled,
  relation.relforcerowsecurity AS row_security_forced
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'public'
  AND relation.relkind IN ('r', 'p')
  AND (
    relation.relname IN (
      'app_workspaces',
      'app_workspace_members',
      'app_pairing_codes',
      'app_devices',
      'hooto_day_sync_records'
    )
    OR lower(relation.relname) ~ '(workspace|member|pairing|device|sync|hooto)'
  )
ORDER BY relation.relname;

-- ==================================================
-- 07. RLS policy
-- ==================================================

SELECT
  '07_related_policies' AS section,
  policies.schemaname,
  policies.tablename,
  policies.policyname,
  policies.permissive,
  policies.roles,
  policies.cmd,
  policies.qual,
  policies.with_check
FROM pg_catalog.pg_policies AS policies
WHERE policies.schemaname = 'public'
  AND (
    policies.tablename IN (
      'app_workspaces',
      'app_workspace_members',
      'app_pairing_codes',
      'app_devices',
      'hooto_day_sync_records'
    )
    OR lower(policies.tablename) ~ '(workspace|member|pairing|device|sync|hooto)'
  )
ORDER BY policies.tablename, policies.policyname;

-- ==================================================
-- 08. 関連RPC・関数一覧
-- ==================================================

WITH related_functions AS (
  SELECT
    function_record.oid,
    namespace.nspname AS function_schema,
    function_record.proname AS function_name,
    function_record.prosecdef,
    function_record.provolatile,
    language.lanname AS language,
    owner_role.rolname AS owner
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function_record.pronamespace
  JOIN pg_catalog.pg_language AS language
    ON language.oid = function_record.prolang
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = function_record.proowner
  WHERE namespace.nspname = 'public'
    AND function_record.prokind = 'f'
    AND lower(function_record.proname) ~ '(workspace|member|pairing|pair|device|sync|hooto|song|post)'
)
SELECT
  '08_related_functions' AS section,
  related_functions.function_schema,
  related_functions.function_name,
  pg_get_function_identity_arguments(related_functions.oid) AS identity_arguments,
  pg_get_function_result(related_functions.oid) AS return_type,
  related_functions.prosecdef AS security_definer,
  CASE related_functions.provolatile
    WHEN 'i' THEN 'IMMUTABLE'
    WHEN 's' THEN 'STABLE'
    WHEN 'v' THEN 'VOLATILE'
  END AS volatility,
  related_functions.language,
  related_functions.owner
FROM related_functions
ORDER BY related_functions.function_name, identity_arguments;

-- ==================================================
-- 09. 関連RPC・関数定義
-- ==================================================

SELECT
  '09_related_function_definitions' AS section,
  namespace.nspname AS function_schema,
  function_record.proname AS function_name,
  pg_get_function_identity_arguments(function_record.oid) AS identity_arguments,
  pg_get_functiondef(function_record.oid) AS function_definition
FROM pg_catalog.pg_proc AS function_record
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = function_record.pronamespace
WHERE namespace.nspname = 'public'
  AND function_record.prokind = 'f'
  AND lower(function_record.proname) ~ '(workspace|member|pairing|pair|device|sync|hooto|song|post)'
ORDER BY function_record.proname, identity_arguments;

-- ==================================================
-- 10. ユーザー定義trigger
-- ==================================================

SELECT
  '10_related_triggers' AS section,
  table_namespace.nspname AS schema_name,
  table_relation.relname AS table_name,
  trigger_record.tgname AS trigger_name,
  pg_get_triggerdef(trigger_record.oid, true) AS trigger_definition,
  trigger_record.tgenabled AS enabled_state,
  function_namespace.nspname || '.' || trigger_function.proname AS trigger_function
FROM pg_catalog.pg_trigger AS trigger_record
JOIN pg_catalog.pg_class AS table_relation
  ON table_relation.oid = trigger_record.tgrelid
JOIN pg_catalog.pg_namespace AS table_namespace
  ON table_namespace.oid = table_relation.relnamespace
JOIN pg_catalog.pg_proc AS trigger_function
  ON trigger_function.oid = trigger_record.tgfoid
JOIN pg_catalog.pg_namespace AS function_namespace
  ON function_namespace.oid = trigger_function.pronamespace
WHERE NOT trigger_record.tgisinternal
  AND table_namespace.nspname = 'public'
  AND (
    table_relation.relname IN (
      'app_workspaces',
      'app_workspace_members',
      'app_pairing_codes',
      'app_devices',
      'hooto_day_sync_records'
    )
    OR lower(table_relation.relname) ~ '(workspace|member|pairing|device|sync|hooto)'
  )
ORDER BY table_relation.relname, trigger_record.tgname;

-- ==================================================
-- 11. 関連テーブルのGRANT
-- ==================================================

SELECT
  '11_related_table_grants' AS section,
  grants.table_schema,
  grants.table_name,
  grants.grantee,
  grants.privilege_type,
  grants.is_grantable
FROM information_schema.role_table_grants AS grants
WHERE grants.table_schema = 'public'
  AND grants.grantee IN ('anon', 'authenticated', 'postgres', 'service_role')
  AND (
    grants.table_name IN (
      'app_workspaces',
      'app_workspace_members',
      'app_pairing_codes',
      'app_devices',
      'hooto_day_sync_records'
    )
    OR lower(grants.table_name) ~ '(workspace|member|pairing|device|sync|hooto)'
  )
ORDER BY grants.table_name, grants.grantee, grants.privilege_type;

-- ==================================================
-- 12. 関連RPC・関数の実行GRANT
-- ==================================================

SELECT
  '12_related_function_grants' AS section,
  privileges.routine_schema AS function_schema,
  privileges.routine_name AS function_name,
  privileges.grantee,
  privileges.privilege_type,
  privileges.is_grantable
FROM information_schema.routine_privileges AS privileges
WHERE privileges.routine_schema = 'public'
  AND privileges.grantee IN ('anon', 'authenticated', 'PUBLIC')
  AND lower(privileges.routine_name) ~ '(workspace|member|pairing|pair|device|sync|hooto|song|post)'
ORDER BY privileges.routine_name, privileges.grantee, privileges.privilege_type;

-- ==================================================
-- 13. 関連extension
-- ==================================================

SELECT
  '13_related_extensions' AS section,
  extension_record.extname AS extension_name,
  extension_record.extversion AS extension_version,
  namespace.nspname AS schema_name
FROM pg_catalog.pg_extension AS extension_record
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = extension_record.extnamespace
WHERE extension_record.extname IN ('pgcrypto', 'uuid-ossp', 'citext', 'pg_cron')
ORDER BY extension_record.extname;

COMMIT;
