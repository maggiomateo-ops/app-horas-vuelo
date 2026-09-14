import { requireAuth } from "./_auth.js";
import { saveFlightFromSheets } from "./_flightRepository.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  try {
    const userId = String(session.userId || "").trim();
    const payload = req.body && typeof req.body === "object" ? { ...req.body } : {};
    const aircraftId = String(
      payload.aircraft_id || process.env.LEGACY_AIRCRAFT_ID || ""
    ).trim();

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

    const data = await saveFlightFromSheets({ userId, aircraftId, payload });
    return res.status(200).json(data);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || "Error interno del servidor.",
    });
  }
}
