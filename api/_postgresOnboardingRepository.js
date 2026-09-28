import crypto from "node:crypto";

import { withPostgresTransaction } from "./_postgres.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d)?$/;
const CAPTURE_METHODS = new Set(["DIRECT", "TACHOMETER", "CLOCK"]);
const OIL_UNITS = new Set(["LITER", "US_QUART"]);
const ALLOWED_INPUT_FIELDS = new Set([
  "registration",
  "manufacturer",
  "model",
  "serialNumber",
  "countryCode",
  "openingTisHours",
  "baselineEffectiveDate",
  "defaultCaptureMethod",
  "defaultOilUnit",
]);

function repositoryError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeUuid(value, label) {
  const normalized = String(value || "").trim();

  if (!UUID_PATTERN.test(normalized)) {
    throw repositoryError(
      `${label} no es un UUID valido.`,
      "INVALID_CANONICAL_ID",
      403
    );
  }

  return normalized;
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw repositoryError(
      `${field} es obligatorio.`,
      "INVALID_ONBOARDING_INPUT",
      400
    );
  }

  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw repositoryError(
      `${field} debe ser texto.`,
      "INVALID_ONBOARDING_INPUT",
      400
    );
  }

  return value.trim() || null;
}

function normalizeCountryCode(value) {
  const countryCode = optionalString(value, "countryCode");

  if (countryCode === null) {
    return null;
  }

  const normalized = countryCode.toUpperCase();

  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw repositoryError(
      "countryCode debe ser un codigo ISO de dos letras.",
      "INVALID_ONBOARDING_INPUT",
      400
    );
  }

  return normalized;
}

function normalizeOpeningTisHours(value) {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    (typeof value === "string" && !value.trim())
  ) {
    return null;
  }

  if (typeof value !== "number" && typeof value !== "string") {
    throw repositoryError(
      "openingTisHours debe ser un decimal mayor o igual a cero.",
      "INVALID_ONBOARDING_INPUT",
      400
    );
  }

  const rawValue = String(value).trim();

  if (!DECIMAL_PATTERN.test(rawValue)) {
    throw repositoryError(
      "openingTisHours debe ser un decimal mayor o igual a cero.",
      "INVALID_ONBOARDING_INPUT",
      400
    );
  }

  const numberValue = Number(rawValue);

  if (
    !Number.isFinite(numberValue) ||
    numberValue < 0 ||
    numberValue > 999_999_999.9
  ) {
    throw repositoryError(
      "openingTisHours debe ser un decimal mayor o igual a cero.",
      "INVALID_ONBOARDING_INPUT",
      400
    );
  }

  return numberValue;
}

function normalizeIsoDate(value) {
  const normalized = requireNonEmptyString(value, "baselineEffectiveDate");
  const match = ISO_DATE_PATTERN.exec(normalized);

  if (!match) {
    throw repositoryError(
      "baselineEffectiveDate debe tener formato YYYY-MM-DD.",
      "INVALID_ONBOARDING_INPUT",
      400
    );
  }

  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() + 1 !== Number(month) ||
    parsed.getUTCDate() !== Number(day)
  ) {
    throw repositoryError(
      "baselineEffectiveDate no es una fecha valida.",
      "INVALID_ONBOARDING_INPUT",
      400
    );
  }

  return normalized;
}

function normalizeEnum(value, defaultValue, allowedValues, field) {
  const normalized =
    value === undefined ||
    value === null ||
    value === "" ||
    (typeof value === "string" && !value.trim())
    ? defaultValue
    : requireNonEmptyString(value, field).toUpperCase();

  if (!allowedValues.has(normalized)) {
    throw repositoryError(
      `${field} no tiene un valor permitido.`,
      "INVALID_ONBOARDING_BUSINESS_PAYLOAD",
      422
    );
  }

  return normalized;
}

export function normalizeAircraftOnboardingInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw repositoryError(
      "El payload de onboarding debe ser un objeto JSON.",
      "INVALID_ONBOARDING_INPUT",
      400
    );
  }

  const unsupportedFields = Object.keys(input).filter(
    (field) => !ALLOWED_INPUT_FIELDS.has(field)
  );

  if (unsupportedFields.length > 0) {
    throw repositoryError(
      "El payload contiene campos no soportados para el onboarding canonico.",
      "UNSUPPORTED_ONBOARDING_FIELDS",
      422
    );
  }

  return {
    registration: requireNonEmptyString(input.registration, "registration").toUpperCase(),
    manufacturer: requireNonEmptyString(input.manufacturer, "manufacturer"),
    model: requireNonEmptyString(input.model, "model"),
    serialNumber: optionalString(input.serialNumber, "serialNumber"),
    countryCode: normalizeCountryCode(input.countryCode),
    openingTisHours: normalizeOpeningTisHours(input.openingTisHours),
    baselineEffectiveDate: normalizeIsoDate(input.baselineEffectiveDate),
    defaultCaptureMethod: normalizeEnum(
      input.defaultCaptureMethod,
      "DIRECT",
      CAPTURE_METHODS,
      "defaultCaptureMethod"
    ),
    defaultOilUnit: normalizeEnum(
      input.defaultOilUnit,
      "US_QUART",
      OIL_UNITS,
      "defaultOilUnit"
    ),
  };
}

function possibleDuplicateError() {
  return repositoryError(
    "La aeronave podria estar registrada previamente.",
    "AIRCRAFT_POSSIBLE_DUPLICATE",
    409
  );
}

export function createPostgresOnboardingRepository({
  transaction = withPostgresTransaction,
  randomUUID = crypto.randomUUID,
} = {}) {
  return async function createAircraftOnboarding({ userId, input }) {
    const normalizedUserId = normalizeUuid(userId, "userId");
    const normalizedInput = normalizeAircraftOnboardingInput(input);
    const aircraftId = randomUUID();
    const membershipId = randomUUID();
    const requestId = randomUUID();

    return transaction(
      async (client) => {
        const { rows: userRows } = await client.query(
          `
            SELECT user_id, status
            FROM app.users
            WHERE user_id = $1::uuid
            LIMIT 1
          `,
          [normalizedUserId]
        );
        const user = userRows[0];

        if (!user || user.status !== "ACTIVE") {
          throw repositoryError(
            "El usuario no esta habilitado para crear aeronaves.",
            "USER_NOT_AUTHORIZED",
            403
          );
        }

        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext($1))",
          [`app-horas:aircraft-registration:${normalizedInput.registration}`]
        );

        const { rows: duplicateRows } = await client.query(
          `
            SELECT
              EXISTS (
                SELECT 1
                FROM app.aircraft_registrations registration
                WHERE registration.effective_to_at IS NULL
                  AND lower(btrim(registration.registration)) = lower(btrim($1::text))
              ) AS registration_duplicate,
              CASE
                WHEN $2::text IS NULL THEN false
                ELSE EXISTS (
                  SELECT 1
                  FROM app.aircraft aircraft
                  WHERE aircraft.serial_number IS NOT NULL
                    AND lower(btrim(aircraft.manufacturer)) = lower(btrim($3::text))
                    AND lower(btrim(aircraft.serial_number)) = lower(btrim($2::text))
                )
              END AS serial_duplicate
          `,
          [
            normalizedInput.registration,
            normalizedInput.serialNumber,
            normalizedInput.manufacturer,
          ]
        );
        const duplicate = duplicateRows[0];

        if (duplicate?.registration_duplicate || duplicate?.serial_duplicate) {
          throw possibleDuplicateError();
        }

        await client.query(
          `
            INSERT INTO app.aircraft (
              aircraft_id, manufacturer, model, serial_number, status,
              created_by_user_id, created_at, updated_at
            ) VALUES (
              $1::uuid, $2::text, $3::text, $4::text, 'ACTIVE',
              $5::uuid, transaction_timestamp(), transaction_timestamp()
            )
          `,
          [
            aircraftId,
            normalizedInput.manufacturer,
            normalizedInput.model,
            normalizedInput.serialNumber,
            normalizedUserId,
          ]
        );

        await client.query(
          `
            INSERT INTO app.aircraft_registrations (
              aircraft_id, registration, country_code,
              effective_from_at, effective_to_at, created_at
            ) VALUES (
              $1::uuid, $2::text, $3::char(2),
              transaction_timestamp(), NULL, transaction_timestamp()
            )
          `,
          [aircraftId, normalizedInput.registration, normalizedInput.countryCode]
        );

        await client.query(
          `
            INSERT INTO app.aircraft_memberships (
              membership_id, aircraft_id, user_id, invited_email, role, status,
              invited_by_user_id, invited_at, activated_at,
              revoked_at, revoked_by_user_id, created_at, updated_at
            ) VALUES (
              $1::uuid, $2::uuid, $3::uuid, NULL, 'OWNER', 'ACTIVE',
              NULL, NULL, transaction_timestamp(),
              NULL, NULL, transaction_timestamp(), transaction_timestamp()
            )
          `,
          [membershipId, aircraftId, normalizedUserId]
        );

        await client.query(
          `
            INSERT INTO app.aircraft_membership_capabilities (
              membership_id, capability, granted_by_user_id, granted_at,
              revoked_by_user_id, revoked_at
            ) VALUES (
              $1::uuid, 'MANAGE_OWNERSHIP', $2::uuid, transaction_timestamp(),
              NULL, NULL
            )
          `,
          [membershipId, normalizedUserId]
        );

        await client.query(
          `
            INSERT INTO app.aircraft_settings (
              aircraft_id, default_capture_method, default_oil_unit,
              capture_engine_runtime, created_at, updated_at
            ) VALUES (
              $1::uuid, $2::text, $3::text,
              false, transaction_timestamp(), transaction_timestamp()
            )
          `,
          [
            aircraftId,
            normalizedInput.defaultCaptureMethod,
            normalizedInput.defaultOilUnit,
          ]
        );

        await client.query(
          `
            INSERT INTO app.aircraft_utilization_baselines (
              aircraft_id, baseline_tis_hours, baseline_effective_date,
              first_tracked_flight_id, source, notes,
              created_by_user_id, created_at, updated_at
            ) VALUES (
              $1::uuid, $2::numeric(10,1), $3::date,
              NULL, 'OWNER_ENTRY', NULL,
              $4::uuid, transaction_timestamp(), transaction_timestamp()
            )
          `,
          [
            aircraftId,
            normalizedInput.openingTisHours,
            normalizedInput.baselineEffectiveDate,
            normalizedUserId,
          ]
        );

        const createdState = {
          aircraft_id: aircraftId,
          registration: normalizedInput.registration,
          manufacturer: normalizedInput.manufacturer,
          model: normalizedInput.model,
          serial_number: normalizedInput.serialNumber,
          country_code: normalizedInput.countryCode,
          status: "ACTIVE",
          membership: {
            membership_id: membershipId,
            user_id: normalizedUserId,
            role: "OWNER",
            status: "ACTIVE",
            capabilities: ["MANAGE_OWNERSHIP"],
          },
          settings: {
            default_capture_method: normalizedInput.defaultCaptureMethod,
            default_oil_unit: normalizedInput.defaultOilUnit,
            capture_engine_runtime: false,
          },
          utilization_baseline: {
            baseline_tis_hours: normalizedInput.openingTisHours,
            baseline_effective_date: normalizedInput.baselineEffectiveDate,
            first_tracked_flight_id: null,
            source: "OWNER_ENTRY",
          },
          ownership_configured: false,
          flight_writes_ready: false,
        };

        await client.query(
          `
            INSERT INTO audit.audit_events (
              request_id, actor_type, actor_user_id, operation_source,
              aircraft_id, entity_type, entity_id, entity_key,
              action_code, before_state, after_state, reason, metadata,
              payload_version
            ) VALUES (
              $1::uuid, 'USER', $2::uuid, 'MANUAL',
              $3::uuid, 'AIRCRAFT', $3::uuid, $4::jsonb,
              'AIRCRAFT_CREATED', NULL, $5::jsonb,
              'Canonical self-service aircraft onboarding', $6::jsonb,
              1
            )
          `,
          [
            requestId,
            normalizedUserId,
            aircraftId,
            JSON.stringify({
              aircraft_id: aircraftId,
              registration: normalizedInput.registration,
            }),
            JSON.stringify(createdState),
            JSON.stringify({
              contracts: ["D-242", "D-244", "D-245"],
              onboarding_mode: "ATOMIC_AIRCRAFT_BOOTSTRAP",
            }),
          ]
        );

        return {
          ok: true,
          aircraft: {
            aircraft_id: aircraftId,
            matricula: normalizedInput.registration,
            fabricante: normalizedInput.manufacturer,
            modelo: normalizedInput.model,
            rol: "OWNER",
          },
          onboarding: {
            ownershipConfigured: false,
            flightWritesReady: false,
          },
        };
      },
      { isolationLevel: "SERIALIZABLE" }
    );
  };
}

export const createAircraftOnboardingInPostgres =
  createPostgresOnboardingRepository();
