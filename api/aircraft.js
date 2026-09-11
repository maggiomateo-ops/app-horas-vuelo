import { requireAuth } from "./_auth.js";
import { getAircraftsForUser } from "./_adminRepository.js";

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

function getAircraftDataSource() {
  return process.env.AIRCRAFT_DATA_SOURCE === "sheets-api"
    ? "sheets-api"
    : "apps-script";
}

async function getAircraftsFromAppsScript(userId) {
  const appsScriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();
  const appSecret = String(process.env.APPS_SCRIPT_SECRET || "").trim();

  if (!appsScriptUrl) {
    const error = new Error("Falta APPS_SCRIPT_URL en variables de entorno.");
    error.statusCode = 401;
    throw error;
  }

  if (!appSecret) {
    const error = new Error("Falta APPS_SCRIPT_SECRET en variables de entorno.");
    error.statusCode = 500;
    throw error;
  }

  const url = new URL(appsScriptUrl);
  url.searchParams.set("action", "aircrafts");
  url.searchParams.set("userId", userId);
  url.searchParams.set("appSecret", appSecret);

  const response = await fetch(url.toString(), { method: "GET" });
  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = { ok: false, error: "Respuesta invalida de Apps Script." };
  }

  if (!response.ok || !data?.ok || !Array.isArray(data.aircrafts)) {
    const error = new Error(data?.error || "No se pudieron cargar las aeronaves.");
    error.statusCode = response.ok ? 502 : response.status;
    throw error;
  }

  return data.aircrafts;
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

  if (!userId) {
    return res
      .status(500)
      .json({ ok: false, error: "La sesion no contiene un userId valido." });
  }

  const dataSource = getAircraftDataSource();

  try {
    const aircrafts = dataSource === "sheets-api"
      ? await getAircraftsForUser(userId)
      : await getAircraftsFromAppsScript(userId);

    return res.status(200).json({
      ok: true,
      aircrafts: aircrafts.map(sanitizeAircraft),
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: dataSource === "sheets-api"
        ? "No se pudieron cargar las aeronaves."
        : error.message || "Error interno del servidor.",
    });
  }
}
