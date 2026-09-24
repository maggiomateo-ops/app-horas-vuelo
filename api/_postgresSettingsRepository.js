import { postgresQuery } from "./_postgres.js";
import { getValidatedAircraftAccessFromPostgres } from "./_postgresAircraftRepository.js";

function repositoryError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function mapAircraft(access) {
  return {
    aircraft_id: access.aircraft.aircraft_id,
    manufacturer: access.aircraft.manufacturer,
    model: access.aircraft.model,
    serial_number: access.aircraft.serial_number,
    registration: access.aircraft.registration,
    status: access.aircraft.status,
  };
}

function mapMembership(access) {
  return {
    membership_id: access.membership.membership_id,
    role: access.membership.role,
    status: access.membership.status,
  };
}

async function loadAircraftRecordingSettings(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        aircraft_id,
        default_capture_method,
        default_oil_unit,
        capture_engine_runtime,
        created_at,
        updated_at
      FROM app.aircraft_settings
      WHERE aircraft_id = $1::uuid
      LIMIT 1
    `,
    [aircraftId]
  );

  return rows[0] || null;
}

async function loadFlightFieldSettings(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        aircraft_id,
        field_code,
        is_enabled,
        is_required,
        display_order,
        created_at,
        updated_at
      FROM app.aircraft_flight_field_settings
      WHERE aircraft_id = $1::uuid
      ORDER BY
        CASE WHEN display_order IS NULL THEN 1 ELSE 0 END,
        display_order,
        field_code
    `,
    [aircraftId]
  );

  return rows;
}

async function loadFlightPurposes(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        flight_purpose_id,
        aircraft_id,
        name,
        status,
        display_order,
        created_at,
        updated_at
      FROM app.aircraft_flight_purposes
      WHERE aircraft_id = $1::uuid
      ORDER BY
        CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
        display_order,
        lower(name),
        flight_purpose_id
    `,
    [aircraftId]
  );

  return rows;
}

async function loadAircraftTanks(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        tank_id,
        aircraft_id,
        name,
        position_code,
        display_unit,
        display_order,
        status,
        created_at,
        updated_at
      FROM app.aircraft_tanks
      WHERE aircraft_id = $1::uuid
      ORDER BY
        CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
        display_order,
        lower(name),
        tank_id
    `,
    [aircraftId]
  );

  return rows;
}

export async function getAircraftSettingsProjectionFromPostgres({
  userId,
  aircraftId,
}) {
  const access = await getValidatedAircraftAccessFromPostgres(userId, aircraftId);
  const canonicalAircraftId = access.aircraft.aircraft_id;

  const [recording, flightFields, flightPurposes, tanks] = await Promise.all([
    loadAircraftRecordingSettings(canonicalAircraftId),
    loadFlightFieldSettings(canonicalAircraftId),
    loadFlightPurposes(canonicalAircraftId),
    loadAircraftTanks(canonicalAircraftId),
  ]);

  return {
    aircraft: mapAircraft(access),
    membership: mapMembership(access),
    recording,
    flight_fields: flightFields,
    flight_purposes: flightPurposes,
    tanks,
  };
}

export async function requireSettingsOwnerAccessFromPostgres({
  userId,
  aircraftId,
}) {
  const access = await getValidatedAircraftAccessFromPostgres(userId, aircraftId);

  if (access.membership.role !== "OWNER") {
    throw repositoryError(
      "El usuario no tiene permiso OWNER para modificar la configuracion de la aeronave.",
      "SETTINGS_WRITE_FORBIDDEN",
      403
    );
  }

  return {
    user: access.user,
    aircraft: mapAircraft(access),
    membership: mapMembership(access),
  };
}
