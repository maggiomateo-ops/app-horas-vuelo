import { getSessionUserId, requireAuth } from "./_auth.js";
import { getAircraftPilotsForManager } from "./_adminRepository.js";
import {
  getBody,
  managementErrorResponse,
  optionalString,
  requiredEmail,
  requiredString,
  userManagementWritesEnabled,
} from "./_managementHttp.js";
import {
  addAircraftPilot,
  revokeAircraftPilot,
} from "./_userManagementRepository.js";

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

  if (!["GET", "POST", "PATCH"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  const userId = getSessionUserId(session);
  if (!userId) {
    return res.status(401).json({ ok: false, error: "Sesion no valida." });
  }

  if (req.method === "GET") {
    const aircraftId = String(req.query?.aircraft_id || "").trim();

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

  if (!userManagementWritesEnabled()) {
    return res.status(503).json({
      ok: false,
      error: "La gestion de pilotos no esta disponible en este momento.",
    });
  }

  try {
    if (req.method === "POST") {
      const body = getBody(req, [
        "aircraft_id",
        "email",
        "nombre",
        "telefono",
        "licencia",
      ]);
      const result = await addAircraftPilot(userId, {
        aircraft_id: requiredString(body.aircraft_id, "aircraft_id", 80),
        email: requiredEmail(body.email),
        nombre: optionalString(body.nombre, "nombre"),
        telefono: optionalString(body.telefono, "telefono", 80),
        licencia: optionalString(body.licencia, "licencia", 80),
      });
      return res.status(200).json({ ok: true, pilot: result });
    }

    const body = getBody(req, ["aircraft_id", "user_id", "action"]);
    const action = requiredString(body.action, "action", 20).toLowerCase();

    if (action !== "revoke") {
      const invalidAction = new Error("action debe ser revoke.");
      invalidAction.code = "VALIDATION_ERROR";
      throw invalidAction;
    }

    const result = await revokeAircraftPilot(userId, {
      aircraft_id: requiredString(body.aircraft_id, "aircraft_id", 80),
      user_id: requiredString(body.user_id, "user_id", 40),
    });
    return res.status(200).json({ ok: true, pilot: result });
  } catch (error) {
    const failure = managementErrorResponse(error, "No se pudo actualizar el piloto.");
    const message = failure.status === 403
      ? "No tenes permisos para gestionar los pilotos de esta aeronave."
      : failure.error;
    return res.status(failure.status).json({ ok: false, error: message });
  }
}
