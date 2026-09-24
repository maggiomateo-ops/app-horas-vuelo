import { postgresQuery } from "./_postgres.js";

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

async function requireActiveUser(userId) {
  const normalizedUserId = normalizeUuid(userId, "userId");
  const { rows } = await postgresQuery(
    `
      SELECT user_id, email, status
      FROM app.users
      WHERE user_id = $1::uuid
      LIMIT 1
    `,
    [normalizedUserId]
  );
  const user = rows[0];

  if (!user || user.status !== "ACTIVE") {
    throw repositoryError(
      "El usuario no esta habilitado en Postgres.",
      "USER_NOT_AUTHORIZED",
      403
    );
  }

  return user;
}

const CURRENT_REGISTRATION_JOIN = `
  LEFT JOIN LATERAL (
    SELECT registration
    FROM app.aircraft_registrations registration_history
    WHERE registration_history.aircraft_id = aircraft.aircraft_id
      AND registration_history.effective_from_at <= now()
      AND (
        registration_history.effective_to_at IS NULL
        OR registration_history.effective_to_at > now()
      )
    ORDER BY registration_history.effective_from_at DESC
    LIMIT 1
  ) current_registration ON true
`;

export async function getAircraftsForUserFromPostgres(userId) {
  const user = await requireActiveUser(userId);
  const { rows } = await postgresQuery(
    `
      SELECT
        aircraft.aircraft_id,
        COALESCE(current_registration.registration, '') AS matricula,
        aircraft.manufacturer AS fabricante,
        aircraft.model AS modelo,
        membership.role AS rol
      FROM app.aircraft_memberships membership
      JOIN app.aircraft aircraft
        ON aircraft.aircraft_id = membership.aircraft_id
      ${CURRENT_REGISTRATION_JOIN}
      WHERE membership.user_id = $1::uuid
        AND membership.status = 'ACTIVE'
        AND aircraft.status = 'ACTIVE'
      ORDER BY
        NULLIF(current_registration.registration, '') NULLS LAST,
        aircraft.manufacturer,
        aircraft.model,
        aircraft.aircraft_id
    `,
    [user.user_id]
  );

  return rows;
}

export async function getValidatedAircraftAccessFromPostgres(userId, aircraftId) {
  const user = await requireActiveUser(userId);
  const normalizedAircraftId = normalizeUuid(aircraftId, "aircraftId");
  const { rows } = await postgresQuery(
    `
      SELECT
        aircraft.aircraft_id,
        aircraft.manufacturer,
        aircraft.model,
        aircraft.serial_number,
        aircraft.status AS aircraft_status,
        COALESCE(current_registration.registration, '') AS registration,
        membership.membership_id,
        membership.role,
        membership.status AS membership_status
      FROM app.aircraft_memberships membership
      JOIN app.aircraft aircraft
        ON aircraft.aircraft_id = membership.aircraft_id
      ${CURRENT_REGISTRATION_JOIN}
      WHERE membership.user_id = $1::uuid
        AND membership.aircraft_id = $2::uuid
        AND membership.status = 'ACTIVE'
        AND aircraft.status = 'ACTIVE'
      LIMIT 1
    `,
    [user.user_id, normalizedAircraftId]
  );
  const access = rows[0];

  if (!access) {
    throw repositoryError(
      "El usuario no tiene acceso activo a la aeronave.",
      "AIRCRAFT_ACCESS_DENIED",
      403
    );
  }

  return {
    user,
    membership: {
      membership_id: access.membership_id,
      role: access.role,
      status: access.membership_status,
    },
    aircraft: {
      aircraft_id: access.aircraft_id,
      registration: access.registration,
      manufacturer: access.manufacturer,
      model: access.model,
      serial_number: access.serial_number,
      status: access.aircraft_status,
    },
  };
}
