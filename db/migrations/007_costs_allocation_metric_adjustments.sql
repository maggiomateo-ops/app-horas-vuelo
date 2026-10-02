-- 007_costs_allocation_metric_adjustments.sql
-- D-302: separate event boundary from expense allocation metric and support immutable settlement adjustments.

ALTER TABLE app.cost_event_types
  RENAME COLUMN utilization_basis TO boundary_basis;

ALTER TABLE app.cost_event_types
  RENAME CONSTRAINT ck_cost_event_type_values TO ck_cost_event_type_values_v1;

ALTER TABLE app.cost_event_types
  DROP CONSTRAINT ck_cost_event_type_values_v1;

ALTER TABLE app.cost_event_types
  ADD CONSTRAINT ck_cost_event_type_values CHECK (
    length(btrim(name)) > 0
    AND boundary_basis IN ('NONE','FLIGHT_TIME','LANDINGS','PRESSURIZATION_CYCLES','ENGINE_CYCLES')
    AND status IN ('ACTIVE','ARCHIVED')
    AND (
      (boundary_basis='ENGINE_CYCLES' AND component_position IS NOT NULL AND component_position > 0)
      OR (boundary_basis<>'ENGINE_CYCLES' AND component_position IS NULL)
    )
  );

ALTER TABLE app.expenses
  ADD COLUMN utilization_metric text,
  ADD COLUMN utilization_component_position smallint;

ALTER TABLE app.expenses
  ADD CONSTRAINT ck_expense_utilization_metric CHECK (
    (
      allocation_method='UTILIZATION'
      AND utilization_metric IN ('FLIGHT_TIME','LANDINGS','PRESSURIZATION_CYCLES','ENGINE_CYCLES')
      AND (
        (utilization_metric='ENGINE_CYCLES' AND utilization_component_position IS NOT NULL AND utilization_component_position > 0)
        OR (utilization_metric<>'ENGINE_CYCLES' AND utilization_component_position IS NULL)
      )
    )
    OR
    (
      allocation_method<>'UTILIZATION'
      AND utilization_metric IS NULL
      AND utilization_component_position IS NULL
    )
  );

ALTER TABLE app.cost_settlements
  ADD COLUMN adjusts_settlement_id uuid REFERENCES app.cost_settlements(cost_settlement_id);

ALTER TABLE app.cost_settlements
  ADD CONSTRAINT ck_cost_settlement_not_self_adjustment CHECK (
    adjusts_settlement_id IS NULL OR adjusts_settlement_id <> cost_settlement_id
  );

ALTER TABLE app.cost_settlements
  DROP CONSTRAINT uq_cost_settlement_currency;

DROP INDEX app.uq_cost_settlement_period_currency;

CREATE UNIQUE INDEX uq_cost_original_event_currency
  ON app.cost_settlements (cost_event_id, currency_code)
  WHERE adjusts_settlement_id IS NULL AND cost_event_id IS NOT NULL;

CREATE UNIQUE INDEX uq_cost_original_period_currency
  ON app.cost_settlements (aircraft_id, period_start_date, period_end_date, currency_code)
  WHERE adjusts_settlement_id IS NULL AND cost_event_id IS NULL;

ALTER TABLE app.cost_settlement_utilization_lines
  DROP CONSTRAINT pk_cost_settlement_utilization;

ALTER TABLE app.cost_settlement_utilization_lines
  ADD COLUMN cost_settlement_utilization_line_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN expense_id uuid NOT NULL REFERENCES app.expenses(expense_id),
  ADD COLUMN utilization_metric text NOT NULL,
  ADD COLUMN component_installation_id uuid REFERENCES app.component_installations(component_installation_id);

ALTER TABLE app.cost_settlement_utilization_lines
  ADD CONSTRAINT pk_cost_settlement_utilization_line
    PRIMARY KEY (cost_settlement_utilization_line_id),
  ADD CONSTRAINT ck_cost_settlement_utilization_metric CHECK (
    utilization_metric IN ('FLIGHT_TIME','LANDINGS','PRESSURIZATION_CYCLES','ENGINE_CYCLES')
    AND (
      (utilization_metric='ENGINE_CYCLES' AND component_installation_id IS NOT NULL)
      OR (utilization_metric<>'ENGINE_CYCLES' AND component_installation_id IS NULL)
    )
  ),
  ADD CONSTRAINT fk_cost_settlement_utilization_expense
    FOREIGN KEY (cost_settlement_id, expense_id)
    REFERENCES app.cost_settlement_expense_lines(cost_settlement_id, expense_id);

CREATE UNIQUE INDEX uq_cost_settlement_utilization_evidence
  ON app.cost_settlement_utilization_lines
    (cost_settlement_id, expense_id, flight_id, utilization_metric, component_installation_id)
  NULLS NOT DISTINCT;

GRANT SELECT, INSERT, UPDATE ON app.expenses TO app_runtime;
GRANT SELECT, INSERT ON app.cost_settlements, app.cost_settlement_utilization_lines TO app_runtime;
