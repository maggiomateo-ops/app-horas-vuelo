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
