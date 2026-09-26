import { postgresQuery } from "./_postgres.js";

function repositoryError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export async function resolveActiveUserByVerifiedEmailFromPostgres(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    throw repositoryError("Falta email verificado.", "INVALID_GOOGLE_IDENTITY", 400);
  }

  const { rows } = await postgresQuery(
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

  if (!name) {
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
