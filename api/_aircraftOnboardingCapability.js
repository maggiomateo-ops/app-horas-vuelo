import { DATA_SOURCE } from './_dataSource.js';
import { resolvePostgresOnboardingWriteCapability } from './_settingsWriteCapability.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Read-only projection. POST /api/aircraft still checks its gate and ACTIVE user.
export function getAircraftOnboardingCapability({ session, identitySource, aircraftSource }) {
  const available = session?.version === 2
    && UUID_PATTERN.test(String(session.userId || '').trim())
    && identitySource === DATA_SOURCE.POSTGRES
    && aircraftSource === DATA_SOURCE.POSTGRES;
  return {
    aircraftOnboardingAvailable: available,
    aircraftOnboardingWritesEnabled: available
      && resolvePostgresOnboardingWriteCapability(aircraftSource).enabled,
  };
}
