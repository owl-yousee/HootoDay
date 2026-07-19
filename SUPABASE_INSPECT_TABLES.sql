/*
関連publicテーブルの存在確認（1結果セット専用）

実行手順:
1. Supabase SQL EditorでNew queryを開く。
2. このSQL全文を貼る。
3. Runを押す。
4. ResultsをCSVでDownloadする。
5. CSVをChatGPT/Codexへアップロードする。

このSQLはinformation_schema.tablesから構造情報だけを読み取る。
テーブル内の実データは取得せず、データ変更も行わない。
*/

WITH exact_candidates(table_name) AS (
  VALUES
    ('app_workspaces'),
    ('app_workspace_members'),
    ('app_pairing_codes'),
    ('app_devices'),
    ('hooto_day_sync_records')
),
matched_tables AS (
  SELECT
    tables.table_schema,
    tables.table_name,
    tables.table_type,
    CASE
      WHEN exact_candidates.table_name IS NOT NULL THEN 'exact_candidate'
      ELSE 'related_name'
    END AS candidate_match
  FROM information_schema.tables AS tables
  LEFT JOIN exact_candidates
    ON exact_candidates.table_name = tables.table_name
  WHERE tables.table_schema = 'public'
    AND (
      exact_candidates.table_name IS NOT NULL
      OR lower(tables.table_name) LIKE '%workspace%'
      OR lower(tables.table_name) LIKE '%member%'
      OR lower(tables.table_name) LIKE '%pairing%'
      OR lower(tables.table_name) LIKE '%device%'
      OR lower(tables.table_name) LIKE '%sync%'
      OR lower(tables.table_name) LIKE '%hooto%'
      OR lower(tables.table_name) LIKE '%song%'
      OR lower(tables.table_name) LIKE '%post%'
      OR lower(tables.table_name) LIKE '%memo%'
    )
),
combined_results AS (
  SELECT
    0 AS sort_group,
    '' AS sort_name,
    'summary' AS section,
    NULL::text AS table_schema,
    NULL::text AS table_name,
    NULL::text AS table_type,
    'found_count_' || count(*)::text AS candidate_match
  FROM matched_tables

  UNION ALL

  SELECT
    CASE
      WHEN matched_tables.candidate_match = 'exact_candidate' THEN 1
      ELSE 2
    END AS sort_group,
    matched_tables.table_name AS sort_name,
    'table' AS section,
    matched_tables.table_schema,
    matched_tables.table_name,
    matched_tables.table_type,
    matched_tables.candidate_match
  FROM matched_tables
)
SELECT
  combined_results.section,
  combined_results.table_schema,
  combined_results.table_name,
  combined_results.table_type,
  combined_results.candidate_match
FROM combined_results
ORDER BY combined_results.sort_group, combined_results.sort_name;
