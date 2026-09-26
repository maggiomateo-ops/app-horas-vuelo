import { OAuth2Client } from "google-auth-library";
import { createSessionCookie } from "./_auth.js";
import { getActiveUserByEmail, resolveGoogleUser } from "./_adminRepository.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";
import { resolveActiveUserByVerifiedEmailFromPostgres } from "./_postgresIdentityRepository.js";

const googleClient = new OAuth2Client();

async function resolveActiveUserFromSheets(email, googleSub) {
  let user;

  try {
    user = googleSub
      ? await resolveGoogleUser({ email, googleSub })
      : await getActiveUserByEmail(email);
  } catch (error) {
    if (error.code === "USER_NOT_AUTHORIZED") {
      throw new Error("USER_NOT_AUTHORIZED");
    }

    if (error.code === "GOOGLE_IDENTITY_MISMATCH") {
      throw new Error("GOOGLE_IDENTITY_MISMATCH");
    }

    throw new Error("USER_SERVICE_UNAVAILABLE");
  }

  const userId = String(user?.user_id || "").trim();
  const userEmail = String(user?.email || "").trim().toLowerCase();
  const name = String(user?.nombre || "").trim();
  const status = String(user?.estado || "").trim().toUpperCase();
  const isAdmin = user?.is_admin === true;

  if (!userId || !userEmail || !name || status !== "ACTIVO" || userEmail !== email) {
    throw new Error("INVALID_USER_RESPONSE");
  }

  return { userId, email: userEmail, name, isAdmin };
}

async function resolveActiveUserFromPostgres(email) {
  try {
    const user = await resolveActiveUserByVerifiedEmailFromPostgres(email);
    const userId = String(user?.user_id || "").trim();
    const userEmail = String(user?.email || "").trim().toLowerCase();
    const name = String(user?.nombre || "").trim();
    const status = String(user?.estado || "").trim().toUpperCase();

    if (!userId || !userEmail || !name || status !== "ACTIVO" || userEmail !== email) {
      throw new Error("INVALID_USER_RESPONSE");
    }

    return { userId, email: userEmail, name, isAdmin: false };
  } catch (error) {
    const code = String(error?.code || error?.message || "");

    if (code === "USER_NOT_AUTHORIZED") {
      throw new Error("USER_NOT_AUTHORIZED");
    }

    if (code === "GOOGLE_IDENTITY_MISMATCH") {
      throw new Error("GOOGLE_IDENTITY_MISMATCH");
    }

    if (code === "INVALID_USER_RESPONSE") {
      throw new Error("INVALID_USER_RESPONSE");
    }

    throw new Error("USER_SERVICE_UNAVAILABLE");
  }
}

async function resolveActiveUser(email, googleSub) {
  const source = resolveDataSource("GOOGLE_USER_RESOLUTION_SOURCE");

  if (source === DATA_SOURCE.POSTGRES) {
    return resolveActiveUserFromPostgres(email);
  }

  return resolveActiveUserFromSheets(email, googleSub);
}

export default async function handler(req, res) {
  if (process.env.GOOGLE_AUTH_ENABLED !== "true") {
    return res.status(404).json({ ok: false, error: "Google Auth no esta habilitado." });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const credential = String(req.body?.credential || "").trim();

  if (!credential) {
    return res.status(400).json({ ok: false, error: "Falta la credencial de Google." });
  }

  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();

  if (!clientId) {
    return res.status(500).json({ ok: false, error: "Google Auth no esta configurado." });
  }

  let payload;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: clientId,
    });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ ok: false, error: "Credencial de Google invalida." });
  }

  const email = String(payload?.email || "").trim().toLowerCase();
  const googleSub = String(payload?.sub || "").trim();

  if (!email) {
    return res.status(401).json({ ok: false, error: "La cuenta de Google no informa un email." });
  }

  if (!googleSub) {
    return res.status(401).json({ ok: false, error: "La cuenta de Google no informa una identidad valida." });
  }

  if (payload?.email_verified !== true) {
    return res.status(401).json({ ok: false, error: "El email de Google no esta verificado." });
  }

  try {
    const user = await resolveActiveUser(email, googleSub);

    res.setHeader("Set-Cookie", createSessionCookie(user));

    return res.status(200).json({ ok: true, user });
  } catch (error) {
    if (error.message === "USER_NOT_AUTHORIZED") {
      return res.status(403).json({ ok: false, error: "Usuario no habilitado." });
    }

    if (error.message === "GOOGLE_IDENTITY_MISMATCH") {
      return res.status(403).json({
        ok: false,
        error: "La cuenta de Google no coincide con la identidad autorizada.",
      });
    }

    return res.status(502).json({
      ok: false,
      error: "No se pudo validar el usuario en este momento.",
    });
  }
}
