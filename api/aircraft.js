import { requireFunctionalCanaryIfConfigured, functionalCanaryAllows } from './_functionalCanary.js';
import { correctAircraftIdentityInPostgres } from './_postgresAircraftIdentityRepository.js';
import { identityCorrectionReadAllowed, requireIdentityCorrection } from './_aircraftIdentityCorrectionPolicy.js';
import { requireAircraftConfigurationCanary, aircraftConfigurationSetupAvailable } from "./_aircraftConfigurationCanary.js";
import { requireAuth } from "./_auth.js";
import { getAircraftsForUser } from "./_adminRepository.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";
import { getAircraftsForUserFromPostgres } from "./_postgresAircraftRepository.js";
import { setupInitialAircraftConfigurationInPostgres } from "./_postgresAircraftConfigurationRepository.js";
import { createAircraftOnboardingInPostgres } from "./_postgresOnboardingRepository.js";
import { setupInitialAircraftOwnershipInPostgres } from "./_postgresOwnershipRepository.js";
import { mutateComponentLifecycleInPostgres } from "./_postgresComponentLifecycleRepository.js";
import {
  resolvePostgresFlightWriteCapability,
  resolvePostgresOnboardingWriteCapability,
  resolvePostgresOwnershipWriteCapability,
  resolvePostgresComponentLifecycleWriteCapability,
} from "./_settingsWriteCapability.js";

const COMPONENT_LIFECYCLE_ACTIONS = new Set([
  "install-component",
  "remove-component",
  "replace-component",
]);

const AIRCRAFT_RESPONSE_FIELDS = [
  "aircraft_id",
  "matricula",
  "fabricante",
  "modelo",
  "identityCorrectionSnapshot",
  "identityCorrectionAvailable",
  "ownershipSetupAvailable",
  "flightMutationAvailable",
  "rol",
  "ownershipConfigured",
  "ownershipInterests",
  "flightWritesReady",
  "configurationConfigured",
  "configuration",
  "componentInstallations",
  "componentInstallationHistory",
  "configurationSetupAvailable",
  "componentLifecycleWritesAvailable",
  "trackingAvailable",
];

function sanitizeAircraft(aircraft) {
  return AIRCRAFT_RESPONSE_FIELDS.reduce((result, field) => {
    if (aircraft?.[field] !== undefined) result[field] = aircraft[field];
    return result;
  }, {});
}

async function loadAircrafts(userId, session) {
  const source = resolveDataSource("AIRCRAFT_DATA_SOURCE");
  if (process.env.VERCEL_GIT_COMMIT_REF === 'codex/lv-sim-v1-functional'
    && !functionalCanaryAllows({source,session,aircraftId:'96d849aa-2827-4aa3-b02b-6671577444a7'})) {
    throw Object.assign(new Error('Este Preview TEST todavía no está configurado para LV-SIM.'),{statusCode:503,code:'FUNCTIONAL_PREVIEW_NOT_CONFIGURED'});
  }
  if (source !== DATA_SOURCE.POSTGRES) return getAircraftsForUser(userId);
  const componentLifecycleCapability =
    resolvePostgresComponentLifecycleWriteCapability(source);
  const trackingAvailable =
    resolveDataSource("SETTINGS_DATA_SOURCE") === DATA_SOURCE.POSTGRES;
  const aircrafts = await getAircraftsForUserFromPostgres(userId);
  return aircrafts.map((aircraft) => ({
    ...aircraft,
    identityCorrectionAvailable: (() => { try { requireIdentityCorrection({source,session,aircraftId:aircraft.aircraft_id}); return aircraft.rol === 'OWNER' && aircraft.configurationConfigured === false && aircraft.identityCorrectionSnapshot?.manufacturer === 'Cessna' && aircraft.identityCorrectionSnapshot?.model === 'C182'; } catch { return false; } })(),
    ownershipSetupAvailable: aircraft.rol === 'OWNER' && !aircraft.ownershipConfigured && resolvePostgresOwnershipWriteCapability(source).enabled && functionalCanaryAllows({source,session,aircraftId:aircraft.aircraft_id}),
    flightMutationAvailable: resolvePostgresFlightWriteCapability('POSTGRES').enabled && functionalCanaryAllows({source,session,aircraftId:aircraft.aircraft_id}) && aircraft.configurationConfigured && aircraft.flightWritesReady,
    identityCorrectionSnapshot: aircraft.rol === 'OWNER' && identityCorrectionReadAllowed({ source, session, aircraftId: aircraft.aircraft_id })
      ? aircraft.identityCorrectionSnapshot : undefined,
    configurationSetupAvailable: aircraftConfigurationSetupAvailable({ source, session, aircraft })
      && (process.env.POSTGRES_V1_FUNCTIONAL_CANARY_AIRCRAFT_ID === undefined || (functionalCanaryAllows({source,session,aircraftId:aircraft.aircraft_id}) && aircraft.fabricante === 'Piper' && aircraft.modelo === 'PA-34 Seneca')),
    componentLifecycleWritesAvailable: componentLifecycleCapability.enabled,
    trackingAvailable,
  }));
}

export default async function handler(req, res) {
  if (!["GET","POST","PATCH"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Metodo no permitido." });
  }

  const session = requireAuth(req, res);
  if (!session) return undefined;
  const userId = String(session.userId || "").trim();
  if (!userId) {
    return res.status(500).json({ ok: false, error: "La sesion no contiene un userId valido." });
  }

  if (req.method === "GET") {
    try {
      const aircrafts = await loadAircrafts(userId, session);
      return res.status(200).json({ ok: true, aircrafts: aircrafts.map(sanitizeAircraft) });
    } catch (error) {
      return res.status(error.statusCode === 503 ? 503 : 500).json({ ok: false, code:error.statusCode === 503 ? error.code : undefined, error: error.statusCode === 503 ? error.message : "No se pudieron cargar las aeronaves." });
    }
  }

  let source;
  try {
    source = resolveDataSource("AIRCRAFT_DATA_SOURCE");
  } catch {
    return res.status(500).json({ ok: false, error: "La fuente de aeronaves no esta configurada correctamente." });
  }

  if (req.method === "PATCH") {
    const action = String(req.body?.action || "").trim();

    if (action === "correct-pending-aircraft-identity") {
      const input = { ...(req.body || {}) };
      delete input.action;
      try {
        const result = await correctAircraftIdentityInPostgres({ source, session, input });
        return res.status(200).json(result);
      } catch (error) {
        const statusCode = error.statusCode || 502;
        const expose = [400, 403, 409, 422, 503].includes(statusCode);
        return res.status(statusCode).json({ ok: false,
          error: expose ? error.message : "No se pudo corregir la identidad de la aeronave.",
          code: expose ? error.code : undefined });
      }
    }

    if (COMPONENT_LIFECYCLE_ACTIONS.has(action)) {
      let capability;
      try {
        capability = resolvePostgresComponentLifecycleWriteCapability(source);
      } catch {
        return res.status(500).json({
          ok: false,
          error: "La capacidad de gestion de componentes no esta configurada correctamente.",
        });
      }
      if (source !== DATA_SOURCE.POSTGRES || !capability.enabled) {
        return res.status(503).json({
          ok: false,
          code: "POSTGRES_COMPONENT_LIFECYCLE_WRITES_NOT_ENABLED",
          error: "La gestion de componentes permanece deshabilitada.",
        });
      }
      const lifecycleInput = { ...(req.body || {}) };
      delete lifecycleInput.action;
      try {
        const result = await mutateComponentLifecycleInPostgres({
          userId,
          action,
          input: lifecycleInput,
        });
        return res.status(200).json(result);
      } catch (error) {
        const statusCode = error.statusCode || 502;
        const exposeError = [400, 403, 409, 422].includes(statusCode);
        return res.status(statusCode).json({
          ok: false,
          error: exposeError
            ? error.message
            : "No se pudo actualizar el componente.",
          code: exposeError ? error.code : undefined,
        });
      }
    }

    if (action === "setup-configuration") {
      try {
        requireFunctionalCanaryIfConfigured({source,session,aircraftId:req.body?.aircraftId});
        requireAircraftConfigurationCanary({ source, session, aircraftId: req.body?.aircraftId });
      } catch (error) {
        return res.status(error.statusCode || 503).json({
          ok: false,
          code: error.code || "AIRCRAFT_CONFIGURATION_CANARY_NOT_CONFIGURED",
          error: "La configuración técnica no está habilitada para esta aeronave.",
        });
      }
      const configurationInput = { ...(req.body || {}) };
      delete configurationInput.action;
      try {
        const result = await setupInitialAircraftConfigurationInPostgres({
          userId,
          input: configurationInput,
        });
        return res.status(201).json(result);
      } catch (error) {
        const statusCode = error.statusCode || 502;
        const exposeError = [400, 403, 409, 422].includes(statusCode);
        return res.status(statusCode).json({
          ok: false,
          error: exposeError
            ? error.message
            : "No se pudo configurar la aeronave.",
          code: exposeError ? error.code : undefined,
        });
      }
    }

    let capability;
    try {
      capability = resolvePostgresOwnershipWriteCapability(source);
    } catch {
      return res.status(500).json({ ok: false, error: "La capacidad de ownership no esta configurada correctamente." });
    }
    if (source !== DATA_SOURCE.POSTGRES || !capability.enabled) {
      return res.status(503).json({
        ok: false,
        code: "POSTGRES_OWNERSHIP_WRITES_NOT_ENABLED",
        error: "La configuracion de propiedad legal permanece deshabilitada.",
      });
    }
    try {
      requireFunctionalCanaryIfConfigured({source,session,aircraftId:req.body?.aircraftId});
      const result = await setupInitialAircraftOwnershipInPostgres({ userId, input: req.body });
      return res.status(201).json(result);
    } catch (error) {
      const statusCode = error.statusCode || 502;
      const exposeError = [400,403,409,422].includes(statusCode);
      return res.status(statusCode).json({
        ok: false,
        error: exposeError ? error.message : "No se pudo configurar la propiedad legal.",
        code: exposeError ? error.code : undefined,
      });
    }
  }

  let capability;
  try {
    capability = resolvePostgresOnboardingWriteCapability(source);
  } catch {
    return res.status(500).json({ ok: false, error: "La capacidad de onboarding no esta configurada correctamente." });
  }
  if (source !== DATA_SOURCE.POSTGRES || !capability.enabled) {
    return res.status(503).json({
      ok: false,
      code: "POSTGRES_ONBOARDING_WRITES_NOT_ENABLED",
      error: "La creacion de aeronaves permanece deshabilitada.",
    });
  }
  try {
    const result = await createAircraftOnboardingInPostgres({ userId, input: req.body });
    return res.status(201).json(result);
  } catch (error) {
    const exposeError = [400,403,409,422].includes(error.statusCode);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: exposeError ? error.message : "No se pudo crear la aeronave.",
      code: exposeError ? error.code : undefined,
    });
  }
}
