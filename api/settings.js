import { requireAuth } from "./_auth.js";
import {
  getSettingsFromSheets,
  saveSettingsToSheets,
} from "./_settingsRepository.js";

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

  if (req.method === "POST") {
    try {
      const settings = await saveSettingsToSheets({
        userId,
        aircraftId,
        settings: body.settings,
      });
      return res.status(200).json({ ok: true, settings });
    } catch (error) {
      return res.status(error.statusCode || 502).json({
        ok: false,
        error: error.statusCode === 403
          ? error.message
          : "No se pudieron guardar los settings.",
      });
    }
  }

  return res.status(405).json({ ok: false, error: "Metodo no permitido." });
}
