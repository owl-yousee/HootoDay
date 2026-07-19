/*
関連RPC・関数定義の確認（実行順2/3）

実行順:
1. SUPABASE_INSPECT_FUNCTIONS.sql
2. SUPABASE_INSPECT_FUNCTION_DEFINITIONS.sql（このファイル）
3. SUPABASE_INSPECT_FUNCTION_GRANTS.sql

手順:
1. Supabase SQL EditorでNew queryを開く。
2. このSQL全文を貼る。
3. Runを押す。
4. ResultsをCSVでDownloadする。
5. CSVをChatGPT/Codexへアップロードする。

このSQLは関数を実行せず、public schemaの関数定義だけを読み取る。
関数定義に秘密情報らしき固定値が含まれていた場合は、共有前に必ず伏せ字にする。
*/

WITH matched_functions AS (
  SELECT
    function_record.oid,
    namespace.nspname AS function_schema,
    function_record.proname AS function_name
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function_record.pronamespace
  WHERE namespace.nspname = 'public'
    AND function_record.prokind = 'f'
    AND (
      lower(function_record.proname) LIKE '%workspace%'
      OR lower(function_record.proname) LIKE '%member%'
      OR lower(function_record.proname) LIKE '%pairing%'
      OR lower(function_record.proname) LIKE '%pair%'
      OR lower(function_record.proname) LIKE '%state%'
      OR lower(function_record.proname) LIKE '%sync%'
      OR lower(function_record.proname) LIKE '%hooto%'
      OR lower(function_record.proname) LIKE '%post%'
      OR lower(function_record.proname) LIKE '%song%'
    )
),
combined_results AS (
  SELECT
    0 AS sort_group,
    'summary' AS section,
    NULL::name AS function_schema,
    'found_function_definition_count_' || count(*)::text AS function_name,
    NULL::text AS identity_arguments,
    NULL::text AS function_definition
  FROM matched_functions

  UNION ALL

  SELECT
    1 AS sort_group,
    'function_definition' AS section,
    matched_functions.function_schema,
    matched_functions.function_name,
    pg_get_function_identity_arguments(matched_functions.oid) AS identity_arguments,
    pg_get_functiondef(matched_functions.oid) AS function_definition
  FROM matched_functions
)
SELECT
  combined_results.section,
  combined_results.function_schema,
  combined_results.function_name,
  combined_results.identity_arguments,
  combined_results.function_definition
FROM combined_results
ORDER BY
  combined_results.sort_group,
  combined_results.function_name,
  combined_results.identity_arguments;
