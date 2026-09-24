import { postgresQuery } from "../api/_postgres.js";

const AIRCRAFT_ID = "00000000-0000-4000-8000-000000000000";
const FLIGHT_ID = "00000000-0000-4000-8000-000000000001";
const REVISION_ID = "00000000-0000-4000-8000-000000000002";

const checks = [
  {
    name: "settings-aircraft",
    sql: `SELECT aircraft_id, default_capture_method, default_oil_unit, capture_engine_runtime, created_at, updated_at FROM app.aircraft_settings WHERE aircraft_id = $1::uuid LIMIT 0`,
    params: [AIRCRAFT_ID],
  },
  {
    name: "settings-fields",
    sql: `SELECT aircraft_id, field_code, is_enabled, is_required, display_order, created_at, updated_at FROM app.aircraft_flight_field_settings WHERE aircraft_id = $1::uuid ORDER BY CASE WHEN display_order IS NULL THEN 1 ELSE 0 END, display_order, field_code LIMIT 0`,
    params: [AIRCRAFT_ID],
  },
  {
    name: "settings-purposes",
    sql: `SELECT flight_purpose_id, aircraft_id, name, status, display_order, created_at, updated_at FROM app.aircraft_flight_purposes WHERE aircraft_id = $1::uuid ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, display_order, lower(name), flight_purpose_id LIMIT 0`,
    params: [AIRCRAFT_ID],
  },
  {
    name: "settings-tanks",
    sql: `SELECT tank_id, aircraft_id, name, position_code, display_unit, display_order, status, created_at, updated_at FROM app.aircraft_tanks WHERE aircraft_id = $1::uuid ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END, display_order, lower(name), tank_id LIMIT 0`,
    params: [AIRCRAFT_ID],
  },
  {
    name: "histories-current-flights",
    sql: `SELECT flight.flight_id, flight.record_source, flight.created_at AS flight_created_at, revision.flight_revision_id, revision.revision_number, revision.flight_date, revision.departure_location, revision.arrival_location, revision.pilot_person_id, pilot.full_name AS pilot_name, revision.utilization_owner_party_id, CASE WHEN owner_party.party_type = 'PERSON' THEN owner_person.full_name WHEN owner_party.party_type = 'ORGANIZATION' THEN owner_party.organization_name ELSE NULL END AS utilization_owner_name, revision.flight_purpose_id, purpose.name AS flight_purpose_name, revision.capture_method, revision.flight_time_hours, revision.time_in_service_hours, revision.tach_start, revision.tach_end, revision.movement_start_at, revision.takeoff_at, revision.landing_at, revision.final_stop_at, revision.remarks, revision.correction_reason FROM app.flight_records flight JOIN app.flight_record_revisions revision ON revision.flight_id = flight.flight_id AND revision.flight_revision_id = flight.current_revision_id LEFT JOIN app.persons pilot ON pilot.person_id = revision.pilot_person_id LEFT JOIN app.parties owner_party ON owner_party.party_id = revision.utilization_owner_party_id LEFT JOIN app.persons owner_person ON owner_person.person_id = owner_party.person_id LEFT JOIN app.aircraft_flight_purposes purpose ON purpose.flight_purpose_id = revision.flight_purpose_id WHERE flight.aircraft_id = $1::uuid AND flight.status = 'ACTIVE' ORDER BY revision.flight_date NULLS LAST, flight.created_at, flight.flight_id LIMIT 0`,
    params: [AIRCRAFT_ID],
  },
  {
    name: "histories-installations",
    sql: `SELECT installation.component_installation_id, installation.aircraft_id, installation.component_id, component.component_type, component.manufacturer, component.model, component.serial_number, component.status AS component_status, installation.position_index, installation.installed_on, installation.removed_on, installation.opening_tis_hours, installation.first_applicable_flight_id, installation.last_applicable_flight_id, installation.created_at, installation.updated_at FROM app.component_installations installation JOIN app.components component ON component.component_id = installation.component_id WHERE installation.aircraft_id = $1::uuid LIMIT 0`,
    params: [AIRCRAFT_ID],
  },
  {
    name: "flight-root-current-revision",
    sql: `SELECT flight.flight_id, flight.aircraft_id, flight.current_revision_id, flight.status, flight.record_source, revision.flight_revision_id, revision.revision_number, revision.flight_date, revision.departure_location, revision.arrival_location, revision.pilot_person_id, pilot.full_name AS pilot_name, revision.utilization_owner_party_id, CASE WHEN owner_party.party_type = 'PERSON' THEN owner_person.full_name WHEN owner_party.party_type = 'ORGANIZATION' THEN owner_party.organization_name ELSE NULL END AS utilization_owner_name, revision.flight_purpose_id, purpose.name AS flight_purpose_name, revision.capture_method, revision.flight_time_hours, revision.time_in_service_hours, revision.tach_start, revision.tach_end, revision.movement_start_at, revision.takeoff_at, revision.landing_at, revision.final_stop_at, revision.remarks, revision.correction_reason FROM app.flight_records flight JOIN app.flight_record_revisions revision ON revision.flight_id = flight.flight_id AND revision.flight_revision_id = flight.current_revision_id LEFT JOIN app.persons pilot ON pilot.person_id = revision.pilot_person_id LEFT JOIN app.parties owner_party ON owner_party.party_id = revision.utilization_owner_party_id LEFT JOIN app.persons owner_person ON owner_person.person_id = owner_party.person_id LEFT JOIN app.aircraft_flight_purposes purpose ON purpose.flight_purpose_id = revision.flight_purpose_id WHERE flight.aircraft_id = $1::uuid AND flight.flight_id = $2::uuid LIMIT 0`,
    params: [AIRCRAFT_ID, FLIGHT_ID],
  },
  {
    name: "flight-component-counters",
    sql: `SELECT counter.component_installation_id, installation.component_id, component.component_type, installation.position_index, counter.counter_code, counter.counter_value FROM app.flight_component_counters counter JOIN app.component_installations installation ON installation.component_installation_id = counter.component_installation_id JOIN app.components component ON component.component_id = installation.component_id WHERE counter.flight_revision_id = $1::uuid LIMIT 0`,
    params: [REVISION_ID],
  },
  {
    name: "flight-tanks",
    sql: `SELECT reading.tank_id, tank.name, tank.position_code, tank.display_order, reading.entered_value, reading.entered_unit, reading.canonical_liters FROM app.flight_tank_readings reading JOIN app.aircraft_tanks tank ON tank.tank_id = reading.tank_id WHERE reading.flight_revision_id = $1::uuid LIMIT 0`,
    params: [REVISION_ID],
  },
  {
    name: "flight-consumables",
    sql: `SELECT consumable.component_installation_id, installation.component_id, component.component_type, installation.position_index, consumable.consumable_code, consumable.entered_value, consumable.entered_unit, consumable.canonical_liters FROM app.flight_component_consumables consumable JOIN app.component_installations installation ON installation.component_installation_id = consumable.component_installation_id JOIN app.components component ON component.component_id = installation.component_id WHERE consumable.flight_revision_id = $1::uuid LIMIT 0`,
    params: [REVISION_ID],
  },
  {
    name: "flight-runtime",
    sql: `SELECT runtime.component_installation_id, installation.component_id, component.component_type, installation.position_index, runtime.engine_start_at, runtime.engine_stop_at, runtime.engine_running_hours FROM app.flight_component_runtime runtime JOIN app.component_installations installation ON installation.component_installation_id = runtime.component_installation_id JOIN app.components component ON component.component_id = installation.component_id WHERE runtime.flight_revision_id = $1::uuid LIMIT 0`,
    params: [REVISION_ID],
  },
];

for (const check of checks) {
  await postgresQuery(check.sql, check.params);
  console.log(`Postgres repository schema check OK: ${check.name}`);
}

console.log(`Postgres repository schema checks passed: ${checks.length}`);
