-- 005_aircraft_configuration.sql
-- D-272/D-273: explicit aircraft topology for canonical component bootstrap.

CREATE TABLE app.aircraft_configuration (
  aircraft_id uuid PRIMARY KEY REFERENCES app.aircraft(aircraft_id),
  propulsion_type text NOT NULL,
  engine_count smallint NOT NULL,
  propeller_count smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_aircraft_configuration_propulsion_type CHECK (
    propulsion_type IN (
      'PISTON',
      'TURBOPROP',
      'TURBOJET',
      'TURBOFAN',
      'ELECTRIC',
      'OTHER'
    )
  ),
  CONSTRAINT ck_aircraft_configuration_counts CHECK (
    engine_count >= 0
    AND propeller_count >= 0
  ),
  CONSTRAINT ck_aircraft_configuration_topology CHECK (
    (
      propulsion_type IN ('PISTON', 'TURBOPROP')
      AND engine_count >= 1
      AND propeller_count >= 1
    )
    OR
    (
      propulsion_type IN ('TURBOJET', 'TURBOFAN')
      AND engine_count >= 1
      AND propeller_count = 0
    )
    OR propulsion_type IN ('ELECTRIC', 'OTHER')
  )
);

GRANT SELECT, INSERT ON app.aircraft_configuration TO app_runtime;
