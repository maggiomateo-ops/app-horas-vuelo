export const DATA_SOURCE = Object.freeze({
  SHEETS: "SHEETS",
  POSTGRES: "POSTGRES",
});

const SHEETS_ALIASES = new Set([
  "sheets",
  "sheets-api",
  "google-sheets",
  "google_sheets",
  "apps-script",
]);

const POSTGRES_ALIASES = new Set(["postgres", "postgresql"]);

function configurationError(variableName, rawValue) {
  const error = new Error(
    `Valor no soportado para ${variableName}: ${String(rawValue || "").trim()}.`
  );
  error.code = "INVALID_DATA_SOURCE_CONFIGURATION";
  error.statusCode = 500;
  return error;
}

export function resolveDataSource(variableName) {
  const rawValue = String(process.env[variableName] || "").trim();

  if (!rawValue) {
    return DATA_SOURCE.SHEETS;
  }

  const normalized = rawValue.toLowerCase();

  if (SHEETS_ALIASES.has(normalized)) {
    return DATA_SOURCE.SHEETS;
  }

  if (POSTGRES_ALIASES.has(normalized)) {
    return DATA_SOURCE.POSTGRES;
  }

  throw configurationError(variableName, rawValue);
}

export function usesPostgres(variableName) {
  return resolveDataSource(variableName) === DATA_SOURCE.POSTGRES;
}
