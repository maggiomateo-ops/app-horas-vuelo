export async function fetchHistoriales(aircraftId, mode, signal) {
  const searchParams = new URLSearchParams({ aircraft_id: aircraftId });

  if (mode) {
    searchParams.set("mode", mode);
  }
  const response = await fetch(`/api/historiales?${searchParams}`, {
    method: "GET",
    signal,
    credentials: "include",
  });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error("No se pudo leer la respuesta de historiales.");
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "No se pudieron cargar los historiales.");
  }

  return data;
}

export const FLIGHT_HISTORY_DATASET = "AIRCRAFT_FLIGHT_HISTORY";
export const EXPORT_PERIOD_TYPES = Object.freeze({
  allHistory: "ALL_HISTORY",
  yearToDate: "YEAR_TO_DATE",
  custom: "CUSTOM",
});

const FORBIDDEN_FILENAME_CHARACTERS = /[\\/:*?"<>|]/;
const DEFAULT_EXPORT_FILENAME = "app-horas-historial.xlsx";

function exportError(message, code, statusCode) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

export function normalizeExportLocale(locale) {
  const normalized = String(locale || "").trim().toLowerCase().split("-")[0];
  return normalized === "en" || normalized === "es" ? normalized : "es";
}

export function createInitialExportState(locale = "es") {
  return {
    isOpen: false,
    periodType: EXPORT_PERIOD_TYPES.allHistory,
    periodStartDate: "",
    periodEndDate: "",
    locale: normalizeExportLocale(locale),
    submitting: false,
    error: "",
  };
}

export function flightHistoryExportReducer(state, action) {
  switch (action.type) {
    case "open":
      return { ...createInitialExportState(action.locale), isOpen: true };
    case "close":
      return createInitialExportState(state.locale);
    case "change":
      return { ...state, [action.field]: action.value, error: "" };
    case "submit-start":
      return { ...state, submitting: true, error: "" };
    case "submit-error":
      return { ...state, error: action.error };
    case "submit-success":
      return createInitialExportState(state.locale);
    case "submit-finish":
      return { ...state, submitting: false };
    default:
      return state;
  }
}

export function createExportSubmissionGuard() {
  let active = false;
  return {
    tryStart() {
      if (active) return false;
      active = true;
      return true;
    },
    finish() {
      active = false;
    },
  };
}

export function buildFlightHistoryExportPayload({
  aircraftId,
  periodType,
  periodStartDate,
  periodEndDate,
  locale,
}) {
  const normalizedAircraftId = String(aircraftId || "").trim();
  const normalizedPeriodType = String(periodType || "").trim().toUpperCase();
  const normalizedLocale = normalizeExportLocale(locale);

  if (!normalizedAircraftId) {
    throw exportError("No se pudo identificar la aeronave.", "INVALID_EXPORT_INPUT", 400);
  }
  if (!Object.values(EXPORT_PERIOD_TYPES).includes(normalizedPeriodType)) {
    throw exportError("Seleccioná un período válido.", "INVALID_EXPORT_PERIOD", 400);
  }

  const payload = {
    aircraftId: normalizedAircraftId,
    datasetCode: FLIGHT_HISTORY_DATASET,
    periodType: normalizedPeriodType,
    locale: normalizedLocale,
  };

  if (normalizedPeriodType === EXPORT_PERIOD_TYPES.custom) {
    const start = String(periodStartDate || "").trim();
    const end = String(periodEndDate || "").trim();
    if (!start || !end) {
      throw exportError(
        "Completá las fechas Desde y Hasta.",
        "INVALID_EXPORT_PERIOD",
        400
      );
    }
    if (start > end) {
      throw exportError(
        "La fecha Desde no puede ser posterior a Hasta.",
        "INVALID_EXPORT_PERIOD",
        400
      );
    }
    payload.periodStartDate = start;
    payload.periodEndDate = end;
  }

  return payload;
}

export function getSafeExportFilename(contentDisposition) {
  const header = String(contentDisposition || "");
  const encodedMatch = header.match(/filename\*=UTF-8''([^;]+)/i);
  const basicMatch = header.match(/filename="?([^";]+)"?/i);
  let candidate = encodedMatch?.[1] || basicMatch?.[1] || "";

  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    return DEFAULT_EXPORT_FILENAME;
  }

  candidate = candidate.trim();
  const hasControlCharacters = Array.from(candidate).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  const isSafe =
    candidate.length > 0 &&
    candidate.length <= 180 &&
    candidate.toLowerCase().endsWith(".xlsx") &&
    !FORBIDDEN_FILENAME_CHARACTERS.test(candidate) &&
    !hasControlCharacters;

  return isSafe
    ? candidate
    : DEFAULT_EXPORT_FILENAME;
}

async function readSafeErrorPayload(response) {
  try {
    const data = await response.json();
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

function responseError(response, data) {
  if (response.status === 401) {
    return exportError("La sesión expiró.", "UNAUTHORIZED", 401);
  }
  if (response.status === 403) {
    return exportError(
      "No tenés permiso para exportar este historial.",
      data?.code || "EXPORT_ACCESS_DENIED",
      403
    );
  }
  if (response.status === 503) {
    return exportError(
      "La exportación Excel no está disponible temporalmente.",
      data?.code || "EXPORT_UNAVAILABLE",
      503
    );
  }
  if ([400, 422].includes(response.status)) {
    const backendMessage = typeof data?.error === "string" ? data.error.trim() : "";
    return exportError(
      backendMessage || "Revisá los datos elegidos para la exportación.",
      data?.code || "INVALID_EXPORT_INPUT",
      response.status
    );
  }
  return exportError(
    "No se pudo generar el archivo Excel.",
    "EXPORT_REQUEST_FAILED",
    response.status
  );
}

export async function requestFlightHistoryExport(values, fetchImpl = fetch) {
  const payload = buildFlightHistoryExportPayload(values);
  let response;
  try {
    response = await fetchImpl("/api/historiales", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw exportError(
      "No se pudo generar el archivo Excel.",
      "EXPORT_REQUEST_FAILED",
      0
    );
  }

  if (!response.ok) {
    throw responseError(response, await readSafeErrorPayload(response));
  }

  try {
    return {
      blob: await response.blob(),
      filename: getSafeExportFilename(response.headers.get("Content-Disposition")),
    };
  } catch {
    throw exportError(
      "No se pudo generar el archivo Excel.",
      "EXPORT_RESPONSE_INVALID",
      response.status
    );
  }
}

export function downloadExportBlob(
  { blob, filename },
  {
    createObjectURL = URL.createObjectURL.bind(URL),
    revokeObjectURL = URL.revokeObjectURL.bind(URL),
    createElement = document.createElement.bind(document),
  } = {}
) {
  const objectUrl = createObjectURL(blob);
  try {
    const anchor = createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = "noopener";
    anchor.click();
  } finally {
    revokeObjectURL(objectUrl);
  }
}

export async function exportAndDownloadFlightHistory(values, dependencies = {}) {
  const artifact = await requestFlightHistoryExport(values, dependencies.fetchImpl);
  downloadExportBlob(artifact, dependencies.downloadDependencies);
  return artifact;
}
