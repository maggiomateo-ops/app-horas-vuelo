import crypto from "node:crypto";

import { postgresQuery, withPostgresTransaction } from "./_postgres.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DNI_ISSUER_COUNTRY_CODE = "AR";

function repositoryError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeUuid(value, label) {
  const normalized = String(value || "").trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw repositoryError(`${label} no es un UUID valido.`, "VALIDATION_ERROR", 400);
  }
  return normalized;
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeOptionalEmail(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw repositoryError("El email no es valido.", "VALIDATION_ERROR", 400);
  }
  return normalized || null;
}

function localizedStatus(status) {
  return status === "ACTIVE" ? "ACTIVO" : "INACTIVO";
}

function isOwnerManagerRole(role) {
  return normalizeText(role).toUpperCase() === "OWNER";
}

async function requireOwnerManager(query, actorUserId, aircraftId, { lock = false } = {}) {
  const { rows } = await query(
    `SELECT
       actor.user_id,
       membership.membership_id,
       membership.role,
       aircraft.aircraft_id,
       COALESCE(registration.registration, '') AS registration
     FROM app.users actor
     JOIN app.aircraft_memberships membership
       ON membership.user_id = actor.user_id
      AND membership.aircraft_id = $2::uuid
     JOIN app.aircraft aircraft
       ON aircraft.aircraft_id = membership.aircraft_id
     LEFT JOIN LATERAL (
       SELECT current_registration.registration
       FROM app.aircraft_registrations current_registration
       WHERE current_registration.aircraft_id = aircraft.aircraft_id
         AND current_registration.effective_to_at IS NULL
       ORDER BY current_registration.effective_from_at DESC
       LIMIT 1
     ) registration ON true
     WHERE actor.user_id = $1::uuid
       AND actor.status = 'ACTIVE'
       AND aircraft.status = 'ACTIVE'
       AND membership.status = 'ACTIVE'
     ${lock ? "FOR UPDATE OF membership" : ""}`,
    [actorUserId, aircraftId]
  );

  if (rows.length !== 1 || !isOwnerManagerRole(rows[0].role)) {
    throw repositoryError(
      "Se requiere ser Owner activo de la aeronave.",
      "AIRCRAFT_ACCESS_DENIED",
      403
    );
  }
  return rows[0];
}

async function requireAircraftMember(query, actorUserId, aircraftId) {
  const { rows } = await query(
    `SELECT
       actor.user_id,
       membership.membership_id,
       membership.role,
       aircraft.aircraft_id,
       COALESCE(registration.registration, '') AS registration
     FROM app.users actor
     JOIN app.aircraft_memberships membership
       ON membership.user_id = actor.user_id
      AND membership.aircraft_id = $2::uuid
     JOIN app.aircraft aircraft
       ON aircraft.aircraft_id = membership.aircraft_id
     LEFT JOIN LATERAL (
       SELECT current_registration.registration
       FROM app.aircraft_registrations current_registration
       WHERE current_registration.aircraft_id = aircraft.aircraft_id
         AND current_registration.effective_to_at IS NULL
       ORDER BY current_registration.effective_from_at DESC
       LIMIT 1
     ) registration ON true
     WHERE actor.user_id = $1::uuid
       AND actor.status = 'ACTIVE'
       AND aircraft.status = 'ACTIVE'
       AND membership.status = 'ACTIVE'`,
    [actorUserId, aircraftId]
  );
  if (rows.length !== 1) {
    throw repositoryError(
      "Se requiere acceso activo a la aeronave.",
      "AIRCRAFT_ACCESS_DENIED",
      403
    );
  }
  return rows[0];
}

async function listPilotRows(query, aircraftId) {
  const { rows } = await query(
    `SELECT
       person.person_id,
       user_link.user_id,
       person.full_name,
       person.email,
       person.phone,
       person.license_number,
       person.status AS person_status,
       user_account.status AS user_status,
       association.status AS association_status,
       identifier.identifier_value AS dni
     FROM app.aircraft_persons association
     JOIN app.persons person
       ON person.person_id = association.person_id
     LEFT JOIN app.user_person_links user_link
       ON user_link.person_id = person.person_id
     LEFT JOIN app.users user_account
       ON user_account.user_id = user_link.user_id
     LEFT JOIN LATERAL (
       SELECT person_identifier.identifier_value
       FROM app.person_identifiers person_identifier
       WHERE person_identifier.person_id = person.person_id
         AND person_identifier.identifier_type = 'DNI'
       ORDER BY person_identifier.is_primary DESC, person_identifier.created_at
       LIMIT 1
     ) identifier ON true
     WHERE association.aircraft_id = $1::uuid
     ORDER BY lower(person.full_name), person.person_id`,
    [aircraftId]
  );
  return rows;
}

function mapPilot(row) {
  return {
    person_id: String(row.person_id),
    user_id: row.user_id ? String(row.user_id) : null,
    nombre: normalizeText(row.full_name),
    email: normalizeText(row.email).toLowerCase(),
    telefono: normalizeText(row.phone),
    dni: normalizeText(row.dni),
    licencia: normalizeText(row.license_number),
    estado: localizedStatus(row.person_status),
    user_estado: row.user_status ? localizedStatus(row.user_status) : null,
    permiso_estado: localizedStatus(row.association_status),
  };
}

async function writePilotAudit(client, {
  randomUUID,
  actorUserId,
  aircraftId,
  personId,
  actionCode,
  beforeStatus,
  afterStatus,
  reason,
  metadata = {},
}) {
  await client.query(
    `INSERT INTO audit.audit_events (
       audit_event_id, request_id, actor_type, actor_user_id, operation_source,
       aircraft_id, entity_type, entity_id, entity_key, action_code,
       before_state, after_state, reason, metadata, payload_version
     ) VALUES (
       $1::uuid, $2::uuid, 'USER', $3::uuid, 'MANUAL',
       $4::uuid, 'AIRCRAFT_PERSON', $5::uuid, $6::jsonb, $7,
       $8::jsonb, $9::jsonb, $10, $11::jsonb, 1
     )`,
    [
      randomUUID(),
      randomUUID(),
      actorUserId,
      aircraftId,
      personId,
      JSON.stringify({ aircraft_id: aircraftId, person_id: personId }),
      actionCode,
      beforeStatus ? JSON.stringify({ status: beforeStatus }) : null,
      JSON.stringify({ status: afterStatus, ...metadata }),
      reason,
      JSON.stringify({
        contract: "POSTGRES_CANONICAL_PILOT_MANAGEMENT",
        ...metadata,
      }),
    ]
  );
}

export function createPostgresPilotManagementRepository({
  query = postgresQuery,
  transaction = withPostgresTransaction,
  randomUUID = crypto.randomUUID,
} = {}) {
  async function listAircraftPilotsForMember(actorUserId, aircraftId) {
    const normalizedActorUserId = normalizeUuid(actorUserId, "actorUserId");
    const normalizedAircraftId = normalizeUuid(aircraftId, "aircraftId");
    const aircraft = await requireAircraftMember(
      query,
      normalizedActorUserId,
      normalizedAircraftId
    );
    const rows = await listPilotRows(query, normalizedAircraftId);
    return {
      aircraft: {
        aircraft_id: normalizedAircraftId,
        matricula: normalizeText(aircraft.registration),
      },
      pilots: rows.map(mapPilot),
      canManagePilots: isOwnerManagerRole(aircraft.role),
    };
  }

  async function authorizeAircraftPilot(actorUserId, input) {
    const normalizedActorUserId = normalizeUuid(actorUserId, "actorUserId");
    const aircraftId = normalizeUuid(input.aircraft_id, "aircraftId");
    const requestedPersonId = input.person_id
      ? normalizeUuid(input.person_id, "personId")
      : null;
    const email = normalizeOptionalEmail(input.email);
    const name = normalizeText(input.nombre);
    const phone = normalizeText(input.telefono) || null;
    const dni = normalizeText(input.dni);
    const licenseNumber = normalizeText(input.licencia) || null;

    if (!requestedPersonId && !name) {
      throw repositoryError("El nombre es obligatorio.", "VALIDATION_ERROR", 400);
    }

    return transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `app-horas:pilot-management:${aircraftId}`,
      ]);
      if (dni) {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
          `app-horas:pilot-dni:${DNI_ISSUER_COUNTRY_CODE}:${dni.toUpperCase()}`,
        ]);
      }
      await requireOwnerManager(
        (text, params) => client.query(text, params),
        normalizedActorUserId,
        aircraftId,
        { lock: true }
      );

      let person = null;
      let createdPerson = false;
      if (requestedPersonId) {
        const { rows: personRows } = await client.query(
          `SELECT person_id, full_name, email, phone, license_number, status
             FROM app.persons
            WHERE person_id = $1::uuid
            FOR UPDATE`,
          [requestedPersonId]
        );
        if (personRows.length !== 1) {
          throw repositoryError(
            "La persona seleccionada no existe.",
            "PILOT_PERSON_NOT_FOUND",
            404
          );
        }
        person = personRows[0];
        if (person.status !== "ACTIVE") {
          throw repositoryError(
            "La persona esta inactiva y no puede autorizarse como piloto.",
            "PILOT_PERSON_INACTIVE",
            409
          );
        }
      }

      if (!person) {
        if (dni) {
          const { rows: identifierRows } = await client.query(
            `SELECT person_id
               FROM app.person_identifiers
              WHERE issuer_country_code = $1::char(2)
                AND identifier_type = 'DNI'
                AND normalized_value = $2
              LIMIT 2`,
            [DNI_ISSUER_COUNTRY_CODE, dni.toUpperCase()]
          );
          if (identifierRows.length) {
            throw repositoryError(
              "Los datos identificatorios corresponden a otra persona.",
              "PILOT_PERSON_AMBIGUOUS",
              409
            );
          }
        }

        const personId = randomUUID();
        await client.query(
          `INSERT INTO app.persons (
             person_id, full_name, email, phone, license_number, notes,
             status, created_at, updated_at
           ) VALUES (
             $1::uuid, $2, $3, $4, $5, NULL,
             'ACTIVE', transaction_timestamp(), transaction_timestamp()
           )`,
          [personId, name, email, phone, licenseNumber]
        );
        if (dni) {
          await client.query(
            `INSERT INTO app.person_identifiers (
               person_identifier_id, person_id, issuer_country_code,
               identifier_type, identifier_value, normalized_value,
               is_primary, verified_at, expires_at, created_at
             ) VALUES (
               $1::uuid, $2::uuid, $3::char(2),
               'DNI', $4, $5, true, NULL, NULL, transaction_timestamp()
             )`,
            [randomUUID(), personId, DNI_ISSUER_COUNTRY_CODE, dni, dni.toUpperCase()]
          );
        }
        person = {
          person_id: personId,
          full_name: name,
          email,
          phone,
          license_number: licenseNumber,
          status: "ACTIVE",
        };
        createdPerson = true;
      }

      const { rows: associationRows } = await client.query(
        `SELECT status
           FROM app.aircraft_persons
          WHERE aircraft_id = $1::uuid AND person_id = $2::uuid
          FOR UPDATE`,
        [aircraftId, person.person_id]
      );
      const association = associationRows[0] || null;
      if (association?.status === "ACTIVE") {
        return {
          ...mapPilot({
            ...person,
            person_status: person.status,
            association_status: "ACTIVE",
            user_id: null,
            user_status: null,
            dni,
          }),
          changed: false,
        };
      }

      if (association) {
        await client.query(
          `UPDATE app.aircraft_persons
              SET status = 'ACTIVE', updated_at = transaction_timestamp()
            WHERE aircraft_id = $1::uuid AND person_id = $2::uuid`,
          [aircraftId, person.person_id]
        );
      } else {
        await client.query(
          `INSERT INTO app.aircraft_persons (
             aircraft_id, person_id, status, created_at, updated_at
           ) VALUES (
             $1::uuid, $2::uuid, 'ACTIVE',
             transaction_timestamp(), transaction_timestamp()
           )`,
          [aircraftId, person.person_id]
        );
      }

      await writePilotAudit(client, {
        randomUUID,
        actorUserId: normalizedActorUserId,
        aircraftId,
        personId: person.person_id,
        actionCode: association
          ? "AIRCRAFT_PERSON_REACTIVATED"
          : "AIRCRAFT_PERSON_AUTHORIZED",
        beforeStatus: association?.status || null,
        afterStatus: "ACTIVE",
        reason: association
          ? "Owner reactivated aircraft pilot association"
          : "Owner authorized aircraft pilot association",
        metadata: { created_person: createdPerson },
      });

      return {
        ...mapPilot({
          ...person,
          person_status: person.status,
          association_status: "ACTIVE",
          user_id: null,
          user_status: null,
          dni,
        }),
        created_person: createdPerson,
        changed: true,
      };
    }, { isolationLevel: "SERIALIZABLE" });
  }

  async function revokeAircraftPilot(actorUserId, input) {
    const normalizedActorUserId = normalizeUuid(actorUserId, "actorUserId");
    const aircraftId = normalizeUuid(input.aircraft_id, "aircraftId");
    const personId = normalizeUuid(input.person_id, "personId");

    return transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        `app-horas:pilot-management:${aircraftId}`,
      ]);
      await requireOwnerManager(
        (text, params) => client.query(text, params),
        normalizedActorUserId,
        aircraftId,
        { lock: true }
      );
      const { rows } = await client.query(
        `SELECT association.status, person.status AS person_status
           FROM app.aircraft_persons association
           JOIN app.persons person ON person.person_id = association.person_id
          WHERE association.aircraft_id = $1::uuid
            AND association.person_id = $2::uuid
          FOR UPDATE OF association`,
        [aircraftId, personId]
      );
      const association = rows[0];
      if (!association) {
        throw repositoryError(
          "La asociacion del piloto no existe.",
          "PILOT_ASSOCIATION_NOT_FOUND",
          404
        );
      }
      if (association.status === "ARCHIVED") {
        return { person_id: personId, permiso_estado: "INACTIVO", changed: false };
      }

      await client.query(
        `UPDATE app.aircraft_persons
            SET status = 'ARCHIVED', updated_at = transaction_timestamp()
          WHERE aircraft_id = $1::uuid AND person_id = $2::uuid`,
        [aircraftId, personId]
      );
      await writePilotAudit(client, {
        randomUUID,
        actorUserId: normalizedActorUserId,
        aircraftId,
        personId,
        actionCode: "AIRCRAFT_PERSON_REVOKED",
        beforeStatus: "ACTIVE",
        afterStatus: "ARCHIVED",
        reason: "Owner revoked aircraft pilot association",
      });
      return { person_id: personId, permiso_estado: "INACTIVO", changed: true };
    }, { isolationLevel: "SERIALIZABLE" });
  }

  return {
    listAircraftPilotsForMember,
    authorizeAircraftPilot,
    revokeAircraftPilot,
  };
}

const postgresPilotManagementRepository = createPostgresPilotManagementRepository();

export const getAircraftPilotsForMemberFromPostgres =
  postgresPilotManagementRepository.listAircraftPilotsForMember;
export const authorizeAircraftPilotInPostgres =
  postgresPilotManagementRepository.authorizeAircraftPilot;
export const revokeAircraftPilotInPostgres =
  postgresPilotManagementRepository.revokeAircraftPilot;
