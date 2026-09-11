import { requireAuth } from "./_auth.js";
import { getHistorialesFromSheets } from "./_historialesRepository.js";

const ALLOWED_MODES = new Set(["historiales", "dashboard"]);

function buildHistorialesUrl(userId, aircraftId, mode) {
  const appsScriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();

  if (!appsScriptUrl) {
    return null;
  }

  const url = new URL(appsScriptUrl);
  url.searchParams.set("action", "historiales");
  url.searchParams.set("userId", userId);
  url.searchParams.set("aircraftId", aircraftId);

  if (mode) {
    url.searchParams.set("mode", mode);
  }

  if (process.env.APPS_SCRIPT_SECRET) {
    url.searchParams.set("appSecret", String(process.env.APPS_SCRIPT_SECRET).trim());
  }

  return url.toString();
}

function getHistorialesDataSource() {
  return process.env.HISTORIALES_DATA_SOURCE === "sheets-api"
    ? "sheets-api"
    : "apps-script";
}

async function getHistorialesFromSheetsApi(userId, aircraftId, mode) {
  try {
    return await getHistorialesFromSheets({ userId, aircraftId, mode });
  } catch {
    const error = new Error("No se pudieron cargar los historiales desde Google Sheets.");
    error.statusCode = 502;
    throw error;
  }
}

async function getHistorialesFromAppsScript(userId, aircraftId, mode) {
  const historialesUrl = buildHistorialesUrl(userId, aircraftId, mode);

  if (!historialesUrl) {
    throw new Error("Falta APPS_SCRIPT_URL en variables de entorno.");
  }

  const response = await fetch(historialesUrl, { method: "GET" });
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: "Respuesta invalida de Apps Script." };
  }

  if (!response.ok || !data?.ok) {
    const error = new Error(data?.error || "No se pudieron cargar los historiales.");
    error.statusCode = response.ok ? 502 : response.status;
    throw error;
  }

  return data;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  const userId = String(session.userId || "").trim();
  const requestedAircraftId = Array.isArray(req.query?.aircraft_id)
    ? req.query.aircraft_id[0]
    : req.query?.aircraft_id;
  const aircraftId = String(
    requestedAircraftId || process.env.LEGACY_AIRCRAFT_ID || ""
  ).trim();
  const requestedMode = Array.isArray(req.query?.mode) ? req.query.mode[0] : req.query?.mode;
  const mode = String(requestedMode || "").trim().toLowerCase();

  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: "La sesion no contiene un userId valido." });
  }

  if (!aircraftId) {
    return res
      .status(500)
      .json({ ok: false, error: "Falta aircraft_id o LEGACY_AIRCRAFT_ID." });
  }

  if (mode && !ALLOWED_MODES.has(mode)) {
    return res.status(400).json({ ok: false, error: "Modo de historiales no valido." });
  }

  try {
    const dataSource = getHistorialesDataSource();
    const data = dataSource === "sheets-api"
      ? await getHistorialesFromSheetsApi(userId, aircraftId, mode)
      : await getHistorialesFromAppsScript(userId, aircraftId, mode);

    return res.status(200).json(data);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || "Error interno del servidor.",
    });
  }
}
