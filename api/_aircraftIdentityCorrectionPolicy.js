// A one-aircraft TEST repair, not a general aircraft identity editor.
export const IDENTITY_CANARY_ID = '96d849aa-2827-4aa3-b02b-6671577444a7';
export const IDENTITY_CORRECTION_FLAG = 'POSTGRES_AIRCRAFT_IDENTITY_CORRECTIONS_ENABLED';
export const IDENTITY_CORRECTION_REASON = 'Corrección de identidad ficticia en Neon TEST.';
export const IDENTITY_TEST_HOSTS = new Set([
  'ep-jolly-sun-b6a3ayw9.c-2.sa-east-1.aws.neon.tech',
  'ep-jolly-sun-b6a3ayw9-pooler.c-2.sa-east-1.aws.neon.tech',
]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function identityCorrectionError(code, statusCode = 403) {
  return Object.assign(new Error('La corrección de identidad no está disponible o el estado cambió. Volvé a consultar la aeronave.'), { code, statusCode });
}
export function identityCorrectionReadAllowed({ source, session, aircraftId }) {
  if (source !== 'POSTGRES' || process.env.VERCEL_ENV !== 'preview'
    || session?.version !== 2 || !UUID.test(session.userId || '')
    || String(aircraftId).toLowerCase() !== IDENTITY_CANARY_ID) return false;
  try {
    const url = new URL(process.env.DATABASE_URL || '');
    return ['postgres:', 'postgresql:'].includes(url.protocol) && IDENTITY_TEST_HOSTS.has(url.hostname)
      && (!url.port || url.port === '5432') && url.pathname === '/app_horas'
      && decodeURIComponent(url.username) === 'app_horas_runtime'
      && [...url.searchParams.keys()].every(k => ['sslmode', 'channel_binding', 'connect_timeout', 'application_name'].includes(k));
  } catch { return false; }
}
export function requireIdentityCorrection({ source, session, aircraftId }) {
  if (process.env[IDENTITY_CORRECTION_FLAG]?.trim().toLowerCase() !== 'true') {
    throw identityCorrectionError('AIRCRAFT_IDENTITY_CORRECTION_DISABLED', 503);
  }
  if (!identityCorrectionReadAllowed({ source, session, aircraftId })) {
    throw identityCorrectionError('AIRCRAFT_IDENTITY_CORRECTION_SCOPE_DENIED');
  }
}
