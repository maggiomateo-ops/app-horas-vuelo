-- V1 only. 009 reserved for Hours V2 (D-311). No backfill or new privileges.
-- HOLD: independent TEST preflight required before a persistent run.
-- Authorized migration session must explicitly SET app.v1_tracking_migration = 'approved_test'.
DO $$ BEGIN
  IF current_setting('app.v1_tracking_migration', true) IS DISTINCT FROM 'approved_test' THEN
    RAISE EXCEPTION '010 requires independent TEST approval';
  END IF;
END $$;
ALTER TABLE app.component_installations
  ADD COLUMN tracking_started_on date,
  ADD COLUMN tracking_reference_tis_hours numeric(10,1),
  ADD CONSTRAINT ck_component_tracking_reference_v1 CHECK (
    (tracking_reference_tis_hours IS NULL OR
      (tracking_started_on IS NOT NULL AND tracking_reference_tis_hours >= 0))
    AND (tracking_started_on IS NULL OR installed_on IS NULL OR tracking_started_on >= installed_on)
    AND (tracking_started_on IS NULL OR removed_on IS NULL OR tracking_started_on <= removed_on)
  );
COMMENT ON COLUMN app.component_installations.tracking_started_on IS
  'Explicit V1 CURRENT_REFERENCE tracking date, inclusive. NULL preserves pre-010 installation semantics.';
COMMENT ON COLUMN app.component_installations.tracking_reference_tis_hours IS
  'Known V1 TIS at tracking start; NULL means unknown. Not installation TIS, TSN, TSO or engine runtime.';
