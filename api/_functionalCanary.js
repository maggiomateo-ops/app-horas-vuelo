import { identityCorrectionReadAllowed, IDENTITY_CANARY_ID } from './_aircraftIdentityCorrectionPolicy.js';
const KEY='POSTGRES_V1_FUNCTIONAL_CANARY_AIRCRAFT_ID';
// Optional scoped policy preserves other branches; an explicit invalid value fails closed.
export function requireFunctionalCanaryIfConfigured({source,session,aircraftId}) {
  if (process.env[KEY] === undefined && process.env.VERCEL_GIT_COMMIT_REF !== 'codex/lv-sim-v1-functional') return;
  if (process.env[KEY] !== IDENTITY_CANARY_ID || !identityCorrectionReadAllowed({source,session,aircraftId})) {
    throw Object.assign(new Error('Esta operación no está habilitada para la aeronave seleccionada.'),{code:'FUNCTIONAL_CANARY_DENIED',statusCode:403});
  }
}
export function functionalCanaryAllows(context) {
  try { requireFunctionalCanaryIfConfigured(context);return true; } catch {return false;}
}

export function functionalPilotWritesEnabled(context) {
  return process.env.POSTGRES_V1_FUNCTIONAL_CANARY_AIRCRAFT_ID === IDENTITY_CANARY_ID
    && process.env.POSTGRES_FLIGHT_WRITES_ENABLED === 'true'
    && context.source === 'POSTGRES' && functionalCanaryAllows(context);
}
