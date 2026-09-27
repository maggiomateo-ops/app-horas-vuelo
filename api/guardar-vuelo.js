import { requireAuth } from "./_auth.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";
import { saveFlightFromSheets } from "./_flightRepository.js";
import { requireCanonicalOwnershipReadyForFlightFromPostgres, saveLegacyFlightToPostgres } from "./_postgresFlightRepository.js";
import { resolvePostgresFlightWriteCapability } from "./_settingsWriteCapability.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);
  if (!session) return undefined;

  let source;
  try {
    source = resolveDataSource("FLIGHT_DATA_SOURCE");
  } catch {
    return res.status(500).json({ ok: false, error: "La fuente de datos de vuelos no esta configurada correctamente." });
  }

  try {
    const userId = String(session.userId || "").trim();
    const payload = req.body && typeof req.body === "object" ? { ...req.body } : {};
    const aircraftId = String(payload.aircraft_id || process.env.LEGACY_AIRCRAFT_ID || "").trim();

    if (!userId) {
      return res.status(500).json({ ok: false, error: "La sesion no contiene un userId valido." });
    }
    if (!aircraftId) {
      return res.status(500).json({ ok: false, error: "Falta aircraft_id o LEGACY_AIRCRAFT_ID." });
    }

    if (source === DATA_SOURCE.POSTGRES) {
      await requireCanonicalOwnershipReadyForFlightFromPostgres({ userId, aircraftId });
      const capability = resolvePostgresFlightWriteCapability(source);
      if (!capability.enabled) {
        return res.status(503).json({
          ok: false,
          code: "POSTGRES_FLIGHT_WRITES_NOT_ENABLED",
          error: "Ownership canonico listo. Las mutaciones de vuelos permanecen bloqueadas hasta habilitar explicitamente el gate de Flight writes.",
        });
      }
      const data = await saveLegacyFlightToPostgres({ userId, aircraftId, payload });
      return res.status(200).json(data);
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
      code: error.code || undefined,
      error: error.message || "Error interno del servidor.",
    });
  }
}
