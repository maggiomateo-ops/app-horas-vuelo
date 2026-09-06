export const DEFAULT_SETTINGS = {
  appConfig: {
    aircraftName: "App Horas de Vuelo",
    aircraftRegistration: "LV-MHZ",
    oilUnitLabel: "Qrt",
    currency: "USD",
  },
  kpiParams: {
    annualInspection: {
      nextDueDate: "",
    },
    inspection50: {
      lastInspectionDate: "",
    },
    inspection100: {
      lastInspectionDate: "",
    },
    oil: {
      currentPrice: "",
      analysisWindowMonths: 6,
    },
    thresholds: {
      annualInspection: {
        dangerDays: 30,
        warningDays: 60,
      },
      inspection50: {
        dangerHours: 5,
        warningHours: 10,
      },
      inspection100: {
        dangerHours: 10,
        warningHours: 20,
      },
    },
    annualUtilizationLegacy: {
      2022: "",
    },
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(base, override) {
  if (!isPlainObject(base)) {
    return override === undefined ? base : override;
  }

  const result = { ...base };

  for (const [key, value] of Object.entries(override ?? {})) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      result[key] = mergeDeep(base[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

export function normalizeSettings(input) {
  return mergeDeep(DEFAULT_SETTINGS, input);
}

async function readResponseData(response) {
  try {
    return await response.json();
  } catch {
    throw new Error("No se pudo leer la respuesta de settings.");
  }
}

export async function fetchSettings(signal) {
  const response = await fetch("/api/settings", {
    method: "GET",
    signal,
    credentials: "include",
  });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  const data = await readResponseData(response);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "No se pudieron cargar los settings.");
  }

  return normalizeSettings(data.settings);
}

export async function saveSettings(nextSettings) {
  const normalized = normalizeSettings(nextSettings);

  const response = await fetch("/api/settings", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      settings: normalized,
    }),
  });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  const data = await readResponseData(response);

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "No se pudieron guardar los settings.");
  }

  return normalizeSettings(data.settings);
}
