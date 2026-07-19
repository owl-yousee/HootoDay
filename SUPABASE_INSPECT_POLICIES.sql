/*
既存同期基盤4テーブルのRLS policy確認（実行順4/4）

1. Supabase SQL EditorでNew queryを開く。
2. このSQL全文を貼る。
3. Runを押す。
4. ResultsをCSVでDownloadする。
5. CSVをChatGPT/Codexへアップロードする。

実行順:
1. SUPABASE_INSPECT_CONSTRAINTS.sql
2. SUPABASE_INSPECT_INDEXES.sql
3. SUPABASE_INSPECT_RLS.sql
4. SUPABASE_INSPECT_POLICIES.sql（このファイル）

このSQLはpg_policiesからpolicy定義だけを読み取り、データを変更しない。
*/

WITH target_tables(table_name, table_order) AS (
  VALUES
    ('app_workspaces', 1),
    ('app_workspace_members', 2),
    ('app_pairing_codes', 3),
    ('app_workspace_state', 4)
),
matched_policies AS (
  SELECT
    target_tables.table_order,
    policies.schemaname,
    policies.tablename,
    policies.policyname,
    policies.permissive,
    policies.roles,
    policies.cmd,
    policies.qual,
    policies.with_check
  FROM pg_catalog.pg_policies AS policies
  JOIN target_tables
    ON target_tables.table_name = policies.tablename
  WHERE policies.schemaname = 'public'
),
combined_results AS (
  SELECT
    0 AS sort_group,
    0 AS table_order,
    'summary' AS section,
    NULL::name AS schemaname,
    NULL::name AS tablename,
    'found_policy_count_' || count(*)::text AS policyname,
    NULL::text AS permissive,
    NULL::name[] AS roles,
    NULL::text AS cmd,
    NULL::text AS qual,
    NULL::text AS with_check
  FROM matched_policies

  UNION ALL

  SELECT
    1 AS sort_group,
    matched_policies.table_order,
    'policy' AS section,
    matched_policies.schemaname,
    matched_policies.tablename,
    matched_policies.policyname,
    matched_policies.permissive,
    matched_policies.roles,
    matched_policies.cmd,
    matched_policies.qual,
    matched_policies.with_check
  FROM matched_policies
)
SELECT
  combined_results.section,
  combined_results.schemaname,
  combined_results.tablename,
  combined_results.policyname,
  combined_results.permissive,
  combined_results.roles,
  combined_results.cmd,
  combined_results.qual,
  combined_results.with_check
FROM combined_results
ORDER BY
  combined_results.sort_group,
  combined_results.table_order,
  combined_results.tablename,
  combined_results.policyname;
