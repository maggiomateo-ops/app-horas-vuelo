-- 003_component_installation_historical_date.sql
-- D-207: historical migration must not fabricate physical installation dates.

ALTER TABLE app.component_installations
  ALTER COLUMN installed_on DROP NOT NULL;

ALTER TABLE app.component_installations
  DROP CONSTRAINT ck_component_installation_values;

ALTER TABLE app.component_installations
  ADD CONSTRAINT ck_component_installation_values CHECK (
    position_index > 0
    AND (
      removed_on IS NULL
      OR installed_on IS NULL
      OR removed_on >= installed_on
    )
    AND (opening_tis_hours IS NULL OR opening_tis_hours >= 0)
  );
