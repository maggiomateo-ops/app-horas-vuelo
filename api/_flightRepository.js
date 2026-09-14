import { getValidatedAircraftAccess } from "./_adminRepository.js";
import {
  appendSpreadsheetValues,
  batchGetSpreadsheetValues,
  batchUpdateSpreadsheetValues,
  clearSpreadsheetValues,
} from "./_googleSheets.js";

const FLIGHT_SHEET_NAME = "Computacion Horas";
const FLIGHT_ROWS_RANGE = `'${FLIGHT_SHEET_NAME}'!A:N`;
const FLIGHT_IDS_RANGE = `'${FLIGHT_SHEET_NAME}'!A2:A`;
const ALLOWED_MODES = new Set(["create", "update", "delete"]);

function flightError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function buildFlightRow(id, payload) {
  return [
    id,
    payload.dia || "",
    payload.mes || "",
    payload.anio || "",
    payload.desde || "",
    payload.hasta || "",
    payload.tiempoVueloJPI || "",
    payload.tiempoEnServicioGarmin || "",
    payload.piloto || "",
    payload.propietario || "",
    payload.aceiteAgregado || "",
    payload.combustibleTanqueIzquierdo || "",
    payload.combustibleTanqueDerecho || "",
    payload.observaciones || "",
  ];
}

async function findFlightRowNumber(spreadsheetId, id) {
  const [idRows] = await batchGetSpreadsheetValues(spreadsheetId, [FLIGHT_IDS_RANGE]);
  const index = idRows.findIndex((row) => String(row?.[0] ?? "") === String(id));

  if (index === -1) {
    throw flightError(`No se encontro un registro con ID ${id}`, 404);
  }

  return index + 2;
}

export async function saveFlightFromSheets({ userId, aircraftId, payload }) {
  const access = await getValidatedAircraftAccess(userId, aircraftId);
  const role = String(access.permission?.rol || "").trim().toUpperCase();

  if (role !== "OWNER" && role !== "ADMIN") {
    throw flightError("El usuario no tiene permiso para modificar vuelos.", 403);
  }

  const mode = String(payload.modo || "create").trim().toLowerCase();

  if (!ALLOWED_MODES.has(mode)) {
    throw flightError("Modo de operacion de vuelo no valido.", 400);
  }

  const id = payload.id || String(Date.now());

  if (mode === "delete") {
    const rowNumber = await findFlightRowNumber(access.spreadsheetId, id);
    await clearSpreadsheetValues(
      access.spreadsheetId,
      `'${FLIGHT_SHEET_NAME}'!A${rowNumber}:N${rowNumber}`
    );

    return {
      ok: true,
      modo: "delete",
      id,
      message: "Vuelo eliminado correctamente",
    };
  }

  const flightRow = buildFlightRow(id, payload);

  if (mode === "update") {
    const rowNumber = await findFlightRowNumber(access.spreadsheetId, id);
    await batchUpdateSpreadsheetValues(access.spreadsheetId, [
      {
        range: `'${FLIGHT_SHEET_NAME}'!A${rowNumber}:N${rowNumber}`,
        values: [flightRow],
      },
    ]);

    return {
      ok: true,
      modo: "update",
      id,
      message: "Vuelo actualizado correctamente",
    };
  }

  await appendSpreadsheetValues(access.spreadsheetId, FLIGHT_ROWS_RANGE, [flightRow]);

  return {
    ok: true,
    modo: "create",
    id,
    message: "Vuelo guardado correctamente",
  };
}
