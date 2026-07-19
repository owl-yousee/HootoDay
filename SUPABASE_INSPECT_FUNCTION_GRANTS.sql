/*
関連RPC・関数のEXECUTE権限確認（実行順3/3）

実行順:
1. SUPABASE_INSPECT_FUNCTIONS.sql
2. SUPABASE_INSPECT_FUNCTION_DEFINITIONS.sql
3. SUPABASE_INSPECT_FUNCTION_GRANTS.sql（このファイル）

手順:
1. Supabase SQL EditorでNew queryを開く。
2. このSQL全文を貼る。
3. Runを押す。
4. ResultsをCSVでDownloadする。
5. CSVをChatGPT/Codexへアップロードする。

このSQLはpublic schemaの関連関数に対する権限定義だけを読み取り、
関数を実行せず、データも変更しない。
*/

WITH matched_functions AS (
  SELECT
    function_record.oid,
    namespace.nspname AS function_schema,
    function_record.proname AS function_name,
    pg_get_function_identity_arguments(function_record.oid) AS identity_arguments
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
matched_grants AS (
  SELECT
    matched_functions.function_schema,
    matched_functions.function_name,
    matched_functions.identity_arguments,
    privileges.grantee::text AS grantee,
    privileges.privilege_type::text AS privilege_type,
    privileges.is_grantable::text AS is_grantable
  FROM matched_functions
  JOIN information_schema.routine_privileges AS privileges
    ON privileges.specific_schema = matched_functions.function_schema
   AND privileges.specific_name = matched_functions.function_name || '_' || matched_functions.oid::text
  WHERE privileges.grantee IN ('PUBLIC', 'anon', 'authenticated')
),
combined_results AS (
  SELECT
    0 AS sort_group,
    'summary' AS section,
    NULL::name AS function_schema,
    'found_function_grant_count_' || count(*)::text AS function_name,
    NULL::text AS identity_arguments,
    NULL::text AS grantee,
    NULL::text AS privilege_type,
    NULL::text AS is_grantable
  FROM matched_grants

  UNION ALL

  SELECT
    1 AS sort_group,
    'function_grant' AS section,
    matched_grants.function_schema,
    matched_grants.function_name,
    matched_grants.identity_arguments,
    matched_grants.grantee,
    matched_grants.privilege_type,
    matched_grants.is_grantable
  FROM matched_grants
)
SELECT
  combined_results.section,
  combined_results.function_schema,
  combined_results.function_name,
  combined_results.identity_arguments,
  combined_results.grantee,
  combined_results.privilege_type,
  combined_results.is_grantable
FROM combined_results
ORDER BY
  combined_results.sort_group,
  combined_results.function_name,
  combined_results.identity_arguments,
  combined_results.grantee;
