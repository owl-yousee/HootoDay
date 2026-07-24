-- HootoDay sales/inventory workspace snapshot sync foundation.
-- Repository design artifact only: this file has not been run against Supabase.
-- Review it, take a current HootoDay JSON backup, and run it manually in the
-- Supabase SQL Editor only after Sync Phase S-3 review is complete.
--
-- This transaction adds dedicated objects. It does not alter DayMemo objects,
-- shared workspace/member tables, existing inventory records, or local data.

BEGIN;

DO $preflight$
DECLARE
  conflict_name text;
BEGIN
  IF to_regclass('public.app_workspaces') IS NULL
     OR to_regclass('public.app_workspace_members') IS NULL
     OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Inventory sync apply stopped: required shared tables are missing';
  END IF;
  IF to_regprocedure('public.is_app_workspace_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Inventory sync apply stopped: membership helper is missing';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_roles
      WHERE rolname IN ('anon', 'authenticated')) <> 2 THEN
    RAISE EXCEPTION 'Inventory sync apply stopped: required Supabase roles are missing';
  END IF;

  SELECT name INTO conflict_name
  FROM (
    SELECT 'public.app_inventory_snapshots' AS name
      WHERE to_regclass('public.app_inventory_snapshots') IS NOT NULL
    UNION ALL SELECT 'public.app_inventory_snapshots_updated_at_idx'
      WHERE to_regclass('public.app_inventory_snapshots_updated_at_idx') IS NOT NULL
    UNION ALL SELECT 'public.app_inventory_snapshots_operation_idx'
      WHERE to_regclass('public.app_inventory_snapshots_operation_idx') IS NOT NULL
    UNION ALL SELECT 'public.' || p.proname
      FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN (
        'get_app_inventory_snapshot',
        'save_app_inventory_snapshot'
      )
    UNION ALL SELECT 'policy:' || policyname
      FROM pg_catalog.pg_policies
      WHERE schemaname = 'public'
        AND (tablename = 'app_inventory_snapshots'
             OR policyname LIKE 'app_inventory_snapshots_%')
  ) conflicts
  LIMIT 1;

  IF conflict_name IS NOT NULL THEN
    RAISE EXCEPTION 'Inventory sync apply stopped: dedicated object exists: %', conflict_name;
  END IF;
END
$preflight$;

CREATE TABLE public.app_inventory_snapshots (
  workspace_id uuid PRIMARY KEY
    REFERENCES public.app_workspaces(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (
    revision BETWEEN 1 AND 9007199254740991
  ),
  schema_version integer NOT NULL CHECK (schema_version = 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  content_fingerprint text NOT NULL CHECK (
    content_fingerprint ~ '^inv-[0-9a-f]{16}$'
  ),
  last_operation_id uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (
    snapshot ?& ARRAY[
      'schemaVersion',
      'workspaceId',
      'revision',
      'generatedAt',
      'products',
      'inventoryMovements',
      'eventSalesRecords',
      'boothSalesRecords',
      'boothWarehouseSalesRecords',
      'anniversaryCampaigns',
      'anniversaryShipments'
    ]::text[]
  ),
  CHECK (jsonb_typeof(snapshot->'workspaceId') = 'string'),
  CHECK (jsonb_typeof(snapshot->'schemaVersion') = 'number'),
  CHECK (jsonb_typeof(snapshot->'revision') = 'number'),
  CHECK (jsonb_typeof(snapshot->'generatedAt') = 'string'),
  CHECK (jsonb_typeof(snapshot->'products') = 'array'),
  CHECK (jsonb_typeof(snapshot->'inventoryMovements') = 'array'),
  CHECK (jsonb_typeof(snapshot->'eventSalesRecords') = 'array'),
  CHECK (jsonb_typeof(snapshot->'boothSalesRecords') = 'array'),
  CHECK (jsonb_typeof(snapshot->'boothWarehouseSalesRecords') = 'array'),
  CHECK (jsonb_typeof(snapshot->'anniversaryCampaigns') = 'array'),
  CHECK (jsonb_typeof(snapshot->'anniversaryShipments') = 'array'),
  CHECK ((snapshot->>'workspaceId')::uuid = workspace_id),
  CHECK ((snapshot->>'schemaVersion')::integer = schema_version),
  CHECK ((snapshot->>'revision')::bigint = revision)
);

CREATE INDEX app_inventory_snapshots_updated_at_idx
  ON public.app_inventory_snapshots (updated_at, workspace_id);

CREATE UNIQUE INDEX app_inventory_snapshots_operation_idx
  ON public.app_inventory_snapshots (last_operation_id)
  WHERE last_operation_id IS NOT NULL;

COMMENT ON TABLE public.app_inventory_snapshots IS
  'Current HootoDay sales/inventory schema-v1 snapshot, one row per workspace.';
COMMENT ON COLUMN public.app_inventory_snapshots.snapshot IS
  'Complete seven-array snapshot. Derived stock and sales totals are not stored.';
COMMENT ON COLUMN public.app_inventory_snapshots.last_operation_id IS
  'Most recently applied operation UUID, used to prevent immediate duplicate CAS.';

-- No direct table policy is created. RLS and revoked table privileges are a
-- second barrier; SECURITY DEFINER RPCs still authenticate and check membership.
ALTER TABLE public.app_inventory_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_inventory_snapshots FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_app_inventory_snapshot(
  target_workspace_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  current_row public.app_inventory_snapshots%ROWTYPE;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF target_workspace_id IS NULL
     OR NOT public.is_app_workspace_member(target_workspace_id) THEN
    RAISE EXCEPTION 'Workspace membership is required';
  END IF;

  SELECT * INTO current_row
  FROM public.app_inventory_snapshots s
  WHERE s.workspace_id = target_workspace_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'workspaceId', target_workspace_id::text,
      'revision', 0,
      'snapshot', NULL,
      'contentFingerprint', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'workspaceId', current_row.workspace_id::text,
    'revision', current_row.revision,
    'snapshot', current_row.snapshot,
    'contentFingerprint', current_row.content_fingerprint
  );
END
$function$;

CREATE FUNCTION public.save_app_inventory_snapshot(
  target_workspace_id uuid,
  operation_id uuid,
  base_revision bigint,
  target_snapshot jsonb,
  target_content_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  caller_id uuid := auth.uid();
  current_row public.app_inventory_snapshots%ROWTYPE;
  new_revision bigint;
  stored_snapshot jsonb;
  required_array text;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF target_workspace_id IS NULL
     OR NOT public.is_app_workspace_member(target_workspace_id) THEN
    RAISE EXCEPTION 'Workspace membership is required';
  END IF;
  IF operation_id IS NULL THEN
    RAISE EXCEPTION 'operation_id is required';
  END IF;
  IF base_revision IS NOT NULL
     AND (base_revision < 0 OR base_revision > 9007199254740991) THEN
    RAISE EXCEPTION 'base_revision must be null or a safe non-negative integer';
  END IF;
  IF jsonb_typeof(target_snapshot) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'snapshot must be an object';
  END IF;
  IF target_snapshot->>'workspaceId' IS DISTINCT FROM target_workspace_id::text THEN
    RAISE EXCEPTION 'snapshot workspace does not match the request';
  END IF;
  IF target_snapshot->>'schemaVersion' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'inventory snapshot schema version must be 1';
  END IF;
  IF target_snapshot->>'revision' IS NULL
     OR target_snapshot->>'revision' !~ '^(0|[1-9][0-9]*)$'
     OR (target_snapshot->>'revision')::numeric > 9007199254740991
     OR (base_revision IS NULL AND (target_snapshot->>'revision')::bigint <> 0)
     OR (base_revision IS NOT NULL
         AND (target_snapshot->>'revision')::bigint <> base_revision) THEN
    RAISE EXCEPTION 'snapshot revision must equal the request base revision';
  END IF;
  IF target_snapshot->>'generatedAt' IS NULL
     OR jsonb_typeof(target_snapshot->'generatedAt') IS DISTINCT FROM 'string' THEN
    RAISE EXCEPTION 'snapshot generatedAt is required';
  END IF;
  FOREACH required_array IN ARRAY ARRAY[
    'products',
    'inventoryMovements',
    'eventSalesRecords',
    'boothSalesRecords',
    'boothWarehouseSalesRecords',
    'anniversaryCampaigns',
    'anniversaryShipments'
  ] LOOP
    IF jsonb_typeof(target_snapshot -> required_array) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'snapshot array is missing or invalid: %', required_array;
    END IF;
  END LOOP;
  IF target_content_fingerprint IS NULL
     OR target_content_fingerprint !~ '^inv-[0-9a-f]{16}$' THEN
    RAISE EXCEPTION 'content fingerprint is invalid';
  END IF;

  -- Serialize all mutations for one workspace. The operation lock additionally
  -- prevents concurrent use of the same UUID against different workspaces.
  PERFORM pg_advisory_xact_lock(hashtextextended(operation_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(target_workspace_id::text, 0));

  SELECT * INTO current_row
  FROM public.app_inventory_snapshots s
  WHERE s.workspace_id = target_workspace_id
  FOR UPDATE;

  IF FOUND AND current_row.last_operation_id = operation_id THEN
    IF target_content_fingerprint <> current_row.content_fingerprint
       OR (base_revision IS NULL AND current_row.revision <> 1)
       OR (base_revision IS NOT NULL AND current_row.revision <> base_revision + 1)
       OR jsonb_set(target_snapshot, '{revision}',
            to_jsonb(current_row.revision), false) <> current_row.snapshot THEN
      RAISE EXCEPTION 'operation_id was already used for a different request';
    END IF;
    RETURN jsonb_build_object(
      'status', 'replayed',
      'revision', current_row.revision,
      'contentFingerprint', current_row.content_fingerprint
    );
  END IF;

  IF NOT FOUND THEN
    IF base_revision IS NOT NULL THEN
      RETURN jsonb_build_object(
        'status', 'conflict',
        'currentRevision', 0,
        'currentContentFingerprint', NULL
      );
    END IF;
    new_revision := 1;
    stored_snapshot := jsonb_set(
      target_snapshot, '{revision}', to_jsonb(new_revision), false
    );
    INSERT INTO public.app_inventory_snapshots (
      workspace_id,
      revision,
      schema_version,
      snapshot,
      content_fingerprint,
      last_operation_id
    ) VALUES (
      target_workspace_id,
      new_revision,
      1,
      stored_snapshot,
      target_content_fingerprint,
      operation_id
    );
  ELSE
    IF base_revision IS NULL OR current_row.revision <> base_revision THEN
      RETURN jsonb_build_object(
        'status', 'conflict',
        'currentRevision', current_row.revision,
        'currentContentFingerprint', current_row.content_fingerprint
      );
    END IF;
    IF current_row.revision >= 9007199254740991 THEN
      RAISE EXCEPTION 'inventory snapshot revision limit reached';
    END IF;
    new_revision := current_row.revision + 1;
    stored_snapshot := jsonb_set(
      target_snapshot, '{revision}', to_jsonb(new_revision), false
    );
    UPDATE public.app_inventory_snapshots s
    SET revision = new_revision,
        schema_version = 1,
        snapshot = stored_snapshot,
        content_fingerprint = target_content_fingerprint,
        last_operation_id = operation_id,
        updated_at = pg_catalog.clock_timestamp()
    WHERE s.workspace_id = target_workspace_id;
  END IF;

  RETURN jsonb_build_object(
    'status', 'saved',
    'revision', new_revision,
    'contentFingerprint', target_content_fingerprint
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_app_inventory_snapshot(uuid)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_app_inventory_snapshot(
  uuid, uuid, bigint, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_app_inventory_snapshot(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_app_inventory_snapshot(
  uuid, uuid, bigint, jsonb, text
) TO authenticated;

-- Static postflight only. It does not call either RPC or read workspace data.
DO $postflight$
BEGIN
  IF to_regclass('public.app_inventory_snapshots') IS NULL
     OR to_regprocedure('public.get_app_inventory_snapshot(uuid)') IS NULL
     OR to_regprocedure(
       'public.save_app_inventory_snapshot(uuid,uuid,bigint,jsonb,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'Inventory sync apply stopped: required objects are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'app_inventory_snapshots'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Inventory sync apply stopped: RLS is not enabled';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'app_inventory_snapshots'
  ) THEN
    RAISE EXCEPTION 'Inventory sync apply stopped: direct table policy is unexpected';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'app_inventory_snapshots'
    GROUP BY c.table_schema, c.table_name
    HAVING array_agg(c.column_name::text ORDER BY c.ordinal_position) = ARRAY[
      'workspace_id',
      'revision',
      'schema_version',
      'snapshot',
      'content_fingerprint',
      'last_operation_id',
      'created_at',
      'updated_at'
    ]::text[]
  ) THEN
    RAISE EXCEPTION 'Inventory sync apply stopped: table columns are unexpected';
  END IF;
END
$postflight$;

COMMIT;
