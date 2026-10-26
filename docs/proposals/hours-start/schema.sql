-- PROPOSAL ONLY. NOT A MIGRATION: outside db/migrations deliberately.
-- No apply/version/grants/backfill authorized. Schema review + isolated rollback preflight required.
-- D-307 confirms the two explicit start modes only; these tables remain PROPOSED.
CREATE TABLE app.aircraft_hours_plans (
  hours_plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  created_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hours_plan_id, aircraft_id)
);
CREATE TABLE app.aircraft_hours_plan_revisions (
  hours_plan_revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hours_plan_id uuid NOT NULL REFERENCES app.aircraft_hours_plans(hours_plan_id),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  start_mode text NOT NULL CHECK (start_mode IN ('CURRENT_REFERENCE','HISTORICAL_IMPORT')),
  status text NOT NULL CHECK (status IN ('DRAFT','REFERENCES_PENDING','IMPORT_VALIDATION_PENDING','RECONCILIATION_PENDING','COMPLETE','CANCELLED')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hours_plan_id, revision_number)
);
-- Values are observations, not mutable aircraft totals. New evidence creates new rows.
CREATE TABLE app.hours_counter_references (
  counter_reference_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hours_plan_id uuid NOT NULL REFERENCES app.aircraft_hours_plans(hours_plan_id),
  component_installation_id uuid REFERENCES app.component_installations(component_installation_id),
  scope text NOT NULL CHECK (scope IN ('AT_INSTALLATION','TRACKING_REFERENCE')),
  metric text NOT NULL CHECK (metric IN ('AIRFRAME_TIS','TSN','TSO')),
  usage_basis text NOT NULL CHECK (usage_basis IN ('TIS','ENGINE_RUNTIME','DECLARED_ONLY')),
  raw_value_text text,
  value_hours numeric(10,1) CHECK (value_hours >= 0), -- NULL is explicitly unknown
  observed_at timestamptz,
  after_flight_revision_id uuid REFERENCES app.flight_record_revisions(flight_revision_id),
  overhaul_reference text,
  source_kind text NOT NULL CHECK (source_kind IN ('OWNER_DECLARATION','LOGBOOK','IMPORT','RECONCILIATION')),
  source_reference text NOT NULL CHECK (length(btrim(source_reference)) > 0),
  recorded_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (metric <> 'AIRFRAME_TIS' OR usage_basis='TIS'),
  CHECK ((component_installation_id IS NULL AND metric='AIRFRAME_TIS' AND scope='TRACKING_REFERENCE')
    OR (component_installation_id IS NOT NULL AND metric IN ('TSN','TSO'))),
  CHECK ((scope='AT_INSTALLATION' AND observed_at IS NULL AND after_flight_revision_id IS NULL)
    OR (scope='TRACKING_REFERENCE' AND ((observed_at IS NOT NULL)::int + (after_flight_revision_id IS NOT NULL)::int)=1)),
  CHECK (metric <> 'TSO' OR value_hours IS NULL OR overhaul_reference IS NOT NULL)
);
CREATE TABLE app.hours_reconciliation_runs (
  reconciliation_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hours_plan_revision_id uuid NOT NULL REFERENCES app.aircraft_hours_plan_revisions(hours_plan_revision_id),
  import_batch_id uuid REFERENCES app.flight_import_batches(import_batch_id),
  input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
  algorithm_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('VALIDATED','REJECTED')),
  request_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hours_plan_revision_id,input_sha256,algorithm_version)
);
CREATE TABLE app.hours_reconciliation_confirmations (
  reconciliation_run_id uuid PRIMARY KEY REFERENCES app.hours_reconciliation_runs(reconciliation_run_id),
  confirmed_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL UNIQUE
);
CREATE TABLE app.hours_reconciliation_flights (
  reconciliation_run_id uuid NOT NULL REFERENCES app.hours_reconciliation_runs(reconciliation_run_id),
  flight_revision_id uuid NOT NULL REFERENCES app.flight_record_revisions(flight_revision_id),
  PRIMARY KEY(reconciliation_run_id,flight_revision_id)
);
CREATE TABLE app.hours_reconciliation_references (
  reconciliation_run_id uuid NOT NULL REFERENCES app.hours_reconciliation_runs(reconciliation_run_id),
  counter_reference_id uuid NOT NULL REFERENCES app.hours_counter_references(counter_reference_id),
  PRIMARY KEY(reconciliation_run_id,counter_reference_id)
);
CREATE TABLE app.flight_component_utilization_attributions (
  flight_revision_id uuid NOT NULL REFERENCES app.flight_record_revisions(flight_revision_id),
  component_installation_id uuid NOT NULL REFERENCES app.component_installations(component_installation_id),
  reconciliation_run_id uuid NOT NULL REFERENCES app.hours_reconciliation_runs(reconciliation_run_id),
  usage_basis text NOT NULL CHECK (usage_basis IN ('TIS','ENGINE_RUNTIME')),
  attributed_hours numeric(10,1) NOT NULL CHECK (attributed_hours >= 0),
  source_reference text NOT NULL,
  PRIMARY KEY(flight_revision_id,component_installation_id,usage_basis)
);
-- Cross-aircraft scope, position/type, period/boundary applicability, selected revision currency,
-- reference confidence, TSO overhaul event identity, non-overlap and reconciliation math remain
-- service validation inside a single aircraft-locked SERIALIZABLE transaction. NOT implemented.
-- No existing opening_tis_hours/baselines/revisions are rewritten or backfilled.

CREATE TABLE app.hours_reconciliation_differences (
  reconciliation_run_id uuid NOT NULL REFERENCES app.hours_reconciliation_runs(reconciliation_run_id),
  counter_reference_id uuid NOT NULL REFERENCES app.hours_counter_references(counter_reference_id),
  derived_hours numeric(10,1),
  difference_hours numeric(10,1),
  result text NOT NULL CHECK (result IN ('MATCH','UNKNOWN','GAP','CONFLICT')),
  explanation text NOT NULL,
  PRIMARY KEY(reconciliation_run_id,counter_reference_id),
  CHECK (derived_hours IS NULL OR derived_hours >= 0),
  CHECK (result <> 'UNKNOWN' OR (derived_hours IS NULL AND difference_hours IS NULL))
);
-- Latest accepted sequence is distinct from any pending candidate import/plan revision.
CREATE TABLE app.aircraft_hours_acceptances (
  hours_acceptance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  acceptance_sequence integer NOT NULL CHECK (acceptance_sequence > 0),
  reconciliation_run_id uuid NOT NULL UNIQUE REFERENCES app.hours_reconciliation_confirmations(reconciliation_run_id),
  supersedes_acceptance_id uuid REFERENCES app.aircraft_hours_acceptances(hours_acceptance_id),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(aircraft_id,acceptance_sequence)
);
