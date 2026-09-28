import crypto from "node:crypto";

import { withPostgresTransaction } from "./_postgres.js";
import { renderFlightHistoryWorkbook } from "./_xlsxFlightHistoryRenderer.js";

export const FLIGHT_HISTORY_DATASET = "AIRCRAFT_FLIGHT_HISTORY";
export const SYSTEM_FLIGHT_HISTORY_TEMPLATE_ID = "e6010000-0000-4000-8000-000000000001";
export const SYSTEM_FLIGHT_HISTORY_VERSION_ID = "e6010000-0000-4000-8000-000000000002";

export const SYSTEM_FLIGHT_HISTORY_FIELDS = Object.freeze([
  "flight_date",
  "departure_location",
  "arrival_location",
  "pilot",
  "utilization_owner",
  "flight_time_hours",
  "time_in_service_hours",
  "accumulated_aircraft_tis",
  "landings",
  "purpose",
  "remarks",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const PERIOD_TYPES = new Set(["ALL_HISTORY", "YEAR_TO_DATE", "CUSTOM"]);
const LOCALES = new Set(["es", "en"]);
const ALLOWED_INPUT_FIELDS = new Set([
  "aircraftId",
  "datasetCode",
  "periodType",
  "periodStartDate",
  "periodEndDate",
  "locale",
]);

function repositoryError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeUuid(value, label, statusCode = 400) {
  const normalized = String(value || "").trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw repositoryError(`${label} no es un UUID valido.`, "INVALID_EXPORT_INPUT", statusCode);
  }
  return normalized;
}

function dateText(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function normalizeIsoDate(value, field) {
  const normalized = String(value || "").trim();
  const match = ISO_DATE_PATTERN.exec(normalized);
  if (!match) {
    throw repositoryError(`${field} debe tener formato YYYY-MM-DD.`, "INVALID_EXPORT_PERIOD", 400);
  }
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) {
    throw repositoryError(`${field} no es una fecha valida.`, "INVALID_EXPORT_PERIOD", 400);
  }
  return normalized;
}

function resolvePeriod(input, now) {
  const periodType = String(input.periodType || "").trim().toUpperCase();
  if (!PERIOD_TYPES.has(periodType)) {
    throw repositoryError("periodType no tiene un valor permitido.", "INVALID_EXPORT_PERIOD", 400);
  }

  if (periodType === "ALL_HISTORY") {
    if (input.periodStartDate || input.periodEndDate) {
      throw repositoryError(
        "ALL_HISTORY no acepta fechas de inicio o fin.",
        "UNSUPPORTED_EXPORT_FIELDS",
        422
      );
    }
    return { periodType, periodStartDate: null, periodEndDate: null };
  }

  if (periodType === "YEAR_TO_DATE") {
    if (input.periodStartDate || input.periodEndDate) {
      throw repositoryError(
        "YEAR_TO_DATE resuelve sus fechas automaticamente.",
        "UNSUPPORTED_EXPORT_FIELDS",
        422
      );
    }
    const periodEndDate = now.toISOString().slice(0, 10);
    return {
      periodType,
      periodStartDate: `${periodEndDate.slice(0, 4)}-01-01`,
      periodEndDate,
    };
  }

  const periodStartDate = normalizeIsoDate(input.periodStartDate, "periodStartDate");
  const periodEndDate = normalizeIsoDate(input.periodEndDate, "periodEndDate");
  if (periodStartDate > periodEndDate) {
    throw repositoryError(
      "periodStartDate no puede ser posterior a periodEndDate.",
      "INVALID_EXPORT_PERIOD",
      400
    );
  }
  return { periodType, periodStartDate, periodEndDate };
}

export function normalizeFlightHistoryExportInput(input, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw repositoryError("El payload de export debe ser un objeto JSON.", "INVALID_EXPORT_INPUT", 400);
  }
  const unsupported = Object.keys(input).filter((field) => !ALLOWED_INPUT_FIELDS.has(field));
  if (unsupported.length > 0) {
    throw repositoryError(
      "El payload contiene campos no soportados para export.",
      "UNSUPPORTED_EXPORT_FIELDS",
      422
    );
  }

  const datasetCode = String(input.datasetCode || "").trim().toUpperCase();
  if (datasetCode !== FLIGHT_HISTORY_DATASET) {
    throw repositoryError("datasetCode no esta soportado en XLSX V1.", "UNSUPPORTED_EXPORT_DATASET", 422);
  }
  const locale = String(input.locale || "").trim().toLowerCase();
  if (!LOCALES.has(locale)) {
    throw repositoryError("locale debe ser es o en.", "INVALID_EXPORT_INPUT", 400);
  }

  return {
    aircraftId: normalizeUuid(input.aircraftId, "aircraftId"),
    datasetCode,
    locale,
    ...resolvePeriod(input, now),
  };
}

async function requireOwnerAccess(client, userId, aircraftId) {
  const { rows } = await client.query(
    `
      SELECT
        aircraft.aircraft_id,
        aircraft.manufacturer,
        aircraft.model,
        COALESCE(registration.registration, '') AS registration,
        baseline.baseline_tis_hours,
        baseline.baseline_effective_date,
        baseline.first_tracked_flight_id
      FROM app.users user_account
      JOIN app.aircraft_memberships membership
        ON membership.user_id = user_account.user_id
      JOIN app.aircraft aircraft
        ON aircraft.aircraft_id = membership.aircraft_id
      LEFT JOIN app.aircraft_utilization_baselines baseline
        ON baseline.aircraft_id = aircraft.aircraft_id
      LEFT JOIN LATERAL (
        SELECT history.registration
        FROM app.aircraft_registrations history
        WHERE history.aircraft_id = aircraft.aircraft_id
          AND history.effective_from_at <= now()
          AND (history.effective_to_at IS NULL OR history.effective_to_at > now())
        ORDER BY history.effective_from_at DESC
        LIMIT 1
      ) registration ON true
      WHERE user_account.user_id = $1::uuid
        AND user_account.status = 'ACTIVE'
        AND aircraft.aircraft_id = $2::uuid
        AND aircraft.status = 'ACTIVE'
        AND membership.status = 'ACTIVE'
        AND membership.role = 'OWNER'
      LIMIT 2
    `,
    [userId, aircraftId]
  );
  if (rows.length !== 1) {
    throw repositoryError(
      "No tenes permiso para exportar el historial de esta aeronave.",
      "EXPORT_ACCESS_DENIED",
      403
    );
  }
  return rows[0];
}

async function loadTemplate(client) {
  const { rows } = await client.query(
    `
      SELECT
        template.export_template_id,
        version.export_template_version_id,
        version.version_number,
        version.name,
        version.render_options
      FROM app.export_templates template
      JOIN app.export_template_versions version
        ON version.export_template_id = template.export_template_id
       AND version.export_template_version_id = template.current_version_id
      WHERE template.scope = 'SYSTEM'
        AND template.aircraft_id IS NULL
        AND template.dataset_code = $1::text
        AND template.status = 'ACTIVE'
      LIMIT 2
    `,
    [FLIGHT_HISTORY_DATASET]
  );
  if (rows.length > 1) {
    throw repositoryError(
      "Existe mas de un SYSTEM preset activo para el dataset.",
      "EXPORT_TEMPLATE_STATE_INVALID"
    );
  }
  return rows[0] || null;
}

async function loadTemplateFields(client, versionId) {
  const { rows } = await client.query(
    `
      SELECT field_code, display_order, custom_label, format_options
      FROM app.export_template_version_fields
      WHERE export_template_version_id = $1::uuid
      ORDER BY display_order
    `,
    [versionId]
  );
  return rows;
}

function publicTemplate(template, fields) {
  const allowedFields = new Set(SYSTEM_FLIGHT_HISTORY_FIELDS);
  if (
    fields.length !== SYSTEM_FLIGHT_HISTORY_FIELDS.length ||
    fields.some((field) => !allowedFields.has(field.field_code))
  ) {
    throw repositoryError(
      "El SYSTEM preset AIRCRAFT_FLIGHT_HISTORY no es compatible con XLSX V1.",
      "EXPORT_TEMPLATE_STATE_INVALID"
    );
  }
  return {
    templateId: template.export_template_id,
    versionId: template.export_template_version_id,
    versionNumber: Number(template.version_number),
    name: template.name,
    renderOptions: template.render_options || {},
    fields: fields.map((field) => ({
      fieldCode: field.field_code,
      displayOrder: Number(field.display_order),
      customLabel: field.custom_label || null,
      formatOptions: field.format_options || {},
    })),
  };
}

export async function ensureSystemFlightHistoryPreset(client) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `app-horas:export-template:${FLIGHT_HISTORY_DATASET}`,
  ]);
  let template = await loadTemplate(client);
  if (!template) {
    await client.query(
      `
        INSERT INTO app.export_templates (
          export_template_id, scope, aircraft_id, dataset_code, status,
          current_version_id, created_by_user_id, created_at, updated_at
        ) VALUES (
          $1::uuid, 'SYSTEM', NULL, $2::text, 'ACTIVE',
          $3::uuid, NULL, transaction_timestamp(), transaction_timestamp()
        )
      `,
      [
        SYSTEM_FLIGHT_HISTORY_TEMPLATE_ID,
        FLIGHT_HISTORY_DATASET,
        SYSTEM_FLIGHT_HISTORY_VERSION_ID,
      ]
    );
    await client.query(
      `
        INSERT INTO app.export_template_versions (
          export_template_version_id, export_template_id, version_number,
          name, render_options, created_by_user_id, created_at
        ) VALUES (
          $1::uuid, $2::uuid, 1,
          'System Aircraft Flight History V1', $3::jsonb, NULL, transaction_timestamp()
        )
      `,
      [
        SYSTEM_FLIGHT_HISTORY_VERSION_ID,
        SYSTEM_FLIGHT_HISTORY_TEMPLATE_ID,
        JSON.stringify({ workbook_version: 1, sheets: ["Summary", "Aircraft"] }),
      ]
    );
    for (const [index, fieldCode] of SYSTEM_FLIGHT_HISTORY_FIELDS.entries()) {
      await client.query(
        `
          INSERT INTO app.export_template_version_fields (
            export_template_version_id, field_code, display_order,
            custom_label, format_options
          ) VALUES ($1::uuid, $2::text, $3::integer, NULL, $4::jsonb)
        `,
        [
          SYSTEM_FLIGHT_HISTORY_VERSION_ID,
          fieldCode,
          index + 1,
          JSON.stringify({}),
        ]
      );
    }
    template = await loadTemplate(client);
  }

  const fields = await loadTemplateFields(client, template.export_template_version_id);
  return publicTemplate(template, fields);
}

async function loadCurrentFlights(client, aircraftId) {
  const { rows } = await client.query(
    `
      SELECT
        flight.flight_id,
        flight.current_revision_id,
        flight.created_at AS flight_created_at,
        revision.flight_date,
        revision.departure_location,
        revision.arrival_location,
        pilot.full_name AS pilot,
        CASE
          WHEN owner_party.party_type = 'PERSON' THEN owner_person.full_name
          WHEN owner_party.party_type = 'ORGANIZATION' THEN owner_party.organization_name
          ELSE NULL
        END AS utilization_owner,
        revision.flight_time_hours,
        revision.time_in_service_hours,
        landing.counter_value AS landings,
        purpose.name AS purpose,
        revision.remarks
      FROM app.flight_records flight
      JOIN app.flight_record_revisions revision
        ON revision.flight_id = flight.flight_id
       AND revision.flight_revision_id = flight.current_revision_id
      LEFT JOIN app.persons pilot ON pilot.person_id = revision.pilot_person_id
      LEFT JOIN app.parties owner_party
        ON owner_party.party_id = revision.utilization_owner_party_id
      LEFT JOIN app.persons owner_person ON owner_person.person_id = owner_party.person_id
      LEFT JOIN app.aircraft_flight_purposes purpose
        ON purpose.flight_purpose_id = revision.flight_purpose_id
      LEFT JOIN app.flight_counters landing
        ON landing.flight_revision_id = revision.flight_revision_id
       AND landing.counter_code = 'LANDINGS'
      WHERE flight.aircraft_id = $1::uuid
        AND flight.status = 'ACTIVE'
      ORDER BY revision.flight_date NULLS LAST, flight.created_at, flight.flight_id
    `,
    [aircraftId]
  );
  return rows;
}

async function loadAircraftAdjustments(client, aircraftId) {
  const { rows } = await client.query(
    `
      SELECT
        utilization_adjustment_id,
        adjustment_hours,
        effective_date,
        after_flight_id,
        created_at
      FROM app.utilization_adjustments
      WHERE aircraft_id = $1::uuid
      ORDER BY effective_date, created_at, utilization_adjustment_id
    `,
    [aircraftId]
  );
  return rows;
}

function toTenths(value) {
  if (value === null || value === undefined || value === "") return 0;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) : 0;
}

function fromTenths(value) {
  return Math.round(value) / 10;
}

function isDateInPeriod(value, startDate, endDate) {
  const date = dateText(value);
  if (!startDate && !endDate) return true;
  if (!date) return false;
  return (!startDate || date >= startDate) && (!endDate || date <= endDate);
}

function buildTrackedFlightSet(flights, baseline) {
  const firstTrackedId = String(baseline?.first_tracked_flight_id || "");
  const baselineDate = dateText(baseline?.baseline_effective_date);
  const firstIndex = firstTrackedId
    ? flights.findIndex((flight) => String(flight.flight_id) === firstTrackedId)
    : -1;

  return new Set(
    flights
      .filter((flight, index) => {
        if (firstIndex >= 0) return index >= firstIndex;
        const flightDate = dateText(flight.flight_date);
        return Boolean(flightDate && (!baselineDate || flightDate >= baselineDate));
      })
      .map((flight) => String(flight.flight_id))
  );
}

function eligibleAdjustment(adjustment, baselineDate) {
  const effectiveDate = dateText(adjustment.effective_date);
  return Boolean(effectiveDate && (!baselineDate || effectiveDate >= baselineDate));
}

export function buildFlightHistoryExportModel({ aircraft, flights, adjustments, period }) {
  const baselineDate = dateText(aircraft.baseline_effective_date);
  const baselineKnown = aircraft.baseline_tis_hours !== null && aircraft.baseline_tis_hours !== undefined;
  const trackedFlightIds = buildTrackedFlightSet(flights, aircraft);
  const trackedAdjustments = adjustments.filter((adjustment) =>
    eligibleAdjustment(adjustment, baselineDate)
  );
  const accumulatedByFlight = new Map();
  let absoluteTenths = baselineKnown ? toTenths(aircraft.baseline_tis_hours) : null;
  const appliedAdjustments = new Set();

  flights.forEach((flight) => {
    const flightDate = dateText(flight.flight_date);
    trackedAdjustments.forEach((adjustment, index) => {
      if (appliedAdjustments.has(index)) return;
      const adjustmentDate = dateText(adjustment.effective_date);
      const afterFlightId = String(adjustment.after_flight_id || "");
      if (adjustmentDate < flightDate || (adjustmentDate === flightDate && !afterFlightId)) {
        if (absoluteTenths !== null) absoluteTenths += toTenths(adjustment.adjustment_hours);
        appliedAdjustments.add(index);
      }
    });

    if (trackedFlightIds.has(String(flight.flight_id))) {
      if (absoluteTenths !== null) absoluteTenths += toTenths(flight.time_in_service_hours);
      accumulatedByFlight.set(
        String(flight.flight_id),
        absoluteTenths === null ? null : fromTenths(absoluteTenths)
      );
    } else {
      accumulatedByFlight.set(String(flight.flight_id), null);
    }

    trackedAdjustments.forEach((adjustment, index) => {
      if (
        !appliedAdjustments.has(index) &&
        String(adjustment.after_flight_id || "") === String(flight.flight_id)
      ) {
        if (absoluteTenths !== null) absoluteTenths += toTenths(adjustment.adjustment_hours);
        appliedAdjustments.add(index);
      }
    });
  });

  const periodFlights = flights.filter((flight) =>
    isDateInPeriod(flight.flight_date, period.periodStartDate, period.periodEndDate)
  );
  const periodTrackedFlightTenths = periodFlights.reduce(
    (sum, flight) =>
      trackedFlightIds.has(String(flight.flight_id))
        ? sum + toTenths(flight.time_in_service_hours)
        : sum,
    0
  );
  const periodAdjustmentTenths = trackedAdjustments.reduce(
    (sum, adjustment) =>
      isDateInPeriod(
        adjustment.effective_date,
        period.periodStartDate,
        period.periodEndDate
      )
        ? sum + toTenths(adjustment.adjustment_hours)
        : sum,
    0
  );
  const periodTenths = periodTrackedFlightTenths + periodAdjustmentTenths;
  const priorFlightTenths = period.periodStartDate
    ? flights.reduce((sum, flight) => {
        const flightDate = dateText(flight.flight_date);
        return trackedFlightIds.has(String(flight.flight_id)) && flightDate < period.periodStartDate
          ? sum + toTenths(flight.time_in_service_hours)
          : sum;
      }, 0)
    : 0;
  const priorAdjustmentTenths = period.periodStartDate
    ? trackedAdjustments.reduce((sum, adjustment) => {
        const adjustmentDate = dateText(adjustment.effective_date);
        return adjustmentDate < period.periodStartDate
          ? sum + toTenths(adjustment.adjustment_hours)
          : sum;
      }, 0)
    : 0;
  const absolutePeriodAvailable =
    baselineKnown &&
    (!period.periodStartDate || !baselineDate || period.periodStartDate >= baselineDate);
  const openingTenths = absolutePeriodAvailable
    ? toTenths(aircraft.baseline_tis_hours) + priorFlightTenths + priorAdjustmentTenths
    : null;

  return {
    rows: periodFlights.map((flight) => ({
      flight_date: dateText(flight.flight_date),
      departure_location: flight.departure_location || "",
      arrival_location: flight.arrival_location || "",
      pilot: flight.pilot || "",
      utilization_owner: flight.utilization_owner || "",
      flight_time_hours:
        flight.flight_time_hours === null ? null : Number(flight.flight_time_hours),
      time_in_service_hours:
        flight.time_in_service_hours === null ? null : Number(flight.time_in_service_hours),
      accumulated_aircraft_tis: accumulatedByFlight.get(String(flight.flight_id)) ?? null,
      landings: flight.landings === null ? null : Number(flight.landings),
      purpose: flight.purpose || "",
      remarks: flight.remarks || "",
    })),
    openingUtilization: openingTenths === null ? null : fromTenths(openingTenths),
    periodUtilization: fromTenths(periodTenths),
    closingUtilization:
      openingTenths === null ? null : fromTenths(openingTenths + periodTenths),
    trackedUtilization: fromTenths(periodTenths),
  };
}

function safeFilename(registration, periodType, generatedAt) {
  const safeRegistration = String(registration || "aircraft")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "aircraft";
  const timestamp = generatedAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `app-horas_${safeRegistration}_${periodType.toLowerCase()}_${timestamp}.xlsx`;
}

export function createPostgresExportRepository({
  transaction = withPostgresTransaction,
  renderer = renderFlightHistoryWorkbook,
  randomUUID = crypto.randomUUID,
  clock = () => new Date(),
} = {}) {
  return async function generateFlightHistoryExport({ userId, input }) {
    const normalizedUserId = normalizeUuid(userId, "userId", 403);
    const generatedAt = clock();
    const normalized = normalizeFlightHistoryExportInput(input, generatedAt);

    return transaction(
      async (client) => {
        const aircraft = await requireOwnerAccess(
          client,
          normalizedUserId,
          normalized.aircraftId
        );
        const template = await ensureSystemFlightHistoryPreset(client);
        const [flights, adjustments] = await Promise.all([
          loadCurrentFlights(client, normalized.aircraftId),
          loadAircraftAdjustments(client, normalized.aircraftId),
        ]);
        const model = buildFlightHistoryExportModel({
          aircraft,
          flights,
          adjustments,
          period: normalized,
        });
        const summary = {
          registration: aircraft.registration,
          manufacturer: aircraft.manufacturer,
          model: aircraft.model,
          periodType: normalized.periodType,
          periodStartDate: normalized.periodStartDate,
          periodEndDate: normalized.periodEndDate,
          generatedAt: generatedAt.toISOString(),
          ...model,
        };
        const bytes = await renderer({
          locale: normalized.locale,
          summary,
          template,
          rows: model.rows,
        });
        const artifact = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
        const filename = safeFilename(
          aircraft.registration,
          normalized.periodType,
          generatedAt
        );
        const sha256 = crypto.createHash("sha256").update(artifact).digest("hex");
        const exportRunId = randomUUID();

        await client.query(
          `
            INSERT INTO app.export_runs (
              export_run_id, aircraft_id, generated_by_user_id, output_format,
              period_type, period_start_date, period_end_date, locale, status,
              created_at, generated_at, failed_at, failure_code,
              artifact_filename, artifact_sha256, artifact_size_bytes,
              artifact_storage_key, artifact_expires_at, artifact_removed_at
            ) VALUES (
              $1::uuid, $2::uuid, $3::uuid, 'XLSX',
              $4::text, $5::date, $6::date, $7::text, 'COMPLETED',
              $8::timestamptz, $8::timestamptz, NULL, NULL,
              $9::text, $10::text, $11::bigint,
              NULL, NULL, NULL
            )
          `,
          [
            exportRunId,
            normalized.aircraftId,
            normalizedUserId,
            normalized.periodType,
            normalized.periodStartDate,
            normalized.periodEndDate,
            normalized.locale,
            generatedAt.toISOString(),
            filename,
            sha256,
            artifact.length,
          ]
        );
        await client.query(
          `
            INSERT INTO app.export_run_datasets (
              export_run_id, dataset_code, export_template_version_id
            ) VALUES ($1::uuid, $2::text, $3::uuid)
          `,
          [exportRunId, normalized.datasetCode, template.versionId]
        );

        return {
          bytes: artifact,
          filename,
          sha256,
          size: artifact.length,
          exportRunId,
          templateVersionId: template.versionId,
        };
      },
      { isolationLevel: "REPEATABLE READ" }
    );
  };
}

export const generateFlightHistoryExportFromPostgres =
  createPostgresExportRepository();
