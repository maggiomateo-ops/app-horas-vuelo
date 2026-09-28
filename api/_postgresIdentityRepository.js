import crypto from "node:crypto";

import { postgresQuery, withPostgresTransaction } from "./_postgres.js";

const DEFAULT_PREFERRED_LOCALE = "es";

function repositoryError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeVerifiedEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    throw repositoryError("Falta email verificado.", "INVALID_GOOGLE_IDENTITY", 400);
  }

  return normalizedEmail;
}

function normalizeVerifiedDisplayName(displayName) {
  const normalizedName = String(displayName || "").trim();

  if (!normalizedName) {
    throw repositoryError(
      "Falta el nombre verificado de la identidad Google.",
      "INVALID_GOOGLE_IDENTITY",
      400
    );
  }

  return normalizedName;
}

export function resolvePostgresSelfServiceUserCreationCapability() {
  const rawValue = String(
    process.env.POSTGRES_SELF_SERVICE_USER_CREATION_ENABLED || ""
  )
    .trim()
    .toLowerCase();

  if (!rawValue || rawValue === "false") {
    return false;
  }

  if (rawValue === "true") {
    return true;
  }

  throw repositoryError(
    "POSTGRES_SELF_SERVICE_USER_CREATION_ENABLED debe ser true, false o estar ausente.",
    "SELF_SERVICE_USER_CREATION_FLAG_INVALID",
    500
  );
}

async function loadIdentityRows(query, normalizedEmail) {
  const { rows } = await query(
    `
      SELECT
        user_account.user_id,
        user_account.email,
        user_account.status,
        user_account.preferred_locale,
        person.person_id,
        person.full_name,
        person.status AS person_status
      FROM app.users user_account
      JOIN app.user_person_links user_person
        ON user_person.user_id = user_account.user_id
      JOIN app.persons person
        ON person.person_id = user_person.person_id
      WHERE lower(user_account.email) = lower($1)
      LIMIT 2
    `,
    [normalizedEmail]
  );

  return rows;
}

function mapActiveIdentity(rows, normalizedEmail) {
  if (rows.length !== 1) {
    throw repositoryError(
      "Usuario no habilitado.",
      "USER_NOT_AUTHORIZED",
      403
    );
  }

  const user = rows[0];

  if (user.status !== "ACTIVE" || user.person_status !== "ACTIVE") {
    throw repositoryError(
      "Usuario no habilitado.",
      "USER_NOT_AUTHORIZED",
      403
    );
  }

  if (String(user.email || "").trim().toLowerCase() !== normalizedEmail) {
    throw repositoryError(
      "La identidad canonical no coincide con el email verificado.",
      "GOOGLE_IDENTITY_MISMATCH",
      403
    );
  }

  const name = String(user.full_name || "").trim();

  if (!name || !user.person_id) {
    throw repositoryError(
      "El usuario canonical no tiene una persona vinculada valida.",
      "INVALID_USER_RESPONSE",
      500
    );
  }

  return {
    user_id: String(user.user_id),
    email: normalizedEmail,
    nombre: name,
    estado: "ACTIVO",
    preferred_locale: user.preferred_locale,
    is_admin: false,
  };
}

export function createPostgresIdentityRepository({
  query = postgresQuery,
  transaction = withPostgresTransaction,
  randomUUID = crypto.randomUUID,
  isSelfServiceCreationEnabled = resolvePostgresSelfServiceUserCreationCapability,
} = {}) {
  async function resolveActiveUserByVerifiedEmail(email) {
    const normalizedEmail = normalizeVerifiedEmail(email);
    const rows = await loadIdentityRows(query, normalizedEmail);
    return mapActiveIdentity(rows, normalizedEmail);
  }

  async function resolveOrCreateActiveUserByVerifiedGoogleIdentity({
    email,
    displayName,
  }) {
    const normalizedEmail = normalizeVerifiedEmail(email);

    try {
      return await resolveActiveUserByVerifiedEmail(normalizedEmail);
    } catch (error) {
      if (error.code !== "USER_NOT_AUTHORIZED") {
        throw error;
      }

      if (!isSelfServiceCreationEnabled()) {
        throw error;
      }
    }

    try {
      return await transaction(
        async (client) => {
          const transactionQuery = (text, params) => client.query(text, params);
          const normalizedName = normalizeVerifiedDisplayName(displayName);

          await transactionQuery(
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            [`app-horas:verified-google-email:${normalizedEmail}`]
          );

          const { rows: existingUserRows } = await transactionQuery(
            `
              SELECT user_id
              FROM app.users
              WHERE lower(email) = lower($1)
              LIMIT 2
            `,
            [normalizedEmail]
          );

          if (existingUserRows.length > 0) {
            const identityRows = await loadIdentityRows(
              transactionQuery,
              normalizedEmail
            );
            return mapActiveIdentity(identityRows, normalizedEmail);
          }

          const userId = randomUUID();
          const personId = randomUUID();
          const requestId = randomUUID();

          await transactionQuery(
            `
              INSERT INTO app.users (
                user_id, email, status, preferred_locale, created_at, updated_at
              ) VALUES (
                $1::uuid, $2::text, 'ACTIVE', $3::text,
                transaction_timestamp(), transaction_timestamp()
              )
            `,
            [userId, normalizedEmail, DEFAULT_PREFERRED_LOCALE]
          );

          await transactionQuery(
            `
              INSERT INTO app.persons (
                person_id, full_name, email, phone, license_number, notes,
                status, created_at, updated_at
              ) VALUES (
                $1::uuid, $2::text, $3::text, NULL, NULL, NULL,
                'ACTIVE', transaction_timestamp(), transaction_timestamp()
              )
            `,
            [personId, normalizedName, normalizedEmail]
          );

          await transactionQuery(
            `
              INSERT INTO app.user_person_links (
                user_id, person_id, linked_at, verified_at
              ) VALUES (
                $1::uuid, $2::uuid,
                transaction_timestamp(), transaction_timestamp()
              )
            `,
            [userId, personId]
          );

          const afterState = {
            user_id: userId,
            email: normalizedEmail,
            status: "ACTIVE",
            preferred_locale: DEFAULT_PREFERRED_LOCALE,
            person: {
              person_id: personId,
              full_name: normalizedName,
              email: normalizedEmail,
              status: "ACTIVE",
            },
            identity_link: {
              verified: true,
            },
          };

          await transactionQuery(
            `
              INSERT INTO audit.audit_events (
                request_id, actor_type, actor_user_id, operation_source,
                aircraft_id, entity_type, entity_id, entity_key,
                action_code, before_state, after_state, reason, metadata,
                payload_version
              ) VALUES (
                $1::uuid, 'USER', $2::uuid, 'MANUAL',
                NULL, 'USER', $2::uuid, $3::jsonb,
                'USER_PROFILE_CREATED', NULL, $4::jsonb,
                'Verified Google identity self-service bootstrap', $5::jsonb,
                1
              )
            `,
            [
              requestId,
              userId,
              JSON.stringify({ user_id: userId }),
              JSON.stringify(afterState),
              JSON.stringify({
                contract: "D-247",
                bootstrap_mode: "VERIFIED_GOOGLE_IDENTITY",
              }),
            ]
          );

          return {
            user_id: userId,
            email: normalizedEmail,
            nombre: normalizedName,
            estado: "ACTIVO",
            preferred_locale: DEFAULT_PREFERRED_LOCALE,
            is_admin: false,
          };
        },
        { isolationLevel: "SERIALIZABLE" }
      );
    } catch (error) {
      if (error?.code === "23505" && error?.constraint === "uq_users_email_ci") {
        return resolveActiveUserByVerifiedEmail(normalizedEmail);
      }

      throw error;
    }
  }

  return {
    resolveActiveUserByVerifiedEmail,
    resolveOrCreateActiveUserByVerifiedGoogleIdentity,
  };
}

const postgresIdentityRepository = createPostgresIdentityRepository();

export const resolveActiveUserByVerifiedEmailFromPostgres =
  postgresIdentityRepository.resolveActiveUserByVerifiedEmail;

export const resolveOrCreateActiveUserByVerifiedGoogleIdentityFromPostgres =
  postgresIdentityRepository.resolveOrCreateActiveUserByVerifiedGoogleIdentity;
