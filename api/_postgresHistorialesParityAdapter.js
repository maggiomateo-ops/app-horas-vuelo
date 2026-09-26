import { postgresQuery } from "./_postgres.js";
import {
  getAircraftOperationalHistoryFromPostgres,
  getComponentOperationalHistorySourcesFromPostgres,
} from "./_postgresHistoriesRepository.js";

function asNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round1(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function dateText(value) {
  if (!value) {
    return "";
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function dateParts(value) {
  const [anio = "", mes = "", dia = ""] = dateText(value).split("-");
  return { dia, mes, anio };
}

function text(value) {
  return String(value ?? "").trim();
}

async function loadMigrationFlightProvenance(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        entity_id::text AS flight_id,
        entity_key ->> 'legacy_flight_id' AS legacy_flight_id,
        metadata -> 'authoritative_source' ->> 'row' AS authoritative_source_row,
        metadata ->> 'utilization_owner_source_label' AS utilization_owner_source_label,
        metadata -> 'enrichment_source' ->> 'row' AS enrichment_source_row,
        metadata -> 'raw_enrichment_nonfinancial' ->> 'raw_flight_time_jpi' AS raw_flight_time_jpi,
        metadata -> 'raw_enrichment_nonfinancial' ->> 'raw_service_time_garmin' AS raw_service_time_garmin
      FROM audit.audit_events
      WHERE aircraft_id = $1::uuid
        AND entity_type = 'FLIGHT_RECORD'
        AND action_code = 'MIGRATION_CREATED'
      ORDER BY occurred_at, audit_event_id
    `,
    [aircraftId]
  );

  return new Map(
    rows.map((row) => [
      String(row.flight_id),
      {
        legacyFlightId: text(row.legacy_flight_id),
        sourceRow: asNumber(row.authoritative_source_row),
        legacyOwnerLabel: text(row.utilization_owner_source_label),
        hasLegacyEnrichment: Boolean(text(row.enrichment_source_row)),
        rawFlightTime: asNumber(row.raw_flight_time_jpi),
        rawServiceTime: asNumber(row.raw_service_time_garmin),
      },
    ])
  );
}

async function loadCurrentRevisionSupplements(aircraftId) {
  const [oilResult, fuelResult] = await Promise.all([
    postgresQuery(
      `
        SELECT
          flight.flight_id::text AS flight_id,
          consumable.entered_value,
          consumable.entered_unit
        FROM app.flight_records flight
        JOIN app.flight_record_revisions revision
          ON revision.flight_revision_id = flight.current_revision_id
        JOIN app.flight_component_consumables consumable
          ON consumable.flight_revision_id = revision.flight_revision_id
        JOIN app.component_installations installation
          ON installation.component_installation_id = consumable.component_installation_id
        JOIN app.components component
          ON component.component_id = installation.component_id
        WHERE flight.aircraft_id = $1::uuid
          AND flight.status = 'ACTIVE'
          AND consumable.consumable_code = 'OIL_ADDED'
          AND component.component_type = 'ENGINE'
          AND installation.position_index = 1
      `,
      [aircraftId]
    ),
    postgresQuery(
      `
        SELECT
          flight.flight_id::text AS flight_id,
          tank.position_code,
          reading.entered_value,
          reading.entered_unit
        FROM app.flight_records flight
        JOIN app.flight_record_revisions revision
          ON revision.flight_revision_id = flight.current_revision_id
        JOIN app.flight_tank_readings reading
          ON reading.flight_revision_id = revision.flight_revision_id
        JOIN app.aircraft_tanks tank
          ON tank.tank_id = reading.tank_id
        WHERE flight.aircraft_id = $1::uuid
          AND flight.status = 'ACTIVE'
      `,
      [aircraftId]
    ),
  ]);

  const oilByFlight = new Map();
  for (const row of oilResult.rows) {
    oilByFlight.set(String(row.flight_id), {
      enteredValue: asNumber(row.entered_value),
      enteredUnit: text(row.entered_unit),
    });
  }

  const fuelByFlight = new Map();
  for (const row of fuelResult.rows) {
    const flightId = String(row.flight_id);
    if (!fuelByFlight.has(flightId)) {
      fuelByFlight.set(flightId, {});
    }

    const position = text(row.position_code).toUpperCase();
    fuelByFlight.get(flightId)[position] = {
      enteredValue: asNumber(row.entered_value),
      enteredUnit: text(row.entered_unit),
    };
  }

  return { oilByFlight, fuelByFlight };
}

function compareFlights(left, right, provenanceByFlight) {
  const leftDate = dateText(left.flight_date);
  const rightDate = dateText(right.flight_date);

  if (leftDate !== rightDate) {
    return leftDate.localeCompare(rightDate);
  }

  const leftSourceRow = provenanceByFlight.get(String(left.flight_id))?.sourceRow;
  const rightSourceRow = provenanceByFlight.get(String(right.flight_id))?.sourceRow;

  if (Number.isFinite(leftSourceRow) && Number.isFinite(rightSourceRow)) {
    return leftSourceRow - rightSourceRow;
  }

  if (Number.isFinite(leftSourceRow)) {
    return -1;
  }

  if (Number.isFinite(rightSourceRow)) {
    return 1;
  }

  const leftCreatedAt = new Date(left.flight_created_at || left.revision_created_at || 0).getTime();
  const rightCreatedAt = new Date(right.flight_created_at || right.revision_created_at || 0).getTime();

  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }

  return String(left.flight_id).localeCompare(String(right.flight_id));
}

function sortedFlights(flights, provenanceByFlight) {
  return [...flights].sort((left, right) => compareFlights(left, right, provenanceByFlight));
}

function adjustmentDate(adjustment) {
  return dateText(adjustment.effective_date);
}

function buildRunningTotals(flights, openingValue, adjustments = []) {
  const totals = new Map();
  let current = asNumber(openingValue);
  const pending = [...adjustments];
  const applied = new Set();

  const applyAdjustment = (adjustment, index) => {
    if (applied.has(index)) {
      return;
    }

    const amount = asNumber(adjustment.adjustment_hours);
    if (current !== null && amount !== null) {
      current += amount;
    }
    applied.add(index);
  };

  flights.forEach((flight) => {
    const flightDate = dateText(flight.flight_date);

    pending.forEach((adjustment, index) => {
      if (applied.has(index)) {
        return;
      }

      const effectiveDate = adjustmentDate(adjustment);
      const boundaryFlightId = text(adjustment.after_flight_id);

      if (
        effectiveDate < flightDate ||
        (effectiveDate === flightDate && !boundaryFlightId)
      ) {
        applyAdjustment(adjustment, index);
      }
    });

    const tis = asNumber(flight.time_in_service_hours);
    if (current !== null && tis !== null) {
      current += tis;
    }

    pending.forEach((adjustment, index) => {
      if (
        !applied.has(index) &&
        text(adjustment.after_flight_id) === String(flight.flight_id)
      ) {
        applyAdjustment(adjustment, index);
      }
    });

    totals.set(String(flight.flight_id), round1(current));
  });

  return totals;
}

function applicableFlightsForInstallation(flights, installation) {
  const firstFlightId = text(installation.first_applicable_flight_id);
  const lastFlightId = text(installation.last_applicable_flight_id);
  const firstIndex = firstFlightId
    ? flights.findIndex((flight) => String(flight.flight_id) === firstFlightId)
    : -1;
  const lastIndex = lastFlightId
    ? flights.findIndex((flight) => String(flight.flight_id) === lastFlightId)
    : -1;
  const installedOn = dateText(installation.installed_on);
  const removedOn = dateText(installation.removed_on);

  return flights.filter((flight, index) => {
    const flightDate = dateText(flight.flight_date);

    if (firstIndex >= 0 && index < firstIndex) {
      return false;
    }
    if (lastIndex >= 0 && index > lastIndex) {
      return false;
    }
    if (firstIndex < 0 && installedOn && flightDate < installedOn) {
      return false;
    }
    if (lastIndex < 0 && removedOn && flightDate > removedOn) {
      return false;
    }

    return true;
  });
}

function primaryInstallation(installations, componentType) {
  const candidates = installations
    .filter(
      (installation) =>
        text(installation.component_type).toUpperCase() === componentType &&
        Number(installation.position_index) === 1
    )
    .sort((left, right) => {
      const leftRemoved = dateText(left.removed_on);
      const rightRemoved = dateText(right.removed_on);
      if (!leftRemoved && rightRemoved) return -1;
      if (leftRemoved && !rightRemoved) return 1;
      return dateText(left.installed_on).localeCompare(dateText(right.installed_on));
    });

  return candidates[0] || null;
}

function legacyIdForFlight(flight, provenanceByFlight) {
  return provenanceByFlight.get(String(flight.flight_id))?.legacyFlightId || String(flight.flight_id);
}

function commonLegacyRow(flight, provenanceByFlight) {
  return {
    id: legacyIdForFlight(flight, provenanceByFlight),
    ...dateParts(flight.flight_date),
    desde: text(flight.departure_location),
    hasta: text(flight.arrival_location),
    tiempoEnServicio: asNumber(flight.time_in_service_hours) ?? "",
    piloto: text(flight.pilot_name),
    observaciones: text(flight.remarks),
  };
}

function buildAircraftHistoryRows(flights, totalByFlight, provenanceByFlight) {
  return flights.map((flight) => ({
    ...commonLegacyRow(flight, provenanceByFlight),
    tiempoTotalEnServicio: totalByFlight.get(String(flight.flight_id)) ?? "",
    tiempoDeVuelo: asNumber(flight.flight_time_hours) ?? "",
  }));
}

function buildEngineHistoryRows(flights, totalByFlight, provenanceByFlight) {
  return flights.map((flight) => ({
    ...commonLegacyRow(flight, provenanceByFlight),
    tiempoTotalEnServicio: totalByFlight.get(String(flight.flight_id)) ?? "",
  }));
}

function buildPropellerHistoryRows(
  flights,
  aircraftTotalByFlight,
  propellerTotalByFlight,
  provenanceByFlight
) {
  return flights.map((flight) => ({
    ...commonLegacyRow(flight, provenanceByFlight),
    // Legacy Historial Helice used aircraft TIS in this column and D.U.R.G.
    // for the actual propeller accumulated utilization. Keep the public shape.
    tiempoTotalEnServicio: aircraftTotalByFlight.get(String(flight.flight_id)) ?? "",
    durg: propellerTotalByFlight.get(String(flight.flight_id)) ?? "",
  }));
}

function buildComputacionRows(
  flights,
  provenanceByFlight,
  oilByFlight,
  fuelByFlight
) {
  return flights
    .filter((flight) => {
      const provenance = provenanceByFlight.get(String(flight.flight_id));
      return provenance?.hasLegacyEnrichment || text(flight.record_source).toUpperCase() !== "MIGRATION";
    })
    .map((flight) => {
      const provenance = provenanceByFlight.get(String(flight.flight_id));
      const oil = oilByFlight.get(String(flight.flight_id));
      const fuel = fuelByFlight.get(String(flight.flight_id)) || {};
      const canonicalOwner = text(flight.utilization_owner_name);

      return {
        id: legacyIdForFlight(flight, provenanceByFlight),
        ...dateParts(flight.flight_date),
        desde: text(flight.departure_location),
        hasta: text(flight.arrival_location),
        tiempoVuelo: provenance?.rawFlightTime ?? asNumber(flight.flight_time_hours) ?? "",
        tiempoEnServicio:
          provenance?.rawServiceTime ?? asNumber(flight.time_in_service_hours) ?? "",
        piloto: text(flight.pilot_name),
        propietario: canonicalOwner || provenance?.legacyOwnerLabel || "",
        aceiteAgregado: oil?.enteredValue ?? "",
        combustibleTanqueIzquierdo: fuel.LEFT?.enteredValue ?? "",
        combustibleTanqueDerecho: fuel.RIGHT?.enteredValue ?? "",
        observaciones: text(flight.remarks),
      };
    });
}

export async function getLegacyHistorialesShapeFromPostgres({ userId, aircraftId, mode }) {
  const [aircraftHistory, componentSources] = await Promise.all([
    getAircraftOperationalHistoryFromPostgres({ userId, aircraftId }),
    getComponentOperationalHistorySourcesFromPostgres({ userId, aircraftId }),
  ]);

  const canonicalAircraftId = aircraftHistory.aircraft.aircraft_id;
  const [provenanceByFlight, supplements] = await Promise.all([
    loadMigrationFlightProvenance(canonicalAircraftId),
    loadCurrentRevisionSupplements(canonicalAircraftId),
  ]);

  const flights = sortedFlights(aircraftHistory.flights, provenanceByFlight);
  const aircraftTotals = buildRunningTotals(
    flights,
    aircraftHistory.baseline?.baseline_tis_hours,
    aircraftHistory.adjustments
  );

  const installations = componentSources.component_installations || [];
  const engine = primaryInstallation(installations, "ENGINE");
  const propeller = primaryInstallation(installations, "PROPELLER");
  const engineFlights = engine ? applicableFlightsForInstallation(flights, engine) : [];
  const propellerFlights = propeller ? applicableFlightsForInstallation(flights, propeller) : [];
  const engineTotals = engine
    ? buildRunningTotals(engineFlights, engine.opening_tis_hours, engine.adjustments)
    : new Map();
  const propellerTotals = propeller
    ? buildRunningTotals(propellerFlights, propeller.opening_tis_hours, propeller.adjustments)
    : new Map();

  const result = {
    ok: true,
    historialAeronave: buildAircraftHistoryRows(flights, aircraftTotals, provenanceByFlight),
    historialMotor: buildEngineHistoryRows(engineFlights, engineTotals, provenanceByFlight),
    historialHelice: buildPropellerHistoryRows(
      propellerFlights,
      aircraftTotals,
      propellerTotals,
      provenanceByFlight
    ),
  };

  if (String(mode || "").toLowerCase() !== "historiales") {
    result.computacionHoras = buildComputacionRows(
      flights,
      provenanceByFlight,
      supplements.oilByFlight,
      supplements.fuelByFlight
    );
  }

  return result;
}
