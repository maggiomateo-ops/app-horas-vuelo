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
  resolvePostgresAircraftConfigurationWriteCapability,
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
  "rol",
  "ownershipConfigured",
  "flightWritesReady",
  "configurationConfigured",
  "configuration",
  "componentInstallations",
  "componentInstallationHistory",
  "configurationSetupAvailable",
  "componentLifecycleWritesAvailable",
];

function sanitizeAircraft(aircraft) {
  return AIRCRAFT_RESPONSE_FIELDS.reduce((result, field) => {
    if (aircraft?.[field] !== undefined) result[field] = aircraft[field];
    return result;
  }, {});
}

async function loadAircrafts(userId) {
  const source = resolveDataSource("AIRCRAFT_DATA_SOURCE");
  if (source !== DATA_SOURCE.POSTGRES) return getAircraftsForUser(userId);
  const capability = resolvePostgresAircraftConfigurationWriteCapability(source);
  const componentLifecycleCapability =
    resolvePostgresComponentLifecycleWriteCapability(source);
  const aircrafts = await getAircraftsForUserFromPostgres(userId);
  return aircrafts.map((aircraft) => ({
    ...aircraft,
    configurationSetupAvailable: capability.enabled,
    componentLifecycleWritesAvailable: componentLifecycleCapability.enabled,
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
      const aircrafts = await loadAircrafts(userId);
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
      let capability;
      try {
        capability = resolvePostgresAircraftConfigurationWriteCapability(source);
      } catch {
        return res.status(500).json({
          ok: false,
          error: "La capacidad de configuracion aeronautica no esta configurada correctamente.",
        });
      }
      if (source !== DATA_SOURCE.POSTGRES || !capability.enabled) {
        return res.status(503).json({
          ok: false,
          code: "POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_NOT_ENABLED",
          error: "La configuracion aeronautica permanece deshabilitada.",
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
