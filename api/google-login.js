import { OAuth2Client } from "google-auth-library";
import { createSessionCookie } from "./_auth.js";

const googleClient = new OAuth2Client();

async function resolveActiveUser(email) {
  const appsScriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();
  const appSecret = String(process.env.APPS_SCRIPT_SECRET || "").trim();

  if (!appsScriptUrl || !appSecret) {
    throw new Error("AUTH_CONFIGURATION_ERROR");
  }

  const url = new URL(appsScriptUrl);
  url.searchParams.set("action", "resolveUser");
  url.searchParams.set("email", email);
  url.searchParams.set("appSecret", appSecret);

  let response;

  try {
    response = await fetch(url.toString(), { method: "GET" });
  } catch {
    throw new Error("USER_SERVICE_UNAVAILABLE");
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error("USER_SERVICE_UNAVAILABLE");
  }

  if (!data?.ok) {
    throw new Error("USER_NOT_AUTHORIZED");
  }

  const user = data.user;
  const userId = String(user?.user_id || "").trim();
  const userEmail = String(user?.email || "").trim().toLowerCase();
  const name = String(user?.nombre || "").trim();
  const status = String(user?.estado || "").trim().toUpperCase();

  if (!userId || !userEmail || !name || status !== "ACTIVO" || userEmail !== email) {
    throw new Error("INVALID_USER_RESPONSE");
  }

  return { userId, email: userEmail, name };
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

  if (!email) {
    return res.status(401).json({ ok: false, error: "La cuenta de Google no informa un email." });
  }

  if (payload?.email_verified !== true) {
    return res.status(401).json({ ok: false, error: "El email de Google no esta verificado." });
  }

  try {
    const user = await resolveActiveUser(email);

    res.setHeader("Set-Cookie", createSessionCookie(user));

    return res.status(200).json({ ok: true, user });
  } catch (error) {
    if (error.message === "USER_NOT_AUTHORIZED") {
      return res.status(403).json({ ok: false, error: "Usuario no habilitado." });
    }

    if (error.message === "AUTH_CONFIGURATION_ERROR") {
      return res.status(500).json({ ok: false, error: "Google Auth no esta configurado." });
    }

    return res.status(502).json({
      ok: false,
      error: "No se pudo validar el usuario en este momento.",
    });
  }
}
