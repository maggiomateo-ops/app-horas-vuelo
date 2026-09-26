import { requireAuth } from "./_auth.js";
import { getAircraftsForUser } from "./_adminRepository.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";
import { getAircraftsForUserFromPostgres } from "./_postgresAircraftRepository.js";

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
