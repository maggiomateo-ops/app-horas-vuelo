-- 006_costs.sql
-- D-297..D-300: normalized aircraft-private Costs ledger and immutable settlement evidence.
-- Production is out of scope. Application service remains responsible for OWNER authorization,
-- aircraft-scoped validation, allocation-total validation and atomic settlement semantics.

CREATE TABLE app.cost_concepts (
  cost_concept_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  name text NOT NULL,
  cost_class text NOT NULL,
  default_allocation_method text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT ck_cost_concept_values CHECK (
    length(btrim(name)) > 0
    AND cost_class IN ('FIXED','VARIABLE')
    AND default_allocation_method IN ('OWNERSHIP','CUSTOM','UTILIZATION','DIRECT')
    AND status IN ('ACTIVE','ARCHIVED')
  )
);
CREATE UNIQUE INDEX uq_active_cost_concept_name
  ON app.cost_concepts (aircraft_id, lower(name)) WHERE status='ACTIVE';

CREATE TABLE app.cost_event_types (
  cost_event_type_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  name text NOT NULL,
  utilization_basis text NOT NULL DEFAULT 'NONE',
  component_position smallint,
  status text NOT NULL DEFAULT 'ACTIVE',
  CONSTRAINT ck_cost_event_type_values CHECK (
    length(btrim(name)) > 0
    AND utilization_basis IN ('NONE','FLIGHT_TIME','LANDINGS','PRESSURIZATION_CYCLES','ENGINE_CYCLES')
    AND status IN ('ACTIVE','ARCHIVED')
    AND (
      (utilization_basis='ENGINE_CYCLES' AND component_position IS NOT NULL AND component_position > 0)
      OR (utilization_basis<>'ENGINE_CYCLES' AND component_position IS NULL)
    )
  )
);
CREATE UNIQUE INDEX uq_active_cost_event_type_name
  ON app.cost_event_types (aircraft_id, lower(name)) WHERE status='ACTIVE';

CREATE TABLE app.cost_events (
  cost_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  cost_event_type_id uuid NOT NULL REFERENCES app.cost_event_types(cost_event_type_id),
  title text NOT NULL,
  event_date date NOT NULL,
  previous_cost_event_id uuid REFERENCES app.cost_events(cost_event_id),
  boundary_after_flight_id uuid REFERENCES app.flight_records(flight_id),
  status text NOT NULL DEFAULT 'OPEN',
  settled_at timestamptz,
  settled_by_user_id uuid REFERENCES app.users(user_id),
  CONSTRAINT ck_cost_event_values CHECK (
    length(btrim(title)) > 0
    AND status IN ('OPEN','SETTLED')
    AND (
      (status='OPEN' AND settled_at IS NULL AND settled_by_user_id IS NULL)
      OR (status='SETTLED' AND settled_at IS NOT NULL AND settled_by_user_id IS NOT NULL)
    )
  ),
  CONSTRAINT ck_cost_event_not_self_previous CHECK (
    previous_cost_event_id IS NULL OR previous_cost_event_id <> cost_event_id
  )
);
CREATE INDEX idx_cost_events_aircraft_date
  ON app.cost_events (aircraft_id, event_date DESC);

CREATE TABLE app.expenses (
  expense_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  cost_event_id uuid REFERENCES app.cost_events(cost_event_id),
  cost_concept_id uuid NOT NULL REFERENCES app.cost_concepts(cost_concept_id),
  expense_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency_code char(3) NOT NULL,
  description text,
  allocation_method text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN',
  CONSTRAINT ck_expense_values CHECK (
    amount > 0
    AND currency_code ~ '^[A-Z]{3}$'
    AND allocation_method IN ('OWNERSHIP','CUSTOM','UTILIZATION','DIRECT')
    AND status IN ('OPEN','VOID')
  )
);
CREATE INDEX idx_expenses_aircraft_date
  ON app.expenses (aircraft_id, expense_date DESC);
CREATE INDEX idx_expenses_event
  ON app.expenses (cost_event_id) WHERE cost_event_id IS NOT NULL;

CREATE TABLE app.expense_payments (
  expense_payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES app.expenses(expense_id),
  payer_party_id uuid NOT NULL REFERENCES app.parties(party_id),
  amount numeric(14,2) NOT NULL,
  CONSTRAINT ck_expense_payment_amount CHECK (amount > 0)
);
CREATE INDEX idx_expense_payments_expense ON app.expense_payments (expense_id);

CREATE TABLE app.expense_allocations (
  expense_allocation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES app.expenses(expense_id),
  party_id uuid NOT NULL REFERENCES app.parties(party_id),
  allocation_percent numeric(7,4) NOT NULL,
  allocated_amount numeric(14,2) NOT NULL,
  source_method text NOT NULL,
  CONSTRAINT uq_expense_allocation_party UNIQUE (expense_id, party_id),
  CONSTRAINT ck_expense_allocation_values CHECK (
    allocation_percent > 0 AND allocation_percent <= 100
    AND allocated_amount >= 0
    AND source_method IN ('OWNERSHIP','CUSTOM','UTILIZATION','DIRECT')
  )
);

CREATE TABLE app.cost_settlements (
  cost_settlement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aircraft_id uuid NOT NULL REFERENCES app.aircraft(aircraft_id),
  cost_event_id uuid REFERENCES app.cost_events(cost_event_id),
  period_start_date date,
  period_end_date date,
  currency_code char(3) NOT NULL,
  settled_at timestamptz NOT NULL,
  settled_by_user_id uuid NOT NULL REFERENCES app.users(user_id),
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_cost_settlement_currency UNIQUE (cost_event_id, currency_code),
  CONSTRAINT ck_cost_settlement_values CHECK (
    currency_code ~ '^[A-Z]{3}$'
    AND jsonb_typeof(source_snapshot)='object'
    AND (
      (cost_event_id IS NOT NULL AND period_start_date IS NULL AND period_end_date IS NULL)
      OR
      (cost_event_id IS NULL AND period_start_date IS NOT NULL AND period_end_date IS NOT NULL
       AND period_start_date <= period_end_date)
    )
  )
);
CREATE INDEX idx_cost_settlements_aircraft_time
  ON app.cost_settlements (aircraft_id, settled_at DESC);
CREATE UNIQUE INDEX uq_cost_settlement_period_currency
  ON app.cost_settlements (aircraft_id, period_start_date, period_end_date, currency_code)
  WHERE cost_event_id IS NULL;

CREATE TABLE app.cost_settlement_expense_lines (
  cost_settlement_id uuid NOT NULL REFERENCES app.cost_settlements(cost_settlement_id),
  expense_id uuid NOT NULL REFERENCES app.expenses(expense_id),
  cost_concept_id uuid NOT NULL REFERENCES app.cost_concepts(cost_concept_id),
  expense_date date NOT NULL,
  amount numeric(14,2) NOT NULL,
  currency_code char(3) NOT NULL,
  allocation_method text NOT NULL,
  CONSTRAINT pk_cost_settlement_expense PRIMARY KEY (cost_settlement_id, expense_id),
  CONSTRAINT ck_cost_settlement_expense_values CHECK (
    amount > 0
    AND currency_code ~ '^[A-Z]{3}$'
    AND allocation_method IN ('OWNERSHIP','CUSTOM','UTILIZATION','DIRECT')
  )
);

CREATE TABLE app.cost_settlement_party_lines (
  cost_settlement_id uuid NOT NULL REFERENCES app.cost_settlements(cost_settlement_id),
  expense_id uuid NOT NULL REFERENCES app.expenses(expense_id),
  party_id uuid NOT NULL REFERENCES app.parties(party_id),
  responsibility_amount numeric(14,2) NOT NULL,
  paid_amount numeric(14,2) NOT NULL,
  CONSTRAINT pk_cost_settlement_party_expense PRIMARY KEY
    (cost_settlement_id, expense_id, party_id),
  CONSTRAINT fk_cost_settlement_party_expense
    FOREIGN KEY (cost_settlement_id, expense_id)
    REFERENCES app.cost_settlement_expense_lines(cost_settlement_id, expense_id),
  CONSTRAINT ck_cost_settlement_party_values CHECK (
    responsibility_amount >= 0 AND paid_amount >= 0
  )
);

CREATE TABLE app.cost_settlement_owner_lines (
  cost_settlement_id uuid NOT NULL REFERENCES app.cost_settlements(cost_settlement_id),
  party_id uuid NOT NULL REFERENCES app.parties(party_id),
  responsibility_amount numeric(14,2) NOT NULL,
  paid_amount numeric(14,2) NOT NULL,
  net_amount numeric(14,2) NOT NULL,
  CONSTRAINT pk_cost_settlement_owner PRIMARY KEY (cost_settlement_id, party_id),
  CONSTRAINT ck_cost_settlement_owner_values CHECK (
    responsibility_amount >= 0
    AND paid_amount >= 0
    AND net_amount = paid_amount - responsibility_amount
  )
);

CREATE TABLE app.cost_settlement_utilization_lines (
  cost_settlement_id uuid NOT NULL REFERENCES app.cost_settlements(cost_settlement_id),
  flight_id uuid NOT NULL REFERENCES app.flight_records(flight_id),
  flight_revision_id uuid NOT NULL REFERENCES app.flight_record_revisions(flight_revision_id),
  utilization_owner_party_id uuid NOT NULL REFERENCES app.parties(party_id),
  utilization_value numeric(12,3) NOT NULL,
  CONSTRAINT pk_cost_settlement_utilization PRIMARY KEY (cost_settlement_id, flight_id),
  CONSTRAINT ck_cost_settlement_utilization_value CHECK (utilization_value >= 0)
);

-- New tables need explicit grants because the initial blanket grants predate migration 006.
GRANT SELECT, INSERT, UPDATE ON
  app.cost_concepts,
  app.cost_event_types,
  app.cost_events,
  app.expenses,
  app.expense_payments,
  app.expense_allocations
TO app_runtime;

GRANT SELECT, INSERT ON
  app.cost_settlements,
  app.cost_settlement_expense_lines,
  app.cost_settlement_party_lines,
  app.cost_settlement_owner_lines,
  app.cost_settlement_utilization_lines
TO app_runtime;

-- No runtime DELETE is granted on Costs tables.
-- Settlement snapshot tables intentionally receive no UPDATE privilege.
