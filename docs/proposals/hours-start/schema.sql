-- PROPOSAL ONLY. NOT A MIGRATION. DO NOT EXECUTE; outside db/migrations.
-- Revision F2/F4/F6: D-307 is product intent, NOT approval of this DDL/policy.
-- Core schema only; retention.sql and security.sql complete the isolated preflight proposal.
-- No execution, backfill, business writes or runner registration authorized.
-- Supporting candidate keys on existing canonical tables: no business-value changes.
ALTER TABLE app.flight_records ADD CONSTRAINT uq_hours_flight_aircraft UNIQUE (aircraft_id, flight_id);
ALTER TABLE app.component_installations ADD CONSTRAINT uq_hours_installation_scope UNIQUE (aircraft_id, component_installation_id, component_id);
ALTER TABLE app.flight_import_batches ADD CONSTRAINT uq_hours_batch_aircraft UNIQUE (aircraft_id, import_batch_id);

CREATE TABLE app.aircraft_hours_plans (
  hours_plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  created_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(aircraft_id, hours_plan_id)
);
CREATE TABLE app.aircraft_hours_plan_revisions (
  hours_plan_revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL,
  hours_plan_id uuid NOT NULL,
  revision_number integer NOT NULL CHECK (revision_number > 0),
  start_mode text NOT NULL CHECK (start_mode IN ('CURRENT_REFERENCE','HISTORICAL_IMPORT')),
  status text NOT NULL CHECK (status IN ('DRAFT','REFERENCES_PENDING','IMPORT_VALIDATION_PENDING','RECONCILIATION_PENDING','COMPLETE','CANCELLED')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  created_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(aircraft_id,hours_plan_id) REFERENCES app.aircraft_hours_plans(aircraft_id,hours_plan_id),
  UNIQUE(aircraft_id,hours_plan_id,hours_plan_revision_id),
  UNIQUE(hours_plan_id,revision_number)
);
-- Evidence of a physical component episode; context installation grants scope, not event timing.
CREATE TABLE app.hours_component_overhaul_episodes (
  overhaul_episode_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL,
  context_installation_id uuid NOT NULL,
  component_id uuid NOT NULL,
  episode_kind text NOT NULL CHECK(episode_kind IN ('OVERHAUL','SINCE_NEW_DECLARED')),
  occurred_on date,
  source_reference text NOT NULL CHECK(length(btrim(source_reference)) > 0),
  recorded_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(aircraft_id,context_installation_id,component_id) REFERENCES app.component_installations(aircraft_id,component_installation_id,component_id),
  UNIQUE(aircraft_id,component_id,overhaul_episode_id)
);
-- The existing batch owns filename/hash/storage-key/expiry. No duplicate raw XLSX in DB.
CREATE TABLE app.hours_import_mapping_versions (
  mapping_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  version_number integer NOT NULL CHECK(version_number > 0),
  mapping_sha256 text NOT NULL CHECK(mapping_sha256 ~ '^[a-f0-9]{64}$'),
  parser_version text NOT NULL CHECK(length(btrim(parser_version)) > 0),
  created_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(aircraft_id,import_batch_id) REFERENCES app.flight_import_batches(aircraft_id,import_batch_id),
  UNIQUE(aircraft_id,mapping_version_id),
  UNIQUE(aircraft_id,mapping_version_id,import_batch_id),
  UNIQUE(import_batch_id,version_number)
);
CREATE TABLE app.hours_import_mapping_fields (
  aircraft_id uuid NOT NULL,
  mapping_version_id uuid NOT NULL,
  FOREIGN KEY(aircraft_id,mapping_version_id) REFERENCES app.hours_import_mapping_versions(aircraft_id,mapping_version_id),
  field_code text NOT NULL,
  source_sheet text NOT NULL CHECK(source_sheet ~ '^sheet-([1-9]|1[0-9]|20)$'),
  source_column text NOT NULL,
  transformation text NOT NULL CHECK(transformation IN ('TEXT','ISO_DATE','DECIMAL_HOURS','HH_MM_HOURS','EXPLICIT_LOOKUP')),
  PRIMARY KEY(mapping_version_id,field_code)
);
-- Immutable candidate identities are NOT operational flight_id/revision_id.
-- Re-mapping/re-validation creates new mapping/version/row identities, never edits a snapshot.
CREATE TABLE app.hours_import_staged_rows (
  staged_row_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  source_ordinal integer NOT NULL CHECK(source_ordinal > 0),
  mapping_version_id uuid NOT NULL,
  source_sheet text NOT NULL CHECK(source_sheet ~ '^sheet-([1-9]|1[0-9]|20)$'),
  source_row_number integer NOT NULL CHECK(source_row_number > 0),
  source_row_sha256 text NOT NULL CHECK(source_row_sha256 ~ '^[a-f0-9]{64}$'),
  source_record_key text CHECK(source_record_key IS NULL OR source_record_key ~ '^[a-f0-9]{64}$'),
  date_precision text NOT NULL CHECK(date_precision IN ('DATE','MONTH','YEAR','UNKNOWN')),
  source_date_text text,
  flight_date date,
  source_year integer CHECK(source_year BETWEEN 1 AND 9999),
  source_month integer CHECK(source_month BETWEEN 1 AND 12),
  departure_location text,
  arrival_location text,
  flight_time_hours numeric(8,1) CHECK(flight_time_hours >= 0),
  time_in_service_hours numeric(8,1) CHECK(time_in_service_hours >= 0),
  duration_evidence jsonb NOT NULL CHECK(jsonb_typeof(duration_evidence)='object'),
  -- Typed DTO validation must enforce raw/unit/resolution/exact seconds/canonical rounding per mapped field.
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(aircraft_id,mapping_version_id,import_batch_id) REFERENCES app.hours_import_mapping_versions(aircraft_id,mapping_version_id,import_batch_id),
  UNIQUE(aircraft_id,staged_row_id),
  UNIQUE(aircraft_id,staged_row_id,import_batch_id),
  UNIQUE(mapping_version_id,source_ordinal),
  UNIQUE(mapping_version_id,source_sheet,source_row_number),
  CHECK((date_precision='DATE' AND flight_date IS NOT NULL AND source_year IS NULL AND source_month IS NULL)
    OR (date_precision='MONTH' AND flight_date IS NULL AND source_year IS NOT NULL AND source_month IS NOT NULL)
    OR (date_precision='YEAR' AND flight_date IS NULL AND source_year IS NOT NULL AND source_month IS NULL)
    OR (date_precision='UNKNOWN' AND flight_date IS NULL AND source_year IS NULL AND source_month IS NULL))
);
-- Evidence, not mutable totals. No reinterpretation of opening_tis_hours.
CREATE TABLE app.hours_counter_references (
  counter_reference_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL,
  hours_plan_id uuid NOT NULL,
  component_installation_id uuid,
  component_id uuid,
  scope text NOT NULL CHECK(scope IN ('AT_INSTALLATION','TRACKING_REFERENCE')),
  metric text NOT NULL CHECK(metric IN ('AIRFRAME_TIS','TSN','TSO')),
  usage_basis text NOT NULL CHECK(usage_basis IN ('TIS','ENGINE_RUNTIME','DECLARED_ONLY')),
  raw_value_text text,
  source_unit text CHECK(source_unit IN ('HOURS','HH_MM','MINUTES','SECONDS')),
  source_decimal_places smallint CHECK(source_decimal_places BETWEEN 0 AND 1000),
  source_resolution_text text, -- physical resolution declared by evidence, never inferred
  conversion_version text,
  CHECK((value_seconds IS NULL) OR (raw_value_text IS NOT NULL AND source_unit IS NOT NULL AND conversion_version IS NOT NULL AND (source_unit='HH_MM' OR (source_decimal_places IS NOT NULL AND source_decimal_places BETWEEN 0 AND 6)))),
  value_seconds numeric(24,6) CHECK(value_seconds >= 0),
  anchor_kind text NOT NULL CHECK(anchor_kind IN ('INSTALLATION','DATE_START','BEFORE_FLIGHT','AFTER_FLIGHT','UNRESOLVED')),
  reference_date date,
  boundary_flight_id uuid,
  boundary_flight_revision_id uuid,
  overhaul_episode_id uuid,
  source_kind text NOT NULL CHECK(source_kind IN ('OWNER_DECLARATION','LOGBOOK','IMPORT','RECONCILIATION')),
  source_reference text NOT NULL CHECK(length(btrim(source_reference)) > 0),
  recorded_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(aircraft_id,hours_plan_id) REFERENCES app.aircraft_hours_plans(aircraft_id,hours_plan_id),
  FOREIGN KEY(aircraft_id,component_installation_id,component_id) REFERENCES app.component_installations(aircraft_id,component_installation_id,component_id),
  FOREIGN KEY(aircraft_id,boundary_flight_id) REFERENCES app.flight_records(aircraft_id,flight_id),
  FOREIGN KEY(boundary_flight_id,boundary_flight_revision_id) REFERENCES app.flight_record_revisions(flight_id,flight_revision_id),
  FOREIGN KEY(aircraft_id,component_id,overhaul_episode_id) REFERENCES app.hours_component_overhaul_episodes(aircraft_id,component_id,overhaul_episode_id),
  UNIQUE(aircraft_id,hours_plan_id,counter_reference_id),
  CHECK((component_installation_id IS NULL) = (component_id IS NULL)),
  CHECK((component_installation_id IS NULL AND metric='AIRFRAME_TIS' AND usage_basis='TIS' AND scope='TRACKING_REFERENCE')
    OR (component_installation_id IS NOT NULL AND metric IN ('TSN','TSO'))),
  CHECK((scope='AT_INSTALLATION' AND anchor_kind='INSTALLATION')
    OR (scope='TRACKING_REFERENCE' AND anchor_kind<>'INSTALLATION')),
  CHECK((anchor_kind IN ('INSTALLATION','UNRESOLVED') AND reference_date IS NULL AND boundary_flight_id IS NULL AND boundary_flight_revision_id IS NULL)
    OR (anchor_kind='DATE_START' AND reference_date IS NOT NULL AND boundary_flight_id IS NULL AND boundary_flight_revision_id IS NULL)
    OR (anchor_kind IN ('BEFORE_FLIGHT','AFTER_FLIGHT') AND reference_date IS NOT NULL AND boundary_flight_id IS NOT NULL AND boundary_flight_revision_id IS NOT NULL)),
  CHECK(overhaul_episode_id IS NULL OR (metric='TSO' AND component_id IS NOT NULL)),
  CHECK(metric<>'TSO' OR value_seconds IS NULL OR overhaul_episode_id IS NOT NULL)
);
CREATE TABLE app.hours_reconciliation_runs (
  reconciliation_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL,
  hours_plan_id uuid NOT NULL,
  hours_plan_revision_id uuid NOT NULL,
  import_batch_id uuid,
  input_generation bigint NOT NULL CHECK(input_generation >= 0),
  input_sha256 text NOT NULL CHECK(input_sha256 ~ '^[a-f0-9]{64}$'),
  episode_manifest_sha256 text NOT NULL CHECK(episode_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  algorithm_version text NOT NULL CHECK(length(btrim(algorithm_version)) > 0),
  policy_version text NOT NULL CHECK(length(btrim(policy_version)) > 0),
  tolerance_seconds numeric(24,6) CHECK(tolerance_seconds = 0), -- NULL = no approved policy; zero only, no epsilon
  policy_approval_reference text,
  status text NOT NULL CHECK(status IN ('VALIDATED','REJECTED')),
  confirmable boolean NOT NULL DEFAULT false,
  request_id uuid NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(aircraft_id,hours_plan_id,hours_plan_revision_id) REFERENCES app.aircraft_hours_plan_revisions(aircraft_id,hours_plan_id,hours_plan_revision_id),
  FOREIGN KEY(aircraft_id,import_batch_id) REFERENCES app.flight_import_batches(aircraft_id,import_batch_id),
  UNIQUE(aircraft_id,reconciliation_run_id),
  UNIQUE(aircraft_id,reconciliation_run_id,import_batch_id),
  UNIQUE(aircraft_id,hours_plan_id,reconciliation_run_id),
  UNIQUE(aircraft_id,reconciliation_run_id,confirmable),
  UNIQUE(hours_plan_revision_id,input_sha256,algorithm_version,policy_version),
  CHECK((tolerance_seconds IS NULL) = (policy_approval_reference IS NULL)),
  CHECK(policy_approval_reference IS NULL OR length(btrim(policy_approval_reference)) > 0),
  CHECK(NOT confirmable OR (status='VALIDATED' AND tolerance_seconds IS NOT NULL))
);
CREATE TABLE app.hours_reconciliation_flights (
  aircraft_id uuid NOT NULL,
  reconciliation_run_id uuid NOT NULL,
  flight_id uuid NOT NULL,
  flight_revision_id uuid NOT NULL,
  status_snapshot text NOT NULL CHECK(status_snapshot IN ('ACTIVE','VOIDED')),
  PRIMARY KEY(aircraft_id,reconciliation_run_id,flight_id,flight_revision_id),
  UNIQUE(aircraft_id,reconciliation_run_id,flight_id),
  FOREIGN KEY(aircraft_id,reconciliation_run_id) REFERENCES app.hours_reconciliation_runs(aircraft_id,reconciliation_run_id),
  FOREIGN KEY(aircraft_id,flight_id) REFERENCES app.flight_records(aircraft_id,flight_id),
  FOREIGN KEY(flight_id,flight_revision_id) REFERENCES app.flight_record_revisions(flight_id,flight_revision_id)
);
CREATE TABLE app.hours_reconciliation_installations (
  aircraft_id uuid NOT NULL,
  reconciliation_run_id uuid NOT NULL,
  component_installation_id uuid NOT NULL,
  component_id uuid NOT NULL,
  component_type text NOT NULL CHECK(component_type IN ('ENGINE','PROPELLER')),
  position_index smallint NOT NULL CHECK(position_index > 0),
  installed_on_snapshot date,
  removed_on_snapshot date,
  installation_manifest_sha256 text NOT NULL CHECK(installation_manifest_sha256 ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(aircraft_id,reconciliation_run_id,component_installation_id),
  FOREIGN KEY(aircraft_id,reconciliation_run_id) REFERENCES app.hours_reconciliation_runs(aircraft_id,reconciliation_run_id),
  FOREIGN KEY(aircraft_id,component_installation_id,component_id) REFERENCES app.component_installations(aircraft_id,component_installation_id,component_id),
  CHECK(removed_on_snapshot IS NULL OR installed_on_snapshot IS NULL OR removed_on_snapshot >= installed_on_snapshot)
);
CREATE TABLE app.hours_reconciliation_staged_rows (
  aircraft_id uuid NOT NULL,
  reconciliation_run_id uuid NOT NULL,
  staged_row_id uuid NOT NULL,
  import_batch_id uuid NOT NULL,
  disposition text NOT NULL CHECK(disposition IN ('INCLUDE','EXCLUDE_VERIFIED_DUPLICATE','REQUIRES_REVIEW')),
  matched_flight_id uuid,
  matched_flight_revision_id uuid,
  reason text NOT NULL,
  PRIMARY KEY(aircraft_id,reconciliation_run_id,staged_row_id),
  FOREIGN KEY(aircraft_id,reconciliation_run_id,import_batch_id) REFERENCES app.hours_reconciliation_runs(aircraft_id,reconciliation_run_id,import_batch_id),
  FOREIGN KEY(aircraft_id,staged_row_id,import_batch_id) REFERENCES app.hours_import_staged_rows(aircraft_id,staged_row_id,import_batch_id),
  UNIQUE(aircraft_id,reconciliation_run_id,staged_row_id,disposition),
  FOREIGN KEY(aircraft_id,matched_flight_id) REFERENCES app.flight_records(aircraft_id,flight_id),
  FOREIGN KEY(matched_flight_id,matched_flight_revision_id) REFERENCES app.flight_record_revisions(flight_id,flight_revision_id),
  CHECK((matched_flight_id IS NULL) = (matched_flight_revision_id IS NULL)),
  CHECK(disposition<>'EXCLUDE_VERIFIED_DUPLICATE' OR matched_flight_id IS NOT NULL)
);
CREATE TABLE app.hours_reconciliation_references (
  aircraft_id uuid NOT NULL,
  hours_plan_id uuid NOT NULL,
  reconciliation_run_id uuid NOT NULL,
  counter_reference_id uuid NOT NULL,
  PRIMARY KEY(aircraft_id,reconciliation_run_id,counter_reference_id),
  FOREIGN KEY(aircraft_id,hours_plan_id,reconciliation_run_id) REFERENCES app.hours_reconciliation_runs(aircraft_id,hours_plan_id,reconciliation_run_id),
  FOREIGN KEY(aircraft_id,hours_plan_id,counter_reference_id) REFERENCES app.hours_counter_references(aircraft_id,hours_plan_id,counter_reference_id)
);
-- PK INCLUDES RUN: repeated reconciliation of the SAME revision/installation/basis is valid.
CREATE TABLE app.flight_component_utilization_attributions (
  aircraft_id uuid NOT NULL,
  reconciliation_run_id uuid NOT NULL,
  flight_id uuid NOT NULL,
  flight_revision_id uuid NOT NULL,
  component_installation_id uuid NOT NULL,
  usage_basis text NOT NULL CHECK(usage_basis IN ('TIS','ENGINE_RUNTIME')),
  attributed_seconds numeric(24,6) CHECK(attributed_seconds >= 0),
  resolution text NOT NULL CHECK(resolution IN ('RESOLVED','UNKNOWN','AMBIGUOUS')),
  source_reference text NOT NULL,
  PRIMARY KEY(reconciliation_run_id,flight_revision_id,component_installation_id,usage_basis),
  FOREIGN KEY(aircraft_id,reconciliation_run_id,flight_id,flight_revision_id) REFERENCES app.hours_reconciliation_flights(aircraft_id,reconciliation_run_id,flight_id,flight_revision_id),
  FOREIGN KEY(aircraft_id,reconciliation_run_id,component_installation_id) REFERENCES app.hours_reconciliation_installations(aircraft_id,reconciliation_run_id,component_installation_id),
  CHECK((resolution='RESOLVED' AND attributed_seconds IS NOT NULL) OR (resolution<>'RESOLVED' AND attributed_seconds IS NULL))
);
CREATE TABLE app.hours_candidate_component_attributions (
  aircraft_id uuid NOT NULL,
  reconciliation_run_id uuid NOT NULL,
  staged_row_id uuid NOT NULL,
  component_installation_id uuid NOT NULL,
  usage_basis text NOT NULL CHECK(usage_basis IN ('TIS','ENGINE_RUNTIME')),
  attributed_seconds numeric(24,6) CHECK(attributed_seconds >= 0),
  resolution text NOT NULL CHECK(resolution IN ('RESOLVED','UNKNOWN','AMBIGUOUS')),
  PRIMARY KEY(reconciliation_run_id,staged_row_id,component_installation_id,usage_basis),
  FOREIGN KEY(aircraft_id,reconciliation_run_id,staged_row_id) REFERENCES app.hours_reconciliation_staged_rows(aircraft_id,reconciliation_run_id,staged_row_id),
  FOREIGN KEY(aircraft_id,reconciliation_run_id,component_installation_id) REFERENCES app.hours_reconciliation_installations(aircraft_id,reconciliation_run_id,component_installation_id),
  CHECK((resolution='RESOLVED' AND attributed_seconds IS NOT NULL) OR (resolution<>'RESOLVED' AND attributed_seconds IS NULL))
);
CREATE TABLE app.hours_reconciliation_differences (
  aircraft_id uuid NOT NULL,
  reconciliation_run_id uuid NOT NULL,
  counter_reference_id uuid NOT NULL,
  derived_seconds numeric(24,6),
  difference_seconds numeric(24,6),
  result text NOT NULL CHECK(result IN ('MATCH','DISCREPANCY','UNKNOWN','GAP','CONFLICT')),
  cause text NOT NULL CHECK(cause IN ('EXACT_EQUIVALENCE','DOCUMENTED_ROUNDING','REAL_DIFFERENCE','INSUFFICIENT_EVIDENCE','INCOMPATIBLE_BASIS')),
  observed_seconds numeric(24,6),
  comparison_evidence jsonb NOT NULL CHECK(jsonb_typeof(comparison_evidence)='object'),
  explanation text NOT NULL,
  PRIMARY KEY(aircraft_id,reconciliation_run_id,counter_reference_id),
  FOREIGN KEY(aircraft_id,reconciliation_run_id,counter_reference_id) REFERENCES app.hours_reconciliation_references(aircraft_id,reconciliation_run_id,counter_reference_id),
  CHECK(derived_seconds IS NULL OR derived_seconds >= 0),
  CHECK(observed_seconds IS NULL OR observed_seconds >= 0),
  CHECK(result NOT IN ('UNKNOWN','GAP','CONFLICT') OR (derived_seconds IS NULL AND difference_seconds IS NULL)),
  CHECK(result NOT IN ('MATCH','DISCREPANCY') OR (derived_seconds IS NOT NULL AND observed_seconds IS NOT NULL AND difference_seconds IS NOT NULL AND difference_seconds=derived_seconds-observed_seconds)),
  CHECK(result<>'MATCH' OR (difference_seconds=0 AND cause='EXACT_EQUIVALENCE'))
);
-- Validation diagnostics are immutable business evidence, not technical Audit.
CREATE TABLE app.hours_reconciliation_issues (
  reconciliation_issue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL,
  reconciliation_run_id uuid NOT NULL,
  staged_row_id uuid,
  severity text NOT NULL CHECK(severity IN ('ERROR','WARNING')),
  issue_code text NOT NULL CHECK(length(btrim(issue_code)) > 0),
  safe_message text NOT NULL,
  FOREIGN KEY(aircraft_id,reconciliation_run_id) REFERENCES app.hours_reconciliation_runs(aircraft_id,reconciliation_run_id),
  FOREIGN KEY(aircraft_id,reconciliation_run_id,staged_row_id) REFERENCES app.hours_reconciliation_staged_rows(aircraft_id,reconciliation_run_id,staged_row_id)
);
CREATE TABLE app.hours_reconciliation_confirmations (
  aircraft_id uuid NOT NULL,
  reconciliation_run_id uuid PRIMARY KEY,
  confirmable boolean NOT NULL DEFAULT true CHECK(confirmable),
  confirmed_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL UNIQUE,
  request_payload_sha256 text NOT NULL CHECK(request_payload_sha256 ~ '^[a-f0-9]{64}$'),
  FOREIGN KEY(aircraft_id,reconciliation_run_id,confirmable) REFERENCES app.hours_reconciliation_runs(aircraft_id,reconciliation_run_id,confirmable),
  UNIQUE(aircraft_id,reconciliation_run_id)
);
CREATE TABLE app.hours_import_committed_rows (
  aircraft_id uuid NOT NULL,
  reconciliation_run_id uuid NOT NULL,
  staged_row_id uuid NOT NULL,
  disposition text NOT NULL DEFAULT 'INCLUDE' CHECK(disposition='INCLUDE'),
  flight_id uuid NOT NULL,
  flight_revision_id uuid NOT NULL,
  PRIMARY KEY(staged_row_id),
  FOREIGN KEY(aircraft_id,reconciliation_run_id) REFERENCES app.hours_reconciliation_confirmations(aircraft_id,reconciliation_run_id),
  FOREIGN KEY(aircraft_id,reconciliation_run_id,staged_row_id,disposition) REFERENCES app.hours_reconciliation_staged_rows(aircraft_id,reconciliation_run_id,staged_row_id,disposition),
  FOREIGN KEY(aircraft_id,flight_id) REFERENCES app.flight_records(aircraft_id,flight_id),
  FOREIGN KEY(flight_id,flight_revision_id) REFERENCES app.flight_record_revisions(flight_id,flight_revision_id),
  UNIQUE(flight_id,flight_revision_id)
);
CREATE TABLE app.aircraft_hours_acceptances (
  hours_acceptance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL,
  acceptance_sequence integer NOT NULL CHECK(acceptance_sequence > 0),
  reconciliation_run_id uuid NOT NULL UNIQUE,
  supersedes_acceptance_id uuid,
  predecessor_sequence integer,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(aircraft_id,reconciliation_run_id) REFERENCES app.hours_reconciliation_confirmations(aircraft_id,reconciliation_run_id),
  UNIQUE(aircraft_id,acceptance_sequence),
  UNIQUE(aircraft_id,hours_acceptance_id,acceptance_sequence),
  UNIQUE(supersedes_acceptance_id), -- no two accepted successors to the same predecessor
  FOREIGN KEY(aircraft_id,supersedes_acceptance_id,predecessor_sequence) REFERENCES app.aircraft_hours_acceptances(aircraft_id,hours_acceptance_id,acceptance_sequence),
  CHECK((acceptance_sequence=1 AND supersedes_acceptance_id IS NULL AND predecessor_sequence IS NULL)
    OR (acceptance_sequence>1 AND supersedes_acceptance_id IS NOT NULL AND predecessor_sequence IS NOT NULL AND acceptance_sequence=predecessor_sequence+1))
);
-- Append-only invalidation; history is preserved. A new acceptance is needed for live results.
CREATE TABLE app.hours_acceptance_invalidations (
  hours_invalidation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL,
  aircraft_id uuid NOT NULL,
  hours_acceptance_id uuid NOT NULL,
  acceptance_sequence integer NOT NULL,
  reason_code text NOT NULL CHECK(reason_code IN ('REVISION_CHANGED','FLIGHT_VOIDED','RETROACTIVE_FLIGHT','INSTALLATION_CHANGED','REFERENCE_SUPERSEDED','OVERHAUL_CHANGED','ADJUSTMENT_CHANGED','POLICY_CHANGED','SOURCE_CHANGED')),
  source_reference text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(hours_acceptance_id,request_id,reason_code),
  FOREIGN KEY(aircraft_id,hours_acceptance_id,acceptance_sequence) REFERENCES app.aircraft_hours_acceptances(aircraft_id,hours_acceptance_id,acceptance_sequence)
);
-- SQL does NOT prove current revision, ledger continuity, scope of a user, exact file SHA match,
-- chronological applicability, source identity, service-return idempotency or semantic readiness.
-- Those checks need one aircraft-locked SERIALIZABLE transaction + hash/current-state recheck.
-- No function/trigger/grant is implemented here. Immutable evidence still requires approved
-- append-only privileges and audited mutation paths before any migration/apply.

-- F2: all *_seconds values are exact normalized seconds, max microsecond representation.
-- Bound DTO inputs to <=12 integer and <=6 fractional source digits BEFORE numeric casts;
-- PostgreSQL numeric(p,s) rounds excess scale, so column type alone is NOT input validation.
-- SQL cannot verify evidence conversion, source authority, DTO JSON shape, same physical basis,
-- complete coverage, current revisions or manifest freshness. SERIALIZABLE confirmation must
-- revalidate these under shared aircraft locks used by ALL competing mutators (see preflight.md).
-- No DDL execution, grants, policy approval or raw-file storage provisioning authorized here.

-- Bounded cleanup/scope lookup indexes; table teardown removes these automatically.
CREATE INDEX ix_hours_runs_batch ON app.hours_reconciliation_runs(aircraft_id,import_batch_id);
CREATE INDEX ix_hours_mapping_batch ON app.hours_import_mapping_versions(aircraft_id,import_batch_id);
