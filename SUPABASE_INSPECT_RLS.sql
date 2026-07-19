/*
既存同期基盤4テーブルのRLS状態確認（実行順3/4）

1. Supabase SQL EditorでNew queryを開く。
2. このSQL全文を貼る。
3. Runを押す。
4. ResultsをCSVでDownloadする。
5. CSVをChatGPT/Codexへアップロードする。

実行順:
1. SUPABASE_INSPECT_CONSTRAINTS.sql
2. SUPABASE_INSPECT_INDEXES.sql
3. SUPABASE_INSPECT_RLS.sql（このファイル）
4. SUPABASE_INSPECT_POLICIES.sql

このSQLはpg_catalogからRLS設定だけを読み取り、データを変更しない。
*/

WITH target_tables(table_name, table_order) AS (
  VALUES
    ('app_workspaces', 1),
    ('app_workspace_members', 2),
    ('app_pairing_codes', 3),
    ('app_workspace_state', 4)
),
rls_status AS (
  SELECT
    target_tables.table_order,
    relation.oid AS relation_oid,
    CASE
      WHEN relation.oid IS NULL THEN 'table_not_found'
      ELSE 'rls_status'
    END AS section,
    COALESCE(namespace.nspname, 'public') AS schema_name,
    target_tables.table_name,
    relation.relrowsecurity AS row_security_enabled,
    relation.relforcerowsecurity AS row_security_forced
  FROM target_tables
  LEFT JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS relation
    ON relation.relnamespace = namespace.oid
   AND relation.relname = target_tables.table_name
   AND relation.relkind IN ('r', 'p')
),
combined_results AS (
  SELECT
    0 AS sort_group,
    0 AS table_order,
    'summary' AS section,
    NULL::text AS schema_name,
    'found_table_count_' || count(relation_oid)::text AS table_name,
    NULL::boolean AS row_security_enabled,
    NULL::boolean AS row_security_forced
  FROM rls_status

  UNION ALL

  SELECT
    1 AS sort_group,
    rls_status.table_order,
    rls_status.section,
    rls_status.schema_name,
    rls_status.table_name,
    rls_status.row_security_enabled,
    rls_status.row_security_forced
  FROM rls_status
)
SELECT
  combined_results.section,
  combined_results.schema_name,
  combined_results.table_name,
  combined_results.row_security_enabled,
  combined_results.row_security_forced
FROM combined_results
ORDER BY combined_results.sort_group, combined_results.table_order;
