/*
関連RPC・関数一覧の確認（実行順1/3）

実行順:
1. SUPABASE_INSPECT_FUNCTIONS.sql（このファイル）
2. SUPABASE_INSPECT_FUNCTION_DEFINITIONS.sql
3. SUPABASE_INSPECT_FUNCTION_GRANTS.sql

手順:
1. Supabase SQL EditorでNew queryを開く。
2. このSQL全文を貼る。
3. Runを押す。
4. ResultsをCSVでDownloadする。
5. CSVをChatGPT/Codexへアップロードする。

このSQLはpublic schemaの関数メタデータだけを読み取り、関数を実行せず、
データも変更しない。
*/

WITH matched_functions AS (
  SELECT
    function_record.oid,
    namespace.nspname AS function_schema,
    function_record.proname AS function_name,
    function_record.prosecdef AS security_definer,
    function_record.provolatile,
    language.lanname AS language,
    owner_role.rolname AS owner_name
  FROM pg_catalog.pg_proc AS function_record
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = function_record.pronamespace
  JOIN pg_catalog.pg_language AS language
    ON language.oid = function_record.prolang
  JOIN pg_catalog.pg_roles AS owner_role
    ON owner_role.oid = function_record.proowner
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
    'found_function_count_' || count(*)::text AS function_name,
    NULL::text AS identity_arguments,
    NULL::text AS return_type,
    NULL::boolean AS security_definer,
    NULL::text AS volatility,
    NULL::name AS language,
    NULL::name AS owner_name
  FROM matched_functions

  UNION ALL

  SELECT
    1 AS sort_group,
    'function' AS section,
    matched_functions.function_schema,
    matched_functions.function_name,
    pg_get_function_identity_arguments(matched_functions.oid) AS identity_arguments,
    pg_get_function_result(matched_functions.oid) AS return_type,
    matched_functions.security_definer,
    CASE matched_functions.provolatile
      WHEN 'i' THEN 'IMMUTABLE'
      WHEN 's' THEN 'STABLE'
      WHEN 'v' THEN 'VOLATILE'
    END AS volatility,
    matched_functions.language,
    matched_functions.owner_name
  FROM matched_functions
)
SELECT
  combined_results.section,
  combined_results.function_schema,
  combined_results.function_name,
  combined_results.identity_arguments,
  combined_results.return_type,
  combined_results.security_definer,
  combined_results.volatility,
  combined_results.language,
  combined_results.owner_name
FROM combined_results
ORDER BY
  combined_results.sort_group,
  combined_results.function_name,
  combined_results.identity_arguments;
