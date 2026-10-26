-- PROPOSED isolated-preflight teardown only; never run against business data.
-- Normal preflight uses ROLLBACK, not these DROP statements.
DROP TABLE app.aircraft_hours_acceptances;
DROP TABLE app.hours_reconciliation_differences;
DROP TABLE app.flight_component_utilization_attributions;
DROP TABLE app.hours_reconciliation_references;
DROP TABLE app.hours_reconciliation_flights;
DROP TABLE app.hours_reconciliation_confirmations;
DROP TABLE app.hours_reconciliation_runs;
DROP TABLE app.hours_counter_references;
DROP TABLE app.aircraft_hours_plan_revisions;
DROP TABLE app.aircraft_hours_plans;
