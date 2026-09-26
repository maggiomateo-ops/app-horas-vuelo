import { getSession } from "./_auth.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";

function resolveParityCapabilities() {
  const identitySource = resolveDataSource("GOOGLE_USER_RESOLUTION_SOURCE");
  const settingsSource = resolveDataSource("SETTINGS_DATA_SOURCE");
  const flightSource = resolveDataSource("FLIGHT_DATA_SOURCE");

  return {
    legacyUserManagementEnabled: identitySource !== DATA_SOURCE.POSTGRES,
    settingsWritesEnabled: settingsSource !== DATA_SOURCE.POSTGRES,
    flightWritesEnabled: flightSource !== DATA_SOURCE.POSTGRES,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = getSession(req);

  if (!session) {
    return res.status(401).json({ ok: false, authenticated: false });
  }

  let capabilities;
  try {
    capabilities = resolveParityCapabilities();
  } catch {
    return res.status(500).json({
      ok: false,
      authenticated: false,
      error: "Las fuentes de datos no estan configuradas correctamente.",
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
        ...capabilities,
      },
    });
  }

  return res.status(200).json({
    ok: true,
    authenticated: true,
    user: {
      username: session.username,
      ...capabilities,
    },
  });
}
