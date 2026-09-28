import { requireAuth } from "./_auth.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";
import { getHistorialesFromSheets } from "./_historialesRepository.js";
import { generateFlightHistoryExportFromPostgres } from "./_postgresExportRepository.js";
import { getLegacyHistorialesShapeFromPostgres } from "./_postgresHistorialesParityAdapter.js";

const ALLOWED_MODES = new Set(["historiales", "dashboard"]);

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  const userId = String(session.userId || "").trim();

  if (!userId) {
    return res
      .status(401)
      .json({ ok: false, error: "La sesion no contiene un userId valido." });
  }

  if (req.method === "POST") {
    let source;
    try {
      source = resolveDataSource("HISTORIALES_DATA_SOURCE");
    } catch {
      return res.status(500).json({
        ok: false,
        error: "La fuente de datos de historiales no esta configurada correctamente.",
      });
    }

    if (source !== DATA_SOURCE.POSTGRES) {
      return res.status(503).json({
        ok: false,
        code: "POSTGRES_EXPORT_NOT_AVAILABLE",
        error: "La exportacion XLSX no esta disponible temporalmente.",
      });
    }

    try {
      const artifact = await generateFlightHistoryExportFromPostgres({
        userId,
        input: req.body,
      });
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${artifact.filename}"`
      );
      res.setHeader("Content-Length", String(artifact.size));
      return res.status(200).send(artifact.bytes);
    } catch (error) {
      const statusCode = error.statusCode || 502;
      const exposeError = [400, 403, 409, 422].includes(statusCode);
      return res.status(statusCode).json({
        ok: false,
        error: exposeError ? error.message : "No se pudo generar la exportacion XLSX.",
        code: exposeError ? error.code : undefined,
      });
    }
  }

  const requestedAircraftId = Array.isArray(req.query?.aircraft_id)
    ? req.query.aircraft_id[0]
    : req.query?.aircraft_id;
  const aircraftId = String(
    requestedAircraftId || process.env.LEGACY_AIRCRAFT_ID || ""
  ).trim();
  const requestedMode = Array.isArray(req.query?.mode) ? req.query.mode[0] : req.query?.mode;
  const mode = String(requestedMode || "").trim().toLowerCase();

  if (!aircraftId) {
    return res
      .status(500)
      .json({ ok: false, error: "Falta aircraft_id o LEGACY_AIRCRAFT_ID." });
  }

  if (mode && !ALLOWED_MODES.has(mode)) {
    return res.status(400).json({ ok: false, error: "Modo de historiales no valido." });
  }

  let source;
  try {
    source = resolveDataSource("HISTORIALES_DATA_SOURCE");
  } catch {
    return res.status(500).json({
      ok: false,
      error: "La fuente de datos de historiales no esta configurada correctamente.",
    });
  }

  try {
    const data = source === DATA_SOURCE.POSTGRES
      ? await getLegacyHistorialesShapeFromPostgres({ userId, aircraftId, mode })
      : await getHistorialesFromSheets({ userId, aircraftId, mode });

    return res.status(200).json(data);
  } catch (error) {
    return res.status(error.statusCode || 502).json({
      ok: false,
      error: source === DATA_SOURCE.POSTGRES
        ? "No se pudieron cargar los historiales desde Postgres TEST."
        : "No se pudieron cargar los historiales desde Google Sheets.",
    });
  }
}
