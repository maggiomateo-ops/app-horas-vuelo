import { correctAircraftIdentityInPostgres } from './_postgresAircraftIdentityRepository.js';
import { identityCorrectionReadAllowed } from './_aircraftIdentityCorrectionPolicy.js';
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
  if (source !== DATA_SOURCE.POSTGRES) return getAircraftsForUser(userId);
  const componentLifecycleCapability =
    resolvePostgresComponentLifecycleWriteCapability(source);
  const trackingAvailable =
    resolveDataSource("SETTINGS_DATA_SOURCE") === DATA_SOURCE.POSTGRES;
  const aircrafts = await getAircraftsForUserFromPostgres(userId);
  return aircrafts.map((aircraft) => ({
    ...aircraft,
    identityCorrectionSnapshot: aircraft.rol === 'OWNER' && identityCorrectionReadAllowed({ source, session, aircraftId: aircraft.aircraft_id })
      ? aircraft.identityCorrectionSnapshot : undefined,
    configurationSetupAvailable: aircraftConfigurationSetupAvailable({ source, session, aircraft }),
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
    } catch {
      return res.status(500).json({ ok: false, error: "No se pudieron cargar las aeronaves." });
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
