import { requireAuth } from "./_auth.js";
import { getSettingsFromSheets } from "./_settingsRepository.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/services/settingsService.js";

function getSettingsDataSource() {
  return process.env.SETTINGS_DATA_SOURCE === "sheets-api"
    ? "sheets-api"
    : "apps-script";
}

function buildSettingsUrl(userId, aircraftId) {
  const appsScriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();

  if (!appsScriptUrl) {
    return null;
  }

  const url = new URL(appsScriptUrl);
  url.searchParams.set("action", "settings");
  url.searchParams.set("userId", userId);
  url.searchParams.set("aircraftId", aircraftId);

  if (process.env.APPS_SCRIPT_SECRET) {
    url.searchParams.set("appSecret", String(process.env.APPS_SCRIPT_SECRET).trim());
  }

  return url.toString();
}

async function readResponseData(response) {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: "Respuesta invalida de Apps Script.", raw: text };
  }
}

export default async function handler(req, res) {
  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  const userId = String(session.userId || "").trim();
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const requestedAircraftId = req.method === "GET"
    ? (Array.isArray(req.query?.aircraft_id)
      ? req.query.aircraft_id[0]
      : req.query?.aircraft_id)
    : body.aircraft_id;
  const aircraftId = String(
    requestedAircraftId || process.env.LEGACY_AIRCRAFT_ID || ""
  ).trim();

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

  if (req.method === "GET") {
    if (getSettingsDataSource() === "sheets-api") {
      try {
        const settings = await getSettingsFromSheets({ userId, aircraftId });
        return res.status(200).json({ ok: true, settings });
      } catch (error) {
        return res.status(502).json({
          ok: false,
          error: error.code === "INVALID_SETTINGS_JSON"
            ? error.message
            : "No se pudieron cargar los settings.",
        });
      }
    }

    const settingsUrl = buildSettingsUrl(userId, aircraftId);

    if (!settingsUrl) {
      return res
        .status(500)
        .json({ ok: false, error: "Falta APPS_SCRIPT_URL en variables de entorno." });
    }

    try {
      const response = await fetch(settingsUrl, { method: "GET" });
      const data = await readResponseData(response);

      if (response.status === 404) {
        return res.status(200).json({ ok: true, settings: DEFAULT_SETTINGS });
      }

      if (!response.ok || !data?.ok) {
        return res.status(response.ok ? 502 : response.status).json({
          ok: false,
          error: data?.error || "No se pudieron cargar los settings.",
        });
      }

      return res.status(200).json({
        ok: true,
        settings: normalizeSettings(data.settings),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || "Error interno del servidor.",
      });
    }
  }

  if (req.method === "POST") {
    const settingsUrl = buildSettingsUrl(userId, aircraftId);

    if (!settingsUrl) {
      return res
        .status(500)
        .json({ ok: false, error: "Falta APPS_SCRIPT_URL en variables de entorno." });
    }

    try {
      const response = await fetch(settingsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "settings",
          mode: "save",
          settings: normalizeSettings(body.settings),
          userId,
          aircraftId,
          appSecret: process.env.APPS_SCRIPT_SECRET
            ? String(process.env.APPS_SCRIPT_SECRET).trim()
            : undefined,
        }),
      });

      const data = await readResponseData(response);

      if (!response.ok || !data?.ok) {
        return res.status(response.ok ? 502 : response.status).json({
          ok: false,
          error: data?.error || "No se pudieron guardar los settings.",
        });
      }

      return res.status(200).json({
        ok: true,
        settings: normalizeSettings(data.settings),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        error: error.message || "Error interno del servidor.",
      });
    }
  }

  return res.status(405).json({ ok: false, error: "Metodo no permitido." });
}
