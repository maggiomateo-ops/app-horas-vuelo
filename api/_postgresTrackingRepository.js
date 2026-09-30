import crypto from "node:crypto";

import { postgresQuery, withPostgresTransaction } from "./_postgres.js";
import { getValidatedAircraftAccessFromPostgres } from "./_postgresAircraftRepository.js";
import { LEGACY_SETTINGS_TRACKING_CONCEPTS } from "./_postgresSettingsRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DUE_BASIS = new Set(["DATE", "TIME_IN_SERVICE"]);
const RECURRENCE = new Set(["ONE_TIME", "RECURRING"]);
const REFERENCE_MODE = new Set(["ABSOLUTE_TIS", "TRACKED_FROM_NOW"]);
const ITEM_STATUS = new Set(["ACTIVE", "ARCHIVED"]);
const LEGACY_SETTINGS_CONCEPT_SET = new Set(
  Object.values(LEGACY_SETTINGS_TRACKING_CONCEPTS)
);

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

function normalizeText(value, label, maximumLength = 500, { required = false } = {}) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) {
    throw repositoryError(`Falta ${label}.`, "TRACKING_VALIDATION_ERROR", 400);
  }
  if (normalized.length > maximumLength) {
    throw repositoryError(`${label} es demasiado largo.`, "TRACKING_VALIDATION_ERROR", 400);
  }
  return normalized || null;
}

function normalizeEnum(value, allowed, label) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!allowed.has(normalized)) {
    throw repositoryError(`${label} no es valido.`, "TRACKING_VALIDATION_ERROR", 400);
  }
  return normalized;
}

function normalizeIsoDate(value, label, { required = false } = {}) {
  const normalized = String(value || "").trim();
  if (!normalized && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw repositoryError(`${label} debe tener formato AAAA-MM-DD.`, "TRACKING_VALIDATION_ERROR", 400);
  }
  const date = new Date(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw repositoryError(`${label} no es una fecha valida.`, "TRACKING_VALIDATION_ERROR", 400);
  }
  return normalized;
}

function normalizeTenths(value, label, { required = false, positive = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (!required) return null;
    throw repositoryError(`Falta ${label}.`, "TRACKING_VALIDATION_ERROR", 400);
  }
  const numeric = Number(value);
  if (
    !Number.isFinite(numeric)
    || numeric < 0
    || (positive && numeric <= 0)
    || Math.abs(numeric * 10 - Math.round(numeric * 10)) > 1e-9
  ) {
    throw repositoryError(
      `${label} debe ser un numero ${positive ? "mayor que 0" : "mayor o igual a 0"} con hasta un decimal.`,
      "TRACKING_VALIDATION_ERROR",
      400
    );
  }
  return Math.round(numeric * 10) / 10;
}

function dateText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value ? String(value).slice(0, 10) : null;
}

function numberValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundTenths(value) {
  return value === null ? null : Math.round(value * 10) / 10;
}

function todayIso(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

function deriveAlertState(remaining, threshold) {
  if (remaining === null) return "UNAVAILABLE";
  if (remaining < 0) return "OVERDUE";
  if (remaining === 0) return "DUE";
  if (remaining <= threshold) return "DUE_SOON";
  return "OK";
}

function trackedFlightsAfterBoundary(flights, item) {
  const boundaryId = String(item.tracking_start_after_flight_id || "");
  const boundaryIndex = boundaryId
    ? flights.findIndex((flight) => String(flight.flight_id) === boundaryId)
    : -1;
  const startDate = dateText(item.tracking_start_date);

  if (boundaryId && boundaryIndex < 0) {
    throw repositoryError(
      "El limite historico del recordatorio ya no puede resolverse.",
      "TRACKING_BOUNDARY_INVALID",
      409
    );
  }

  return flights.filter((flight, index) => {
    if (boundaryIndex >= 0) return index > boundaryIndex;
    return Boolean(startDate && dateText(flight.flight_date) >= startDate);
  });
}

export function deriveTrackingItemState(item, utilization, asOfDate) {
  const dueBasis = String(item.due_basis || "").toUpperCase();
  const threshold = numberValue(item.alert_before_value) ?? 0;
  let dueValue = null;
  let remainingValue = null;
  let elapsedHours = null;
  let unit = dueBasis === "DATE" ? "DAYS" : "HOURS";

  if (dueBasis === "DATE") {
    const dueDate = dateText(item.due_date);
    remainingValue = dueDate ? daysBetween(asOfDate, dueDate) : null;
    dueValue = dueDate;
  } else if (String(item.reference_mode || "").toUpperCase() === "ABSOLUTE_TIS") {
    const reference = numberValue(item.reference_tis_hours);
    const interval = numberValue(item.interval_hours);
    dueValue = reference === null || interval === null ? null : roundTenths(reference + interval);
    remainingValue = dueValue === null || utilization.currentTisHours === null
      ? null
      : roundTenths(dueValue - utilization.currentTisHours);
  } else {
    const applicable = trackedFlightsAfterBoundary(utilization.flights, item);
    elapsedHours = roundTenths(applicable.reduce(
      (sum, flight) => String(flight.status || "ACTIVE") === "ACTIVE"
        ? sum + (numberValue(flight.time_in_service_hours) ?? 0)
        : sum,
      0
    ));
    dueValue = numberValue(item.interval_hours);
    remainingValue = dueValue === null ? null : roundTenths(dueValue - elapsedHours);
  }

  return {
    due_value: dueValue,
    remaining_value: remainingValue,
    remaining_unit: unit,
    elapsed_hours: elapsedHours,
    due_state: deriveAlertState(remainingValue, threshold),
    current_aircraft_tis: utilization.currentTisHours,
    as_of_date: asOfDate,
  };
}

function buildTrackedFlightSet(flights, baseline) {
  const firstTrackedId = String(baseline?.first_tracked_flight_id || "");
  const baselineDate = dateText(baseline?.baseline_effective_date);
  const firstIndex = firstTrackedId
    ? flights.findIndex((flight) => String(flight.flight_id) === firstTrackedId)
    : -1;

  return new Set(flights.filter((flight, index) => {
    if (firstIndex >= 0) return index >= firstIndex;
    const flightDate = dateText(flight.flight_date);
    return Boolean(flightDate && (!baselineDate || flightDate >= baselineDate));
  }).map((flight) => String(flight.flight_id)));
}

export function calculateUtilizationSnapshot({ baseline, flights, adjustments }) {
  const baselineHours = numberValue(baseline?.baseline_tis_hours);
  const baselineDate = dateText(baseline?.baseline_effective_date);
  const trackedFlightIds = buildTrackedFlightSet(flights, baseline);
  const trackedHours = flights.reduce((sum, flight) => (
    String(flight.status || "ACTIVE") === "ACTIVE"
    && trackedFlightIds.has(String(flight.flight_id))
      ? sum + (numberValue(flight.time_in_service_hours) ?? 0)
      : sum
  ), 0);
  const adjustmentHours = adjustments.reduce((sum, adjustment) => {
    const effectiveDate = dateText(adjustment.effective_date);
    return effectiveDate && (!baselineDate || effectiveDate >= baselineDate)
      ? sum + (numberValue(adjustment.adjustment_hours) ?? 0)
      : sum;
  }, 0);

  return {
    currentTisHours: baselineHours === null
      ? null
      : roundTenths(baselineHours + trackedHours + adjustmentHours),
    flights,
  };
}

async function loadUtilizationSnapshot(query, aircraftId, asOfDate) {
  const [{ rows: baselineRows }, { rows: flights }, { rows: adjustments }] = await Promise.all([
    query(
      `SELECT baseline_tis_hours, baseline_effective_date, first_tracked_flight_id
         FROM app.aircraft_utilization_baselines
        WHERE aircraft_id = $1::uuid
        LIMIT 1`,
      [aircraftId]
    ),
    query(
      `SELECT flight.flight_id, flight.status, revision.flight_date, revision.time_in_service_hours,
              flight.created_at AS flight_created_at,
              provenance.source_row
         FROM app.flight_records flight
         JOIN app.flight_record_revisions revision
           ON revision.flight_id = flight.flight_id
          AND revision.flight_revision_id = flight.current_revision_id
         LEFT JOIN LATERAL (
           SELECT (event.metadata -> 'authoritative_source' ->> 'row')::integer AS source_row
             FROM audit.audit_events event
            WHERE event.aircraft_id = flight.aircraft_id
              AND event.entity_type = 'FLIGHT_RECORD'
              AND event.entity_id = flight.flight_id
              AND event.action_code = 'MIGRATION_CREATED'
            ORDER BY event.occurred_at, event.audit_event_id
            LIMIT 1
         ) provenance ON true
        WHERE flight.aircraft_id = $1::uuid
          AND revision.flight_date IS NOT NULL
          AND revision.flight_date <= $2::date
        ORDER BY revision.flight_date, provenance.source_row NULLS LAST,
                 flight.created_at, flight.flight_id`,
      [aircraftId, asOfDate]
    ),
    query(
      `SELECT adjustment_hours, effective_date, after_flight_id
         FROM app.utilization_adjustments
        WHERE aircraft_id = $1::uuid
          AND effective_date <= $2::date
        ORDER BY effective_date, created_at, utilization_adjustment_id`,
      [aircraftId, asOfDate]
    ),
  ]);

  return calculateUtilizationSnapshot({
    baseline: baselineRows[0] || null,
    flights,
    adjustments,
  });
}

function latestSameDayFlightId(utilization, date) {
  const sameDayFlights = utilization.flights.filter(
    (flight) => String(flight.status || "ACTIVE") === "ACTIVE"
      && dateText(flight.flight_date) === date
  );
  return sameDayFlights.length
    ? String(sameDayFlights[sameDayFlights.length - 1].flight_id)
    : null;
}

function normalizeTrackingConfiguration(input, context) {
  const dueBasis = normalizeEnum(input.due_basis, DUE_BASIS, "due_basis");
  const recurrence = normalizeEnum(input.recurrence, RECURRENCE, "recurrence");
  const concept = normalizeText(input.concept, "concepto", 160, { required: true });
  const notes = normalizeText(input.notes, "notas", 2000);
  const alertBeforeValue = normalizeTenths(
    input.alert_before_value ?? (dueBasis === "DATE" ? 30 : 10),
    "alert_before_value",
    { required: true }
  );

  if (dueBasis === "DATE") {
    return {
      concept,
      due_basis: dueBasis,
      recurrence,
      reference_mode: null,
      due_date: normalizeIsoDate(input.due_date, "due_date", { required: true }),
      reference_tis_hours: null,
      tracking_start_date: null,
      tracking_start_after_flight_id: null,
      interval_hours: null,
      alert_before_value: alertBeforeValue,
      notes,
    };
  }

  const referenceMode = normalizeEnum(
    input.reference_mode,
    REFERENCE_MODE,
    "reference_mode"
  );
  const intervalHours = normalizeTenths(input.interval_hours, "interval_hours", {
    required: true,
    positive: true,
  });

  if (referenceMode === "ABSOLUTE_TIS") {
    if (context.currentTisHours === null) {
      throw repositoryError(
        "La aeronave no tiene TIS absoluto disponible; usa Seguimiento desde ahora.",
        "TRACKING_ABSOLUTE_TIS_UNAVAILABLE",
        409
      );
    }
    return {
      concept,
      due_basis: dueBasis,
      recurrence,
      reference_mode: referenceMode,
      due_date: null,
      reference_tis_hours: normalizeTenths(
        input.reference_tis_hours,
        "reference_tis_hours",
        { required: true }
      ),
      tracking_start_date: null,
      tracking_start_after_flight_id: null,
      interval_hours: intervalHours,
      alert_before_value: alertBeforeValue,
      notes,
    };
  }

  return {
    concept,
    due_basis: dueBasis,
    recurrence,
    reference_mode: referenceMode,
    due_date: null,
    reference_tis_hours: null,
    tracking_start_date:
      context.existing?.due_basis === "TIME_IN_SERVICE"
      && context.existing?.reference_mode === "TRACKED_FROM_NOW"
        ? dateText(context.existing.tracking_start_date)
        : context.asOfDate,
    tracking_start_after_flight_id:
      context.existing?.due_basis === "TIME_IN_SERVICE"
      && context.existing?.reference_mode === "TRACKED_FROM_NOW"
        ? context.existing.tracking_start_after_flight_id || null
        : latestSameDayFlightId(context, context.asOfDate),
    interval_hours: intervalHours,
    alert_before_value: alertBeforeValue,
    notes,
  };
}

function mapItem(row, utilization, asOfDate, events = []) {
  const item = {
    tracking_item_id: String(row.tracking_item_id),
    concept: String(row.concept || ""),
    due_basis: String(row.due_basis || ""),
    recurrence: String(row.recurrence || ""),
    reference_mode: row.reference_mode ? String(row.reference_mode) : null,
    due_date: dateText(row.due_date),
    reference_tis_hours: numberValue(row.reference_tis_hours),
    tracking_start_date: dateText(row.tracking_start_date),
    tracking_start_after_flight_id: row.tracking_start_after_flight_id
      ? String(row.tracking_start_after_flight_id)
      : null,
    interval_hours: numberValue(row.interval_hours),
    alert_before_value: numberValue(row.alert_before_value),
    notes: row.notes ? String(row.notes) : "",
    status: String(row.status || ""),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
  if (
    item.status === "ACTIVE"
    && item.due_basis === "TIME_IN_SERVICE"
    && item.reference_mode === "ABSOLUTE_TIS"
    && utilization.currentTisHours === null
  ) {
    throw repositoryError(
      "Existe un recordatorio TIS absoluto activo sin TIS canonico disponible.",
      "TRACKING_ABSOLUTE_TIS_UNAVAILABLE",
      409
    );
  }
  return {
    ...item,
    legacy_settings_managed: LEGACY_SETTINGS_CONCEPT_SET.has(item.concept),
    derived: deriveTrackingItemState(item, utilization, asOfDate),
    events: events.map((event) => ({
      tracking_event_id: String(event.tracking_event_id),
      event_type: String(event.event_type),
      completed_at: event.completed_at,
      completed_at_tis: numberValue(event.completed_at_tis),
      completed_after_flight_id: event.completed_after_flight_id
        ? String(event.completed_after_flight_id)
        : null,
      note: event.note ? String(event.note) : "",
      cycle_snapshot: event.cycle_snapshot,
      next_due_date: dateText(event.next_due_date),
    })),
  };
}

async function requireOwnerInTransaction(client, userId, aircraftId) {
  const { rows } = await client.query(
    `SELECT membership.membership_id, membership.role
       FROM app.users user_account
       JOIN app.aircraft_memberships membership
         ON membership.user_id = user_account.user_id
       JOIN app.aircraft aircraft
         ON aircraft.aircraft_id = membership.aircraft_id
      WHERE user_account.user_id = $1::uuid
        AND user_account.status = 'ACTIVE'
        AND membership.aircraft_id = $2::uuid
        AND membership.status = 'ACTIVE'
        AND membership.role = 'OWNER'
        AND aircraft.status = 'ACTIVE'
      FOR UPDATE OF membership`,
    [userId, aircraftId]
  );
  if (rows.length !== 1) {
    throw repositoryError(
      "Se requiere ser Owner activo de la aeronave para gestionar recordatorios.",
      "TRACKING_ACCESS_DENIED",
      403
    );
  }
  return rows[0];
}

async function loadItemForUpdate(client, aircraftId, trackingItemId) {
  const { rows } = await client.query(
    `SELECT tracking_item_id, aircraft_id, concept, due_basis, recurrence,
            reference_mode, due_date, reference_tis_hours, tracking_start_date,
            tracking_start_after_flight_id, interval_hours, alert_before_value,
            notes, status, created_at, updated_at
       FROM app.tracking_items
      WHERE aircraft_id = $1::uuid
        AND tracking_item_id = $2::uuid
      FOR UPDATE`,
    [aircraftId, trackingItemId]
  );
  if (rows.length !== 1) {
    throw repositoryError("El recordatorio no existe.", "TRACKING_ITEM_NOT_FOUND", 404);
  }
  return rows[0];
}

function cycleSnapshot(item) {
  return {
    concept: String(item.concept),
    due_basis: String(item.due_basis),
    recurrence: String(item.recurrence),
    reference_mode: item.reference_mode ? String(item.reference_mode) : null,
    due_date: dateText(item.due_date),
    reference_tis_hours: numberValue(item.reference_tis_hours),
    tracking_start_date: dateText(item.tracking_start_date),
    tracking_start_after_flight_id: item.tracking_start_after_flight_id
      ? String(item.tracking_start_after_flight_id)
      : null,
    interval_hours: numberValue(item.interval_hours),
    alert_before_value: numberValue(item.alert_before_value),
    notes: item.notes ? String(item.notes) : null,
  };
}

function assertLegacySettingsTrackingCompatibility(existing, configuration) {
  if (!LEGACY_SETTINGS_CONCEPT_SET.has(String(existing.concept || ""))) return;

  const unchangedIdentity = configuration.concept === existing.concept
    && configuration.due_basis === existing.due_basis
    && configuration.recurrence === "RECURRING"
    && configuration.reference_mode === (existing.reference_mode || null)
    && numberValue(configuration.interval_hours) === numberValue(existing.interval_hours)
    && (configuration.notes || null) === (existing.notes || null);

  if (!unchangedIdentity) {
    throw repositoryError(
      "Este recordatorio esta vinculado a Settings; su identidad, periodo y notas de migracion deben conservarse.",
      "TRACKING_LEGACY_SETTINGS_CONFLICT",
      409
    );
  }
}

async function writeAudit(client, {
  randomUUID,
  actorUserId,
  aircraftId,
  trackingItemId,
  actionCode,
  beforeState,
  afterState,
  reason,
}) {
  await client.query(
    `INSERT INTO audit.audit_events (
       audit_event_id, request_id, actor_type, actor_user_id, operation_source,
       aircraft_id, entity_type, entity_id, entity_key, action_code,
       before_state, after_state, reason, metadata, payload_version
     ) VALUES (
       $1::uuid, $2::uuid, 'USER', $3::uuid, 'MANUAL', $4::uuid,
       'TRACKING_ITEM', $5::uuid, $6::jsonb, $7, $8::jsonb, $9::jsonb,
       $10, $11::jsonb, 1
     )`,
    [
      randomUUID(),
      randomUUID(),
      actorUserId,
      aircraftId,
      trackingItemId,
      JSON.stringify({ aircraft_id: aircraftId, tracking_item_id: trackingItemId }),
      actionCode,
      beforeState ? JSON.stringify(beforeState) : null,
      afterState ? JSON.stringify(afterState) : null,
      reason,
      JSON.stringify({ contract: "OWNER_TRACKING_REMINDER_V1" }),
    ]
  );
}

function itemSqlValues(configuration) {
  return [
    configuration.concept,
    configuration.due_basis,
    configuration.recurrence,
    configuration.reference_mode,
    configuration.due_date,
    configuration.reference_tis_hours,
    configuration.tracking_start_date,
    configuration.tracking_start_after_flight_id,
    configuration.interval_hours,
    configuration.alert_before_value,
    configuration.notes,
  ];
}

export function createPostgresTrackingRepository({
  query = postgresQuery,
  transaction = withPostgresTransaction,
  getAccess = getValidatedAircraftAccessFromPostgres,
  randomUUID = crypto.randomUUID,
  now = () => new Date(),
} = {}) {
  async function listTrackingItems({ userId, aircraftId, status = "ACTIVE" }) {
    const normalizedUserId = normalizeUuid(userId, "userId");
    const normalizedAircraftId = normalizeUuid(aircraftId, "aircraftId");
    const normalizedStatus = normalizeEnum(status, new Set(["ACTIVE", "ARCHIVED", "ALL"]), "status");
    const access = await getAccess(normalizedUserId, normalizedAircraftId);
    const asOfDate = todayIso(now());
    const statusClause = normalizedStatus === "ALL" ? "" : "AND status = $2";
    const params = normalizedStatus === "ALL"
      ? [normalizedAircraftId]
      : [normalizedAircraftId, normalizedStatus];
    const [{ rows: items }, utilization] = await Promise.all([
      query(
        `SELECT tracking_item_id, aircraft_id, concept, due_basis, recurrence,
                reference_mode, due_date, reference_tis_hours, tracking_start_date,
                tracking_start_after_flight_id, interval_hours, alert_before_value,
                notes, status, created_at, updated_at
           FROM app.tracking_items
          WHERE aircraft_id = $1::uuid ${statusClause}
          ORDER BY CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
                   lower(concept), tracking_item_id`,
        params
      ),
      loadUtilizationSnapshot(query, normalizedAircraftId, asOfDate),
    ]);
    const itemIds = items.map((item) => item.tracking_item_id);
    const { rows: events } = itemIds.length
      ? await query(
          `SELECT tracking_event_id, tracking_item_id, event_type, completed_at,
                  completed_at_tis, completed_after_flight_id, note,
                  cycle_snapshot, next_due_date
             FROM app.tracking_item_events
            WHERE tracking_item_id = ANY($1::uuid[])
            ORDER BY completed_at DESC, tracking_event_id DESC`,
          [itemIds]
        )
      : { rows: [] };
    const eventsByItem = new Map();
    events.forEach((event) => {
      const key = String(event.tracking_item_id);
      if (!eventsByItem.has(key)) eventsByItem.set(key, []);
      eventsByItem.get(key).push(event);
    });

    return {
      aircraft: access.aircraft,
      membership: access.membership,
      canManage: access.membership.role === "OWNER",
      currentTisHours: utilization.currentTisHours,
      asOfDate,
      items: items.map((item) => mapItem(
        item,
        utilization,
        asOfDate,
        eventsByItem.get(String(item.tracking_item_id)) || []
      )),
    };
  }

  async function createTrackingItem({ userId, aircraftId, item }) {
    const normalizedUserId = normalizeUuid(userId, "userId");
    const normalizedAircraftId = normalizeUuid(aircraftId, "aircraftId");
    const trackingItemId = randomUUID();
    return transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `app-horas:tracking:${normalizedAircraftId}`,
      ]);
      await requireOwnerInTransaction(client, normalizedUserId, normalizedAircraftId);
      const asOfDate = todayIso(now());
      const utilization = await loadUtilizationSnapshot(
        (text, params) => client.query(text, params),
        normalizedAircraftId,
        asOfDate
      );
      const configuration = normalizeTrackingConfiguration(item || {}, {
        ...utilization,
        asOfDate,
      });
      const values = itemSqlValues(configuration);
      await client.query(
        `INSERT INTO app.tracking_items (
           tracking_item_id, aircraft_id, concept, due_basis, recurrence,
           reference_mode, due_date, reference_tis_hours, tracking_start_date,
           tracking_start_after_flight_id, interval_hours, alert_before_value,
           notes, status, created_by_user_id, created_at, updated_at
         ) VALUES (
           $1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, $8::numeric(10,1),
           $9::date, $10::uuid, $11::numeric(10,1), $12::numeric(10,1),
           $13, 'ACTIVE', $14::uuid, transaction_timestamp(), transaction_timestamp()
         )`,
        [trackingItemId, normalizedAircraftId, ...values, normalizedUserId]
      );
      const afterState = { tracking_item_id: trackingItemId, status: "ACTIVE", ...configuration };
      await writeAudit(client, {
        randomUUID,
        actorUserId: normalizedUserId,
        aircraftId: normalizedAircraftId,
        trackingItemId,
        actionCode: "TRACKING_ITEM_CREATED",
        beforeState: null,
        afterState,
        reason: "Owner created tracking reminder",
      });
      return { tracking_item_id: trackingItemId, changed: true };
    }, { isolationLevel: "SERIALIZABLE" });
  }

  async function updateTrackingItem({ userId, aircraftId, trackingItemId, item }) {
    const normalizedUserId = normalizeUuid(userId, "userId");
    const normalizedAircraftId = normalizeUuid(aircraftId, "aircraftId");
    const normalizedItemId = normalizeUuid(trackingItemId, "trackingItemId");
    return transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `app-horas:tracking:${normalizedAircraftId}`,
      ]);
      await requireOwnerInTransaction(client, normalizedUserId, normalizedAircraftId);
      const existing = await loadItemForUpdate(client, normalizedAircraftId, normalizedItemId);
      if (existing.status !== "ACTIVE") {
        throw repositoryError(
          "Solo se pueden editar recordatorios activos.",
          "TRACKING_ITEM_ARCHIVED",
          409
        );
      }
      const asOfDate = todayIso(now());
      const utilization = await loadUtilizationSnapshot(
        (text, params) => client.query(text, params),
        normalizedAircraftId,
        asOfDate
      );
      const configuration = normalizeTrackingConfiguration(item || {}, {
        ...utilization,
        asOfDate,
        existing,
      });
      assertLegacySettingsTrackingCompatibility(existing, configuration);
      await client.query(
        `UPDATE app.tracking_items
            SET concept = $2, due_basis = $3, recurrence = $4,
                reference_mode = $5, due_date = $6::date,
                reference_tis_hours = $7::numeric(10,1),
                tracking_start_date = $8::date,
                tracking_start_after_flight_id = $9::uuid,
                interval_hours = $10::numeric(10,1),
                alert_before_value = $11::numeric(10,1), notes = $12,
                updated_at = transaction_timestamp()
          WHERE tracking_item_id = $1::uuid`,
        [normalizedItemId, ...itemSqlValues(configuration)]
      );
      const beforeState = { tracking_item_id: normalizedItemId, ...cycleSnapshot(existing), status: existing.status };
      const afterState = { tracking_item_id: normalizedItemId, ...configuration, status: "ACTIVE" };
      await writeAudit(client, {
        randomUUID,
        actorUserId: normalizedUserId,
        aircraftId: normalizedAircraftId,
        trackingItemId: normalizedItemId,
        actionCode: "TRACKING_ITEM_UPDATED",
        beforeState,
        afterState,
        reason: "Owner updated tracking reminder",
      });
      return { tracking_item_id: normalizedItemId, changed: true };
    }, { isolationLevel: "SERIALIZABLE" });
  }

  async function archiveTrackingItem({ userId, aircraftId, trackingItemId }) {
    const normalizedUserId = normalizeUuid(userId, "userId");
    const normalizedAircraftId = normalizeUuid(aircraftId, "aircraftId");
    const normalizedItemId = normalizeUuid(trackingItemId, "trackingItemId");
    return transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `app-horas:tracking:${normalizedAircraftId}`,
      ]);
      await requireOwnerInTransaction(client, normalizedUserId, normalizedAircraftId);
      const existing = await loadItemForUpdate(client, normalizedAircraftId, normalizedItemId);
      if (existing.status === "ARCHIVED") {
        return { tracking_item_id: normalizedItemId, changed: false };
      }
      if (LEGACY_SETTINGS_CONCEPT_SET.has(String(existing.concept || ""))) {
        throw repositoryError(
          "Este recordatorio esta vinculado a Settings y no puede archivarse desde Seguimiento.",
          "TRACKING_LEGACY_SETTINGS_CONFLICT",
          409
        );
      }
      await client.query(
        `UPDATE app.tracking_items
            SET status = 'ARCHIVED', updated_at = transaction_timestamp()
          WHERE tracking_item_id = $1::uuid`,
        [normalizedItemId]
      );
      await writeAudit(client, {
        randomUUID,
        actorUserId: normalizedUserId,
        aircraftId: normalizedAircraftId,
        trackingItemId: normalizedItemId,
        actionCode: "TRACKING_ITEM_ARCHIVED",
        beforeState: { tracking_item_id: normalizedItemId, status: "ACTIVE", ...cycleSnapshot(existing) },
        afterState: { tracking_item_id: normalizedItemId, status: "ARCHIVED", ...cycleSnapshot(existing) },
        reason: "Owner archived tracking reminder",
      });
      return { tracking_item_id: normalizedItemId, changed: true };
    }, { isolationLevel: "SERIALIZABLE" });
  }

  async function completeTrackingItem({
    userId,
    aircraftId,
    trackingItemId,
    note,
    nextDueDate,
  }) {
    const normalizedUserId = normalizeUuid(userId, "userId");
    const normalizedAircraftId = normalizeUuid(aircraftId, "aircraftId");
    const normalizedItemId = normalizeUuid(trackingItemId, "trackingItemId");
    const completionNote = normalizeText(note, "nota de finalizacion", 2000);
    return transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `app-horas:tracking:${normalizedAircraftId}`,
      ]);
      await requireOwnerInTransaction(client, normalizedUserId, normalizedAircraftId);
      const existing = await loadItemForUpdate(client, normalizedAircraftId, normalizedItemId);
      if (existing.status !== "ACTIVE") {
        throw repositoryError(
          "Solo se pueden completar recordatorios activos.",
          "TRACKING_ITEM_ARCHIVED",
          409
        );
      }
      const asOfDate = todayIso(now());
      const utilization = await loadUtilizationSnapshot(
        (text, params) => client.query(text, params),
        normalizedAircraftId,
        asOfDate
      );
      const isRecurring = existing.recurrence === "RECURRING";
      const isDate = existing.due_basis === "DATE";
      const normalizedNextDueDate = isRecurring && isDate
        ? normalizeIsoDate(nextDueDate, "next_due_date", { required: true })
        : null;
      const completionBoundary = existing.due_basis === "TIME_IN_SERVICE"
        ? latestSameDayFlightId(utilization, asOfDate)
        : null;
      const snapshot = cycleSnapshot(existing);
      const trackingEventId = randomUUID();

      await client.query(
        `INSERT INTO app.tracking_item_events (
           tracking_event_id, tracking_item_id, event_type, completed_at,
           completed_by_user_id, completed_at_tis, completed_after_flight_id,
           note, cycle_snapshot, next_due_date
         ) VALUES (
           $1::uuid, $2::uuid, 'COMPLETED', transaction_timestamp(), $3::uuid,
           $4::numeric(10,1), $5::uuid, $6, $7::jsonb, $8::date
         )`,
        [
          trackingEventId,
          normalizedItemId,
          normalizedUserId,
          utilization.currentTisHours,
          completionBoundary,
          completionNote,
          JSON.stringify(snapshot),
          normalizedNextDueDate,
        ]
      );

      let afterState;
      if (!isRecurring) {
        await client.query(
          `UPDATE app.tracking_items
              SET status = 'ARCHIVED', updated_at = transaction_timestamp()
            WHERE tracking_item_id = $1::uuid`,
          [normalizedItemId]
        );
        afterState = { ...snapshot, status: "ARCHIVED" };
      } else if (isDate) {
        await client.query(
          `UPDATE app.tracking_items
              SET due_date = $2::date, updated_at = transaction_timestamp()
            WHERE tracking_item_id = $1::uuid`,
          [normalizedItemId, normalizedNextDueDate]
        );
        afterState = { ...snapshot, due_date: normalizedNextDueDate, status: "ACTIVE" };
      } else if (existing.reference_mode === "ABSOLUTE_TIS") {
        if (utilization.currentTisHours === null) {
          throw repositoryError(
            "No se puede iniciar el siguiente ciclo sin TIS absoluto disponible.",
            "TRACKING_ABSOLUTE_TIS_UNAVAILABLE",
            409
          );
        }
        await client.query(
          `UPDATE app.tracking_items
              SET reference_tis_hours = $2::numeric(10,1),
                  updated_at = transaction_timestamp()
            WHERE tracking_item_id = $1::uuid`,
          [normalizedItemId, utilization.currentTisHours]
        );
        afterState = {
          ...snapshot,
          reference_tis_hours: utilization.currentTisHours,
          status: "ACTIVE",
        };
      } else {
        await client.query(
          `UPDATE app.tracking_items
              SET tracking_start_date = $2::date,
                  tracking_start_after_flight_id = $3::uuid,
                  updated_at = transaction_timestamp()
            WHERE tracking_item_id = $1::uuid`,
          [normalizedItemId, asOfDate, completionBoundary]
        );
        afterState = {
          ...snapshot,
          tracking_start_date: asOfDate,
          tracking_start_after_flight_id: completionBoundary,
          status: "ACTIVE",
        };
      }

      await writeAudit(client, {
        randomUUID,
        actorUserId: normalizedUserId,
        aircraftId: normalizedAircraftId,
        trackingItemId: normalizedItemId,
        actionCode: "TRACKING_ITEM_COMPLETED",
        beforeState: { ...snapshot, status: "ACTIVE" },
        afterState: {
          ...afterState,
          tracking_event_id: trackingEventId,
          completed_at_tis: utilization.currentTisHours,
          completed_after_flight_id: completionBoundary,
        },
        reason: "Owner marked tracking reminder attended",
      });
      return {
        tracking_item_id: normalizedItemId,
        tracking_event_id: trackingEventId,
        changed: true,
      };
    }, { isolationLevel: "SERIALIZABLE" });
  }

  return {
    listTrackingItems,
    createTrackingItem,
    updateTrackingItem,
    archiveTrackingItem,
    completeTrackingItem,
  };
}

const repository = createPostgresTrackingRepository();

export const getTrackingItemsFromPostgres = repository.listTrackingItems;
export const createTrackingItemInPostgres = repository.createTrackingItem;
export const updateTrackingItemInPostgres = repository.updateTrackingItem;
export const archiveTrackingItemInPostgres = repository.archiveTrackingItem;
export const completeTrackingItemInPostgres = repository.completeTrackingItem;
