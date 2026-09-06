import { requireAuth } from "./_auth.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/services/settingsService.js";

function buildSettingsUrl() {
  const appsScriptUrl = String(process.env.APPS_SCRIPT_URL || "").trim();

  if (!appsScriptUrl) {
    return null;
  }

  const url = new URL(appsScriptUrl);
  url.searchParams.set("action", "settings");

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

  const settingsUrl = buildSettingsUrl();

  if (!settingsUrl) {
    return res
      .status(500)
      .json({ ok: false, error: "Falta APPS_SCRIPT_URL en variables de entorno." });
  }

  if (req.method === "GET") {
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
    try {
      const response = await fetch(settingsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "settings",
          mode: "save",
          settings: normalizeSettings(req.body?.settings),
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
