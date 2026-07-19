/*
既存同期基盤4テーブルのindex確認（実行順2/4）

1. Supabase SQL EditorでNew queryを開く。
2. このSQL全文を貼る。
3. Runを押す。
4. ResultsをCSVでDownloadする。
5. CSVをChatGPT/Codexへアップロードする。

実行順:
1. SUPABASE_INSPECT_CONSTRAINTS.sql
2. SUPABASE_INSPECT_INDEXES.sql（このファイル）
3. SUPABASE_INSPECT_RLS.sql
4. SUPABASE_INSPECT_POLICIES.sql

このSQLはpg_catalogからindex定義だけを読み取り、データを変更しない。
*/

WITH target_tables(table_name, table_order) AS (
  VALUES
    ('app_workspaces', 1),
    ('app_workspace_members', 2),
    ('app_pairing_codes', 3),
    ('app_workspace_state', 4)
),
matched_indexes AS (
  SELECT
    target_tables.table_order,
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
  JOIN target_tables
    ON target_tables.table_name = table_relation.relname
  WHERE namespace.nspname = 'public'
),
combined_results AS (
  SELECT
    0 AS sort_group,
    0 AS table_order,
    'summary' AS section,
    NULL::text AS schema_name,
    NULL::text AS table_name,
    'found_index_count_' || count(*)::text AS index_name,
    NULL::text AS index_definition,
    NULL::boolean AS is_unique,
    NULL::boolean AS is_primary
  FROM matched_indexes

  UNION ALL

  SELECT
    1 AS sort_group,
    matched_indexes.table_order,
    'index' AS section,
    matched_indexes.schema_name,
    matched_indexes.table_name,
    matched_indexes.index_name,
    matched_indexes.index_definition,
    matched_indexes.is_unique,
    matched_indexes.is_primary
  FROM matched_indexes
)
SELECT
  combined_results.section,
  combined_results.schema_name,
  combined_results.table_name,
  combined_results.index_name,
  combined_results.index_definition,
  combined_results.is_unique,
  combined_results.is_primary
FROM combined_results
ORDER BY
  combined_results.sort_group,
  combined_results.table_order,
  combined_results.table_name,
  combined_results.index_name;
