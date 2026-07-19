/*
既存同期基盤4テーブルのカラム確認（1結果セット専用）

実行手順:
1. Supabase SQL EditorでNew queryを開く。
2. このSQL全文を貼る。
3. Runを押す。
4. ResultsをCSVでDownloadする。
5. CSVまたは結果画面をChatGPT/Codexへ共有する。

このSQLはinformation_schema.columnsからカラム定義だけを読み取る。
テーブル内の実データは取得せず、データ変更も行わない。
*/

WITH target_tables(table_name, table_order) AS (
  VALUES
    ('app_workspaces', 1),
    ('app_workspace_members', 2),
    ('app_pairing_codes', 3),
    ('app_workspace_state', 4)
),
matched_columns AS (
  SELECT
    target_tables.table_order,
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
  JOIN target_tables
    ON target_tables.table_name = columns.table_name
  WHERE columns.table_schema = 'public'
),
combined_results AS (
  SELECT
    0 AS sort_group,
    0 AS table_order,
    0 AS column_order,
    'summary' AS section,
    NULL::text AS table_schema,
    NULL::text AS table_name,
    NULL::integer AS ordinal_position,
    'found_column_count_' || count(*)::text AS column_name,
    NULL::text AS data_type,
    NULL::text AS udt_name,
    NULL::text AS is_nullable,
    NULL::text AS column_default,
    NULL::bigint AS character_maximum_length
  FROM matched_columns

  UNION ALL

  SELECT
    1 AS sort_group,
    matched_columns.table_order,
    matched_columns.ordinal_position AS column_order,
    'column' AS section,
    matched_columns.table_schema,
    matched_columns.table_name,
    matched_columns.ordinal_position,
    matched_columns.column_name,
    matched_columns.data_type,
    matched_columns.udt_name,
    matched_columns.is_nullable,
    matched_columns.column_default,
    matched_columns.character_maximum_length
  FROM matched_columns
)
SELECT
  combined_results.section,
  combined_results.table_schema,
  combined_results.table_name,
  combined_results.ordinal_position,
  combined_results.column_name,
  combined_results.data_type,
  combined_results.udt_name,
  combined_results.is_nullable,
  combined_results.column_default,
  combined_results.character_maximum_length
FROM combined_results
ORDER BY
  combined_results.sort_group,
  combined_results.table_order,
  combined_results.column_order;
