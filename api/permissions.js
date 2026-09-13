import { getSessionUserId, requireAuth } from "./_auth.js";
import {
  getBody,
  managementErrorResponse,
  requiredString,
  userManagementWritesEnabled,
} from "./_managementHttp.js";
import {
  grantAircraftPermissionByAdmin,
  revokeAircraftPermissionByAdmin,
} from "./_userManagementRepository.js";

const VALID_ROLES = ["OWNER", "PILOT", "VIEWER"];

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");

  if (!["POST", "PATCH"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);

  if (!session) {
    return undefined;
  }

  const actorUserId = getSessionUserId(session);

  if (!actorUserId) {
    return res.status(401).json({ ok: false, error: "Sesion no valida." });
  }

  if (!userManagementWritesEnabled()) {
    return res.status(503).json({
      ok: false,
      error: "La gestion de permisos no esta disponible en este momento.",
    });
  }

  try {
    if (req.method === "POST") {
      const body = getBody(req, ["user_id", "aircraft_id", "rol"]);
      const role = requiredString(body.rol, "rol", 20).toUpperCase();

      if (!VALID_ROLES.includes(role)) {
        const invalidRole = new Error("rol debe ser OWNER, PILOT o VIEWER.");
        invalidRole.code = "VALIDATION_ERROR";
        throw invalidRole;
      }

      const result = await grantAircraftPermissionByAdmin(actorUserId, {
        user_id: requiredString(body.user_id, "user_id", 40),
        aircraft_id: requiredString(body.aircraft_id, "aircraft_id", 80),
        rol: role,
      });
      return res.status(200).json({ ok: true, permission: result });
    }

    const body = getBody(req, ["user_id", "aircraft_id", "action"]);
    const action = requiredString(body.action, "action", 20).toLowerCase();

    if (action !== "revoke") {
      const invalidAction = new Error("action debe ser revoke.");
      invalidAction.code = "VALIDATION_ERROR";
      throw invalidAction;
    }

    const result = await revokeAircraftPermissionByAdmin(actorUserId, {
      user_id: requiredString(body.user_id, "user_id", 40),
      aircraft_id: requiredString(body.aircraft_id, "aircraft_id", 80),
    });
    return res.status(200).json({ ok: true, permission: result });
  } catch (error) {
    const failure = managementErrorResponse(error, "No se pudo actualizar el permiso.");
    return res.status(failure.status).json({ ok: false, error: failure.error });
  }
}
