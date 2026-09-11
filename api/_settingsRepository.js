import { getValidatedAircraftAccess } from "./_adminRepository.js";
import { batchGetSpreadsheetValues } from "./_googleSheets.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/services/settingsService.js";

const SETTINGS_KEY = "APP_HORAS_SETTINGS";
const SETTINGS_RANGE = ["CONFIGURACION!A:B"];

function createSettingsError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function getSettingsFromSheets({ userId, aircraftId }) {
  const { spreadsheetId } = await getValidatedAircraftAccess(userId, aircraftId);
  const [values] = await batchGetSpreadsheetValues(spreadsheetId, SETTINGS_RANGE);
  const settingsRow = values.slice(1).find(
    (row) => String(row[0] || "").trim() === SETTINGS_KEY
  );

  if (!settingsRow) {
    if (String(aircraftId).trim() === "A001") {
      throw createSettingsError(
        "No se encontro APP_HORAS_SETTINGS para A001.",
        "A001_LEGACY_SETTINGS_UNAVAILABLE"
      );
    }

    return normalizeSettings(DEFAULT_SETTINGS);
  }

  let storedSettings;

  try {
    storedSettings = JSON.parse(String(settingsRow[1] || ""));
  } catch {
    throw createSettingsError(
      "El valor APP_HORAS_SETTINGS de CONFIGURACION no contiene JSON válido.",
      "INVALID_SETTINGS_JSON"
    );
  }

  return normalizeSettings(storedSettings);
}
