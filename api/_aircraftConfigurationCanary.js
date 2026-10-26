import { resolvePostgresAircraftConfigurationWriteCapability } from './_settingsWriteCapability.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalizeId = (value) => typeof value === 'string' && UUID.test(value.trim()) ? value.trim().toLowerCase() : null;

function denied(code, statusCode) {
  return Object.assign(new Error('La configuración técnica no está habilitada para esta aeronave.'), { code, statusCode });
}

// Only server environment authorizes the target. Never consume a target/override from the request.
export function requireAircraftConfigurationCanary({ source, session, aircraftId }) {
  if (!resolvePostgresAircraftConfigurationWriteCapability(source).enabled) {
    throw denied('POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_NOT_ENABLED', 503);
  }
  const allowedId = normalizeId(process.env.POSTGRES_AIRCRAFT_CONFIGURATION_CANARY_AIRCRAFT_ID);
  if (process.env.VERCEL_ENV !== 'preview' || !allowedId) {
    throw denied('AIRCRAFT_CONFIGURATION_CANARY_NOT_CONFIGURED', 503);
  }
  if (session?.version !== 2 || !normalizeId(session.userId)) {
    throw denied('AIRCRAFT_CONFIGURATION_CANONICAL_SESSION_REQUIRED', 403);
  }
  if (!normalizeId(aircraftId) || normalizeId(aircraftId) !== allowedId) {
    throw denied('AIRCRAFT_CONFIGURATION_CANARY_DENIED', 403);
  }
}

export function aircraftConfigurationSetupAvailable({ source, session, aircraft }) {
  if (aircraft?.rol !== 'OWNER' || aircraft?.configurationConfigured !== false) return false;
  try {
    requireAircraftConfigurationCanary({ source, session, aircraftId: aircraft.aircraft_id });
    return true;
  } catch {
    // Invalid/missing write policy must not break reads or enable actions.
    return false;
  }
}
