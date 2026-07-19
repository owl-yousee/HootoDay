-- HootoDay DayMemo sync infrastructure (design draft; not yet applied).
-- Review and take a current HootoDay JSON backup before manual SQL Editor use.
-- This transaction adds dedicated objects only. It does not alter the shared
-- workspace/member/pairing tables or RPCs, app_workspace_state,
-- current_hooto_sync_key_hash(), HootoPost, or HootoSong.
--
-- Empty client state is not deletion: only the explicit delete RPC creates a
-- tombstone, and no bulk replace/delete RPC exists. The PC must explicitly
-- upload first; an empty iPhone pulls first. JSON restore and local reset must
-- never automatically delete cloud data.
--
-- Workspace naming is only a provisional UI safeguard. Create a new visibly
-- named HootoDay workspace and do not select a HootoSong workspace. A name is
-- not a security boundary; app_key enforcement is deferred to v2.

BEGIN;

DO $preflight$
DECLARE
  conflict_name text;
BEGIN
  IF to_regclass('public.app_workspaces') IS NULL
     OR to_regclass('public.app_workspace_members') IS NULL
     OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'HootoDay apply stopped: required shared tables are missing';
  END IF;
  IF to_regprocedure('public.is_app_workspace_member(uuid)') IS NULL
     OR to_regprocedure('public.is_app_workspace_owner(uuid)') IS NULL THEN
    RAISE EXCEPTION 'HootoDay apply stopped: required membership helpers are missing';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon', 'authenticated')) <> 2 THEN
    RAISE EXCEPTION 'HootoDay apply stopped: required Supabase roles are missing';
  END IF;

  SELECT name INTO conflict_name
  FROM (
    SELECT 'public.hooto_day_sync_records' AS name
      WHERE to_regclass('public.hooto_day_sync_records') IS NOT NULL
    UNION ALL SELECT 'public.hooto_day_sync_operations'
      WHERE to_regclass('public.hooto_day_sync_operations') IS NOT NULL
    UNION ALL SELECT 'public.hooto_day_sync_result'
      WHERE to_regtype('public.hooto_day_sync_result') IS NOT NULL
    UNION ALL SELECT 'public.hooto_day_sync_change_seq'
      WHERE to_regclass('public.hooto_day_sync_change_seq') IS NOT NULL
    UNION ALL SELECT 'public.hooto_day_sync_operations_workspace_created_idx'
      WHERE to_regclass('public.hooto_day_sync_operations_workspace_created_idx') IS NOT NULL
    UNION ALL SELECT 'public.hooto_day_sync_records_pull_cursor_idx'
      WHERE to_regclass('public.hooto_day_sync_records_pull_cursor_idx') IS NOT NULL
    UNION ALL SELECT 'public.' || p.proname
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN (
        'hooto_day_upsert_sync_record',
        'hooto_day_delete_sync_record',
        'hooto_day_pull_sync_records'
      )
    UNION ALL SELECT 'policy:' || policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND (tablename LIKE 'hooto_day_sync_%'
             OR policyname LIKE 'hooto_day_sync_%')
  ) conflicts
  LIMIT 1;

  IF conflict_name IS NOT NULL THEN
    RAISE EXCEPTION 'HootoDay apply stopped: dedicated object exists: %', conflict_name;
  END IF;
END
$preflight$;

-- The sequence is the authoritative pull cursor. nextval is called explicitly
-- inside successful mutations, never by a column DEFAULT, so conflicts,
-- idempotent retries, and tombstone no-ops do not consume a change number.
-- Sequence gaps caused by rolled-back transactions are harmless.
CREATE SEQUENCE public.hooto_day_sync_change_seq
  AS bigint
  MINVALUE 1
  NO CYCLE;

REVOKE ALL ON SEQUENCE public.hooto_day_sync_change_seq
  FROM PUBLIC, anon, authenticated;

-- Operation ledger (B plan): storing both applied and conflict results makes
-- retries return the exact prior result and rejects reuse for another target.
-- result_payload can therefore retain an earlier memo version after a later
-- tombstone. Operation history is not indefinite: 30 days is the recommended
-- retention window, using created_at for a later manual/scheduled cleanup.
-- No cleanup job/RPC is added here; after cleanup, those operation IDs no
-- longer have a retry guarantee. Current records/tombstones are never cleanup
-- targets.
-- Transaction advisory locks make concurrent retries safe without a trigger.
CREATE TABLE public.hooto_day_sync_operations (
  operation_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.app_workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type = 'day_memo'),
  entity_id text NOT NULL CHECK (entity_id ~ '^\d{4}-\d{2}-\d{2}$'),
  operation_kind text NOT NULL CHECK (operation_kind IN ('upsert', 'delete')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  request_base_revision bigint NOT NULL CHECK (request_base_revision >= 0),
  -- MD5 is used only to bind an operation ID to canonical request content;
  -- it is not an authentication, authorization, or password hash.
  request_fingerprint text NOT NULL
    CHECK (request_fingerprint ~ '^[0-9a-f]{32}$'),
  result_status text NOT NULL CHECK (result_status IN ('applied', 'conflict')),
  result_revision bigint NOT NULL CHECK (result_revision >= 0),
  result_change_sequence bigint NOT NULL CHECK (result_change_sequence >= 0),
  result_server_updated_at timestamptz,
  result_deleted_at timestamptz,
  result_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE INDEX hooto_day_sync_operations_workspace_created_idx
  ON public.hooto_day_sync_operations (workspace_id, created_at, operation_id);

CREATE TABLE public.hooto_day_sync_records (
  workspace_id uuid NOT NULL REFERENCES public.app_workspaces(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type = 'day_memo'),
  entity_id text NOT NULL CHECK (entity_id ~ '^\d{4}-\d{2}-\d{2}$'),
  payload jsonb,
  schema_version integer NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  revision bigint NOT NULL CHECK (revision >= 1),
  change_sequence bigint NOT NULL CHECK (change_sequence >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  server_updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  client_updated_at timestamptz,
  -- RPC writes always set auth.uid(); nullable + SET NULL preserves history
  -- if an anonymous auth account is later removed.
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source_device_id text CHECK (
    source_device_id IS NULL OR
    (char_length(source_device_id) BETWEEN 1 AND 200
     AND source_device_id = btrim(source_device_id))
  ),
  PRIMARY KEY (workspace_id, entity_type, entity_id),
  CHECK (
    (deleted_at IS NULL AND payload IS NOT NULL) OR
    (deleted_at IS NOT NULL AND payload IS NULL)
  )
);

CREATE UNIQUE INDEX hooto_day_sync_records_pull_cursor_idx
  ON public.hooto_day_sync_records
    (change_sequence);

CREATE TYPE public.hooto_day_sync_result AS (
  status text,
  workspace_id uuid,
  entity_type text,
  entity_id text,
  revision bigint,
  change_sequence bigint,
  server_updated_at timestamptz,
  deleted_at timestamptz,
  payload jsonb,
  conflict boolean
);

-- All reads and writes are RPC-only. With no direct policies, RLS is a second
-- barrier. SECURITY DEFINER RPCs must still check auth.uid() and membership.
ALTER TABLE public.hooto_day_sync_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hooto_day_sync_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.hooto_day_sync_records FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.hooto_day_sync_operations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TYPE public.hooto_day_sync_result FROM PUBLIC, anon;
GRANT USAGE ON TYPE public.hooto_day_sync_result TO authenticated;

CREATE FUNCTION public.hooto_day_upsert_sync_record(
  target_workspace_id uuid,
  target_entity_type text,
  target_entity_id text,
  target_payload jsonb,
  target_schema_version integer,
  base_revision bigint,
  operation_id uuid,
  client_updated_at timestamptz DEFAULT NULL,
  source_device_id text DEFAULT NULL
)
RETURNS public.hooto_day_sync_result
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  current_row public.hooto_day_sync_records%ROWTYPE;
  prior_op public.hooto_day_sync_operations%ROWTYPE;
  answer public.hooto_day_sync_result;
  parsed_date date;
  now_at timestamptz;
  content_value text;
  request_fingerprint text;
  trim_characters text := ' ' || chr(9) || chr(10) || chr(11) || chr(12) ||
    chr(13) || chr(160) || chr(5760) || chr(6158) || chr(8192) || chr(8193) ||
    chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) ||
    chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) ||
    chr(8287) || chr(12288) || chr(65279);
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  IF target_workspace_id IS NULL OR NOT public.is_app_workspace_member(target_workspace_id) THEN
    RAISE EXCEPTION 'Workspace membership is required';
  END IF;
  IF target_entity_type IS DISTINCT FROM 'day_memo' THEN
    RAISE EXCEPTION 'Only day_memo is supported';
  END IF;
  IF target_entity_id IS NULL OR target_entity_id !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'entity_id must be a valid YYYY-MM-DD date';
  END IF;
  BEGIN parsed_date := target_entity_id::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'entity_id must be a valid YYYY-MM-DD date';
  END;
  IF to_char(parsed_date, 'YYYY-MM-DD') <> target_entity_id THEN
    RAISE EXCEPTION 'entity_id must be a valid YYYY-MM-DD date';
  END IF;
  IF target_schema_version IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'DayMemo schema_version must be 1';
  END IF;
  IF base_revision IS NULL OR base_revision < 0 THEN
    RAISE EXCEPTION 'base_revision must be 0 or the current revision';
  END IF;
  IF operation_id IS NULL THEN RAISE EXCEPTION 'operation_id is required'; END IF;
  IF source_device_id IS NOT NULL AND
     (char_length(source_device_id) NOT BETWEEN 1 AND 200
      OR source_device_id <> btrim(source_device_id)) THEN
    RAISE EXCEPTION 'source_device_id must be trimmed and at most 200 characters';
  END IF;

  IF target_payload IS NULL OR jsonb_typeof(target_payload) <> 'object' THEN
    RAISE EXCEPTION 'DayMemo payload must be an object';
  END IF;
  IF NOT target_payload ?& ARRAY['date', 'content', 'updatedAt']
     OR EXISTS (
       SELECT 1 FROM jsonb_object_keys(target_payload) AS keys(key_name)
       WHERE key_name NOT IN ('date', 'content', 'updatedAt')
     ) THEN
    RAISE EXCEPTION 'DayMemo payload must contain exactly date, content, updatedAt';
  END IF;
  IF jsonb_typeof(target_payload -> 'date') <> 'string'
     OR target_payload ->> 'date' <> target_entity_id THEN
    RAISE EXCEPTION 'DayMemo date must match entity_id';
  END IF;
  IF jsonb_typeof(target_payload -> 'content') <> 'string' THEN
    RAISE EXCEPTION 'DayMemo content must be a string';
  END IF;
  content_value := target_payload ->> 'content';
  IF char_length(content_value) NOT BETWEEN 1 AND 2000
     OR content_value <> btrim(content_value, trim_characters)
     OR content_value = '' THEN
    RAISE EXCEPTION 'DayMemo content must be trimmed, nonblank, and 1 to 2000 characters; use delete for empty content';
  END IF;
  IF jsonb_typeof(target_payload -> 'updatedAt') <> 'string'
     OR (target_payload ->> 'updatedAt') !~
       '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' THEN
    RAISE EXCEPTION 'DayMemo updatedAt must be an ISO 8601 timestamp string';
  END IF;
  BEGIN PERFORM (target_payload ->> 'updatedAt')::timestamptz;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'DayMemo updatedAt must be a valid ISO 8601 timestamp';
  END;

  -- jsonb::text has deterministic object-key ordering. jsonb_build_object
  -- converts SQL NULL to JSON null, so those two null representations are not
  -- distinguished by the fingerprint itself. Valid upserts reject SQL NULL
  -- and JSON-null payloads before this point; delete uses a distinct
  -- operation_kind and fixed null fields. Optional empty strings are either
  -- rejected or remain JSON strings, so valid requests are unambiguous.
  request_fingerprint := pg_catalog.md5(jsonb_build_object(
    'workspace_id', target_workspace_id::text,
    'entity_type', target_entity_type,
    'entity_id', target_entity_id,
    'operation_kind', 'upsert',
    'requested_by', caller_id::text,
    'base_revision', base_revision,
    'schema_version', target_schema_version,
    'payload', target_payload,
    'client_updated_at_epoch', extract(epoch FROM client_updated_at),
    'source_device_id', source_device_id,
    'operation_id', operation_id::text
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended($7::text, 0));
  SELECT * INTO prior_op FROM public.hooto_day_sync_operations o
  WHERE o.operation_id = $7;
  IF FOUND THEN
    IF prior_op.workspace_id <> target_workspace_id
       OR prior_op.entity_type <> target_entity_type
       OR prior_op.entity_id <> target_entity_id
       OR prior_op.operation_kind <> 'upsert'
       OR prior_op.requested_by IS DISTINCT FROM caller_id
       OR prior_op.request_base_revision <> base_revision
       OR prior_op.request_fingerprint <> request_fingerprint THEN
      RAISE EXCEPTION 'operation_id was already used for a different request';
    END IF;
    RETURN (prior_op.result_status, prior_op.workspace_id, prior_op.entity_type,
      prior_op.entity_id, prior_op.result_revision,
      prior_op.result_change_sequence,
      prior_op.result_server_updated_at, prior_op.result_deleted_at,
      prior_op.result_payload, prior_op.result_status = 'conflict')
      ::public.hooto_day_sync_result;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_workspace_id::text || ':' || target_entity_type || ':' || target_entity_id, 0));
  SELECT * INTO current_row FROM public.hooto_day_sync_records r
  WHERE r.workspace_id = target_workspace_id AND r.entity_type = target_entity_type
    AND r.entity_id = target_entity_id FOR UPDATE;

  IF (NOT FOUND AND base_revision <> 0)
     OR (FOUND AND current_row.revision <> base_revision) THEN
    IF current_row.workspace_id IS NULL THEN
      answer := ('conflict', target_workspace_id, target_entity_type,
        target_entity_id, 0, 0, NULL, NULL, NULL, true)::public.hooto_day_sync_result;
    ELSE
      answer := ('conflict', current_row.workspace_id, current_row.entity_type,
        current_row.entity_id, current_row.revision, current_row.change_sequence,
        current_row.server_updated_at,
        current_row.deleted_at, current_row.payload, true)::public.hooto_day_sync_result;
    END IF;
  ELSE
    -- Sequence values alone do not imply commit order. This dedicated two-key
    -- transaction lock serializes successful HootoDay mutations until commit,
    -- preventing a later change from becoming visible before an earlier one.
    PERFORM pg_advisory_xact_lock(1213219668, 1);
    now_at := pg_catalog.clock_timestamp();
    IF current_row.workspace_id IS NULL THEN
      INSERT INTO public.hooto_day_sync_records (
        workspace_id, entity_type, entity_id, payload, schema_version, revision,
        change_sequence,
        deleted_at, created_at, server_updated_at, client_updated_at,
        updated_by, source_device_id
      ) VALUES (
        target_workspace_id, target_entity_type, target_entity_id, target_payload,
        1, 1, nextval('public.hooto_day_sync_change_seq'::regclass),
        NULL, now_at, now_at, $8, caller_id, $9
      ) RETURNING * INTO current_row;
    ELSE
      -- Keep each entity cursor strictly increasing even if the database clock
      -- has microsecond ties during rapid consecutive writes.
      now_at := greatest(now_at, current_row.server_updated_at + interval '1 microsecond');
      UPDATE public.hooto_day_sync_records r SET
        payload = target_payload, schema_version = 1,
        revision = current_row.revision + 1, deleted_at = NULL,
        change_sequence = nextval('public.hooto_day_sync_change_seq'::regclass),
        server_updated_at = now_at,
        client_updated_at = $8,
        updated_by = caller_id,
        source_device_id = $9
      WHERE r.workspace_id = target_workspace_id AND r.entity_type = target_entity_type
        AND r.entity_id = target_entity_id RETURNING * INTO current_row;
    END IF;
    answer := ('applied', current_row.workspace_id, current_row.entity_type,
      current_row.entity_id, current_row.revision, current_row.change_sequence,
      current_row.server_updated_at,
      current_row.deleted_at, current_row.payload, false)::public.hooto_day_sync_result;
  END IF;

  INSERT INTO public.hooto_day_sync_operations (
    operation_id, workspace_id, entity_type, entity_id, operation_kind,
    requested_by, request_base_revision, request_fingerprint,
    result_status, result_revision, result_change_sequence,
    result_server_updated_at, result_deleted_at, result_payload
  ) VALUES ($7, target_workspace_id, target_entity_type, target_entity_id,
    'upsert', caller_id, base_revision, request_fingerprint,
    answer.status, answer.revision, answer.change_sequence,
    answer.server_updated_at, answer.deleted_at, answer.payload);
  RETURN answer;
END
$function$;

-- Tombstones clear payload from the current record. Exact retry history in the
-- operation ledger is separate and needs a later reviewed retention policy.
-- Explicit restore requires the latest tombstone revision.
CREATE FUNCTION public.hooto_day_delete_sync_record(
  target_workspace_id uuid,
  target_entity_type text,
  target_entity_id text,
  base_revision bigint,
  operation_id uuid,
  client_updated_at timestamptz DEFAULT NULL,
  source_device_id text DEFAULT NULL
)
RETURNS public.hooto_day_sync_result
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  current_row public.hooto_day_sync_records%ROWTYPE;
  prior_op public.hooto_day_sync_operations%ROWTYPE;
  answer public.hooto_day_sync_result;
  parsed_date date;
  now_at timestamptz;
  request_fingerprint text;
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  IF target_workspace_id IS NULL OR NOT public.is_app_workspace_member(target_workspace_id) THEN
    RAISE EXCEPTION 'Workspace membership is required';
  END IF;
  IF target_entity_type IS DISTINCT FROM 'day_memo' THEN
    RAISE EXCEPTION 'Only day_memo is supported';
  END IF;
  IF target_entity_id IS NULL OR target_entity_id !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'entity_id must be a valid YYYY-MM-DD date';
  END IF;
  BEGIN parsed_date := target_entity_id::date;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN
    RAISE EXCEPTION 'entity_id must be a valid YYYY-MM-DD date';
  END;
  IF to_char(parsed_date, 'YYYY-MM-DD') <> target_entity_id THEN
    RAISE EXCEPTION 'entity_id must be a valid YYYY-MM-DD date';
  END IF;
  IF base_revision IS NULL OR base_revision < 0 THEN
    RAISE EXCEPTION 'base_revision must be 0 or the current revision';
  END IF;
  IF operation_id IS NULL THEN RAISE EXCEPTION 'operation_id is required'; END IF;
  IF source_device_id IS NOT NULL AND
     (char_length(source_device_id) NOT BETWEEN 1 AND 200
      OR source_device_id <> btrim(source_device_id)) THEN
    RAISE EXCEPTION 'source_device_id must be trimmed and at most 200 characters';
  END IF;

  -- SQL NULL becomes JSON null in jsonb_build_object. Delete deliberately uses
  -- fixed null values for fields absent from this RPC and is separated from
  -- upsert by operation_kind. Empty strings remain strings and invalid empty
  -- source-device input is rejected before fingerprinting.
  request_fingerprint := pg_catalog.md5(jsonb_build_object(
    'workspace_id', target_workspace_id::text,
    'entity_type', target_entity_type,
    'entity_id', target_entity_id,
    'operation_kind', 'delete',
    'requested_by', caller_id::text,
    'base_revision', base_revision,
    'schema_version', NULL,
    'payload', NULL,
    'client_updated_at_epoch', extract(epoch FROM client_updated_at),
    'source_device_id', source_device_id,
    'operation_id', operation_id::text
  )::text);

  PERFORM pg_advisory_xact_lock(hashtextextended($5::text, 0));
  SELECT * INTO prior_op FROM public.hooto_day_sync_operations o
  WHERE o.operation_id = $5;
  IF FOUND THEN
    IF prior_op.workspace_id <> target_workspace_id
       OR prior_op.entity_type <> target_entity_type
       OR prior_op.entity_id <> target_entity_id
       OR prior_op.operation_kind <> 'delete'
       OR prior_op.requested_by IS DISTINCT FROM caller_id
       OR prior_op.request_base_revision <> base_revision
       OR prior_op.request_fingerprint <> request_fingerprint THEN
      RAISE EXCEPTION 'operation_id was already used for a different request';
    END IF;
    RETURN (prior_op.result_status, prior_op.workspace_id, prior_op.entity_type,
      prior_op.entity_id, prior_op.result_revision,
      prior_op.result_change_sequence,
      prior_op.result_server_updated_at, prior_op.result_deleted_at,
      prior_op.result_payload, prior_op.result_status = 'conflict')
      ::public.hooto_day_sync_result;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    target_workspace_id::text || ':' || target_entity_type || ':' || target_entity_id, 0));
  SELECT * INTO current_row FROM public.hooto_day_sync_records r
  WHERE r.workspace_id = target_workspace_id AND r.entity_type = target_entity_type
    AND r.entity_id = target_entity_id FOR UPDATE;

  IF (NOT FOUND AND base_revision <> 0)
     OR (FOUND AND current_row.revision <> base_revision) THEN
    IF current_row.workspace_id IS NULL THEN
      answer := ('conflict', target_workspace_id, target_entity_type,
        target_entity_id, 0, 0, NULL, NULL, NULL, true)::public.hooto_day_sync_result;
    ELSE
      answer := ('conflict', current_row.workspace_id, current_row.entity_type,
        current_row.entity_id, current_row.revision, current_row.change_sequence,
        current_row.server_updated_at,
        current_row.deleted_at, current_row.payload, true)::public.hooto_day_sync_result;
    END IF;
  ELSE
    IF current_row.workspace_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(1213219668, 1);
      now_at := pg_catalog.clock_timestamp();
      INSERT INTO public.hooto_day_sync_records (
        workspace_id, entity_type, entity_id, payload, schema_version, revision,
        change_sequence,
        deleted_at, created_at, server_updated_at, client_updated_at,
        updated_by, source_device_id
      ) VALUES (
        target_workspace_id, target_entity_type, target_entity_id, NULL, 1, 1,
        nextval('public.hooto_day_sync_change_seq'::regclass),
        now_at, now_at, now_at, $6, caller_id, $7
      ) RETURNING * INTO current_row;
    ELSIF current_row.deleted_at IS NULL THEN
      PERFORM pg_advisory_xact_lock(1213219668, 1);
      now_at := pg_catalog.clock_timestamp();
      now_at := greatest(now_at, current_row.server_updated_at + interval '1 microsecond');
      UPDATE public.hooto_day_sync_records r SET
        payload = NULL, revision = current_row.revision + 1,
        change_sequence = nextval('public.hooto_day_sync_change_seq'::regclass),
        deleted_at = now_at, server_updated_at = now_at,
        client_updated_at = $6,
        updated_by = caller_id,
        source_device_id = $7
      WHERE r.workspace_id = target_workspace_id AND r.entity_type = target_entity_type
        AND r.entity_id = target_entity_id RETURNING * INTO current_row;
    END IF;
    -- A repeat delete with a new operation ID is a no-op if the latest row is
    -- already a tombstone; its revision is not inflated.
    answer := ('applied', current_row.workspace_id, current_row.entity_type,
      current_row.entity_id, current_row.revision, current_row.change_sequence,
      current_row.server_updated_at,
      current_row.deleted_at, current_row.payload, false)::public.hooto_day_sync_result;
  END IF;

  INSERT INTO public.hooto_day_sync_operations (
    operation_id, workspace_id, entity_type, entity_id, operation_kind,
    requested_by, request_base_revision, request_fingerprint,
    result_status, result_revision, result_change_sequence,
    result_server_updated_at, result_deleted_at, result_payload
  ) VALUES ($5, target_workspace_id, target_entity_type, target_entity_id,
    'delete', caller_id, base_revision, request_fingerprint,
    answer.status, answer.revision, answer.change_sequence,
    answer.server_updated_at, answer.deleted_at, answer.payload);
  RETURN answer;
END
$function$;

-- The authoritative cursor is the globally ordered change_sequence. Successful
-- mutations are commit-serialized by the dedicated advisory lock above, so a
-- later visible change cannot cause an earlier uncommitted change to be skipped.
-- Tombstones are included; server_updated_at remains audit/display metadata.
CREATE FUNCTION public.hooto_day_pull_sync_records(
  target_workspace_id uuid,
  after_change_sequence bigint DEFAULT 0,
  limit_count integer DEFAULT 200
)
RETURNS SETOF public.hooto_day_sync_result
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
BEGIN
  IF caller_id IS NULL THEN RAISE EXCEPTION 'Authentication is required'; END IF;
  IF target_workspace_id IS NULL OR NOT public.is_app_workspace_member(target_workspace_id) THEN
    RAISE EXCEPTION 'Workspace membership is required';
  END IF;
  IF limit_count IS NULL OR limit_count NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'limit_count must be between 1 and 500';
  END IF;
  IF after_change_sequence IS NULL OR after_change_sequence < 0 THEN
    RAISE EXCEPTION 'after_change_sequence must be 0 or a previously returned value';
  END IF;

  RETURN QUERY
  SELECT 'current'::text, r.workspace_id, r.entity_type, r.entity_id, r.revision,
    r.change_sequence,
    r.server_updated_at, r.deleted_at, r.payload, false
  FROM public.hooto_day_sync_records r
  WHERE r.workspace_id = target_workspace_id AND r.entity_type = 'day_memo'
    AND r.change_sequence > after_change_sequence
  ORDER BY r.change_sequence
  LIMIT limit_count;
END
$function$;

REVOKE ALL ON FUNCTION public.hooto_day_upsert_sync_record(
  uuid, text, text, jsonb, integer, bigint, uuid, timestamptz, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hooto_day_delete_sync_record(
  uuid, text, text, bigint, uuid, timestamptz, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hooto_day_pull_sync_records(
  uuid, bigint, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hooto_day_upsert_sync_record(
  uuid, text, text, jsonb, integer, bigint, uuid, timestamptz, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hooto_day_delete_sync_record(
  uuid, text, text, bigint, uuid, timestamptz, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hooto_day_pull_sync_records(
  uuid, bigint, integer
) TO authenticated;

-- Static postflight only: no RPC call and no workspace/test data creation.
DO $postflight$
DECLARE
  required_check_column text;
BEGIN
  IF to_regclass('public.hooto_day_sync_records') IS NULL
     OR to_regclass('public.hooto_day_sync_operations') IS NULL
     OR to_regtype('public.hooto_day_sync_result') IS NULL
     OR to_regprocedure('public.hooto_day_upsert_sync_record(uuid,text,text,jsonb,integer,bigint,uuid,timestamptz,text)') IS NULL
     OR to_regprocedure('public.hooto_day_delete_sync_record(uuid,text,text,bigint,uuid,timestamptz,text)') IS NULL
     OR to_regprocedure('public.hooto_day_pull_sync_records(uuid,bigint,integer)') IS NULL
     OR to_regclass('public.hooto_day_sync_change_seq') IS NULL
     OR to_regclass('public.hooto_day_sync_operations_workspace_created_idx') IS NULL
     OR to_regclass('public.hooto_day_sync_records_pull_cursor_idx') IS NULL THEN
    RAISE EXCEPTION 'HootoDay apply stopped: a dedicated object was not created';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.hooto_day_sync_records'::regclass
      AND a.attname = 'change_sequence' AND NOT a.attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.hooto_day_sync_operations'::regclass
      AND a.attname = 'request_fingerprint' AND NOT a.attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = 'public.hooto_day_sync_operations'::regclass
      AND a.attname = 'result_change_sequence' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: required sync columns are missing';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('hooto_day_sync_records', 'hooto_day_sync_operations')
        AND c.relrowsecurity) <> 2 THEN
    RAISE EXCEPTION 'HootoDay apply stopped: RLS was not enabled on both tables';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename IN ('hooto_day_sync_records', 'hooto_day_sync_operations')
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: dedicated tables must have zero direct policies';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_sequence s
    JOIN pg_catalog.pg_class c ON c.oid = s.seqrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'hooto_day_sync_change_seq'
      AND c.relkind = 'S'
      AND s.seqtypid = 'pg_catalog.int8'::regtype
      AND s.seqstart = 1
      AND s.seqincrement = 1
      AND s.seqmin = 1
      AND s.seqmax = 9223372036854775807
      AND s.seqcache = 1
      AND NOT s.seqcycle
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: change sequence attributes are unexpected';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('PUBLIC'), ('anon'), ('authenticated')) AS roles(role_name)
    CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS privileges(privilege_name)
    WHERE CASE
      WHEN roles.role_name = 'PUBLIC' THEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          coalesce(c.relacl, pg_catalog.acldefault('s', c.relowner))
        ) acl
        WHERE c.oid = 'public.hooto_day_sync_change_seq'::regclass
          AND acl.grantee = 0
          AND acl.privilege_type = privileges.privilege_name
      )
      ELSE pg_catalog.has_sequence_privilege(
        roles.role_name,
        'public.hooto_day_sync_change_seq',
        privileges.privilege_name
      )
    END
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: client sequence privilege remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.hooto_day_sync_records'::regclass),
      ('public.hooto_day_sync_operations'::regclass)
    ) AS tables(table_oid)
    CROSS JOIN (VALUES ('PUBLIC'), ('anon'), ('authenticated')) AS roles(role_name)
    CROSS JOIN (VALUES
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
      ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
    ) AS privileges(privilege_name)
    WHERE CASE
      WHEN roles.role_name = 'PUBLIC' THEN EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class c
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
        ) acl
        WHERE c.oid = tables.table_oid
          AND acl.grantee = 0
          AND acl.privilege_type = privileges.privilege_name
      )
      ELSE pg_catalog.has_table_privilege(
        roles.role_name, tables.table_oid, privileges.privilege_name
      )
    END
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: direct client table privilege remains';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'hooto_day_sync_records'
      AND c.column_name = 'change_sequence'
      AND c.data_type = 'bigint'
      AND c.is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint con
    WHERE con.conrelid = 'public.hooto_day_sync_records'::regclass
      AND con.contype = 'c'
      AND position('change_sequence' IN
        pg_catalog.pg_get_expr(con.conbin, con.conrelid)) > 0
      AND position('>= 1' IN
        pg_catalog.pg_get_expr(con.conbin, con.conrelid)) > 0
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: change_sequence definition is unexpected';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
    WHERE i.indexrelid = 'public.hooto_day_sync_records_pull_cursor_idx'::regclass
      AND i.indrelid = 'public.hooto_day_sync_records'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indnkeyatts = 1 AND i.indnatts = 1
      AND i.indexprs IS NULL AND i.indpred IS NULL
      AND a.attname = 'change_sequence'
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: pull cursor index is unexpected';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'hooto_day_sync_operations'
      AND c.column_name = 'request_fingerprint'
      AND c.data_type = 'text' AND c.is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'hooto_day_sync_operations'
      AND c.column_name = 'result_change_sequence'
      AND c.data_type = 'bigint' AND c.is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'hooto_day_sync_operations'
      AND c.column_name = 'created_at'
      AND c.data_type = 'timestamp with time zone'
      AND c.is_nullable = 'NO'
      AND c.column_default LIKE '%clock_timestamp%'
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: operation management columns are unexpected';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint con
    JOIN LATERAL unnest(con.conkey) AS key_column(attnum) ON true
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = con.conrelid AND a.attnum = key_column.attnum
    WHERE con.conrelid = 'public.hooto_day_sync_operations'::regclass
      AND con.contype = 'p'
      AND cardinality(con.conkey) = 1
      AND a.attname = 'operation_id'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint con
    JOIN LATERAL unnest(con.conkey) AS key_column(attnum) ON true
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = con.conrelid AND a.attnum = key_column.attnum
    WHERE con.conrelid = 'public.hooto_day_sync_operations'::regclass
      AND con.contype = 'f' AND cardinality(con.conkey) = 1
      AND a.attname = 'workspace_id'
      AND con.confrelid = 'public.app_workspaces'::regclass
      AND con.confdeltype = 'c'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint con
    JOIN LATERAL unnest(con.conkey) AS key_column(attnum) ON true
    JOIN pg_catalog.pg_attribute a
      ON a.attrelid = con.conrelid AND a.attnum = key_column.attnum
    WHERE con.conrelid = 'public.hooto_day_sync_operations'::regclass
      AND con.contype = 'f' AND cardinality(con.conkey) = 1
      AND a.attname = 'requested_by'
      AND con.confrelid = 'auth.users'::regclass
      AND con.confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: operation primary/foreign keys are unexpected';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_index i
    JOIN pg_catalog.pg_attribute first_column
      ON first_column.attrelid = i.indrelid
      AND first_column.attnum = i.indkey[0]
    JOIN pg_catalog.pg_attribute second_column
      ON second_column.attrelid = i.indrelid
      AND second_column.attnum = i.indkey[1]
    JOIN pg_catalog.pg_attribute third_column
      ON third_column.attrelid = i.indrelid
      AND third_column.attnum = i.indkey[2]
    WHERE i.indexrelid =
        'public.hooto_day_sync_operations_workspace_created_idx'::regclass
      AND i.indrelid = 'public.hooto_day_sync_operations'::regclass
      AND NOT i.indisunique AND i.indisvalid AND i.indisready
      AND i.indnkeyatts = 3 AND i.indnatts = 3
      AND i.indexprs IS NULL AND i.indpred IS NULL
      AND first_column.attname = 'workspace_id'
      AND second_column.attname = 'created_at'
      AND third_column.attname = 'operation_id'
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: operation retention index is unexpected';
  END IF;

  FOREACH required_check_column IN ARRAY ARRAY[
    'entity_type', 'entity_id', 'operation_kind', 'request_base_revision',
    'request_fingerprint', 'result_status', 'result_revision',
    'result_change_sequence'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_constraint con
      WHERE con.conrelid = 'public.hooto_day_sync_operations'::regclass
        AND con.contype = 'c'
        AND position(required_check_column IN
          pg_catalog.pg_get_expr(con.conbin, con.conrelid)) > 0
    ) THEN
      RAISE EXCEPTION 'HootoDay apply stopped: operation check constraint missing for %',
        required_check_column;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.hooto_day_upsert_sync_record(uuid,text,text,jsonb,integer,bigint,uuid,timestamptz,text)'::regprocedure, false),
      ('public.hooto_day_delete_sync_record(uuid,text,text,bigint,uuid,timestamptz,text)'::regprocedure, false),
      ('public.hooto_day_pull_sync_records(uuid,bigint,integer)'::regprocedure, true)
    ) AS expected(function_oid, expected_setof)
    JOIN pg_catalog.pg_proc p ON p.oid = expected.function_oid
    WHERE NOT p.prosecdef
       OR p.prorettype <> 'public.hooto_day_sync_result'::regtype
       OR p.proretset <> expected.expected_setof
       OR NOT EXISTS (
         SELECT 1
         FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS settings(setting_value)
         WHERE replace(settings.setting_value, ' ', '') = 'search_path=pg_catalog,public'
       )
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: RPC security, search_path, or result type is unexpected';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.hooto_day_upsert_sync_record(uuid,text,text,jsonb,integer,bigint,uuid,timestamptz,text)'::regprocedure),
      ('public.hooto_day_delete_sync_record(uuid,text,text,bigint,uuid,timestamptz,text)'::regprocedure),
      ('public.hooto_day_pull_sync_records(uuid,bigint,integer)'::regprocedure)
    ) AS functions(function_oid)
    JOIN pg_catalog.pg_proc p ON p.oid = functions.function_oid
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.hooto_day_upsert_sync_record(uuid,text,text,jsonb,integer,bigint,uuid,timestamptz,text)'::regprocedure),
      ('public.hooto_day_delete_sync_record(uuid,text,text,bigint,uuid,timestamptz,text)'::regprocedure),
      ('public.hooto_day_pull_sync_records(uuid,bigint,integer)'::regprocedure)
    ) AS functions(function_oid)
    WHERE pg_catalog.has_function_privilege('anon', functions.function_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege(
         'authenticated', functions.function_oid, 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'HootoDay apply stopped: RPC client EXECUTE privileges are unexpected';
  END IF;
END
$postflight$;

COMMIT;
