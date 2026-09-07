import { requireAuth } from "./_auth.js";

function buildHistorialesUrl(userId, aircraftId) {
  const appsScriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();

  if (!appsScriptUrl) {
    return null;
  }

  const url = new URL(appsScriptUrl);
  url.searchParams.set("action", "historiales");
  url.searchParams.set("userId", userId);
  url.searchParams.set("aircraftId", aircraftId);

  if (process.env.APPS_SCRIPT_SECRET) {
    url.searchParams.set("appSecret", String(process.env.APPS_SCRIPT_SECRET).trim());
  }

  return url.toString();
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  const userId = String(process.env.LEGACY_USER_ID || "").trim();
  const requestedAircraftId = Array.isArray(req.query?.aircraft_id)
    ? req.query.aircraft_id[0]
    : req.query?.aircraft_id;
  const aircraftId = String(
    requestedAircraftId || process.env.LEGACY_AIRCRAFT_ID || ""
  ).trim();

  if (!userId) {
    return res
      .status(500)
      .json({ ok: false, error: "Falta LEGACY_USER_ID en variables de entorno." });
  }

  if (!aircraftId) {
    return res
      .status(500)
      .json({ ok: false, error: "Falta aircraft_id o LEGACY_AIRCRAFT_ID." });
  }

  const historialesUrl = buildHistorialesUrl(userId, aircraftId);

  if (!historialesUrl) {
    return res
      .status(500)
      .json({ ok: false, error: "Falta APPS_SCRIPT_URL en variables de entorno." });
  }

  try {
    const response = await fetch(historialesUrl, {
      method: "GET",
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "Respuesta invalida de Apps Script.", raw: text };
    }

    if (!response.ok || !data?.ok) {
      return res
        .status(response.ok ? 502 : response.status)
        .json({ ok: false, error: data?.error || "No se pudieron cargar los historiales." });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error.message || "Error interno del servidor.",
    });
  }
}
