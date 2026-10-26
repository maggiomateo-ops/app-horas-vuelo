-- PREPARED ONLY / NOT EXECUTED. Never target parent TEST or Production.
-- Requires separately approved disposable branch with proposed DDL and synthetic fixtures.
-- Explicit operator sentinel is required; not invoked by npm test or migration runner.
BEGIN;
DO $$
BEGIN
  IF current_setting('hours_v2.disposable_preflight', true) IS DISTINCT FROM 'approved-synthetic-only' THEN
    RAISE EXCEPTION 'STOP: explicit disposable preflight approval required';
  END IF;
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='app'
      AND table_name IN ('hours_reconciliation_runs','hours_import_staged_rows','hours_counter_references')) <> 3 THEN
    RAISE EXCEPTION 'Missing proposal tables';
  END IF;
  IF 0.01::numeric*3600 <> 36 OR 90::numeric*60 <> 1.5::numeric*3600 THEN
    RAISE EXCEPTION 'Exact conversion mismatch';
  END IF;
  IF round(0.05::numeric,1)+round(0.05::numeric,1) <> 0.2
    OR round(0.05::numeric+0.05::numeric,1) <> 0.1 THEN
    RAISE EXCEPTION 'D024/D098 per-record HALF_UP mismatch';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='app.flight_component_utilization_attributions'::regclass
     AND contype='p' AND pg_get_constraintdef(oid) LIKE '%reconciliation_run_id, flight_revision_id, component_installation_id, usage_basis%') THEN
    RAISE EXCEPTION 'Attribution identity missing run';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='app'
    AND table_name='hours_counter_references' AND column_name='value_seconds'
    AND numeric_precision=24 AND numeric_scale=6 AND is_nullable='YES') THEN
    RAISE EXCEPTION 'Counter precision / unknown contract mismatch';
  END IF;
END $$;
-- Negative scope probe uses TWO pre-provisioned synthetic aircraft/plan pairs only.
-- Caller binds OWNER A context and begin_mutation; fixture B/plan B existence verified separately.
-- Fixture IDs passed through session-local settings, never hard-coded real aircraft UUIDs.
DO $$
DECLARE
  a uuid := current_setting('hours_v2.fixture_aircraft_a')::uuid;
  b uuid := current_setting('hours_v2.fixture_aircraft_b')::uuid;
  p uuid := current_setting('hours_v2.fixture_plan_b')::uuid;
  rejected boolean := false;
BEGIN
  IF a=b THEN
    RAISE EXCEPTION 'Invalid synthetic fixtures';
  END IF;
  BEGIN
    INSERT INTO app.aircraft_hours_plan_revisions
      (aircraft_id,hours_plan_id,revision_number,start_mode,status,reason,created_by_user_id)
      VALUES(a,p,999,'CURRENT_REFERENCE','DRAFT','synthetic cross-scope rejection',
       nullif(current_setting('hours_v2.actor_id',true),'')::uuid);
  EXCEPTION WHEN foreign_key_violation THEN rejected := true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Cross-aircraft plan association accepted'; END IF;
END $$;
ROLLBACK;
