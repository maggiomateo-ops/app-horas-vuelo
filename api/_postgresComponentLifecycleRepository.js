import crypto from "node:crypto";

import { withPostgresTransaction } from "./_postgres.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^\d+(?:\.\d)?$/;
const COMPONENT_TYPES = new Set(["ENGINE", "PROPELLER"]);
const ACTIONS = Object.freeze({
  INSTALL: "install-component",
  REMOVE: "remove-component",
  REPLACE: "replace-component",
});

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

function normalizeIsoDate(value, label) {
  const normalized = String(value || "").trim();
  const match = ISO_DATE_PATTERN.exec(normalized);
  if (!match) {
    throw repositoryError(
      `${label} debe tener formato YYYY-MM-DD.`,
      "INVALID_COMPONENT_LIFECYCLE_INPUT",
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
      `${label} no es una fecha valida.`,
      "INVALID_COMPONENT_LIFECYCLE_INPUT",
      400
    );
  }
  return normalized;
}

function normalizeComponentType(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!COMPONENT_TYPES.has(normalized)) {
    throw repositoryError(
      "componentType debe ser ENGINE o PROPELLER.",
      "INVALID_COMPONENT_LIFECYCLE_INPUT",
      400
    );
  }
  return normalized;
}

function normalizePosition(value) {
  if (!Number.isInteger(value) || value < 1 || value > 32767) {
    throw repositoryError(
      "positionIndex debe ser un entero mayor a cero.",
      "INVALID_COMPONENT_LIFECYCLE_INPUT",
      400
    );
  }
  return value;
}

function optionalString(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw repositoryError(
      `${field} debe ser texto.`,
      "INVALID_COMPONENT_LIFECYCLE_INPUT",
      400
    );
  }
  return value.trim() || null;
}

function normalizeOpeningTisHours(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const raw = String(value).trim();
  if (!DECIMAL_PATTERN.test(raw)) {
    throw repositoryError(
      "openingTisHours debe ser un decimal mayor o igual a cero.",
      "INVALID_COMPONENT_LIFECYCLE_INPUT",
      400
    );
  }
  const normalized = Number(raw);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 999_999_999.9) {
    throw repositoryError(
      "openingTisHours debe ser un decimal mayor o igual a cero.",
      "INVALID_COMPONENT_LIFECYCLE_INPUT",
      400
    );
  }
  return normalized;
}

function assertExactFields(input, allowedFields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw repositoryError(
      "El payload del componente debe ser un objeto JSON.",
      "INVALID_COMPONENT_LIFECYCLE_INPUT",
      400
    );
  }
  const unsupported = Object.keys(input).filter((field) => !allowedFields.has(field));
  if (unsupported.length > 0) {
    throw repositoryError(
      "El payload contiene campos no soportados.",
      "UNSUPPORTED_COMPONENT_LIFECYCLE_FIELDS",
      422
    );
  }
}

function normalizePhysicalComponent(input) {
  assertExactFields(input, new Set([
    "manufacturer",
    "model",
    "serialNumber",
    "notes",
    "openingTisHours",
  ]));
  return {
    manufacturer: optionalString(input.manufacturer, "manufacturer"),
    model: optionalString(input.model, "model"),
    serialNumber: optionalString(input.serialNumber, "serialNumber"),
    notes: optionalString(input.notes, "notes"),
    openingTisHours: normalizeOpeningTisHours(input.openingTisHours),
  };
}

export function normalizeComponentLifecycleInput(action, input) {
  const normalizedAction = String(action || "").trim();
  if (normalizedAction === ACTIONS.INSTALL) {
    assertExactFields(input, new Set([
      "aircraftId",
      "componentType",
      "positionIndex",
      "installedOn",
      "manufacturer",
      "model",
      "serialNumber",
      "notes",
      "openingTisHours",
    ]));
    return {
      aircraftId: normalizeUuid(input.aircraftId, "aircraftId"),
      componentType: normalizeComponentType(input.componentType),
      positionIndex: normalizePosition(input.positionIndex),
      installedOn: normalizeIsoDate(input.installedOn, "installedOn"),
      ...normalizePhysicalComponent({
        manufacturer: input.manufacturer,
        model: input.model,
        serialNumber: input.serialNumber,
        notes: input.notes,
        openingTisHours: input.openingTisHours,
      }),
    };
  }

  if (normalizedAction === ACTIONS.REMOVE) {
    assertExactFields(input, new Set([
      "aircraftId",
      "componentInstallationId",
      "removedOn",
    ]));
    return {
      aircraftId: normalizeUuid(input.aircraftId, "aircraftId"),
      componentInstallationId: normalizeUuid(
        input.componentInstallationId,
        "componentInstallationId"
      ),
      removedOn: normalizeIsoDate(input.removedOn, "removedOn"),
    };
  }

  if (normalizedAction === ACTIONS.REPLACE) {
    assertExactFields(input, new Set([
      "aircraftId",
      "oldComponentInstallationId",
      "effectiveDate",
      "newComponent",
    ]));
    return {
      aircraftId: normalizeUuid(input.aircraftId, "aircraftId"),
      oldComponentInstallationId: normalizeUuid(
        input.oldComponentInstallationId,
        "oldComponentInstallationId"
      ),
      effectiveDate: normalizeIsoDate(input.effectiveDate, "effectiveDate"),
      newComponent: normalizePhysicalComponent(input.newComponent),
    };
  }

  throw repositoryError(
    "Accion de ciclo de vida no soportada.",
    "UNSUPPORTED_COMPONENT_LIFECYCLE_ACTION",
    400
  );
}

function mapInstallation(row) {
  return {
    componentInstallationId: row.component_installation_id,
    componentId: row.component_id,
    componentType: row.component_type,
    positionIndex: Number(row.position_index),
    manufacturer: row.manufacturer ?? null,
    model: row.model ?? null,
    serialNumber: row.serial_number ?? null,
    notes: row.notes ?? null,
    status: row.component_status,
    installedOn: row.installed_on instanceof Date
      ? row.installed_on.toISOString().slice(0, 10)
      : row.installed_on ?? null,
    removedOn: row.removed_on instanceof Date
      ? row.removed_on.toISOString().slice(0, 10)
      : row.removed_on ?? null,
    openingTisHours: row.opening_tis_hours === null || row.opening_tis_hours === undefined
      ? null
      : Number(row.opening_tis_hours),
    firstApplicableFlightId: row.first_applicable_flight_id ?? null,
    lastApplicableFlightId: row.last_applicable_flight_id ?? null,
  };
}

async function lockOwnerAndConfiguration(client, userId, aircraftId) {
  // D-278 concurrency guard: component_type remains normalized in app.components,
  // so every supported writer serializes on the aircraft row before checking a
  // position. SERIALIZABLE then prevents a stale predicate from committing.
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
    [aircraftId, userId]
  );
  if (!accessRows[0]) {
    throw repositoryError(
      "Solo un OWNER activo puede gestionar componentes.",
      "COMPONENT_LIFECYCLE_ACCESS_DENIED",
      403
    );
  }

  const { rows: configurationRows } = await client.query(
    `
      SELECT aircraft_id, engine_count, propeller_count
      FROM app.aircraft_configuration
      WHERE aircraft_id = $1::uuid
      FOR UPDATE
    `,
    [aircraftId]
  );
  if (!configurationRows[0]) {
    throw repositoryError(
      "La aeronave no tiene una configuracion inicial.",
      "AIRCRAFT_CONFIGURATION_REQUIRED",
      409
    );
  }
  return configurationRows[0];
}

function assertPositionWithinConfiguration(configuration, componentType, positionIndex) {
  const limit = Number(
    componentType === "ENGINE"
      ? configuration.engine_count
      : configuration.propeller_count
  );
  if (positionIndex > limit) {
    throw repositoryError(
      "La posicion no existe en la configuracion de la aeronave.",
      "COMPONENT_POSITION_OUT_OF_RANGE",
      422
    );
  }
}

async function lockActivePosition(client, aircraftId, componentType, positionIndex) {
  const { rows } = await client.query(
    `
      SELECT
        installation.component_installation_id,
        installation.component_id,
        component.component_type,
        installation.position_index,
        component.manufacturer,
        component.model,
        component.serial_number,
        component.notes,
        component.status AS component_status,
        installation.installed_on,
        installation.removed_on,
        installation.opening_tis_hours,
        installation.first_applicable_flight_id,
        installation.last_applicable_flight_id
      FROM app.component_installations installation
      JOIN app.components component
        ON component.component_id = installation.component_id
      WHERE installation.aircraft_id = $1::uuid
        AND component.component_type = $2::text
        AND installation.position_index = $3::smallint
        AND installation.removed_on IS NULL
      FOR UPDATE OF installation, component
    `,
    [aircraftId, componentType, positionIndex]
  );
  if (rows.length > 1) {
    throw repositoryError(
      "La posicion contiene mas de una instalacion activa.",
      "COMPONENT_POSITION_INTEGRITY_ERROR",
      409
    );
  }
  return rows[0] || null;
}

async function lockInstallation(client, aircraftId, componentInstallationId) {
  const { rows } = await client.query(
    `
      SELECT
        installation.component_installation_id,
        installation.component_id,
        component.component_type,
        installation.position_index,
        component.manufacturer,
        component.model,
        component.serial_number,
        component.notes,
        component.status AS component_status,
        installation.installed_on,
        installation.removed_on,
        installation.opening_tis_hours,
        installation.first_applicable_flight_id,
        installation.last_applicable_flight_id
      FROM app.component_installations installation
      JOIN app.components component
        ON component.component_id = installation.component_id
      WHERE installation.aircraft_id = $1::uuid
        AND installation.component_installation_id = $2::uuid
      LIMIT 1
      FOR UPDATE OF installation, component
    `,
    [aircraftId, componentInstallationId]
  );
  const row = rows[0];
  if (!row || row.removed_on !== null) {
    throw repositoryError(
      "La instalacion activa solicitada no existe.",
      "ACTIVE_COMPONENT_INSTALLATION_NOT_FOUND",
      409
    );
  }
  return row;
}

async function findBoundaryFlight(client, aircraftId, effectiveDate, direction) {
  const first = direction === "FIRST";
  const comparator = first ? ">=" : "<";
  const order = first ? "ASC" : "DESC";
  const { rows } = await client.query(
    `
      SELECT flight.flight_id
      FROM app.flight_records flight
      JOIN app.flight_record_revisions revision
        ON revision.flight_id = flight.flight_id
       AND revision.flight_revision_id = flight.current_revision_id
      WHERE flight.aircraft_id = $1::uuid
        AND flight.status = 'ACTIVE'
        AND revision.flight_date ${comparator} $2::date
      ORDER BY revision.flight_date ${order}, flight.created_at ${order}, flight.flight_id ${order}
      LIMIT 1
    `,
    [aircraftId, effectiveDate]
  );
  return rows[0]?.flight_id ?? null;
}

async function insertPhysicalComponent(client, values, componentType, componentId) {
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
      componentType,
      values.manufacturer,
      values.model,
      values.serialNumber,
      values.notes,
    ]
  );
}

async function insertInstallation(
  client,
  { componentInstallationId, componentId, aircraftId, positionIndex, installedOn,
    openingTisHours, firstApplicableFlightId, userId }
) {
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
        $7::uuid, NULL,
        $8::uuid, transaction_timestamp(), transaction_timestamp()
      )
    `,
    [
      componentInstallationId,
      componentId,
      aircraftId,
      positionIndex,
      installedOn,
      openingTisHours,
      firstApplicableFlightId,
      userId,
    ]
  );
}

async function closeInstallation(client, componentInstallationId, removedOn, lastFlightId) {
  await client.query(
    `
      UPDATE app.component_installations
      SET removed_on = $2::date,
          last_applicable_flight_id = $3::uuid,
          updated_at = transaction_timestamp()
      WHERE component_installation_id = $1::uuid
        AND removed_on IS NULL
    `,
    [componentInstallationId, removedOn, lastFlightId]
  );
}

async function archiveComponentIfUnused(client, componentId) {
  const { rows } = await client.query(
    `
      UPDATE app.components component
      SET status = 'ARCHIVED', updated_at = transaction_timestamp()
      WHERE component.component_id = $1::uuid
        AND NOT EXISTS (
          SELECT 1
          FROM app.component_installations installation
          WHERE installation.component_id = component.component_id
            AND installation.removed_on IS NULL
        )
      RETURNING component.status
    `,
    [componentId]
  );
  return rows[0]?.status === "ARCHIVED";
}

async function writeAudit(
  client,
  { auditEventId, requestId, userId, aircraftId, entityId, actionCode,
    beforeState, afterState }
) {
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
        $4::uuid, 'COMPONENT_INSTALLATION', $5::uuid,
        jsonb_build_object('component_installation_id', $5::uuid),
        $6::text, $7::jsonb, $8::jsonb,
        'Owner-managed physical component lifecycle.', '{}'::jsonb, 1
      )
    `,
    [
      auditEventId,
      requestId,
      userId,
      aircraftId,
      entityId,
      actionCode,
      beforeState === null ? null : JSON.stringify(beforeState),
      JSON.stringify(afterState),
    ]
  );
}

export function createPostgresComponentLifecycleRepository({
  transaction = withPostgresTransaction,
  randomUUID = crypto.randomUUID,
} = {}) {
  return async function mutateComponentLifecycle({ userId, action, input }) {
    const normalizedUserId = normalizeUuid(userId, "userId");
    const normalizedAction = String(action || "").trim();
    const normalizedInput = normalizeComponentLifecycleInput(normalizedAction, input);
    const requestId = randomUUID();

    return transaction(async (client) => {
      const configuration = await lockOwnerAndConfiguration(
        client,
        normalizedUserId,
        normalizedInput.aircraftId
      );

      if (normalizedAction === ACTIONS.INSTALL) {
        assertPositionWithinConfiguration(
          configuration,
          normalizedInput.componentType,
          normalizedInput.positionIndex
        );
        const occupied = await lockActivePosition(
          client,
          normalizedInput.aircraftId,
          normalizedInput.componentType,
          normalizedInput.positionIndex
        );
        if (occupied) {
          throw repositoryError(
            "La posicion ya tiene un componente instalado.",
            "COMPONENT_POSITION_OCCUPIED",
            409
          );
        }

        const firstApplicableFlightId = await findBoundaryFlight(
          client,
          normalizedInput.aircraftId,
          normalizedInput.installedOn,
          "FIRST"
        );
        const componentId = randomUUID();
        const componentInstallationId = randomUUID();
        await insertPhysicalComponent(
          client,
          normalizedInput,
          normalizedInput.componentType,
          componentId
        );
        await insertInstallation(client, {
          componentInstallationId,
          componentId,
          aircraftId: normalizedInput.aircraftId,
          positionIndex: normalizedInput.positionIndex,
          installedOn: normalizedInput.installedOn,
          openingTisHours: normalizedInput.openingTisHours,
          firstApplicableFlightId,
          userId: normalizedUserId,
        });
        const installation = {
          componentInstallationId,
          componentId,
          componentType: normalizedInput.componentType,
          positionIndex: normalizedInput.positionIndex,
          manufacturer: normalizedInput.manufacturer,
          model: normalizedInput.model,
          serialNumber: normalizedInput.serialNumber,
          notes: normalizedInput.notes,
          status: "ACTIVE",
          installedOn: normalizedInput.installedOn,
          removedOn: null,
          openingTisHours: normalizedInput.openingTisHours,
          firstApplicableFlightId,
          lastApplicableFlightId: null,
        };
        await writeAudit(client, {
          auditEventId: randomUUID(),
          requestId,
          userId: normalizedUserId,
          aircraftId: normalizedInput.aircraftId,
          entityId: componentInstallationId,
          actionCode: "COMPONENT_INSTALLED",
          beforeState: null,
          afterState: {
            aircraftId: normalizedInput.aircraftId,
            componentType: normalizedInput.componentType,
            positionIndex: normalizedInput.positionIndex,
            newInstallation: installation,
          },
        });
        return { ok: true, action: normalizedAction, installation };
      }

      const installationId = normalizedAction === ACTIONS.REMOVE
        ? normalizedInput.componentInstallationId
        : normalizedInput.oldComponentInstallationId;
      const currentRow = await lockInstallation(
        client,
        normalizedInput.aircraftId,
        installationId
      );
      assertPositionWithinConfiguration(
        configuration,
        currentRow.component_type,
        Number(currentRow.position_index)
      );
      const onlyActivePosition = await lockActivePosition(
        client,
        normalizedInput.aircraftId,
        currentRow.component_type,
        Number(currentRow.position_index)
      );
      if (
        !onlyActivePosition
        || onlyActivePosition.component_installation_id !== installationId
      ) {
        throw repositoryError(
          "La posicion no tiene exactamente la instalacion activa solicitada.",
          "COMPONENT_POSITION_INTEGRITY_ERROR",
          409
        );
      }
      const current = mapInstallation(currentRow);
      const effectiveDate = normalizedAction === ACTIONS.REMOVE
        ? normalizedInput.removedOn
        : normalizedInput.effectiveDate;
      if (current.installedOn && effectiveDate < current.installedOn) {
        throw repositoryError(
          "La fecha efectiva no puede ser anterior a la instalacion.",
          "INVALID_COMPONENT_LIFECYCLE_DATE",
          422
        );
      }
      const lastApplicableFlightId = await findBoundaryFlight(
        client,
        normalizedInput.aircraftId,
        effectiveDate,
        "LAST"
      );
      await closeInstallation(client, installationId, effectiveDate, lastApplicableFlightId);

      const closed = {
        ...current,
        removedOn: effectiveDate,
        lastApplicableFlightId,
      };

      if (normalizedAction === ACTIONS.REMOVE) {
        const archived = await archiveComponentIfUnused(client, current.componentId);
        closed.status = archived ? "ARCHIVED" : closed.status;
        await writeAudit(client, {
          auditEventId: randomUUID(),
          requestId,
          userId: normalizedUserId,
          aircraftId: normalizedInput.aircraftId,
          entityId: installationId,
          actionCode: "COMPONENT_REMOVED",
          beforeState: {
            aircraftId: normalizedInput.aircraftId,
            componentType: current.componentType,
            positionIndex: current.positionIndex,
            installation: current,
          },
          afterState: {
            aircraftId: normalizedInput.aircraftId,
            componentType: current.componentType,
            positionIndex: current.positionIndex,
            installation: closed,
          },
        });
        return { ok: true, action: normalizedAction, installation: closed };
      }

      const firstApplicableFlightId = await findBoundaryFlight(
        client,
        normalizedInput.aircraftId,
        effectiveDate,
        "FIRST"
      );
      const newComponentId = randomUUID();
      const newComponentInstallationId = randomUUID();
      await insertPhysicalComponent(
        client,
        normalizedInput.newComponent,
        current.componentType,
        newComponentId
      );
      await insertInstallation(client, {
        componentInstallationId: newComponentInstallationId,
        componentId: newComponentId,
        aircraftId: normalizedInput.aircraftId,
        positionIndex: current.positionIndex,
        installedOn: effectiveDate,
        openingTisHours: normalizedInput.newComponent.openingTisHours,
        firstApplicableFlightId,
        userId: normalizedUserId,
      });
      const archived = await archiveComponentIfUnused(client, current.componentId);
      closed.status = archived ? "ARCHIVED" : closed.status;

      const replacement = {
        componentInstallationId: newComponentInstallationId,
        componentId: newComponentId,
        componentType: current.componentType,
        positionIndex: current.positionIndex,
        manufacturer: normalizedInput.newComponent.manufacturer,
        model: normalizedInput.newComponent.model,
        serialNumber: normalizedInput.newComponent.serialNumber,
        notes: normalizedInput.newComponent.notes,
        status: "ACTIVE",
        installedOn: effectiveDate,
        removedOn: null,
        openingTisHours: normalizedInput.newComponent.openingTisHours,
        firstApplicableFlightId,
        lastApplicableFlightId: null,
      };
      await writeAudit(client, {
        auditEventId: randomUUID(),
        requestId,
        userId: normalizedUserId,
        aircraftId: normalizedInput.aircraftId,
        entityId: newComponentInstallationId,
        actionCode: "COMPONENT_REPLACED",
        beforeState: {
          aircraftId: normalizedInput.aircraftId,
          componentType: current.componentType,
          positionIndex: current.positionIndex,
          oldInstallation: current,
        },
        afterState: {
          aircraftId: normalizedInput.aircraftId,
          componentType: current.componentType,
          positionIndex: current.positionIndex,
          oldInstallation: closed,
          newInstallation: replacement,
        },
      });
      return {
        ok: true,
        action: normalizedAction,
        oldInstallation: closed,
        installation: replacement,
      };
    }, { isolationLevel: "SERIALIZABLE" });
  };
}

export const mutateComponentLifecycleInPostgres =
  createPostgresComponentLifecycleRepository();
