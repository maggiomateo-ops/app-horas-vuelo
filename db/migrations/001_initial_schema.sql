-- App Horas — 2E.1 canonical PostgreSQL foundation
-- Migration: 001_initial_schema.sql
-- Scope: empty schema only. No operational data is loaded by this migration.
-- Source of truth for this file: CONFIRMED rows/decisions in
--   App Horas - 2E.0 Product & Data Model
--   App Horas - Postgres Schema Catalog

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS audit;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime NOLOGIN;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Identity: persons and users
-- ---------------------------------------------------------------------------

CREATE TABLE app.persons (
  person_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  email text,
  phone text,
  license_number text,
  notes text,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_persons_status CHECK (status IN ('ACTIVE', 'ARCHIVED'))
);

CREATE TABLE app.person_identifiers (
  person_identifier_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES app.persons(person_id),
  issuer_country_code char(2) NOT NULL,
  identifier_type text NOT NULL,
  identifier_value text NOT NULL,
  normalized_value text NOT NULL,
  is_primary boolean NOT NULL,
  verified_at timestamptz,
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_person_identifier_identity
    UNIQUE (issuer_country_code, identifier_type, normalized_value)
);

CREATE TABLE app.users (
  user_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  status text NOT NULL,
  preferred_locale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_users_email_status_locale CHECK (
    length(btrim(email)) > 0
    AND status IN ('ACTIVE', 'DISABLED')
    AND preferred_locale IN ('en', 'es')
  )
);

CREATE UNIQUE INDEX uq_users_email_ci
  ON app.users (lower(email));

CREATE TABLE app.user_person_links (
  user_id uuid PRIMARY KEY REFERENCES app.users(user_id),
  person_id uuid NOT NULL UNIQUE REFERENCES app.persons(person_id),
  linked_at timestamptz NOT NULL,
  verified_at timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- Aircraft root, people association, registration, ownership and access
-- ---------------------------------------------------------------------------

CREATE TABLE app.aircraft (
  aircraft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manufacturer text NOT NULL,
  model text NOT NULL,
  serial_number text,
  status text NOT NULL,
  created_by_user_id uuid REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_aircraft_identity_values CHECK (
    length(btrim(manufacturer)) > 0
    AND length(btrim(model)) > 0
    AND (serial_number IS NULL OR length(btrim(serial_number)) > 0)
    AND status IN ('ACTIVE', 'ARCHIVED')
  )
);

CREATE TABLE app.aircraft_persons (
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  person_id uuid NOT NULL REFERENCES app.persons(person_id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT pk_aircraft_persons PRIMARY KEY (aircraft_id, person_id),
  CONSTRAINT ck_aircraft_persons_status CHECK (status IN ('ACTIVE', 'ARCHIVED'))
);

CREATE TABLE app.aircraft_registrations (
  aircraft_registration_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  registration text NOT NULL,
  country_code char(2),
  effective_from_at timestamptz NOT NULL,
  effective_to_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_aircraft_registration_interval CHECK (
    length(btrim(registration)) > 0
    AND (effective_to_at IS NULL OR effective_to_at > effective_from_at)
  )
);

CREATE UNIQUE INDEX uq_current_registration_aircraft
  ON app.aircraft_registrations (aircraft_id)
  WHERE effective_to_at IS NULL;

CREATE TABLE app.parties (
  party_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_type text NOT NULL,
  person_id uuid REFERENCES app.persons(person_id),
  organization_name text,
  country_code char(2),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_party_representation CHECK (
    (
      party_type = 'PERSON'
      AND person_id IS NOT NULL
      AND organization_name IS NULL
    )
    OR
    (
      party_type = 'ORGANIZATION'
      AND person_id IS NULL
      AND organization_name IS NOT NULL
      AND length(btrim(organization_name)) > 0
    )
  ),
  CONSTRAINT ck_parties_status CHECK (status IN ('ACTIVE', 'ARCHIVED'))
);

CREATE UNIQUE INDEX uq_party_person
  ON app.parties (person_id)
  WHERE party_type = 'PERSON';

CREATE TABLE app.aircraft_ownership_interests (
  ownership_interest_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  party_id uuid NOT NULL REFERENCES app.parties(party_id),
  ownership_share numeric(5,2) NOT NULL,
  effective_from_at timestamptz NOT NULL,
  effective_to_at timestamptz,
  created_by_user_id uuid REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ownership_interest_values CHECK (
    ownership_share > 0
    AND ownership_share <= 100
    AND (effective_to_at IS NULL OR effective_to_at > effective_from_at)
  )
);

CREATE UNIQUE INDEX uq_current_ownership_party
  ON app.aircraft_ownership_interests (aircraft_id, party_id)
  WHERE effective_to_at IS NULL;

CREATE TABLE app.aircraft_memberships (
  membership_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  user_id uuid REFERENCES app.users(user_id),
  invited_email text,
  role text NOT NULL,
  status text NOT NULL,
  invited_by_user_id uuid REFERENCES app.users(user_id),
  invited_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_aircraft_membership_role CHECK (role IN ('OWNER', 'PILOT', 'VIEWER')),
  CONSTRAINT ck_membership_lifecycle CHECK (
    (
      status = 'INVITED'
      AND invited_email IS NOT NULL
      AND length(btrim(invited_email)) > 0
      AND invited_at IS NOT NULL
      AND invited_by_user_id IS NOT NULL
      AND activated_at IS NULL
      AND revoked_at IS NULL
      AND revoked_by_user_id IS NULL
    )
    OR
    (
      status = 'ACTIVE'
      AND user_id IS NOT NULL
      AND activated_at IS NOT NULL
      AND revoked_at IS NULL
      AND revoked_by_user_id IS NULL
    )
    OR
    (
      status = 'REVOKED'
      AND revoked_at IS NOT NULL
      AND revoked_by_user_id IS NOT NULL
      AND (
        (activated_at IS NOT NULL AND user_id IS NOT NULL)
        OR
        (
          activated_at IS NULL
          AND invited_email IS NOT NULL
          AND length(btrim(invited_email)) > 0
          AND invited_at IS NOT NULL
          AND invited_by_user_id IS NOT NULL
        )
      )
    )
  )
);

CREATE UNIQUE INDEX uq_live_membership_user
  ON app.aircraft_memberships (aircraft_id, user_id)
  WHERE user_id IS NOT NULL AND status IN ('INVITED', 'ACTIVE');

CREATE UNIQUE INDEX uq_pending_invite_email_ci
  ON app.aircraft_memberships (aircraft_id, lower(invited_email))
  WHERE status = 'INVITED';

CREATE TABLE app.aircraft_membership_capabilities (
  membership_capability_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES app.aircraft_memberships(membership_id),
  capability text NOT NULL,
  granted_by_user_id uuid REFERENCES app.users(user_id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_by_user_id uuid REFERENCES app.users(user_id),
  revoked_at timestamptz,
  CONSTRAINT ck_membership_capability_lifecycle CHECK (
    capability = 'MANAGE_OWNERSHIP'
    AND (
      (revoked_at IS NULL AND revoked_by_user_id IS NULL)
      OR
      (revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
    )
  )
);

CREATE UNIQUE INDEX uq_active_membership_capability
  ON app.aircraft_membership_capabilities (membership_id, capability)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Aircraft settings and entry configuration
-- ---------------------------------------------------------------------------

CREATE TABLE app.aircraft_settings (
  aircraft_id uuid PRIMARY KEY REFERENCES app.aircraft(aircraft_id),
  default_capture_method text NOT NULL,
  default_oil_unit text NOT NULL,
  capture_engine_runtime boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_aircraft_settings_values CHECK (
    default_capture_method IN ('DIRECT', 'TACHOMETER', 'CLOCK')
    AND default_oil_unit IN ('LITER', 'US_QUART')
  )
);

CREATE TABLE app.aircraft_flight_field_settings (
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  field_code text NOT NULL,
  is_enabled boolean NOT NULL,
  is_required boolean NOT NULL,
  display_order integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT pk_aircraft_flight_field_settings PRIMARY KEY (aircraft_id, field_code),
  CONSTRAINT ck_aircraft_flight_field_code CHECK (
    field_code IN (
      'FLIGHT_PURPOSE',
      'LANDINGS',
      'PRESSURIZATION_CYCLES',
      'ENGINE_CYCLES',
      'ENGINE_STARTS',
      'FUEL_REMAINING',
      'OIL_ADDED',
      'REMARKS'
    )
  ),
  CONSTRAINT ck_field_required_enabled CHECK (NOT is_required OR is_enabled),
  CONSTRAINT ck_field_display_order CHECK (
    (is_enabled AND display_order IS NOT NULL AND display_order >= 0)
    OR
    (NOT is_enabled AND display_order IS NULL)
  )
);

CREATE UNIQUE INDEX uq_field_enabled_order
  ON app.aircraft_flight_field_settings (aircraft_id, display_order)
  WHERE is_enabled;

CREATE TABLE app.aircraft_flight_purposes (
  flight_purpose_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  name text NOT NULL,
  status text NOT NULL,
  display_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_aircraft_flight_purpose_values CHECK (
    status IN ('ACTIVE', 'ARCHIVED')
    AND display_order >= 0
  )
);

CREATE UNIQUE INDEX uq_active_purpose_name
  ON app.aircraft_flight_purposes (aircraft_id, lower(name))
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX uq_active_purpose_order
  ON app.aircraft_flight_purposes (aircraft_id, display_order)
  WHERE status = 'ACTIVE';

CREATE TABLE app.aircraft_tanks (
  tank_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  name text NOT NULL,
  position_code text,
  display_unit text NOT NULL,
  display_order integer NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_aircraft_tank_values CHECK (
    display_unit IN ('LITER', 'US_GALLON')
    AND display_order >= 0
    AND status IN ('ACTIVE', 'ARCHIVED')
  )
);

CREATE UNIQUE INDEX uq_active_tank_name
  ON app.aircraft_tanks (aircraft_id, lower(name))
  WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX uq_active_tank_order
  ON app.aircraft_tanks (aircraft_id, display_order)
  WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Components and import-batch root data needed before Flight Records
-- ---------------------------------------------------------------------------

CREATE TABLE app.components (
  component_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_type text NOT NULL,
  manufacturer text,
  model text,
  serial_number text,
  status text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_component_values CHECK (
    component_type IN ('ENGINE', 'PROPELLER')
    AND status IN ('ACTIVE', 'ARCHIVED')
  )
);

CREATE TABLE app.flight_import_batches (
  import_batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  initiated_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  template_version text NOT NULL,
  source_filename text NOT NULL,
  source_file_sha256 text NOT NULL,
  status text NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  valid_rows integer NOT NULL DEFAULT 0,
  error_rows integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  source_storage_key text,
  source_expires_at timestamptz,
  mapping_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  committed_at timestamptz,
  CONSTRAINT ck_import_batch_status CHECK (
    status IN ('UPLOADED', 'INVALID', 'READY', 'COMMITTED', 'FAILED')
  ),
  CONSTRAINT ck_import_batch_counts CHECK (
    total_rows >= 0
    AND valid_rows >= 0
    AND error_rows >= 0
    AND warning_count >= 0
    AND valid_rows + error_rows = total_rows
  ),
  CONSTRAINT ck_import_batch_committed_at CHECK (
    status <> 'COMMITTED' OR committed_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX uq_committed_import_hash
  ON app.flight_import_batches (aircraft_id, source_file_sha256)
  WHERE status = 'COMMITTED';

CREATE INDEX idx_import_aircraft_created
  ON app.flight_import_batches (aircraft_id, created_at DESC);

CREATE TABLE app.flight_import_issues (
  import_issue_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES app.flight_import_batches(import_batch_id),
  row_number integer,
  column_name text,
  severity text NOT NULL,
  issue_code text NOT NULL,
  message_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_import_issue_row CHECK (row_number IS NULL OR row_number > 0),
  CONSTRAINT ck_import_issue_severity CHECK (severity IN ('ERROR', 'WARNING'))
);

CREATE INDEX idx_import_issues_batch_row
  ON app.flight_import_issues (import_batch_id, row_number);

-- ---------------------------------------------------------------------------
-- Flight Record stable identity + immutable revisions
-- ---------------------------------------------------------------------------

CREATE TABLE app.flight_records (
  flight_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  current_revision_id uuid NOT NULL,
  status text NOT NULL,
  record_source text NOT NULL,
  created_by_user_id uuid REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by_user_id uuid REFERENCES app.users(user_id),
  void_reason text,
  import_batch_id uuid REFERENCES app.flight_import_batches(import_batch_id),
  import_row_number integer,
  CONSTRAINT ck_flight_record_status_source CHECK (
    status IN ('ACTIVE', 'VOIDED')
    AND record_source IN ('MANUAL', 'IMPORT', 'MIGRATION')
  ),
  CONSTRAINT ck_flight_void_state CHECK (
    (
      status = 'ACTIVE'
      AND voided_at IS NULL
      AND voided_by_user_id IS NULL
      AND void_reason IS NULL
    )
    OR
    (
      status = 'VOIDED'
      AND voided_at IS NOT NULL
      AND voided_by_user_id IS NOT NULL
      AND void_reason IS NOT NULL
    )
  ),
  CONSTRAINT ck_flight_import_provenance CHECK (
    (
      record_source = 'IMPORT'
      AND import_batch_id IS NOT NULL
      AND import_row_number IS NOT NULL
      AND import_row_number > 0
    )
    OR
    (
      record_source <> 'IMPORT'
      AND import_batch_id IS NULL
      AND import_row_number IS NULL
    )
  )
);

CREATE UNIQUE INDEX uq_flight_import_row
  ON app.flight_records (import_batch_id, import_row_number)
  WHERE import_batch_id IS NOT NULL;

CREATE TABLE app.flight_record_revisions (
  flight_revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flight_id uuid NOT NULL REFERENCES app.flight_records(flight_id),
  revision_number integer NOT NULL,
  flight_date date,
  departure_location text,
  arrival_location text,
  pilot_person_id uuid REFERENCES app.persons(person_id),
  utilization_owner_party_id uuid REFERENCES app.parties(party_id),
  flight_purpose_id uuid REFERENCES app.aircraft_flight_purposes(flight_purpose_id),
  capture_method text,
  flight_time_hours numeric(8,1),
  time_in_service_hours numeric(8,1),
  tach_start numeric,
  tach_end numeric,
  movement_start_at timestamptz,
  takeoff_at timestamptz,
  landing_at timestamptz,
  final_stop_at timestamptz,
  remarks text,
  created_by_user_id uuid REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  correction_reason text,
  CONSTRAINT uq_flight_revision_number UNIQUE (flight_id, revision_number),
  CONSTRAINT uq_flight_revision_pair UNIQUE (flight_id, flight_revision_id),
  CONSTRAINT ck_flight_revision_number CHECK (revision_number > 0),
  CONSTRAINT ck_flight_revision_capture_method CHECK (
    capture_method IS NULL OR capture_method IN ('DIRECT', 'TACHOMETER', 'CLOCK')
  ),
  CONSTRAINT ck_revision_correction_reason CHECK (
    revision_number = 1 OR correction_reason IS NOT NULL
  )
);

ALTER TABLE app.flight_records
  ADD CONSTRAINT fk_flight_current_revision
  FOREIGN KEY (flight_id, current_revision_id)
  REFERENCES app.flight_record_revisions(flight_id, flight_revision_id)
  DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- Physical component installation and revision-scoped dynamic snapshots
-- ---------------------------------------------------------------------------

CREATE TABLE app.component_installations (
  component_installation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id uuid NOT NULL REFERENCES app.components(component_id),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  position_index smallint NOT NULL,
  installed_on date NOT NULL,
  removed_on date,
  opening_tis_hours numeric(10,1),
  first_applicable_flight_id uuid REFERENCES app.flight_records(flight_id),
  last_applicable_flight_id uuid REFERENCES app.flight_records(flight_id),
  created_by_user_id uuid REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_component_installation_values CHECK (
    position_index > 0
    AND (removed_on IS NULL OR removed_on >= installed_on)
    AND (opening_tis_hours IS NULL OR opening_tis_hours >= 0)
  )
);

CREATE UNIQUE INDEX uq_open_component_installation
  ON app.component_installations (component_id)
  WHERE removed_on IS NULL;

CREATE TABLE app.flight_counters (
  flight_revision_id uuid NOT NULL REFERENCES app.flight_record_revisions(flight_revision_id),
  counter_code text NOT NULL,
  counter_value integer NOT NULL,
  CONSTRAINT pk_flight_counters PRIMARY KEY (flight_revision_id, counter_code),
  CONSTRAINT ck_flight_counter_values CHECK (
    counter_code IN ('LANDINGS', 'PRESSURIZATION_CYCLES')
    AND counter_value >= 0
  )
);

CREATE TABLE app.flight_component_counters (
  flight_revision_id uuid NOT NULL REFERENCES app.flight_record_revisions(flight_revision_id),
  component_installation_id uuid NOT NULL REFERENCES app.component_installations(component_installation_id),
  counter_code text NOT NULL,
  counter_value integer NOT NULL,
  CONSTRAINT pk_flight_component_counters
    PRIMARY KEY (flight_revision_id, component_installation_id, counter_code),
  CONSTRAINT ck_component_counter_values CHECK (
    counter_code IN ('ENGINE_STARTS', 'ENGINE_CYCLES')
    AND counter_value >= 0
  )
);

CREATE TABLE app.flight_tank_readings (
  flight_revision_id uuid NOT NULL REFERENCES app.flight_record_revisions(flight_revision_id),
  tank_id uuid NOT NULL REFERENCES app.aircraft_tanks(tank_id),
  entered_value numeric(12,3) NOT NULL,
  entered_unit text NOT NULL,
  canonical_liters numeric(12,3) NOT NULL,
  CONSTRAINT pk_flight_tank_readings PRIMARY KEY (flight_revision_id, tank_id),
  CONSTRAINT ck_fuel_reading_values CHECK (
    entered_value >= 0
    AND canonical_liters >= 0
    AND entered_unit IN ('LITER', 'US_GALLON')
  )
);

CREATE TABLE app.flight_component_consumables (
  flight_revision_id uuid NOT NULL REFERENCES app.flight_record_revisions(flight_revision_id),
  component_installation_id uuid NOT NULL REFERENCES app.component_installations(component_installation_id),
  consumable_code text NOT NULL,
  entered_value numeric(12,3) NOT NULL,
  entered_unit text NOT NULL,
  canonical_liters numeric(12,3) NOT NULL,
  CONSTRAINT pk_flight_component_consumables
    PRIMARY KEY (flight_revision_id, component_installation_id, consumable_code),
  CONSTRAINT ck_consumable_values CHECK (
    consumable_code = 'OIL_ADDED'
    AND entered_value >= 0
    AND canonical_liters >= 0
    AND entered_unit IN ('LITER', 'US_QUART')
  )
);

CREATE TABLE app.flight_component_runtime (
  flight_revision_id uuid NOT NULL REFERENCES app.flight_record_revisions(flight_revision_id),
  component_installation_id uuid NOT NULL REFERENCES app.component_installations(component_installation_id),
  engine_start_at timestamptz NOT NULL,
  engine_stop_at timestamptz NOT NULL,
  engine_running_hours numeric(8,1) NOT NULL,
  CONSTRAINT pk_flight_component_runtime
    PRIMARY KEY (flight_revision_id, component_installation_id),
  CONSTRAINT ck_flight_component_runtime_values CHECK (engine_stop_at > engine_start_at)
);

-- ---------------------------------------------------------------------------
-- Utilization baselines and exceptional adjustments
-- ---------------------------------------------------------------------------

CREATE TABLE app.aircraft_utilization_baselines (
  aircraft_id uuid PRIMARY KEY REFERENCES app.aircraft(aircraft_id),
  baseline_tis_hours numeric(10,1),
  baseline_effective_date date NOT NULL,
  first_tracked_flight_id uuid REFERENCES app.flight_records(flight_id),
  source text NOT NULL,
  notes text,
  created_by_user_id uuid REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_aircraft_baseline_values CHECK (
    (baseline_tis_hours IS NULL OR baseline_tis_hours >= 0)
    AND source IN ('OWNER_ENTRY', 'LOGBOOK', 'IMPORT', 'MIGRATION', 'RECONCILIATION')
  )
);

CREATE TABLE app.utilization_adjustments (
  utilization_adjustment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid REFERENCES app.aircraft(aircraft_id),
  component_installation_id uuid REFERENCES app.component_installations(component_installation_id),
  adjustment_hours numeric(10,1) NOT NULL,
  effective_date date NOT NULL,
  after_flight_id uuid REFERENCES app.flight_records(flight_id),
  reason text NOT NULL,
  source_reference text,
  created_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_utilization_adjustment_values CHECK (
    ((aircraft_id IS NOT NULL)::integer + (component_installation_id IS NOT NULL)::integer) = 1
    AND adjustment_hours <> 0
    AND length(btrim(reason)) > 0
  )
);

-- ---------------------------------------------------------------------------
-- Semantic audit
-- ---------------------------------------------------------------------------

CREATE TABLE audit.audit_events (
  audit_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  request_id uuid NOT NULL,
  actor_type text NOT NULL,
  actor_user_id uuid,
  operation_source text NOT NULL,
  aircraft_id uuid,
  entity_type text NOT NULL,
  entity_id uuid,
  entity_key jsonb NOT NULL DEFAULT '{}'::jsonb,
  action_code text NOT NULL,
  before_state jsonb,
  after_state jsonb,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  payload_version smallint NOT NULL DEFAULT 1,
  CONSTRAINT ck_audit_actor_consistency CHECK (
    actor_type IN ('USER', 'SYSTEM')
    AND (actor_type <> 'USER' OR actor_user_id IS NOT NULL)
  ),
  CONSTRAINT ck_audit_operation_source CHECK (
    operation_source IN ('MANUAL', 'IMPORT', 'MIGRATION', 'SYSTEM')
  ),
  CONSTRAINT ck_audit_payload_version CHECK (payload_version > 0)
);

CREATE INDEX idx_audit_request
  ON audit.audit_events (request_id);

CREATE INDEX idx_audit_aircraft_time
  ON audit.audit_events (aircraft_id, occurred_at DESC)
  WHERE aircraft_id IS NOT NULL;

CREATE INDEX idx_audit_actor_time
  ON audit.audit_events (actor_user_id, occurred_at DESC)
  WHERE actor_user_id IS NOT NULL;

CREATE INDEX idx_audit_entity
  ON audit.audit_events (entity_type, entity_id, occurred_at DESC)
  WHERE entity_id IS NOT NULL;

CREATE INDEX gin_audit_entity_key
  ON audit.audit_events USING gin (entity_key);

-- ---------------------------------------------------------------------------
-- Component Tracking / owner reminders
-- ---------------------------------------------------------------------------

CREATE TABLE app.tracking_items (
  tracking_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  concept text NOT NULL,
  due_basis text NOT NULL,
  recurrence text NOT NULL,
  reference_mode text,
  due_date date,
  reference_tis_hours numeric(10,1),
  tracking_start_date date,
  tracking_start_after_flight_id uuid REFERENCES app.flight_records(flight_id),
  interval_hours numeric(10,1),
  alert_before_value numeric(10,1) NOT NULL,
  notes text,
  status text NOT NULL,
  created_by_user_id uuid REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_tracking_concept_nonblank CHECK (length(btrim(concept)) > 0),
  CONSTRAINT ck_tracking_lifecycle_recurrence CHECK (
    status IN ('ACTIVE', 'ARCHIVED')
    AND recurrence IN ('ONE_TIME', 'RECURRING')
    AND due_basis IN ('DATE', 'TIME_IN_SERVICE')
  ),
  CONSTRAINT ck_tracking_alert_before CHECK (alert_before_value >= 0),
  CONSTRAINT ck_tracking_item_basis_config CHECK (
    (
      due_basis = 'DATE'
      AND due_date IS NOT NULL
      AND reference_mode IS NULL
      AND reference_tis_hours IS NULL
      AND tracking_start_date IS NULL
      AND tracking_start_after_flight_id IS NULL
      AND interval_hours IS NULL
    )
    OR
    (
      due_basis = 'TIME_IN_SERVICE'
      AND due_date IS NULL
      AND interval_hours IS NOT NULL
      AND interval_hours > 0
      AND (
        (
          reference_mode = 'ABSOLUTE_TIS'
          AND reference_tis_hours IS NOT NULL
          AND reference_tis_hours >= 0
          AND tracking_start_date IS NULL
          AND tracking_start_after_flight_id IS NULL
        )
        OR
        (
          reference_mode = 'TRACKED_FROM_NOW'
          AND reference_tis_hours IS NULL
          AND tracking_start_date IS NOT NULL
        )
      )
    )
  )
);

CREATE INDEX idx_tracking_active_aircraft
  ON app.tracking_items (aircraft_id, due_basis)
  WHERE status = 'ACTIVE';

CREATE TABLE app.tracking_item_events (
  tracking_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_item_id uuid NOT NULL REFERENCES app.tracking_items(tracking_item_id),
  event_type text NOT NULL,
  completed_at timestamptz NOT NULL,
  completed_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  completed_at_tis numeric(10,1),
  completed_after_flight_id uuid REFERENCES app.flight_records(flight_id),
  note text,
  cycle_snapshot jsonb NOT NULL,
  next_due_date date,
  CONSTRAINT ck_tracking_event_type CHECK (event_type = 'COMPLETED')
);

CREATE INDEX idx_tracking_events_history
  ON app.tracking_item_events (tracking_item_id, completed_at DESC);

-- ---------------------------------------------------------------------------
-- Squawks / Novedades
-- ---------------------------------------------------------------------------

CREATE TABLE app.squawks (
  squawk_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  reported_at timestamptz NOT NULL,
  created_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  title text NOT NULL,
  description text NOT NULL,
  category text,
  flight_id uuid REFERENCES app.flight_records(flight_id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_squawk_content_nonblank CHECK (
    length(btrim(title)) > 0
    AND length(btrim(description)) > 0
  ),
  CONSTRAINT ck_squawk_status_category CHECK (
    status IN ('OPEN', 'SENT_TO_WORKSHOP', 'RESOLVED')
    AND (
      category IS NULL
      OR category IN (
        'POWERPLANT',
        'ELECTRICAL',
        'AVIONICS_INSTRUMENTS',
        'FUEL',
        'FLIGHT_CONTROLS',
        'LANDING_GEAR_BRAKES',
        'LIGHTING',
        'STRUCTURE',
        'CABIN_INTERIOR',
        'OTHER'
      )
    )
  )
);

CREATE INDEX idx_squawks_aircraft_status
  ON app.squawks (aircraft_id, status, reported_at DESC);

CREATE TABLE app.squawk_status_events (
  squawk_status_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squawk_id uuid NOT NULL REFERENCES app.squawks(squawk_id),
  from_status text NOT NULL,
  to_status text NOT NULL,
  changed_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  transition_note text,
  workshop_name text,
  workshop_contact text,
  resolution_note text,
  CONSTRAINT ck_squawk_status_transition CHECK (
    (from_status = 'OPEN' AND to_status IN ('SENT_TO_WORKSHOP', 'RESOLVED'))
    OR
    (from_status = 'SENT_TO_WORKSHOP' AND to_status IN ('OPEN', 'RESOLVED'))
    OR
    (from_status = 'RESOLVED' AND to_status = 'OPEN')
  ),
  CONSTRAINT ck_squawk_transition_metadata CHECK (
    (
      (to_status = 'RESOLVED' AND resolution_note IS NOT NULL AND length(btrim(resolution_note)) > 0)
      OR
      (to_status <> 'RESOLVED' AND resolution_note IS NULL)
    )
    AND (
      to_status = 'SENT_TO_WORKSHOP'
      OR (workshop_name IS NULL AND workshop_contact IS NULL)
    )
  )
);

CREATE INDEX idx_squawk_status_timeline
  ON app.squawk_status_events (squawk_id, changed_at);

CREATE TABLE app.squawk_comments (
  comment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squawk_id uuid NOT NULL REFERENCES app.squawks(squawk_id),
  body text NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_squawk_comment_nonblank CHECK (length(btrim(body)) > 0)
);

CREATE INDEX idx_squawk_comments_timeline
  ON app.squawk_comments (squawk_id, created_at);

CREATE TABLE app.squawk_attachments (
  attachment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  squawk_id uuid NOT NULL REFERENCES app.squawks(squawk_id),
  storage_key text NOT NULL,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  uploaded_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL,
  removed_at timestamptz,
  removed_by_user_id uuid REFERENCES app.users(user_id),
  CONSTRAINT ck_squawk_attachment_state CHECK (
    size_bytes >= 0
    AND (
      (status = 'ACTIVE' AND removed_at IS NULL AND removed_by_user_id IS NULL)
      OR
      (status = 'REMOVED' AND removed_at IS NOT NULL AND removed_by_user_id IS NOT NULL)
    )
  )
);

CREATE INDEX idx_squawk_attachments_timeline
  ON app.squawk_attachments (squawk_id, uploaded_at);

-- ---------------------------------------------------------------------------
-- Export templates and generated-run provenance
-- ---------------------------------------------------------------------------

CREATE TABLE app.export_templates (
  export_template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL,
  aircraft_id uuid REFERENCES app.aircraft(aircraft_id),
  dataset_code text NOT NULL,
  status text NOT NULL,
  current_version_id uuid NOT NULL,
  created_by_user_id uuid REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL,
  CONSTRAINT ck_export_template_scope CHECK (
    scope IN ('SYSTEM', 'AIRCRAFT')
    AND (
      (scope = 'SYSTEM' AND aircraft_id IS NULL)
      OR
      (scope = 'AIRCRAFT' AND aircraft_id IS NOT NULL)
    )
  ),
  CONSTRAINT ck_export_template_dataset_status CHECK (
    dataset_code IN (
      'AIRCRAFT_FLIGHT_HISTORY',
      'ENGINE_UTILIZATION_HISTORY',
      'PROPELLER_UTILIZATION_HISTORY'
    )
    AND status IN ('ACTIVE', 'ARCHIVED')
  )
);

CREATE TABLE app.export_template_versions (
  export_template_version_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_template_id uuid NOT NULL REFERENCES app.export_templates(export_template_id),
  version_number integer NOT NULL,
  name text NOT NULL,
  render_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid REFERENCES app.users(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_export_template_version_number UNIQUE (export_template_id, version_number),
  CONSTRAINT uq_export_template_version_pair UNIQUE (export_template_id, export_template_version_id),
  CONSTRAINT ck_export_template_version_values CHECK (
    version_number > 0
    AND length(btrim(name)) > 0
  )
);

ALTER TABLE app.export_templates
  ADD CONSTRAINT fk_export_template_current_version
  FOREIGN KEY (export_template_id, current_version_id)
  REFERENCES app.export_template_versions(export_template_id, export_template_version_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE app.export_template_version_fields (
  export_template_version_id uuid NOT NULL REFERENCES app.export_template_versions(export_template_version_id),
  field_code text NOT NULL,
  display_order integer NOT NULL,
  custom_label text,
  format_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT pk_export_template_version_fields
    PRIMARY KEY (export_template_version_id, field_code),
  CONSTRAINT uq_export_template_field_order
    UNIQUE (export_template_version_id, display_order),
  CONSTRAINT ck_export_template_field_values CHECK (
    display_order > 0
    AND (custom_label IS NULL OR length(btrim(custom_label)) > 0)
    AND jsonb_typeof(format_options) = 'object'
  )
);

CREATE INDEX idx_export_templates_aircraft_active
  ON app.export_templates (aircraft_id, dataset_code)
  WHERE scope = 'AIRCRAFT' AND status = 'ACTIVE';

CREATE TABLE app.export_runs (
  export_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  generated_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  output_format text NOT NULL,
  period_type text NOT NULL,
  period_start_date date,
  period_end_date date,
  locale text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz,
  failed_at timestamptz,
  failure_code text,
  artifact_filename text,
  artifact_sha256 text,
  artifact_size_bytes bigint,
  artifact_storage_key text,
  artifact_expires_at timestamptz,
  artifact_removed_at timestamptz,
  CONSTRAINT ck_export_run_config CHECK (
    output_format = 'XLSX'
    AND period_type IN ('ALL_HISTORY', 'YEAR_TO_DATE', 'CUSTOM')
    AND locale IN ('en', 'es')
    AND status IN ('PENDING', 'COMPLETED', 'FAILED')
  ),
  CONSTRAINT ck_export_run_period CHECK (
    (
      period_type = 'ALL_HISTORY'
      AND period_start_date IS NULL
      AND period_end_date IS NULL
    )
    OR
    (
      period_type IN ('YEAR_TO_DATE', 'CUSTOM')
      AND period_start_date IS NOT NULL
      AND period_end_date IS NOT NULL
      AND period_start_date <= period_end_date
    )
  ),
  CONSTRAINT ck_export_run_terminal_state CHECK (
    (
      status = 'PENDING'
      AND generated_at IS NULL
      AND failed_at IS NULL
      AND failure_code IS NULL
      AND artifact_filename IS NULL
      AND artifact_sha256 IS NULL
      AND artifact_size_bytes IS NULL
      AND artifact_storage_key IS NULL
      AND artifact_expires_at IS NULL
      AND artifact_removed_at IS NULL
    )
    OR
    (
      status = 'COMPLETED'
      AND generated_at IS NOT NULL
      AND failed_at IS NULL
      AND failure_code IS NULL
      AND artifact_filename IS NOT NULL
      AND artifact_sha256 IS NOT NULL
      AND artifact_size_bytes IS NOT NULL
      AND artifact_expires_at IS NOT NULL
    )
    OR
    (
      status = 'FAILED'
      AND failed_at IS NOT NULL
      AND failure_code IS NOT NULL
      AND generated_at IS NULL
      AND artifact_filename IS NULL
      AND artifact_sha256 IS NULL
      AND artifact_size_bytes IS NULL
      AND artifact_storage_key IS NULL
      AND artifact_expires_at IS NULL
      AND artifact_removed_at IS NULL
    )
  ),
  CONSTRAINT ck_export_artifact_delivery CHECK (
    (artifact_size_bytes IS NULL OR artifact_size_bytes >= 0)
    AND (
      status <> 'COMPLETED'
      OR (
        (artifact_removed_at IS NULL AND artifact_storage_key IS NOT NULL)
        OR
        (artifact_removed_at IS NOT NULL AND artifact_storage_key IS NULL)
      )
    )
  )
);

CREATE INDEX idx_export_runs_aircraft_created
  ON app.export_runs (aircraft_id, created_at DESC);

CREATE TABLE app.export_run_datasets (
  export_run_id uuid NOT NULL REFERENCES app.export_runs(export_run_id),
  dataset_code text NOT NULL,
  export_template_version_id uuid NOT NULL REFERENCES app.export_template_versions(export_template_version_id),
  CONSTRAINT pk_export_run_datasets PRIMARY KEY (export_run_id, dataset_code),
  CONSTRAINT ck_export_run_dataset_code CHECK (
    dataset_code IN (
      'AIRCRAFT_FLIGHT_HISTORY',
      'ENGINE_UTILIZATION_HISTORY',
      'PROPELLER_UTILIZATION_HISTORY'
    )
  )
);

-- ---------------------------------------------------------------------------
-- Runtime role grants
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA app, audit TO app_runtime;

-- Runtime can read and create canonical rows. No blanket UPDATE or DELETE grant.
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA app TO app_runtime;
GRANT SELECT, INSERT ON audit.audit_events TO app_runtime;

-- Mutable roots/configuration/lifecycle tables.
GRANT UPDATE ON
  app.persons,
  app.person_identifiers,
  app.users,
  app.aircraft,
  app.aircraft_persons,
  app.aircraft_registrations,
  app.parties,
  app.aircraft_ownership_interests,
  app.aircraft_memberships,
  app.aircraft_membership_capabilities,
  app.aircraft_settings,
  app.aircraft_flight_field_settings,
  app.aircraft_flight_purposes,
  app.aircraft_tanks,
  app.components,
  app.component_installations,
  app.aircraft_utilization_baselines,
  app.flight_import_batches,
  app.tracking_items,
  app.squawks
TO app_runtime;

-- Stable link identity is insert-only for runtime; corrections require explicit admin/migration handling.
-- app.user_person_links intentionally receives no UPDATE/DELETE.

-- Flight root lifecycle/current revision is mutable; revision snapshots are append-only.
GRANT UPDATE (
  current_revision_id,
  status,
  voided_at,
  voided_by_user_id,
  void_reason
) ON app.flight_records TO app_runtime;

-- Import validation issues are the sole V1 hard-delete exception and are service-gated
-- to non-COMMITTED parent batches (D-191).
GRANT DELETE ON app.flight_import_issues TO app_runtime;

-- Squawk attachment upload metadata is immutable; only removal lifecycle fields can change.
GRANT UPDATE (status, removed_at, removed_by_user_id)
  ON app.squawk_attachments TO app_runtime;

-- Export template root identity is immutable after creation.
GRANT UPDATE (current_version_id, status, updated_at)
  ON app.export_templates TO app_runtime;

-- Export run configuration is immutable after creation; only terminal/artifact lifecycle mutates.
GRANT UPDATE (
  status,
  generated_at,
  failed_at,
  failure_code,
  artifact_filename,
  artifact_sha256,
  artifact_size_bytes,
  artifact_storage_key,
  artifact_expires_at,
  artifact_removed_at
) ON app.export_runs TO app_runtime;

-- Explicitly keep append-only/history tables without UPDATE/DELETE runtime privileges:
--   app.flight_record_revisions
--   app.flight_counters
--   app.flight_component_counters
--   app.flight_tank_readings
--   app.flight_component_consumables
--   app.flight_component_runtime
--   app.utilization_adjustments
--   app.tracking_item_events
--   app.squawk_status_events
--   app.squawk_comments
--   app.export_template_versions
--   app.export_template_version_fields
--   app.export_run_datasets
--   audit.audit_events

-- No runtime DELETE is granted on any other canonical app table.
