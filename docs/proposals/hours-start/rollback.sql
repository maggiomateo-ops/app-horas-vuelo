-- PROPOSED teardown for EMPTY DISPOSABLE PREFLIGHT branch only. DO NOT EXECUTE here.
-- Normal preflight must ROLLBACK the entire transaction, including supporting constraints.
-- Never CASCADE, destroy committed imports or remove historical evidence in shared TEST/Production.
DROP TABLE app.hours_acceptance_invalidations;
DROP TABLE app.aircraft_hours_acceptances;
DROP TABLE app.hours_import_committed_rows;
DROP TABLE app.hours_reconciliation_confirmations;
DROP TABLE app.hours_reconciliation_issues;
DROP TABLE app.hours_reconciliation_differences;
DROP TABLE app.hours_candidate_component_attributions;
DROP TABLE app.flight_component_utilization_attributions;
DROP TABLE app.hours_reconciliation_references;
DROP TABLE app.hours_reconciliation_staged_rows;
DROP TABLE app.hours_reconciliation_installations;
DROP TABLE app.hours_reconciliation_flights;
DROP TABLE app.hours_reconciliation_runs;
DROP TABLE app.hours_counter_references;
DROP TABLE app.hours_import_staged_rows;
DROP TABLE app.hours_import_mapping_fields;
DROP TABLE app.hours_import_mapping_versions;
DROP TABLE app.hours_component_overhaul_episodes;
DROP TABLE app.aircraft_hours_plan_revisions;
DROP TABLE app.aircraft_hours_plans;
ALTER TABLE app.flight_import_batches DROP CONSTRAINT uq_hours_batch_aircraft;
ALTER TABLE app.component_installations DROP CONSTRAINT uq_hours_installation_scope;
ALTER TABLE app.flight_records DROP CONSTRAINT uq_hours_flight_aircraft;
