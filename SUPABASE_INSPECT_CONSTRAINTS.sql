/*
既存同期基盤4テーブルの制約確認（実行順1/4）

1. Supabase SQL EditorでNew queryを開く。
2. このSQL全文を貼る。
3. Runを押す。
4. ResultsをCSVでDownloadする。
5. CSVをChatGPT/Codexへアップロードする。

実行順:
1. SUPABASE_INSPECT_CONSTRAINTS.sql（このファイル）
2. SUPABASE_INSPECT_INDEXES.sql
3. SUPABASE_INSPECT_RLS.sql
4. SUPABASE_INSPECT_POLICIES.sql

このSQLはpg_catalogから制約定義だけを読み取り、データを変更しない。
*/

WITH target_tables(table_name, table_order) AS (
  VALUES
    ('app_workspaces', 1),
    ('app_workspace_members', 2),
    ('app_pairing_codes', 3),
    ('app_workspace_state', 4)
),
matched_constraints AS (
  SELECT
    target_tables.table_order,
    namespace.nspname AS table_schema,
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
  JOIN target_tables
    ON target_tables.table_name = relation.relname
  WHERE namespace.nspname = 'public'
    AND constraint_record.contype IN ('p', 'f', 'u', 'c')
),
combined_results AS (
  SELECT
    0 AS sort_group,
    0 AS table_order,
    'summary' AS section,
    NULL::text AS table_schema,
    NULL::text AS table_name,
    'found_constraint_count_' || count(*)::text AS constraint_name,
    NULL::text AS constraint_type,
    NULL::text AS constraint_definition
  FROM matched_constraints

  UNION ALL

  SELECT
    1 AS sort_group,
    matched_constraints.table_order,
    'constraint' AS section,
    matched_constraints.table_schema,
    matched_constraints.table_name,
    matched_constraints.constraint_name,
    matched_constraints.constraint_type,
    matched_constraints.constraint_definition
  FROM matched_constraints
)
SELECT
  combined_results.section,
  combined_results.table_schema,
  combined_results.table_name,
  combined_results.constraint_name,
  combined_results.constraint_type,
  combined_results.constraint_definition
FROM combined_results
ORDER BY
  combined_results.sort_group,
  combined_results.table_order,
  combined_results.table_name,
  combined_results.constraint_type,
  combined_results.constraint_name;
