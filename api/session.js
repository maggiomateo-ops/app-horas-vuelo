import { getSession } from "./_auth.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";
import { resolveSettingsWriteCapability, resolvePostgresFlightWriteCapability } from "./_settingsWriteCapability.js";

// Deployment marker: refresh Preview environment after Flight write gate activation.\nfunction resolveParityCapabilities() {
  const identitySource = resolveDataSource("GOOGLE_USER_RESOLUTION_SOURCE");
  const settingsSource = resolveDataSource("SETTINGS_DATA_SOURCE");
  const flightSource = resolveDataSource("FLIGHT_DATA_SOURCE");
  const settingsWriteCapability = resolveSettingsWriteCapability(settingsSource);
  const flightWriteCapability = resolvePostgresFlightWriteCapability(flightSource);

  return {
    legacyUserManagementEnabled: identitySource !== DATA_SOURCE.POSTGRES,
    settingsWritesEnabled: settingsWriteCapability.enabled,
    settingsWriteMode: settingsWriteCapability.mode,
    settingsEditablePaths: settingsWriteCapability.editablePaths,
    flightWritesEnabled: flightWriteCapability.enabled,
    flightWriteMode: flightWriteCapability.mode,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  const session = getSession(req);
  if (!session) return res.status(401).json({ ok: false, authenticated: false });

  let capabilities;
  try {
    capabilities = resolveParityCapabilities();
  } catch {
    return res.status(500).json({ ok: false, authenticated: false, error: "Las fuentes de datos o capacidades de escritura no estan configuradas correctamente." });
  }

  if (session.version === 2) {
    return res.status(200).json({
      ok: true, authenticated: true,
      user: { userId: session.userId, email: session.email, name: session.name, isAdmin: session.isAdmin === true, ...capabilities },
    });
  }

  return res.status(200).json({ ok: true, authenticated: true, user: { username: session.username, ...capabilities } });
}
