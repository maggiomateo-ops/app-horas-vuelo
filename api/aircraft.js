import { requireAuth } from "./_auth.js";
import { getAircraftsForUser } from "./_adminRepository.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";
import { getAircraftsForUserFromPostgres } from "./_postgresAircraftRepository.js";
import { createAircraftOnboardingInPostgres } from "./_postgresOnboardingRepository.js";
import { resolvePostgresOnboardingWriteCapability } from "./_settingsWriteCapability.js";

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

async function loadAircrafts(userId) {
  const source = resolveDataSource("AIRCRAFT_DATA_SOURCE");

  if (source === DATA_SOURCE.POSTGRES) {
    return getAircraftsForUserFromPostgres(userId);
  }

  return getAircraftsForUser(userId);
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
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

  if (req.method === "GET") {
    try {
      const aircrafts = await loadAircrafts(userId);

      return res.status(200).json({
        ok: true,
        aircrafts: aircrafts.map(sanitizeAircraft),
      });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        ok: false,
        error: "No se pudieron cargar las aeronaves.",
      });
    }
  }

  let source;
  let capability;

  try {
    source = resolveDataSource("AIRCRAFT_DATA_SOURCE");
    capability = resolvePostgresOnboardingWriteCapability(source);
  } catch {
    return res.status(500).json({
      ok: false,
      error: "La capacidad de onboarding no esta configurada correctamente.",
    });
  }

  if (source !== DATA_SOURCE.POSTGRES || !capability.enabled) {
    return res.status(503).json({
      ok: false,
      code: "POSTGRES_ONBOARDING_WRITES_NOT_ENABLED",
      error: "La creacion de aeronaves permanece deshabilitada.",
    });
  }

  try {
    const result = await createAircraftOnboardingInPostgres({
      userId,
      input: req.body,
    });

    return res.status(201).json(result);
  } catch (error) {
    const exposeError = [400, 403, 409, 422].includes(error.statusCode);

    return res.status(error.statusCode || 500).json({
      ok: false,
      error: exposeError
        ? error.message
        : "No se pudo crear la aeronave.",
      code: exposeError ? error.code : undefined,
    });
  }
}
