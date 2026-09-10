import { getSessionUserId, requireAuth } from "./_auth.js";

const AIRCRAFT_RESPONSE_FIELDS = [
  "aircraft_id",
  "matricula",
  "fabricante",
  "modelo",
  "rol",
];

function sanitizeAircraft(aircraft) {
  return AIRCRAFT_RESPONSE_FIELDS.reduce((result, field) => {
    if (aircraft?.[field] !== undefined) {
      result[field] = aircraft[field];
    }

    return result;
  }, {});
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  const appsScriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();
  const appSecret = String(process.env.APPS_SCRIPT_SECRET || "").trim();
  const userId = getSessionUserId(session);

  if (!appsScriptUrl) {
    return res
      .status(500)
      .json({ ok: false, error: "Falta APPS_SCRIPT_URL en variables de entorno." });
  }

  if (!appSecret) {
    return res
      .status(500)
      .json({ ok: false, error: "Falta APPS_SCRIPT_SECRET en variables de entorno." });
  }

  if (!userId) {
    return res
      .status(500)
      .json({ ok: false, error: "La sesion no contiene un userId valido." });
  }

  const url = new URL(appsScriptUrl);
  url.searchParams.set("action", "aircrafts");
  url.searchParams.set("userId", userId);
  url.searchParams.set("appSecret", appSecret);

  try {
    const response = await fetch(url.toString(), { method: "GET" });
    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "Respuesta invalida de Apps Script." };
    }

    if (!response.ok || !data?.ok || !Array.isArray(data.aircrafts)) {
      return res.status(response.ok ? 502 : response.status).json({
        ok: false,
        error: data?.error || "No se pudieron cargar las aeronaves.",
      });
    }

    return res.status(200).json({
      ok: true,
      aircrafts: data.aircrafts.map(sanitizeAircraft),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Error interno del servidor.",
    });
  }
}
