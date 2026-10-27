-- PREPARED, NOT EXECUTED. psql -X -v ON_ERROR_STOP=1 -f preflight.sql
-- Only an independently approved disposable TEST clone, using migration role.
-- Never parent TEST/Production. Do not run db/migrate.js for this preflight.
BEGIN ISOLATION LEVEL SERIALIZABLE;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE version >= '009') THEN
    RAISE EXCEPTION 'Recheck reserved numbering and migration state';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='app'
    AND table_name='component_installations' AND column_name='tracking_started_on') THEN
    RAISE EXCEPTION 'Preflight expects pre-010 schema';
  END IF;
END $$;
SET LOCAL app.v1_tracking_migration = 'approved_test';
\ir ../../../db/migrations/010_component_tracking_reference_v1.sql
-- Temp-only fixtures. LIKE copies CHECK constraints but not foreign keys.
CREATE TEMP TABLE tracking_fixture (LIKE app.component_installations INCLUDING ALL) ON COMMIT DROP;
INSERT INTO tracking_fixture (component_installation_id,component_id,aircraft_id,position_index,
  installed_on,opening_tis_hours,tracking_started_on,tracking_reference_tis_hours)
SELECT gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),p,NULL,NULL,DATE '2026-10-20',
  CASE WHEN p=1 THEN 100.1 ELSE NULL END FROM generate_series(1,4) p;
DO $$ BEGIN
  IF (SELECT count(*) FROM tracking_fixture) <> 4 THEN RAISE EXCEPTION 'fixture count'; END IF;
  BEGIN
    UPDATE tracking_fixture SET installed_on='2026-10-21';
    RAISE EXCEPTION 'invalid date order accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE tracking_fixture SET tracking_reference_tis_hours=-1;
    RAISE EXCEPTION 'negative reference accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    UPDATE tracking_fixture SET tracking_started_on=NULL WHERE tracking_reference_tis_hours IS NOT NULL;
    RAISE EXCEPTION 'reference without start accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- Effective privileges must be identical before/after: no GRANT in 010.
SELECT has_table_privilege('app_horas_runtime','app.component_installations','INSERT') AS runtime_insert,
 has_table_privilege('app_horas_runtime','audit.audit_events','UPDATE') AS audit_update,
 has_table_privilege('app_horas_runtime','audit.audit_events','DELETE') AS audit_delete;
SELECT version,filename,checksum_sha256 FROM public.schema_migrations ORDER BY version;
ROLLBACK;
-- Readback must return zero added fields and ledger unchanged 001–008.
SELECT count(*) AS added_fields_after_rollback FROM information_schema.columns
 WHERE table_schema='app' AND table_name='component_installations'
 AND column_name IN ('tracking_started_on','tracking_reference_tis_hours');
SELECT version,filename,checksum_sha256 FROM public.schema_migrations ORDER BY version;
