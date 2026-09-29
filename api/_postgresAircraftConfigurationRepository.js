import crypto from "node:crypto";

import { withPostgresTransaction } from "./_postgres.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d)?$/;
const PROPULSION_TYPES = new Set([
  "PISTON",
  "TURBOPROP",
  "TURBOJET",
  "TURBOFAN",
  "ELECTRIC",
  "OTHER",
]);
const COMPONENT_TYPES = new Set(["ENGINE", "PROPELLER"]);
const ALLOWED_INPUT_FIELDS = new Set([
  "aircraftId",
  "propulsionType",
  "engineCount",
  "propellerCount",
  "components",
]);
const ALLOWED_COMPONENT_FIELDS = new Set([
  "componentType",
  "positionIndex",
  "manufacturer",
  "model",
  "serialNumber",
  "notes",
  "openingTisHours",
  "installedOn",
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
    throw repositoryError(`${label} no es un UUID valido.`, "INVALID_CANONICAL_ID", 400);
  }
  return normalized;
}

function optionalString(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw repositoryError(`${field} debe ser texto.`, "INVALID_AIRCRAFT_CONFIGURATION", 400);
  }
  return value.trim() || null;
}

function normalizeCount(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 32767) {
    throw repositoryError(
      `${field} debe ser un entero mayor o igual a cero.`,
      "INVALID_AIRCRAFT_TOPOLOGY",
      422
    );
  }
  return value;
}

function normalizeOpeningTisHours(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const raw = String(value).trim();
  if (!DECIMAL_PATTERN.test(raw)) {
    throw repositoryError(
      "openingTisHours debe ser un decimal mayor o igual a cero.",
      "INVALID_AIRCRAFT_CONFIGURATION",
      400
    );
  }
  const normalized = Number(raw);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 999_999_999.9) {
    throw repositoryError(
      "openingTisHours debe ser un decimal mayor o igual a cero.",
      "INVALID_AIRCRAFT_CONFIGURATION",
      400
    );
  }
  return normalized;
}

function normalizeIsoDate(value) {
  const normalized = String(value || "").trim();
  const match = ISO_DATE_PATTERN.exec(normalized);
  if (!match) {
    throw repositoryError(
      "installedOn debe tener formato YYYY-MM-DD.",
      "INVALID_AIRCRAFT_CONFIGURATION",
      400
    );
  }
  const [, year, month, day] = match;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year)
    || parsed.getUTCMonth() + 1 !== Number(month)
    || parsed.getUTCDate() !== Number(day)
  ) {
    throw repositoryError(
      "installedOn no es una fecha valida.",
      "INVALID_AIRCRAFT_CONFIGURATION",
      400
    );
  }
  return normalized;
}

function validateTopology(propulsionType, engineCount, propellerCount) {
  const pistonLike = propulsionType === "PISTON" || propulsionType === "TURBOPROP";
  const jet = propulsionType === "TURBOJET" || propulsionType === "TURBOFAN";
  if (pistonLike && (engineCount < 1 || propellerCount < 1)) {
    throw repositoryError(
      `${propulsionType} requiere al menos un motor y una helice.`,
      "INVALID_AIRCRAFT_TOPOLOGY",
      422
    );
  }
  if (jet && (engineCount < 1 || propellerCount !== 0)) {
    throw repositoryError(
      `${propulsionType} requiere al menos un motor y cero helices.`,
      "INVALID_AIRCRAFT_TOPOLOGY",
      422
    );
  }
}

function normalizeComponent(component) {
  if (!component || typeof component !== "object" || Array.isArray(component)) {
    throw repositoryError(
      "Cada componente debe ser un objeto JSON.",
      "INVALID_AIRCRAFT_CONFIGURATION",
      400
    );
  }
  const unsupported = Object.keys(component).filter(
    (field) => !ALLOWED_COMPONENT_FIELDS.has(field)
  );
  if (unsupported.length > 0) {
    throw repositoryError(
      "El componente contiene campos no soportados.",
      "UNSUPPORTED_AIRCRAFT_CONFIGURATION_FIELDS",
      422
    );
  }
  const componentType = String(component.componentType || "").trim().toUpperCase();
  if (!COMPONENT_TYPES.has(componentType)) {
    throw repositoryError(
      "componentType no tiene un valor permitido.",
      "INVALID_AIRCRAFT_CONFIGURATION",
      400
    );
  }
  const positionIndex = normalizeCount(component.positionIndex, "positionIndex");
  if (positionIndex < 1) {
    throw repositoryError(
      "positionIndex debe ser mayor a cero.",
      "INVALID_AIRCRAFT_CONFIGURATION",
      400
    );
  }
  return {
    componentType,
    positionIndex,
    manufacturer: optionalString(component.manufacturer, "manufacturer"),
    model: optionalString(component.model, "model"),
    serialNumber: optionalString(component.serialNumber, "serialNumber"),
    notes: optionalString(component.notes, "notes"),
    openingTisHours: normalizeOpeningTisHours(component.openingTisHours),
    installedOn: normalizeIsoDate(component.installedOn),
  };
}

function assertComponentPositions(components, componentType, expectedCount) {
  const positions = components
    .filter((component) => component.componentType === componentType)
    .map((component) => component.positionIndex)
    .sort((left, right) => left - right);
  if (
    positions.length !== expectedCount
    || positions.some((position, index) => position !== index + 1)
  ) {
    throw repositoryError(
      `${componentType} debe declarar exactamente las posiciones 1..${expectedCount}.`,
      "INVALID_AIRCRAFT_TOPOLOGY",
      422
    );
  }
}

export function normalizeAircraftConfigurationInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw repositoryError(
      "El payload de configuracion debe ser un objeto JSON.",
      "INVALID_AIRCRAFT_CONFIGURATION",
      400
    );
  }
  const unsupported = Object.keys(input).filter((field) => !ALLOWED_INPUT_FIELDS.has(field));
  if (unsupported.length > 0) {
    throw repositoryError(
      "El payload contiene campos no soportados para la configuracion.",
      "UNSUPPORTED_AIRCRAFT_CONFIGURATION_FIELDS",
      422
    );
  }
  const aircraftId = normalizeUuid(input.aircraftId, "aircraftId");
  const propulsionType = String(input.propulsionType || "").trim().toUpperCase();
  if (!PROPULSION_TYPES.has(propulsionType)) {
    throw repositoryError(
      "propulsionType no tiene un valor permitido.",
      "INVALID_AIRCRAFT_TOPOLOGY",
      422
    );
  }
  const engineCount = normalizeCount(input.engineCount, "engineCount");
  const propellerCount = normalizeCount(input.propellerCount, "propellerCount");
  validateTopology(propulsionType, engineCount, propellerCount);
  if (!Array.isArray(input.components)) {
    throw repositoryError(
      "components debe ser una lista.",
      "INVALID_AIRCRAFT_CONFIGURATION",
      400
    );
  }
  const components = input.components.map(normalizeComponent);
  if (components.length > 0) {
    if (components.length !== engineCount + propellerCount) {
      throw repositoryError(
        "La cantidad de componentes no coincide con la topologia declarada.",
        "INVALID_AIRCRAFT_TOPOLOGY",
        422
      );
    }
    assertComponentPositions(components, "ENGINE", engineCount);
    assertComponentPositions(components, "PROPELLER", propellerCount);
  }
  return { aircraftId, propulsionType, engineCount, propellerCount, components };
}

function assertCreateComponents(input) {
  if (input.components.length !== input.engineCount + input.propellerCount) {
    throw repositoryError(
      "La identidad fisica de todos los componentes es obligatoria para crear la topologia.",
      "AIRCRAFT_COMPONENT_DETAILS_REQUIRED",
      422
    );
  }
  assertComponentPositions(input.components, "ENGINE", input.engineCount);
  assertComponentPositions(input.components, "PROPELLER", input.propellerCount);
}

function mapExistingInstallation(row) {
  return {
    componentInstallationId: row.component_installation_id,
    componentId: row.component_id,
    componentType: row.component_type,
    positionIndex: Number(row.position_index),
    manufacturer: row.manufacturer ?? null,
    model: row.model ?? null,
    serialNumber: row.serial_number ?? null,
    installedOn: row.installed_on instanceof Date
      ? row.installed_on.toISOString().slice(0, 10)
      : String(row.installed_on || "") || null,
    openingTisHours: row.opening_tis_hours === null || row.opening_tis_hours === undefined
      ? null
      : Number(row.opening_tis_hours),
  };
}

function assertExistingTopology(rows, input) {
  if (rows.some((row) => row.component_status !== "ACTIVE")) {
    throw repositoryError(
      "Los componentes existentes no coinciden con una topologia activa valida.",
      "AIRCRAFT_COMPONENT_TOPOLOGY_MISMATCH",
      409
    );
  }
  const installations = rows.map(mapExistingInstallation);
  try {
    assertComponentPositions(installations, "ENGINE", input.engineCount);
    assertComponentPositions(installations, "PROPELLER", input.propellerCount);
  } catch {
    throw repositoryError(
      "Los componentes existentes no coinciden exactamente con la topologia solicitada.",
      "AIRCRAFT_COMPONENT_TOPOLOGY_MISMATCH",
      409
    );
  }
  return installations;
}

export function createPostgresAircraftConfigurationRepository({
  transaction = withPostgresTransaction,
  randomUUID = crypto.randomUUID,
} = {}) {
  return async function setupInitialAircraftConfiguration({ userId, input }) {
    const normalizedUserId = normalizeUuid(userId, "userId");
    const normalizedInput = normalizeAircraftConfigurationInput(input);
    const requestId = randomUUID();

    return transaction(async (client) => {
      const { rows: accessRows } = await client.query(
        `
          SELECT aircraft.aircraft_id
          FROM app.aircraft aircraft
          JOIN app.aircraft_memberships membership
            ON membership.aircraft_id = aircraft.aircraft_id
          JOIN app.users user_account
            ON user_account.user_id = membership.user_id
          WHERE aircraft.aircraft_id = $1::uuid
            AND membership.user_id = $2::uuid
            AND membership.role = 'OWNER'
            AND membership.status = 'ACTIVE'
            AND user_account.status = 'ACTIVE'
            AND aircraft.status = 'ACTIVE'
          FOR UPDATE OF aircraft
        `,
        [normalizedInput.aircraftId, normalizedUserId]
      );
      if (!accessRows[0]) {
        throw repositoryError(
          "Solo un OWNER activo puede configurar la aeronave.",
          "AIRCRAFT_CONFIGURATION_ACCESS_DENIED",
          403
        );
      }

      const { rows: existingRows } = await client.query(
        `
          SELECT aircraft_id
          FROM app.aircraft_configuration
          WHERE aircraft_id = $1::uuid
          LIMIT 1
        `,
        [normalizedInput.aircraftId]
      );
      if (existingRows[0]) {
        throw repositoryError(
          "La configuracion inicial de la aeronave ya existe.",
          "AIRCRAFT_CONFIGURATION_ALREADY_EXISTS",
          409
        );
      }

      const { rows: existingInstallationRows } = await client.query(
        `
          SELECT
            installation.component_installation_id,
            installation.component_id,
            component.component_type,
            installation.position_index,
            component.manufacturer,
            component.model,
            component.serial_number,
            installation.installed_on,
            installation.opening_tis_hours,
            component.status AS component_status
          FROM app.component_installations installation
          JOIN app.components component
            ON component.component_id = installation.component_id
          WHERE installation.aircraft_id = $1::uuid
            AND installation.removed_on IS NULL
            AND component.component_type IN ('ENGINE', 'PROPELLER')
          ORDER BY component.component_type, installation.position_index
          FOR UPDATE OF installation, component
        `,
        [normalizedInput.aircraftId]
      );

      const bootstrapMode = existingInstallationRows.length > 0
        ? "ADOPT_EXISTING"
        : "CREATE_COMPONENTS";
      let installations;
      if (bootstrapMode === "ADOPT_EXISTING") {
        installations = assertExistingTopology(existingInstallationRows, normalizedInput);
      } else {
        assertCreateComponents(normalizedInput);
        installations = [];
      }

      await client.query(
        `
          INSERT INTO app.aircraft_configuration (
            aircraft_id, propulsion_type, engine_count, propeller_count,
            created_at, updated_at
          ) VALUES (
            $1::uuid, $2::text, $3::smallint, $4::smallint,
            transaction_timestamp(), transaction_timestamp()
          )
        `,
        [
          normalizedInput.aircraftId,
          normalizedInput.propulsionType,
          normalizedInput.engineCount,
          normalizedInput.propellerCount,
        ]
      );

      for (const component of bootstrapMode === "CREATE_COMPONENTS"
        ? normalizedInput.components
        : []) {
        const componentId = randomUUID();
        const componentInstallationId = randomUUID();
        await client.query(
          `
            INSERT INTO app.components (
              component_id, component_type, manufacturer, model,
              serial_number, status, notes, created_at, updated_at
            ) VALUES (
              $1::uuid, $2::text, $3::text, $4::text,
              $5::text, 'ACTIVE', $6::text,
              transaction_timestamp(), transaction_timestamp()
            )
          `,
          [
            componentId,
            component.componentType,
            component.manufacturer,
            component.model,
            component.serialNumber,
            component.notes,
          ]
        );
        await client.query(
          `
            INSERT INTO app.component_installations (
              component_installation_id, component_id, aircraft_id,
              position_index, installed_on, removed_on, opening_tis_hours,
              first_applicable_flight_id, last_applicable_flight_id,
              created_by_user_id, created_at, updated_at
            ) VALUES (
              $1::uuid, $2::uuid, $3::uuid,
              $4::smallint, $5::date, NULL, $6::numeric,
              NULL, NULL,
              $7::uuid, transaction_timestamp(), transaction_timestamp()
            )
          `,
          [
            componentInstallationId,
            componentId,
            normalizedInput.aircraftId,
            component.positionIndex,
            component.installedOn,
            component.openingTisHours,
            normalizedUserId,
          ]
        );
        installations.push({
          componentInstallationId,
          componentId,
          componentType: component.componentType,
          positionIndex: component.positionIndex,
          manufacturer: component.manufacturer,
          model: component.model,
          serialNumber: component.serialNumber,
          installedOn: component.installedOn,
          openingTisHours: component.openingTisHours,
        });
      }

      const configuration = {
        propulsionType: normalizedInput.propulsionType,
        engineCount: normalizedInput.engineCount,
        propellerCount: normalizedInput.propellerCount,
      };
      await client.query(
        `
          INSERT INTO audit.audit_events (
            audit_event_id, occurred_at, request_id,
            actor_type, actor_user_id, operation_source,
            aircraft_id, entity_type, entity_id, entity_key,
            action_code, before_state, after_state, reason, metadata, payload_version
          ) VALUES (
            $1::uuid, transaction_timestamp(), $2::uuid,
            'USER', $3::uuid, 'MANUAL',
            $4::uuid, 'AIRCRAFT_CONFIGURATION', $4::uuid,
            jsonb_build_object('aircraft_id', $4::uuid),
            'AIRCRAFT_CONFIGURATION_CREATED', NULL, $5::jsonb,
            'Initial aircraft topology and component installations configured.',
            $6::jsonb, 1
          )
        `,
        [
          randomUUID(),
          requestId,
          normalizedUserId,
          normalizedInput.aircraftId,
          JSON.stringify({ topology: configuration, installations }),
          JSON.stringify({ bootstrap_mode: bootstrapMode }),
        ]
      );

      return {
        ok: true,
        aircraftId: normalizedInput.aircraftId,
        bootstrapMode,
        configurationConfigured: true,
        configuration,
        componentInstallations: installations,
      };
    }, { isolationLevel: "SERIALIZABLE" });
  };
}

export const setupInitialAircraftConfigurationInPostgres =
  createPostgresAircraftConfigurationRepository();
