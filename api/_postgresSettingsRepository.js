import crypto from "node:crypto";
import { postgresQuery, withPostgresTransaction } from "./_postgres.js";
import { getValidatedAircraftAccessFromPostgres } from "./_postgresAircraftRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const LEGACY_SETTINGS_TRACKING_CONCEPTS = Object.freeze({
  annual: "Annual inspection",
  inspection50: "50-hour inspection",
  inspection100: "100-hour inspection",
});
const TRACKING_CONCEPT = LEGACY_SETTINGS_TRACKING_CONCEPTS;

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

function numberValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function dateValue(value) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return value ? String(value).slice(0, 10) : null;
}

function canonicalState(recording, tracking) {
  return {
    default_oil_unit: String(recording.default_oil_unit || ""),
    annual_inspection: {
      tracking_item_id: tracking.annual.tracking_item_id,
      due_date: dateValue(tracking.annual.due_date),
      alert_before_value: numberValue(tracking.annual.alert_before_value),
    },
    inspection_50h: {
      tracking_item_id: tracking.inspection50.tracking_item_id,
      alert_before_value: numberValue(tracking.inspection50.alert_before_value),
    },
    inspection_100h: {
      tracking_item_id: tracking.inspection100.tracking_item_id,
      alert_before_value: numberValue(tracking.inspection100.alert_before_value),
    },
  };
}

function assertTrackingRow(row, expected) {
  if (!row) {
    throw repositoryError(
      `No se encontro el reminder canonico ${expected.concept}.`,
      "SETTINGS_TRACKING_NOT_READY",
      409
    );
  }

  const dueBasis = String(row.due_basis || "").toUpperCase();
  const recurrence = String(row.recurrence || "").toUpperCase();
  const referenceMode = String(row.reference_mode || "").toUpperCase();
  const interval = numberValue(row.interval_hours);

  if (
    String(row.status || "").toUpperCase() !== "ACTIVE" ||
    dueBasis !== expected.dueBasis ||
    recurrence !== "RECURRING" ||
    (expected.referenceMode && referenceMode !== expected.referenceMode) ||
    (expected.intervalHours !== null && interval !== expected.intervalHours)
  ) {
    throw repositoryError(
      `El reminder ${expected.concept} no coincide con el contrato de Settings 2E.4.`,
      "SETTINGS_TRACKING_NOT_READY",
      409
    );
  }
}

function mapTrackingRows(rows) {
  const byConcept = new Map(rows.map((row) => [String(row.concept || ""), row]));
  const annual = byConcept.get(TRACKING_CONCEPT.annual);
  const inspection50 = byConcept.get(TRACKING_CONCEPT.inspection50);
  const inspection100 = byConcept.get(TRACKING_CONCEPT.inspection100);

  assertTrackingRow(annual, {
    concept: TRACKING_CONCEPT.annual,
    dueBasis: "DATE",
    referenceMode: null,
    intervalHours: null,
  });
  assertTrackingRow(inspection50, {
    concept: TRACKING_CONCEPT.inspection50,
    dueBasis: "TIME_IN_SERVICE",
    referenceMode: "ABSOLUTE_TIS",
    intervalHours: 50,
  });
  assertTrackingRow(inspection100, {
    concept: TRACKING_CONCEPT.inspection100,
    dueBasis: "TIME_IN_SERVICE",
    referenceMode: "ABSOLUTE_TIS",
    intervalHours: 100,
  });

  return { annual, inspection50, inspection100 };
}

async function requireOwnerAccessInTransaction(client, userId, aircraftId) {
  const { rows } = await client.query(
    `
      SELECT
        user_account.user_id,
        user_account.status AS user_status,
        aircraft.aircraft_id,
        aircraft.status AS aircraft_status,
        membership.membership_id,
        membership.role,
        membership.status AS membership_status
      FROM app.users user_account
      JOIN app.aircraft_memberships membership
        ON membership.user_id = user_account.user_id
      JOIN app.aircraft aircraft
        ON aircraft.aircraft_id = membership.aircraft_id
      WHERE user_account.user_id = $1::uuid
        AND aircraft.aircraft_id = $2::uuid
      LIMIT 1
    `,
    [userId, aircraftId]
  );
  const access = rows[0];

  if (
    !access ||
    access.user_status !== "ACTIVE" ||
    access.aircraft_status !== "ACTIVE" ||
    access.membership_status !== "ACTIVE" ||
    access.role !== "OWNER"
  ) {
    throw repositoryError(
      "El usuario no tiene permiso OWNER activo para modificar la configuracion de la aeronave.",
      "SETTINGS_WRITE_FORBIDDEN",
      403
    );
  }

  return access;
}

function changedLegacyPaths(before, desired) {
  const changes = [];

  if (before.default_oil_unit !== desired.defaultOilUnit) {
    changes.push("appConfig.oilUnitLabel");
  }
  if (before.annual_inspection.due_date !== desired.annualDueDate) {
    changes.push("kpiParams.annualInspection.nextDueDate");
  }
  if (before.annual_inspection.alert_before_value !== desired.annualWarning) {
    changes.push("kpiParams.thresholds.annualInspection.warningDays");
  }
  if (before.inspection_50h.alert_before_value !== desired.inspection50Warning) {
    changes.push("kpiParams.thresholds.inspection50.warningHours");
  }
  if (before.inspection_100h.alert_before_value !== desired.inspection100Warning) {
    changes.push("kpiParams.thresholds.inspection100.warningHours");
  }

  return changes;
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

export async function saveCanonicalSettingsSubsetToPostgres({
  userId,
  aircraftId,
  desired,
}) {
  const normalizedUserId = normalizeUuid(userId, "userId");
  const normalizedAircraftId = normalizeUuid(aircraftId, "aircraftId");

  return withPostgresTransaction(
    async (client) => {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1))",
        [`app-horas:settings:${normalizedAircraftId}`]
      );
      await requireOwnerAccessInTransaction(
        client,
        normalizedUserId,
        normalizedAircraftId
      );

      const { rows: recordingRows } = await client.query(
        `
          SELECT aircraft_id, default_capture_method, default_oil_unit,
                 capture_engine_runtime, created_at, updated_at
          FROM app.aircraft_settings
          WHERE aircraft_id = $1::uuid
          FOR UPDATE
        `,
        [normalizedAircraftId]
      );
      const recording = recordingRows[0];

      if (!recording) {
        throw repositoryError(
          "La aeronave no tiene aircraft_settings canonico.",
          "SETTINGS_CANONICAL_ROW_MISSING",
          409
        );
      }

      const { rows: trackingRows } = await client.query(
        `
          SELECT tracking_item_id, concept, due_basis, recurrence, reference_mode,
                 due_date, reference_tis_hours, tracking_start_date,
                 tracking_start_after_flight_id, interval_hours, alert_before_value,
                 notes, status, updated_at
          FROM app.tracking_items
          WHERE aircraft_id = $1::uuid
            AND status = 'ACTIVE'
            AND concept = ANY($2::text[])
          ORDER BY concept
          FOR UPDATE
        `,
        [normalizedAircraftId, Object.values(TRACKING_CONCEPT)]
      );
      const tracking = mapTrackingRows(trackingRows);
      const before = canonicalState(recording, tracking);
      const changedPaths = changedLegacyPaths(before, desired);

      if (changedPaths.length === 0) {
        return { changed: false, changedPaths, before, after: before };
      }

      if (before.default_oil_unit !== desired.defaultOilUnit) {
        await client.query(
          `
            UPDATE app.aircraft_settings
            SET default_oil_unit = $2, updated_at = now()
            WHERE aircraft_id = $1::uuid
          `,
          [normalizedAircraftId, desired.defaultOilUnit]
        );
      }

      if (
        before.annual_inspection.due_date !== desired.annualDueDate ||
        before.annual_inspection.alert_before_value !== desired.annualWarning
      ) {
        await client.query(
          `
            UPDATE app.tracking_items
            SET due_date = $2::date,
                alert_before_value = $3::numeric(10,1),
                updated_at = now()
            WHERE tracking_item_id = $1::uuid
          `,
          [tracking.annual.tracking_item_id, desired.annualDueDate, desired.annualWarning]
        );
      }

      if (before.inspection_50h.alert_before_value !== desired.inspection50Warning) {
        await client.query(
          `
            UPDATE app.tracking_items
            SET alert_before_value = $2::numeric(10,1), updated_at = now()
            WHERE tracking_item_id = $1::uuid
          `,
          [tracking.inspection50.tracking_item_id, desired.inspection50Warning]
        );
      }

      if (before.inspection_100h.alert_before_value !== desired.inspection100Warning) {
        await client.query(
          `
            UPDATE app.tracking_items
            SET alert_before_value = $2::numeric(10,1), updated_at = now()
            WHERE tracking_item_id = $1::uuid
          `,
          [tracking.inspection100.tracking_item_id, desired.inspection100Warning]
        );
      }

      const after = {
        default_oil_unit: desired.defaultOilUnit,
        annual_inspection: {
          ...before.annual_inspection,
          due_date: desired.annualDueDate,
          alert_before_value: desired.annualWarning,
        },
        inspection_50h: {
          ...before.inspection_50h,
          alert_before_value: desired.inspection50Warning,
        },
        inspection_100h: {
          ...before.inspection_100h,
          alert_before_value: desired.inspection100Warning,
        },
      };
      const requestId = crypto.randomUUID();

      await client.query(
        `
          INSERT INTO audit.audit_events (
            request_id,
            actor_type,
            actor_user_id,
            operation_source,
            aircraft_id,
            entity_type,
            entity_id,
            entity_key,
            action_code,
            before_state,
            after_state,
            reason,
            metadata,
            payload_version
          ) VALUES (
            $1::uuid,
            'USER',
            $2::uuid,
            'MANUAL',
            $3::uuid,
            'AIRCRAFT_CONFIGURATION',
            $3::uuid,
            $4::jsonb,
            'SETTINGS_UPDATED',
            $5::jsonb,
            $6::jsonb,
            'Settings canonical subset save',
            $7::jsonb,
            1
          )
        `,
        [
          requestId,
          normalizedUserId,
          normalizedAircraftId,
          JSON.stringify({ aircraft_id: normalizedAircraftId }),
          JSON.stringify(before),
          JSON.stringify(after),
          JSON.stringify({
            contract: "D-233",
            write_mode: "CANONICAL_SUBSET",
            changed_legacy_paths: changedPaths,
          }),
        ]
      );

      return { changed: true, changedPaths, before, after, requestId };
    },
    { isolationLevel: "SERIALIZABLE" }
  );
}
