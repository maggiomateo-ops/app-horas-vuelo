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
    const aircrafts = await getAircraftsForUser(userId);

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
