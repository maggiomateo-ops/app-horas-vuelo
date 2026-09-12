import { getSessionUserId, requireAuth } from "./_auth.js";
import { getAircraftPilotsForManager } from "./_adminRepository.js";

function getErrorStatus(error) {
  if (["FORBIDDEN", "USER_NOT_AUTHORIZED"].includes(error?.code)) {
    return 403;
  }

  if (error?.code === "AIRCRAFT_NOT_FOUND") {
    return 404;
  }

  if (error?.code === "AIRCRAFT_NOT_ACTIVE") {
    return 409;
  }

  return 500;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  const userId = getSessionUserId(session);
  const aircraftId = String(req.query?.aircraft_id || "").trim();

  if (!userId) {
    return res.status(401).json({ ok: false, error: "Sesion no valida." });
  }

  if (!aircraftId) {
    return res.status(400).json({ ok: false, error: "Falta aircraft_id." });
  }

  try {
    const result = await getAircraftPilotsForManager(userId, aircraftId);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    const status = getErrorStatus(error);
    const errorMessages = {
      403: "No tenes permisos para consultar los pilotos de esta aeronave.",
      404: "La aeronave no existe.",
      409: "La aeronave no esta activa.",
      500: "No se pudieron cargar los pilotos autorizados.",
    };

    return res.status(status).json({ ok: false, error: errorMessages[status] });
  }
}
