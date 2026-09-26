import { getSession } from "./_auth.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = getSession(req);

  if (!session) {
    return res.status(401).json({ ok: false, authenticated: false });
  }

  let legacyUserManagementEnabled;
  try {
    legacyUserManagementEnabled =
      resolveDataSource("GOOGLE_USER_RESOLUTION_SOURCE") !== DATA_SOURCE.POSTGRES;
  } catch {
    return res.status(500).json({
      ok: false,
      authenticated: false,
      error: "La fuente de identidad no esta configurada correctamente.",
    });
  }

  if (session.version === 2) {
    return res.status(200).json({
      ok: true,
      authenticated: true,
      user: {
        userId: session.userId,
        email: session.email,
        name: session.name,
        isAdmin: session.isAdmin === true,
        legacyUserManagementEnabled,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    authenticated: true,
    user: {
      username: session.username,
      legacyUserManagementEnabled,
    },
  });
}
