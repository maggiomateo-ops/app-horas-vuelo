import { requireAuth } from "./_auth.js";
import { saveFlightFromSheets } from "./_flightRepository.js";

function getFlightWritesDataSource() {
  return process.env.FLIGHT_WRITES_DATA_SOURCE === "sheets-api"
    ? "sheets-api"
    : "apps-script";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  try {
    const dataSource = getFlightWritesDataSource();
    const appsScriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();
    const userId = String(session.userId || "").trim();
    const payload = req.body && typeof req.body === "object" ? { ...req.body } : {};
    const aircraftId = String(
      payload.aircraft_id || process.env.LEGACY_AIRCRAFT_ID || ""
    ).trim();

    if (dataSource === "apps-script" && !appsScriptUrl) {
      return res
        .status(401)
        .json({ ok: false, error: "Falta APPS_SCRIPT_URL en variables de entorno." });
    }

    if (!userId) {
      return res
        .status(500)
        .json({ ok: false, error: "La sesion no contiene un userId valido." });
    }

    if (!aircraftId) {
      return res
        .status(500)
        .json({ ok: false, error: "Falta aircraft_id o LEGACY_AIRCRAFT_ID." });
    }

    delete payload.userId;
    delete payload.appSecret;
    delete payload.spreadsheet_id;
    delete payload.spreadsheetId;
    delete payload.aircraft_id;
    delete payload.aircraftId;

    if (dataSource === "sheets-api") {
      const data = await saveFlightFromSheets({ userId, aircraftId, payload });
      return res.status(200).json(data);
    }

    const response = await fetch(appsScriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        userId,
        aircraftId,
        appSecret: process.env.APPS_SCRIPT_SECRET
          ? String(process.env.APPS_SCRIPT_SECRET).trim()
          : undefined,
      }),
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "Respuesta invalida de Apps Script.", raw: text };
    }

    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || "Error interno del servidor.",
    });
  }
}
