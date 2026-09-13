import { getSessionUserId, requireAuth } from "./_auth.js";
import { getPlatformUsersForAdmin } from "./_adminRepository.js";
import {
  getBody,
  managementErrorResponse,
  optionalBoolean,
  optionalString,
  requiredEmail,
  requiredString,
  userManagementWritesEnabled,
} from "./_managementHttp.js";
import {
  changeUserStatusByAdmin,
  createUserByAdmin,
} from "./_userManagementRepository.js";

function getErrorStatus(error) {
  if (["FORBIDDEN", "USER_NOT_AUTHORIZED"].includes(error?.code)) {
    return 403;
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
    try {
      const users = await getPlatformUsersForAdmin(userId);
      return res.status(200).json({ ok: true, users });
    } catch (error) {
      const status = getErrorStatus(error);
      return res.status(status).json({
        ok: false,
        error: status === 403
          ? "No tenes permisos para consultar usuarios."
          : "No se pudieron cargar los usuarios.",
      });
    }
  }

  if (!userManagementWritesEnabled()) {
    return res.status(503).json({
      ok: false,
      error: "La gestion de usuarios no esta disponible en este momento.",
    });
  }

  try {
    if (req.method === "POST") {
      const body = getBody(req, [
        "nombre",
        "email",
        "telefono",
        "dni",
        "licencia",
        "is_admin",
      ]);
      const result = await createUserByAdmin(userId, {
        nombre: requiredString(body.nombre, "nombre"),
        email: requiredEmail(body.email),
        telefono: optionalString(body.telefono, "telefono", 80),
        dni: optionalString(body.dni, "dni", 80),
        licencia: optionalString(body.licencia, "licencia", 80),
        is_admin: optionalBoolean(body.is_admin, "is_admin"),
      });

      return res.status(201).json({ ok: true, user: result });
    }

    const body = getBody(req, ["user_id", "estado"]);
    const state = requiredString(body.estado, "estado", 8).toUpperCase();

    if (!["ACTIVO", "INACTIVO"].includes(state)) {
      const invalidState = new Error("estado debe ser ACTIVO o INACTIVO.");
      invalidState.code = "VALIDATION_ERROR";
      throw invalidState;
    }

    const result = await changeUserStatusByAdmin(
      userId,
      requiredString(body.user_id, "user_id", 40),
      state
    );
    return res.status(200).json({ ok: true, user: result });
  } catch (error) {
    const failure = managementErrorResponse(error, "No se pudo actualizar el usuario.");
    return res.status(failure.status).json({ ok: false, error: failure.error });
  }
}
