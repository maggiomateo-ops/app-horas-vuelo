import { postgresQuery } from "./_postgres.js";
import { getValidatedAircraftAccessFromPostgres } from "./_postgresAircraftRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function repositoryError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeUuid(value, label) {
  const normalized = String(value || "").trim();

  if (!UUID_PATTERN.test(normalized)) {
    throw repositoryError(`${label} no es un UUID valido.`, "INVALID_CANONICAL_ID", 400);
  }

  return normalized;
}

async function loadFlightRootAndCurrentRevision({ aircraftId, flightId, includeVoided }) {
  const { rows } = await postgresQuery(
    `
      SELECT
        flight.flight_id,
        flight.aircraft_id,
        flight.current_revision_id,
        flight.status,
        flight.record_source,
        flight.created_by_user_id AS flight_created_by_user_id,
        flight.created_at AS flight_created_at,
        flight.voided_at,
        flight.voided_by_user_id,
        flight.void_reason,
        flight.import_batch_id,
        flight.import_row_number,
        revision.flight_revision_id,
        revision.revision_number,
        revision.flight_date,
        revision.departure_location,
        revision.arrival_location,
        revision.pilot_person_id,
        pilot.full_name AS pilot_name,
        revision.utilization_owner_party_id,
        CASE
          WHEN owner_party.party_type = 'PERSON' THEN owner_person.full_name
          WHEN owner_party.party_type = 'ORGANIZATION' THEN owner_party.organization_name
          ELSE NULL
        END AS utilization_owner_name,
        revision.flight_purpose_id,
        purpose.name AS flight_purpose_name,
        revision.capture_method,
        revision.flight_time_hours,
        revision.time_in_service_hours,
        revision.tach_start,
        revision.tach_end,
        revision.movement_start_at,
        revision.takeoff_at,
        revision.landing_at,
        revision.final_stop_at,
        revision.remarks,
        revision.created_by_user_id AS revision_created_by_user_id,
        revision.created_at AS revision_created_at,
        revision.correction_reason
      FROM app.flight_records flight
      JOIN app.flight_record_revisions revision
        ON revision.flight_id = flight.flight_id
       AND revision.flight_revision_id = flight.current_revision_id
      LEFT JOIN app.persons pilot
        ON pilot.person_id = revision.pilot_person_id
      LEFT JOIN app.parties owner_party
        ON owner_party.party_id = revision.utilization_owner_party_id
      LEFT JOIN app.persons owner_person
        ON owner_person.person_id = owner_party.person_id
      LEFT JOIN app.aircraft_flight_purposes purpose
        ON purpose.flight_purpose_id = revision.flight_purpose_id
      WHERE flight.aircraft_id = $1::uuid
        AND flight.flight_id = $2::uuid
        AND ($3::boolean OR flight.status = 'ACTIVE')
      LIMIT 1
    `,
    [aircraftId, flightId, includeVoided]
  );

  return rows[0] || null;
}

async function loadFlightCounters(flightRevisionId) {
  const { rows } = await postgresQuery(
    `
      SELECT counter_code, counter_value
      FROM app.flight_counters
      WHERE flight_revision_id = $1::uuid
      ORDER BY counter_code
    `,
    [flightRevisionId]
  );

  return rows;
}

async function loadComponentCounters(flightRevisionId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        counter.component_installation_id,
        installation.component_id,
        component.component_type,
        installation.position_index,
        counter.counter_code,
        counter.counter_value
      FROM app.flight_component_counters counter
      JOIN app.component_installations installation
        ON installation.component_installation_id = counter.component_installation_id
      JOIN app.components component
        ON component.component_id = installation.component_id
      WHERE counter.flight_revision_id = $1::uuid
      ORDER BY
        component.component_type,
        installation.position_index,
        counter.counter_code
    `,
    [flightRevisionId]
  );

  return rows;
}

async function loadTankReadings(flightRevisionId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        reading.tank_id,
        tank.name,
        tank.position_code,
        tank.display_order,
        reading.entered_value,
        reading.entered_unit,
        reading.canonical_liters
      FROM app.flight_tank_readings reading
      JOIN app.aircraft_tanks tank
        ON tank.tank_id = reading.tank_id
      WHERE reading.flight_revision_id = $1::uuid
      ORDER BY tank.display_order, tank.tank_id
    `,
    [flightRevisionId]
  );

  return rows;
}

async function loadComponentConsumables(flightRevisionId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        consumable.component_installation_id,
        installation.component_id,
        component.component_type,
        installation.position_index,
        consumable.consumable_code,
        consumable.entered_value,
        consumable.entered_unit,
        consumable.canonical_liters
      FROM app.flight_component_consumables consumable
      JOIN app.component_installations installation
        ON installation.component_installation_id = consumable.component_installation_id
      JOIN app.components component
        ON component.component_id = installation.component_id
      WHERE consumable.flight_revision_id = $1::uuid
      ORDER BY
        component.component_type,
        installation.position_index,
        consumable.consumable_code
    `,
    [flightRevisionId]
  );

  return rows;
}

async function loadComponentRuntime(flightRevisionId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        runtime.component_installation_id,
        installation.component_id,
        component.component_type,
        installation.position_index,
        runtime.engine_start_at,
        runtime.engine_stop_at,
        runtime.engine_running_hours
      FROM app.flight_component_runtime runtime
      JOIN app.component_installations installation
        ON installation.component_installation_id = runtime.component_installation_id
      JOIN app.components component
        ON component.component_id = installation.component_id
      WHERE runtime.flight_revision_id = $1::uuid
      ORDER BY component.component_type, installation.position_index
    `,
    [flightRevisionId]
  );

  return rows;
}

export async function getCurrentFlightRecordFromPostgres({
  userId,
  aircraftId,
  flightId,
  includeVoided = false,
}) {
  const access = await getValidatedAircraftAccessFromPostgres(userId, aircraftId);
  const canonicalFlightId = normalizeUuid(flightId, "flightId");
  const flight = await loadFlightRootAndCurrentRevision({
    aircraftId: access.aircraft.aircraft_id,
    flightId: canonicalFlightId,
    includeVoided: includeVoided === true,
  });

  if (!flight) {
    throw repositoryError(
      "No se encontro el Flight Record solicitado para esta aeronave.",
      "FLIGHT_NOT_FOUND",
      404
    );
  }

  const revisionId = flight.flight_revision_id;
  const [counters, componentCounters, tankReadings, componentConsumables, componentRuntime] =
    await Promise.all([
      loadFlightCounters(revisionId),
      loadComponentCounters(revisionId),
      loadTankReadings(revisionId),
      loadComponentConsumables(revisionId),
      loadComponentRuntime(revisionId),
    ]);

  return {
    aircraft: access.aircraft,
    membership: access.membership,
    flight: {
      flight_id: flight.flight_id,
      aircraft_id: flight.aircraft_id,
      current_revision_id: flight.current_revision_id,
      status: flight.status,
      record_source: flight.record_source,
      created_by_user_id: flight.flight_created_by_user_id,
      created_at: flight.flight_created_at,
      voided_at: flight.voided_at,
      voided_by_user_id: flight.voided_by_user_id,
      void_reason: flight.void_reason,
      import_batch_id: flight.import_batch_id,
      import_row_number: flight.import_row_number,
    },
    revision: {
      flight_revision_id: flight.flight_revision_id,
      revision_number: flight.revision_number,
      flight_date: flight.flight_date,
      departure_location: flight.departure_location,
      arrival_location: flight.arrival_location,
      pilot_person_id: flight.pilot_person_id,
      pilot_name: flight.pilot_name,
      utilization_owner_party_id: flight.utilization_owner_party_id,
      utilization_owner_name: flight.utilization_owner_name,
      flight_purpose_id: flight.flight_purpose_id,
      flight_purpose_name: flight.flight_purpose_name,
      capture_method: flight.capture_method,
      flight_time_hours: flight.flight_time_hours,
      time_in_service_hours: flight.time_in_service_hours,
      tach_start: flight.tach_start,
      tach_end: flight.tach_end,
      movement_start_at: flight.movement_start_at,
      takeoff_at: flight.takeoff_at,
      landing_at: flight.landing_at,
      final_stop_at: flight.final_stop_at,
      remarks: flight.remarks,
      created_by_user_id: flight.revision_created_by_user_id,
      created_at: flight.revision_created_at,
      correction_reason: flight.correction_reason,
    },
    snapshots: {
      counters,
      component_counters: componentCounters,
      tank_readings: tankReadings,
      component_consumables: componentConsumables,
      component_runtime: componentRuntime,
    },
  };
}
