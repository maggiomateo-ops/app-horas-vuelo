export async function fetchAircrafts(signal) {
  const response = await fetch("/api/aircraft", {
    method: "GET",
    signal,
    credentials: "include",
  });

  if (response.status === 401) {
    const error = new Error("UNAUTHORIZED");
    error.code = "UNAUTHORIZED";
    error.statusCode = 401;
    throw error;
  }

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok || !Array.isArray(data.aircrafts)) {
    throw new Error(data?.error || "No se pudieron cargar las aeronaves.");
  }

  return data.aircrafts;
}

export function buildAircraftOnboardingPayload(values) {
  const openingTisValue = String(values?.openingTisHours ?? "").trim();

  return {
    registration: String(values?.registration ?? "").trim().toUpperCase(),
    manufacturer: String(values?.manufacturer ?? "").trim(),
    model: String(values?.model ?? "").trim(),
    serialNumber: String(values?.serialNumber ?? "").trim() || null,
    countryCode: String(values?.countryCode ?? "").trim().toUpperCase() || null,
    openingTisHours: openingTisValue === "" ? null : Number(openingTisValue),
    baselineEffectiveDate: String(values?.baselineEffectiveDate ?? "").trim(),
    defaultCaptureMethod: "DIRECT",
    defaultOilUnit: "US_QUART",
  };
}

export async function createAircraft(values) {
  const response = await fetch("/api/aircraft", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildAircraftOnboardingPayload(values)),
  });
  const data = await response.json().catch(() => null);

  if (response.status === 401) {
    const error = new Error("Tu sesion expiro. Vuelve a iniciar sesion.");
    error.code = "UNAUTHORIZED";
    error.statusCode = 401;
    throw error;
  }

  if (!response.ok || !data?.ok) {
    const error = new Error(data?.error || "No se pudo crear la aeronave.");
    error.code = data?.code || "AIRCRAFT_ONBOARDING_FAILED";
    error.statusCode = response.status;
    throw error;
  }

  const aircraftId = String(data?.aircraft?.aircraft_id || "").trim();

  if (!aircraftId) {
    throw new Error("La respuesta de alta no contiene una aeronave valida.");
  }

  return {
    aircraft: data.aircraft,
    onboarding: data.onboarding ?? {
      ownershipConfigured: false,
      flightWritesReady: false,
    },
  };
}

export async function createFirstAircraftAndRefresh(
  values,
  { createRequest = createAircraft, loadAircrafts = fetchAircrafts } = {}
) {
  const created = await createRequest(values);
  let refreshedAircrafts;

  try {
    refreshedAircrafts = await loadAircrafts();
  } catch (error) {
    if (error?.message === "UNAUTHORIZED" || error?.code === "UNAUTHORIZED") {
      throw error;
    }

    refreshedAircrafts = [];
  }

  const createdAircraftId = String(created.aircraft.aircraft_id).trim();
  const aircraftIsPresent = refreshedAircrafts.some(
    (aircraft) => aircraft.aircraft_id === createdAircraftId
  );
  const aircrafts = aircraftIsPresent
    ? refreshedAircrafts
    : [...refreshedAircrafts, created.aircraft];

  return {
    aircrafts,
    selectedAircraftId: createdAircraftId,
    onboarding: created.onboarding,
  };
}

export function createAircraftSubmissionGuard() {
  let submitting = false;

  return {
    tryStart() {
      if (submitting) {
        return false;
      }

      submitting = true;
      return true;
    },
    finish() {
      submitting = false;
    },
  };
}

const OWNERSHIP_KINDS = new Set(["CREATOR_PERSON", "PERSON", "ORGANIZATION"]);
const OWNERSHIP_SHARE_PATTERN = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

function parseOwnershipShareCents(value) {
  const rawValue = String(value ?? "").trim();
  if (!OWNERSHIP_SHARE_PATTERN.test(rawValue)) return null;
  const [whole, fraction = ""] = rawValue.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 10_000
    ? cents
    : null;
}

export function validateOwnershipOwners(owners) {
  const ownerErrors = {};
  let totalCents = 0;
  let creatorCount = 0;

  if (!Array.isArray(owners) || owners.length === 0) {
    return {
      valid: false,
      totalCents: 0,
      ownerErrors,
      formError: "Agregá al menos un propietario.",
    };
  }

  owners.forEach((owner, index) => {
    const errors = {};
    const kind = String(owner?.kind || "").trim().toUpperCase();
    const shareCents = parseOwnershipShareCents(owner?.ownershipShare);

    if (!OWNERSHIP_KINDS.has(kind)) errors.kind = "Elegí un tipo de propietario.";
    if (kind === "CREATOR_PERSON") creatorCount += 1;
    if (kind === "PERSON" && !String(owner?.fullName || "").trim()) {
      errors.fullName = "Ingresá el nombre completo.";
    }
    if (kind === "ORGANIZATION" && !String(owner?.organizationName || "").trim()) {
      errors.organizationName = "Ingresá el nombre de la organización.";
    }

    const countryCode = String(owner?.countryCode || "").trim();
    if (countryCode && !/^[A-Za-z]{2}$/.test(countryCode)) {
      errors.countryCode = "Usá un código ISO de dos letras.";
    }
    if (shareCents === null) {
      errors.ownershipShare = "Ingresá un porcentaje mayor a 0 y hasta 100.";
    } else {
      totalCents += shareCents;
    }

    if (Object.keys(errors).length > 0) ownerErrors[index] = errors;
  });

  if (creatorCount > 1) {
    return {
      valid: false,
      totalCents,
      ownerErrors,
      formError: "La opción Yo puede utilizarse una sola vez.",
    };
  }

  return {
    valid: Object.keys(ownerErrors).length === 0 && totalCents === 10_000,
    totalCents,
    ownerErrors,
    formError:
      totalCents === 10_000
        ? ""
        : "La suma de los porcentajes debe ser exactamente 100,00%.",
  };
}

export function buildAircraftOwnershipPayload(aircraftId, owners) {
  return {
    aircraftId: String(aircraftId || "").trim(),
    owners: owners.map((owner) => {
      const kind = String(owner.kind || "").trim().toUpperCase();
      const ownershipShare = Number(String(owner.ownershipShare).trim());

      if (kind === "CREATOR_PERSON") return { kind, ownershipShare };
      if (kind === "PERSON") {
        const email = String(owner.email || "").trim();
        const countryCode = String(owner.countryCode || "").trim().toUpperCase();
        return {
          kind,
          fullName: String(owner.fullName || "").trim(),
          ...(email ? { email } : {}),
          ...(countryCode ? { countryCode } : {}),
          ownershipShare,
        };
      }
      const countryCode = String(owner.countryCode || "").trim().toUpperCase();
      return {
        kind,
        organizationName: String(owner.organizationName || "").trim(),
        ...(countryCode ? { countryCode } : {}),
        ownershipShare,
      };
    }),
  };
}

export function removeOwnershipOwner(owners, ownerId) {
  return owners.filter((owner) => owner.id !== ownerId);
}

export async function configureAircraftOwnership(aircraftId, owners) {
  const response = await fetch("/api/aircraft", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAircraftOwnershipPayload(aircraftId, owners)),
  });
  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    const error = new Error(data?.error || "No se pudo configurar la propiedad legal.");
    error.code = data?.code || "OWNERSHIP_SETUP_FAILED";
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

function applyOwnershipReadiness(aircrafts, aircraftId, readiness) {
  return aircrafts.map((aircraft) =>
    aircraft.aircraft_id === aircraftId
      ? {
          ...aircraft,
          ownershipConfigured: readiness.ownershipConfigured === true,
          flightWritesReady: readiness.flightWritesReady === true,
        }
      : aircraft
  );
}

export async function configureOwnershipAndRefresh(
  aircraftId,
  owners,
  {
    configureRequest = configureAircraftOwnership,
    loadAircrafts = fetchAircrafts,
    currentAircrafts = [],
  } = {}
) {
  try {
    const result = await configureRequest(aircraftId, owners);
    let refreshedAircrafts = [];
    try {
      refreshedAircrafts = await loadAircrafts();
    } catch (error) {
      if (error?.code === "UNAUTHORIZED" || error?.message === "UNAUTHORIZED") {
        throw error;
      }
    }

    const baseAircrafts = refreshedAircrafts.length > 0
      ? refreshedAircrafts
      : currentAircrafts;
    return {
      aircrafts: applyOwnershipReadiness(baseAircrafts, aircraftId, result),
      onboarding: {
        ownershipConfigured: result.ownershipConfigured === true,
        flightWritesReady: result.flightWritesReady === true,
      },
      alreadyConfigured: false,
    };
  } catch (error) {
    if (error?.statusCode !== 409 || error?.code !== "OWNERSHIP_ALREADY_CONFIGURED") {
      throw error;
    }

    const refreshedAircrafts = await loadAircrafts();
    const aircraft = refreshedAircrafts.find(
      (candidate) => candidate.aircraft_id === aircraftId
    );
    if (!aircraft?.ownershipConfigured || !aircraft?.flightWritesReady) throw error;

    return {
      aircrafts: refreshedAircrafts,
      onboarding: {
        ownershipConfigured: true,
        flightWritesReady: true,
      },
      alreadyConfigured: true,
    };
  }
}

export function createOwnershipSubmissionGuard() {
  return createAircraftSubmissionGuard();
}

export function getOwnershipSetupErrorMessage(error) {
  if (error?.statusCode === 403) {
    return "No tenés permisos para configurar la propiedad de esta aeronave.";
  }
  if (error?.statusCode === 409) {
    return "La propiedad legal ya fue configurada. Recargá la información de la aeronave.";
  }
  if ([400, 422].includes(error?.statusCode)) return error.message;
  if (error?.statusCode === 503) {
    return "La configuración de propiedad está temporalmente deshabilitada.";
  }
  return "No se pudo configurar la propiedad legal. Intentá nuevamente.";
}

export function getAircraftOnboardingErrorMessage(error) {
  if (error?.code === "AIRCRAFT_POSSIBLE_DUPLICATE") {
    return "No se pudo crear la aeronave porque los datos podrían coincidir con un registro existente.";
  }

  if (error?.statusCode === 503) {
    return "La creación de aeronaves está temporalmente no disponible. Intentá nuevamente más tarde.";
  }

  if ([400, 403, 422].includes(error?.statusCode)) {
    return error.message;
  }

  return "No se pudo crear la aeronave. Intentá nuevamente.";
}

const AIRCRAFT_PROPULSION_TYPES = new Set([
  "PISTON",
  "TURBOPROP",
  "TURBOJET",
  "TURBOFAN",
  "ELECTRIC",
  "OTHER",
]);

function configurationCount(value) {
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

export function validateAircraftConfiguration(values) {
  const propulsionType = String(values?.propulsionType || "").trim().toUpperCase();
  const engineCount = configurationCount(values?.engineCount);
  const propellerCount = configurationCount(values?.propellerCount);
  const installedOn = String(values?.installedOn || "").trim();
  const adoptExisting = values?.adoptExisting === true;
  const errors = {};

  if (!AIRCRAFT_PROPULSION_TYPES.has(propulsionType)) {
    errors.propulsionType = "Seleccioná un tipo de propulsión.";
  }
  if (engineCount === null) errors.engineCount = "Ingresá una cantidad válida.";
  if (propellerCount === null) errors.propellerCount = "Ingresá una cantidad válida.";
  if (!adoptExisting && !/^\d{4}-\d{2}-\d{2}$/.test(installedOn)) {
    errors.installedOn = "Ingresá la fecha efectiva de instalación.";
  }
  if (
    ["PISTON", "TURBOPROP"].includes(propulsionType)
    && (engineCount < 1 || propellerCount < 1)
  ) {
    errors.topology = "Esta propulsión requiere al menos un motor y una hélice.";
  }
  if (
    ["TURBOJET", "TURBOFAN"].includes(propulsionType)
    && (engineCount < 1 || propellerCount !== 0)
  ) {
    errors.topology = "Esta propulsión requiere al menos un motor y cero hélices.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    engineCount,
    propellerCount,
  };
}

function buildConfigurationComponents(values, componentType, count) {
  const source = Array.isArray(values?.components) ? values.components : [];
  return Array.from({ length: count }, (_, index) => {
    const positionIndex = index + 1;
    const component = source.find(
      (candidate) =>
        candidate.componentType === componentType
        && Number(candidate.positionIndex) === positionIndex
    ) || {};
    const openingTis = String(component.openingTisHours ?? "").trim();
    return {
      componentType,
      positionIndex,
      manufacturer: String(component.manufacturer || "").trim() || null,
      model: String(component.model || "").trim() || null,
      serialNumber: String(component.serialNumber || "").trim() || null,
      notes: null,
      openingTisHours: openingTis === "" ? null : Number(openingTis),
      installedOn: String(values.installedOn || "").trim(),
    };
  });
}

export function buildAircraftConfigurationPayload(aircraftId, values) {
  const engineCount = Number(values?.engineCount);
  const propellerCount = Number(values?.propellerCount);
  return {
    action: "setup-configuration",
    aircraftId: String(aircraftId || "").trim(),
    propulsionType: String(values?.propulsionType || "").trim().toUpperCase(),
    engineCount,
    propellerCount,
    components: values?.adoptExisting === true
      ? []
      : [
          ...buildConfigurationComponents(values, "ENGINE", engineCount),
          ...buildConfigurationComponents(values, "PROPELLER", propellerCount),
        ],
  };
}

export async function configureAircraftTopology(aircraftId, values) {
  const response = await fetch("/api/aircraft", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAircraftConfigurationPayload(aircraftId, values)),
  });
  const data = await response.json().catch(() => null);

  if (response.status === 401) {
    const error = new Error("Tu sesion expiro. Vuelve a iniciar sesion.");
    error.code = "UNAUTHORIZED";
    error.statusCode = 401;
    throw error;
  }
  if (!response.ok || !data?.ok) {
    const error = new Error(data?.error || "No se pudo configurar la aeronave.");
    error.code = data?.code || "AIRCRAFT_CONFIGURATION_FAILED";
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

export async function configureAircraftTopologyAndRefresh(
  aircraftId,
  values,
  {
    configureRequest = configureAircraftTopology,
    loadAircrafts = fetchAircrafts,
    currentAircrafts = [],
  } = {}
) {
  const result = await configureRequest(aircraftId, values);
  let aircrafts;
  try {
    aircrafts = await loadAircrafts();
  } catch (error) {
    if (error?.code === "UNAUTHORIZED" || error?.message === "UNAUTHORIZED") throw error;
    aircrafts = currentAircrafts.map((aircraft) =>
      aircraft.aircraft_id === aircraftId
        ? {
            ...aircraft,
            configurationConfigured: true,
            configuration: result.configuration,
            componentInstallations: result.componentInstallations,
          }
        : aircraft
    );
  }
  return { ...result, aircrafts };
}

export function getAircraftConfigurationErrorMessage(error) {
  if (error?.statusCode === 403) {
    return "Sólo un Owner puede configurar esta aeronave.";
  }
  if (error?.code === "AIRCRAFT_COMPONENT_TOPOLOGY_MISMATCH") {
    return "Los componentes existentes no coinciden con la topología seleccionada.";
  }
  if (error?.statusCode === 409) {
    return "La configuración inicial ya existe. Recargá la aeronave.";
  }
  if ([400, 422].includes(error?.statusCode)) return error.message;
  if (error?.statusCode === 503) {
    return "La configuración aeronáutica está temporalmente deshabilitada.";
  }
  return "No se pudo configurar la aeronave. Intentá nuevamente.";
}

export async function mutateAircraftComponent(action, aircraftId, input) {
  const response = await fetch("/api/aircraft", {
    method: "PATCH",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      aircraftId: String(aircraftId || "").trim(),
      ...input,
    }),
  });
  const data = await response.json().catch(() => null);
  if (response.status === 401) {
    const error = new Error("Tu sesion expiro. Vuelve a iniciar sesion.");
    error.code = "UNAUTHORIZED";
    error.statusCode = 401;
    throw error;
  }
  if (!response.ok || !data?.ok) {
    const error = new Error(data?.error || "No se pudo actualizar el componente.");
    error.code = data?.code || "COMPONENT_LIFECYCLE_FAILED";
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

function applyComponentLifecycleResult(aircrafts, aircraftId, result) {
  return aircrafts.map((aircraft) => {
    if (aircraft.aircraft_id !== aircraftId) return aircraft;
    const active = Array.isArray(aircraft.componentInstallations)
      ? aircraft.componentInstallations
      : [];
    const history = Array.isArray(aircraft.componentInstallationHistory)
      ? aircraft.componentInstallationHistory
      : [];
    const oldId = result.oldInstallation?.componentInstallationId
      || (result.action === "remove-component"
        ? result.installation?.componentInstallationId
        : null);
    const nextActive = active.filter(
      (installation) => installation.componentInstallationId !== oldId
    );
    if (result.action !== "remove-component" && result.installation) {
      nextActive.push(result.installation);
    }
    const nextHistory = history.filter(
      (installation) => installation.componentInstallationId !== oldId
        && installation.componentInstallationId
          !== result.installation?.componentInstallationId
    );
    if (result.oldInstallation) nextHistory.push(result.oldInstallation);
    if (result.installation) nextHistory.push(result.installation);
    return {
      ...aircraft,
      componentInstallations: nextActive,
      componentInstallationHistory: nextHistory,
    };
  });
}

export async function mutateAircraftComponentAndRefresh(
  action,
  aircraftId,
  input,
  {
    mutateRequest = mutateAircraftComponent,
    loadAircrafts = fetchAircrafts,
    currentAircrafts = [],
  } = {}
) {
  const result = await mutateRequest(action, aircraftId, input);
  try {
    const aircrafts = await loadAircrafts();
    return { ...result, aircrafts };
  } catch (error) {
    if (error?.code === "UNAUTHORIZED" || error?.message === "UNAUTHORIZED") throw error;
    return {
      ...result,
      aircrafts: applyComponentLifecycleResult(currentAircrafts, aircraftId, result),
    };
  }
}

export function getComponentLifecycleErrorMessage(error) {
  if (error?.statusCode === 403) {
    return "Sólo un Owner puede gestionar componentes.";
  }
  if (error?.statusCode === 503) {
    return "La gestión de componentes está temporalmente deshabilitada.";
  }
  if ([400, 409, 422].includes(error?.statusCode)) return error.message;
  return "No se pudo actualizar el componente. Intentá nuevamente.";
}
