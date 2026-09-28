import { requireAuth } from "./_auth.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";
import { setupInitialAircraftOwnershipInPostgres } from "./_postgresOwnershipRepository.js";
import { resolvePostgresOwnershipWriteCapability } from "./_settingsWriteCapability.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);
  if (!session) return undefined;

  const userId = String(session.userId || "").trim();
  if (!userId) {
    return res
      .status(500)
      .json({ ok: false, error: "La sesion no contiene un userId valido." });
  }

  let source;
  let capability;
  try {
    source = resolveDataSource("AIRCRAFT_DATA_SOURCE");
    capability = resolvePostgresOwnershipWriteCapability(source);
  } catch {
    return res.status(500).json({
      ok: false,
      error: "La capacidad de ownership no esta configurada correctamente.",
    });
  }

  if (source !== DATA_SOURCE.POSTGRES || !capability.enabled) {
    return res.status(503).json({
      ok: false,
      code: "POSTGRES_OWNERSHIP_WRITES_NOT_ENABLED",
      error: "La configuracion de propiedad legal permanece deshabilitada.",
    });
  }

  try {
    const result = await setupInitialAircraftOwnershipInPostgres({
      userId,
      input: req.body,
    });
    return res.status(201).json(result);
  } catch (error) {
    const statusCode = error.statusCode || 502;
    const exposeError = [400, 403, 409, 422].includes(statusCode);
    return res.status(statusCode).json({
      ok: false,
      error: exposeError
        ? error.message
        : "No se pudo configurar la propiedad legal.",
      code: exposeError ? error.code : undefined,
    });
  }
}
