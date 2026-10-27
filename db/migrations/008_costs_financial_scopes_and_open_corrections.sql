-- DESIGN DRAFT ONLY -- NOT APPROVED / DO NOT APPLY.
-- Candidate schema for docs/issue-8-migration-008-design.md, not runtime delivery.
-- D-306 V1: private administration archives, explicit authority and OPEN corrections.
-- D-304/D-305 remain binding; disclosure/delegation workflows are deferred.
-- db/migrate.js discovers numbered SQL files automatically. Keep this blocker
-- until independent contract review, a new authorization and isolated preflight.
DO $draft_only$
BEGIN
  RAISE EXCEPTION 'MIGRATION_008_DESIGN_ONLY_NOT_APPROVED';
END;
$draft_only$;

-- Future preflight: only canonical roles, no elevated flags, unexpected role
-- paths (including SET ROLE), schema ownership/CREATE or canonical object ownership.
DO $runtime_roles$
DECLARE
  runtime_role record;
BEGIN
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('app_runtime','app_horas_runtime')) <> 2 THEN
    RAISE EXCEPTION 'COST_RUNTIME_ROLES_MISSING';
  END IF;
  FOR runtime_role IN SELECT * FROM pg_roles WHERE rolname IN ('app_runtime','app_horas_runtime') LOOP
    IF runtime_role.rolsuper OR runtime_role.rolcreatedb OR runtime_role.rolcreaterole
      OR runtime_role.rolreplication OR runtime_role.rolbypassrls
      OR runtime_role.rolcanlogin <> (runtime_role.rolname = 'app_horas_runtime')
      OR (runtime_role.rolname = 'app_horas_runtime' AND NOT runtime_role.rolinherit)
      OR has_schema_privilege(runtime_role.oid, 'app', 'CREATE')
      OR has_schema_privilege(runtime_role.oid, 'audit', 'CREATE')
      OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname IN ('app','audit') AND nspowner = runtime_role.oid)
      OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname IN ('app','audit') AND c.relowner = runtime_role.oid)
      OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname IN ('app','audit') AND p.proowner = runtime_role.oid)
      OR EXISTS (SELECT 1 FROM pg_roles other_role WHERE other_role.oid <> runtime_role.oid
        AND pg_has_role(runtime_role.oid, other_role.oid, 'MEMBER')
        AND NOT (runtime_role.rolname = 'app_horas_runtime' AND other_role.rolname = 'app_runtime')) THEN
      RAISE EXCEPTION 'COST_RUNTIME_ROLE_UNSAFE: %', runtime_role.rolname;
    END IF;
  END LOOP;
  IF NOT pg_has_role('app_horas_runtime', 'app_runtime', 'USAGE') THEN
    RAISE EXCEPTION 'COST_RUNTIME_INHERITANCE_MISSING';
  END IF;
END;
$runtime_roles$;

-- No INSERT/UPDATE of historical financial roots or settlement snapshots.
-- All new binding/ACL tables start empty: unmapped history remains inaccessible.

CREATE TABLE app.cost_financial_scopes (
  financial_scope_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  label text NOT NULL CHECK (length(btrim(label)) > 0),
  approval_reference text NOT NULL CHECK (length(btrim(approval_reference)) > 0),
  created_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cost_scope_aircraft UNIQUE (financial_scope_id, aircraft_id)
);

-- These are explicitly reviewed mandates, not inferred user/person/party links.
-- Bootstrap and organization representation approval remain outside runtime.
CREATE TABLE app.cost_financial_authorities (
  financial_authority_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_scope_id uuid NOT NULL REFERENCES app.cost_financial_scopes(financial_scope_id),
  user_id uuid NOT NULL REFERENCES app.users(user_id),
  approval_reference text NOT NULL CHECK (length(btrim(approval_reference)) > 0),
  authorized_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  authorized_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_cost_authority_scope UNIQUE (financial_authority_id, financial_scope_id)
);
CREATE INDEX idx_cost_authority_user_scope
  ON app.cost_financial_authorities (user_id, financial_scope_id);

CREATE TABLE app.cost_financial_authority_revocations (
  financial_authority_id uuid PRIMARY KEY
    REFERENCES app.cost_financial_authorities(financial_authority_id),
  revoked_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  revoked_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0)
);

-- Composite keys prevent a binding to a root on a different aircraft.
-- Scope the vocabulary too: a former administration's private name must neither
-- become visible nor reserve that name for every future administration.
ALTER TABLE app.cost_concepts ADD COLUMN financial_scope_id uuid,
  ADD CONSTRAINT fk_cost_concept_scope FOREIGN KEY (financial_scope_id, aircraft_id)
    REFERENCES app.cost_financial_scopes(financial_scope_id, aircraft_id),
  ADD CONSTRAINT uq_cost_concept_aircraft UNIQUE (cost_concept_id, aircraft_id, financial_scope_id);
ALTER TABLE app.cost_event_types ADD COLUMN financial_scope_id uuid,
  ADD CONSTRAINT fk_cost_type_scope FOREIGN KEY (financial_scope_id, aircraft_id)
    REFERENCES app.cost_financial_scopes(financial_scope_id, aircraft_id),
  ADD CONSTRAINT uq_cost_type_aircraft UNIQUE (cost_event_type_id, aircraft_id, financial_scope_id);
DROP INDEX app.uq_active_cost_concept_name;
DROP INDEX app.uq_active_cost_event_type_name;
CREATE UNIQUE INDEX uq_active_cost_concept_name
  ON app.cost_concepts (financial_scope_id, lower(name))
  WHERE status = 'ACTIVE' AND financial_scope_id IS NOT NULL;
CREATE UNIQUE INDEX uq_active_cost_event_type_name
  ON app.cost_event_types (financial_scope_id, lower(name))
  WHERE status = 'ACTIVE' AND financial_scope_id IS NOT NULL;
ALTER TABLE app.cost_events ADD CONSTRAINT uq_cost_event_aircraft
  UNIQUE (cost_event_id, aircraft_id);
ALTER TABLE app.expenses ADD CONSTRAINT uq_cost_expense_aircraft
  UNIQUE (expense_id, aircraft_id);
ALTER TABLE app.cost_settlements ADD CONSTRAINT uq_cost_settlement_aircraft
  UNIQUE (cost_settlement_id, aircraft_id);

-- External immutable bindings let reviewed backfill classify settled records
-- without issuing UPDATE against append-only settlement tables.
CREATE TABLE app.cost_financial_records (
  financial_record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_scope_id uuid NOT NULL,
  aircraft_id uuid NOT NULL,
  cost_concept_id uuid UNIQUE,
  cost_event_type_id uuid UNIQUE,
  cost_event_id uuid UNIQUE,
  expense_id uuid UNIQUE,
  cost_settlement_id uuid UNIQUE,
  registered_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  registered_at timestamptz NOT NULL DEFAULT now(),
  provenance_reference text NOT NULL CHECK (length(btrim(provenance_reference)) > 0),
  CONSTRAINT ck_cost_record_one_root CHECK (
    num_nonnulls(cost_concept_id, cost_event_type_id, cost_event_id,
      expense_id, cost_settlement_id) = 1
  ),
  CONSTRAINT uq_cost_record_scope UNIQUE (financial_record_id, financial_scope_id),
  CONSTRAINT fk_cost_record_scope FOREIGN KEY (financial_scope_id, aircraft_id)
    REFERENCES app.cost_financial_scopes(financial_scope_id, aircraft_id),
  CONSTRAINT fk_cost_record_concept FOREIGN KEY (cost_concept_id, aircraft_id, financial_scope_id)
    REFERENCES app.cost_concepts(cost_concept_id, aircraft_id, financial_scope_id),
  CONSTRAINT fk_cost_record_type FOREIGN KEY (cost_event_type_id, aircraft_id, financial_scope_id)
    REFERENCES app.cost_event_types(cost_event_type_id, aircraft_id, financial_scope_id),
  CONSTRAINT fk_cost_record_event FOREIGN KEY (cost_event_id, aircraft_id)
    REFERENCES app.cost_events(cost_event_id, aircraft_id),
  CONSTRAINT fk_cost_record_expense FOREIGN KEY (expense_id, aircraft_id)
    REFERENCES app.expenses(expense_id, aircraft_id),
  CONSTRAINT fk_cost_record_settlement FOREIGN KEY (cost_settlement_id, aircraft_id)
    REFERENCES app.cost_settlements(cost_settlement_id, aircraft_id)
);
CREATE INDEX idx_cost_record_scope ON app.cost_financial_records (financial_scope_id);

-- Optimistic revision of the entire open detail set, not a monetary counter.
ALTER TABLE app.expenses ADD COLUMN details_version bigint NOT NULL DEFAULT 0;
ALTER TABLE app.expenses ADD CONSTRAINT ck_cost_details_version CHECK (details_version >= 0);

CREATE TABLE app.cost_expense_corrections (
  cost_expense_correction_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES app.expenses(expense_id),
  base_details_version bigint NOT NULL CHECK (base_details_version >= 0),
  request_id uuid NOT NULL UNIQUE,
  actor_user_id uuid NOT NULL REFERENCES app.users(user_id),
  corrected_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  CONSTRAINT uq_cost_correction_version UNIQUE (expense_id, base_details_version),
  CONSTRAINT uq_cost_correction_expense UNIQUE (cost_expense_correction_id, expense_id)
);

ALTER TABLE app.expense_payments
  ADD COLUMN created_correction_id uuid,
  ADD COLUMN retired_correction_id uuid,
  ADD COLUMN retired_at timestamptz,
  ADD COLUMN retired_by_user_id uuid REFERENCES app.users(user_id),
  ADD CONSTRAINT fk_cost_payment_created_correction
    FOREIGN KEY (created_correction_id, expense_id)
    REFERENCES app.cost_expense_corrections(cost_expense_correction_id, expense_id),
  ADD CONSTRAINT fk_cost_payment_retired_correction
    FOREIGN KEY (retired_correction_id, expense_id)
    REFERENCES app.cost_expense_corrections(cost_expense_correction_id, expense_id),
  ADD CONSTRAINT ck_cost_payment_retirement CHECK (
    (retired_at IS NULL AND retired_by_user_id IS NULL AND retired_correction_id IS NULL)
    OR (retired_at IS NOT NULL AND retired_by_user_id IS NOT NULL AND retired_correction_id IS NOT NULL)
  );

ALTER TABLE app.expense_allocations
  ADD COLUMN created_correction_id uuid,
  ADD COLUMN retired_correction_id uuid,
  ADD COLUMN retired_at timestamptz,
  ADD COLUMN retired_by_user_id uuid REFERENCES app.users(user_id),
  ADD CONSTRAINT fk_cost_allocation_created_correction
    FOREIGN KEY (created_correction_id, expense_id)
    REFERENCES app.cost_expense_corrections(cost_expense_correction_id, expense_id),
  ADD CONSTRAINT fk_cost_allocation_retired_correction
    FOREIGN KEY (retired_correction_id, expense_id)
    REFERENCES app.cost_expense_corrections(cost_expense_correction_id, expense_id),
  ADD CONSTRAINT ck_cost_allocation_retirement CHECK (
    (retired_at IS NULL AND retired_by_user_id IS NULL AND retired_correction_id IS NULL)
    OR (retired_at IS NOT NULL AND retired_by_user_id IS NOT NULL AND retired_correction_id IS NOT NULL)
  ),
  DROP CONSTRAINT uq_expense_allocation_party;
CREATE UNIQUE INDEX uq_cost_active_allocation_party
  ON app.expense_allocations (expense_id, party_id) WHERE retired_at IS NULL;
CREATE INDEX idx_cost_active_payment_expense
  ON app.expense_payments (expense_id) WHERE retired_at IS NULL;

-- Guard structural lifecycle and frozen sources. Authorization/totals/Audit are
-- service obligations; this INVOKER function is not an ACL or elevated executor.
CREATE FUNCTION app.guard_cost_open_detail() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, app AS $guard$
DECLARE
  parent app.expenses%ROWTYPE;
  correction app.cost_expense_corrections%ROWTYPE;
  batch_id uuid;
BEGIN
  SELECT * INTO parent FROM app.expenses WHERE expense_id = NEW.expense_id FOR UPDATE;
  IF NOT FOUND OR parent.status <> 'OPEN' THEN
    RAISE EXCEPTION 'COST_EXPENSE_NOT_MODIFIABLE' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM app.cost_settlement_expense_lines WHERE expense_id = NEW.expense_id)
    OR EXISTS (SELECT 1 FROM app.cost_events
      WHERE cost_event_id = parent.cost_event_id AND status <> 'OPEN') THEN
    RAISE EXCEPTION 'COST_EXPENSE_FROZEN' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.retired_at IS NOT NULL OR NEW.created_correction_id IS NULL THEN
      RAISE EXCEPTION 'COST_DETAIL_INVALID_INSERT' USING ERRCODE = '23514';
    END IF;
    batch_id := NEW.created_correction_id;
  ELSE
    IF OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL
      OR (to_jsonb(OLD) - ARRAY['retired_correction_id','retired_at','retired_by_user_id'])
        IS DISTINCT FROM
        (to_jsonb(NEW) - ARRAY['retired_correction_id','retired_at','retired_by_user_id']) THEN
      RAISE EXCEPTION 'COST_DETAIL_IMMUTABLE_VALUES' USING ERRCODE = '23514';
    END IF;
    batch_id := NEW.retired_correction_id;
  END IF;
  SELECT * INTO correction FROM app.cost_expense_corrections
    WHERE cost_expense_correction_id = batch_id AND expense_id = NEW.expense_id;
  IF NOT FOUND OR correction.base_details_version + 1 <> parent.details_version THEN
    RAISE EXCEPTION 'COST_CORRECTION_VERSION_MISMATCH' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.retired_by_user_id IS DISTINCT FROM correction.actor_user_id THEN
    RAISE EXCEPTION 'COST_CORRECTION_ACTOR_MISMATCH' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION app.guard_cost_open_detail() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guard_cost_open_detail() TO app_runtime;
CREATE TRIGGER trg_cost_payment_open_detail BEFORE INSERT OR UPDATE ON app.expense_payments
  FOR EACH ROW EXECUTE FUNCTION app.guard_cost_open_detail();
CREATE TRIGGER trg_cost_allocation_open_detail BEFORE INSERT OR UPDATE ON app.expense_allocations
  FOR EACH ROW EXECUTE FUNCTION app.guard_cost_open_detail();

-- REVOKE on the group alone does NOT remove direct grants to the login or
-- column grants. Normalize both named roles and PUBLIC, then verify EFFECTIVE
-- privileges. Unexpected inheritance/ownership causes failure, never silent repair.
DO $runtime_grants$
DECLARE
  relation_name text;
  column_list text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'app.cost_financial_scopes', 'app.cost_financial_authorities',
    'app.cost_financial_authority_revocations', 'app.cost_financial_records',
    'app.cost_expense_corrections', 'app.expense_payments', 'app.expense_allocations',
    'app.cost_settlements', 'app.cost_settlement_expense_lines',
    'app.cost_settlement_party_lines', 'app.cost_settlement_owner_lines',
    'app.cost_settlement_utilization_lines', 'audit.audit_events'
  ] LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM app_runtime, app_horas_runtime, PUBLIC',
      relation_name::regclass);
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO column_list
      FROM pg_attribute WHERE attrelid = relation_name::regclass AND attnum > 0 AND NOT attisdropped;
    EXECUTE format('REVOKE SELECT (%1$s), INSERT (%1$s), UPDATE (%1$s), REFERENCES (%1$s) ON TABLE %2$s FROM app_runtime, app_horas_runtime, PUBLIC',
      column_list, relation_name::regclass);
  END LOOP;
END;
$runtime_grants$;

-- Explicit authority provisioning/revocation is reviewed and privileged, not
-- an OWNER self-service action. Missing mandate/binding always denies access.
GRANT SELECT ON app.cost_financial_scopes, app.cost_financial_authorities,
  app.cost_financial_authority_revocations TO app_runtime;
GRANT SELECT, INSERT ON app.cost_financial_records, app.cost_expense_corrections,
  app.expense_payments, app.expense_allocations, app.cost_settlements,
  app.cost_settlement_expense_lines, app.cost_settlement_party_lines,
  app.cost_settlement_owner_lines, app.cost_settlement_utilization_lines,
  audit.audit_events TO app_runtime;
GRANT UPDATE (retired_correction_id, retired_at, retired_by_user_id)
  ON app.expense_payments, app.expense_allocations TO app_runtime;

-- In a future approved migration transaction, fail/rollback if direct, inherited
-- or PUBLIC privileges still defeat the contract. No assertion is made about
-- the existing live database until these checks are actually authorized/run.
DO $runtime_effective_privileges$
DECLARE
  role_name text;
  relation_name text;
  column_row record;
  mutable_detail boolean;
  authority_table boolean;
  expected_insert boolean;
  expected_update boolean;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['app_runtime', 'app_horas_runtime', 'public'] LOOP
    FOREACH relation_name IN ARRAY ARRAY[
      'app.cost_financial_scopes', 'app.cost_financial_authorities',
      'app.cost_financial_authority_revocations', 'app.cost_financial_records',
      'app.cost_expense_corrections', 'app.expense_payments', 'app.expense_allocations',
      'app.cost_settlements', 'app.cost_settlement_expense_lines',
      'app.cost_settlement_party_lines', 'app.cost_settlement_owner_lines',
      'app.cost_settlement_utilization_lines', 'audit.audit_events'
    ] LOOP
      mutable_detail := relation_name IN ('app.expense_payments','app.expense_allocations');
      authority_table := relation_name IN ('app.cost_financial_scopes',
        'app.cost_financial_authorities','app.cost_financial_authority_revocations');
      expected_insert := role_name <> 'public' AND NOT authority_table;
      IF has_table_privilege(role_name::name, relation_name, 'SELECT') <> (role_name <> 'public')
        OR has_table_privilege(role_name::name, relation_name, 'INSERT') <> expected_insert
        OR has_table_privilege(role_name::name, relation_name, 'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
        RAISE EXCEPTION 'COST_RUNTIME_TABLE_PRIVILEGES_UNSAFE: %, %', role_name, relation_name;
      END IF;
      FOR column_row IN SELECT attname FROM pg_attribute
        WHERE attrelid = relation_name::regclass AND attnum > 0 AND NOT attisdropped LOOP
        expected_update := role_name <> 'public' AND mutable_detail
          AND column_row.attname IN ('retired_correction_id','retired_at','retired_by_user_id');
        IF has_column_privilege(role_name::name, relation_name, column_row.attname, 'SELECT') <> (role_name <> 'public')
          OR has_column_privilege(role_name::name, relation_name, column_row.attname, 'UPDATE') <> expected_update
          OR has_column_privilege(role_name::name, relation_name, column_row.attname, 'INSERT') <> expected_insert
          OR has_column_privilege(role_name::name, relation_name, column_row.attname, 'REFERENCES') THEN
          RAISE EXCEPTION 'COST_RUNTIME_COLUMN_PRIVILEGES_UNSAFE: %, %, %', role_name, relation_name, column_row.attname;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$runtime_effective_privileges$;
