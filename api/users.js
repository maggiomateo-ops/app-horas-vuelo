import { getSessionUserId, requireAuth } from "./_auth.js";
import { getPlatformUsersForAdmin } from "./_adminRepository.js";

function getErrorStatus(error) {
  if (["FORBIDDEN", "USER_NOT_AUTHORIZED"].includes(error?.code)) {
    return 403;
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

  if (!userId) {
    return res.status(401).json({ ok: false, error: "Sesion no valida." });
  }

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
