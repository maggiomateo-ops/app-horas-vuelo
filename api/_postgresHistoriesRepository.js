import { postgresQuery } from "./_postgres.js";
import { getValidatedAircraftAccessFromPostgres } from "./_postgresAircraftRepository.js";

function ownerLabelExpression() {
  return `
    CASE
      WHEN owner_party.party_type = 'PERSON' THEN owner_person.full_name
      WHEN owner_party.party_type = 'ORGANIZATION' THEN owner_party.organization_name
      ELSE NULL
    END
  `;
}

async function loadAircraftBaseline(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        aircraft_id,
        baseline_tis_hours,
        baseline_effective_date,
        first_tracked_flight_id,
        source,
        notes,
        created_at,
        updated_at
      FROM app.aircraft_utilization_baselines
      WHERE aircraft_id = $1::uuid
      LIMIT 1
    `,
    [aircraftId]
  );

  return rows[0] || null;
}

async function loadAircraftAdjustments(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        utilization_adjustment_id,
        aircraft_id,
        adjustment_hours,
        effective_date,
        after_flight_id,
        reason,
        source_reference,
        created_by_user_id,
        created_at
      FROM app.utilization_adjustments
      WHERE aircraft_id = $1::uuid
      ORDER BY effective_date, created_at, utilization_adjustment_id
    `,
    [aircraftId]
  );

  return rows;
}

async function loadCurrentActiveFlights(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        flight.flight_id,
        flight.record_source,
        flight.created_by_user_id AS flight_created_by_user_id,
        flight.created_at AS flight_created_at,
        revision.flight_revision_id,
        revision.revision_number,
        revision.flight_date,
        revision.departure_location,
        revision.arrival_location,
        revision.pilot_person_id,
        pilot.full_name AS pilot_name,
        revision.utilization_owner_party_id,
        ${ownerLabelExpression()} AS utilization_owner_name,
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
        AND flight.status = 'ACTIVE'
      ORDER BY
        revision.flight_date NULLS LAST,
        flight.created_at,
        flight.flight_id
    `,
    [aircraftId]
  );

  return rows;
}

async function loadComponentInstallations(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        installation.component_installation_id,
        installation.aircraft_id,
        installation.component_id,
        component.component_type,
        component.manufacturer,
        component.model,
        component.serial_number,
        component.status AS component_status,
        installation.position_index,
        installation.installed_on,
        installation.removed_on,
        installation.opening_tis_hours,
        installation.first_applicable_flight_id,
        installation.last_applicable_flight_id,
        installation.created_at,
        installation.updated_at
      FROM app.component_installations installation
      JOIN app.components component
        ON component.component_id = installation.component_id
      WHERE installation.aircraft_id = $1::uuid
      ORDER BY
        component.component_type,
        installation.position_index,
        installation.installed_on,
        installation.component_installation_id
    `,
    [aircraftId]
  );

  return rows;
}

async function loadComponentAdjustments(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        adjustment.utilization_adjustment_id,
        adjustment.component_installation_id,
        adjustment.adjustment_hours,
        adjustment.effective_date,
        adjustment.after_flight_id,
        adjustment.reason,
        adjustment.source_reference,
        adjustment.created_by_user_id,
        adjustment.created_at
      FROM app.utilization_adjustments adjustment
      JOIN app.component_installations installation
        ON installation.component_installation_id = adjustment.component_installation_id
      WHERE installation.aircraft_id = $1::uuid
      ORDER BY
        adjustment.component_installation_id,
        adjustment.effective_date,
        adjustment.created_at,
        adjustment.utilization_adjustment_id
    `,
    [aircraftId]
  );

  return rows;
}

function groupComponentAdjustments(adjustments) {
  const grouped = new Map();

  for (const adjustment of adjustments) {
    const key = adjustment.component_installation_id;

    if (!grouped.has(key)) {
      grouped.set(key, []);
    }

    grouped.get(key).push(adjustment);
  }

  return grouped;
}

export async function getAircraftOperationalHistoryFromPostgres({
  userId,
  aircraftId,
}) {
  const access = await getValidatedAircraftAccessFromPostgres(userId, aircraftId);
  const canonicalAircraftId = access.aircraft.aircraft_id;
  const [baseline, adjustments, flights] = await Promise.all([
    loadAircraftBaseline(canonicalAircraftId),
    loadAircraftAdjustments(canonicalAircraftId),
    loadCurrentActiveFlights(canonicalAircraftId),
  ]);

  return {
    aircraft: access.aircraft,
    membership: access.membership,
    baseline,
    adjustments,
    flights,
  };
}

export async function getComponentOperationalHistorySourcesFromPostgres({
  userId,
  aircraftId,
}) {
  const access = await getValidatedAircraftAccessFromPostgres(userId, aircraftId);
  const canonicalAircraftId = access.aircraft.aircraft_id;
  const [installations, adjustments, flights] = await Promise.all([
    loadComponentInstallations(canonicalAircraftId),
    loadComponentAdjustments(canonicalAircraftId),
    loadCurrentActiveFlights(canonicalAircraftId),
  ]);
  const adjustmentsByInstallation = groupComponentAdjustments(adjustments);

  return {
    aircraft: access.aircraft,
    membership: access.membership,
    flights,
    component_installations: installations.map((installation) => ({
      ...installation,
      adjustments:
        adjustmentsByInstallation.get(installation.component_installation_id) || [],
    })),
  };
}
