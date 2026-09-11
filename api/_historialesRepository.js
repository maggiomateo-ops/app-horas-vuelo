import { resolveAircraftAccess } from "./_adminRepository.js";
import { batchGetSpreadsheetValues } from "./_googleSheets.js";

const RANGE_DEFINITIONS = {
  computacionHoras: {
    range: "'Computacion Horas'!A:N",
    firstDataRowIndex: 1,
    fields: [
      "id",
      "dia",
      "mes",
      "anio",
      "desde",
      "hasta",
      "tiempoVuelo",
      "tiempoEnServicio",
      "piloto",
      "propietario",
      "aceiteAgregado",
      "combustibleTanqueIzquierdo",
      "combustibleTanqueDerecho",
      "observaciones",
    ],
  },
  historialAeronave: {
    range: "'Historial Aeronave'!A:K",
    firstDataRowIndex: 2,
    fields: [
      "id",
      "dia",
      "mes",
      "anio",
      "desde",
      "hasta",
      "tiempoEnServicio",
      "tiempoTotalEnServicio",
      "tiempoDeVuelo",
      "piloto",
      "observaciones",
    ],
  },
  historialMotor: {
    range: "'Historial Motor'!A:J",
    firstDataRowIndex: 2,
    fields: [
      "id",
      "dia",
      "mes",
      "anio",
      "desde",
      "hasta",
      "tiempoEnServicio",
      "tiempoTotalEnServicio",
      "piloto",
      "observaciones",
    ],
  },
  historialHelice: {
    range: "'Historial Helice'!A:K",
    firstDataRowIndex: 2,
    fields: [
      "id",
      "dia",
      "mes",
      "anio",
      "desde",
      "hasta",
      "tiempoEnServicio",
      "tiempoTotalEnServicio",
      "durg",
      "piloto",
      "observaciones",
    ],
  },
};

function isEmptyRow(row) {
  return row.every((cell) => String(cell ?? "").trim() === "");
}

function transformRows(values, definition) {
  return values
    .slice(definition.firstDataRowIndex)
    .filter((row) => !isEmptyRow(row))
    .map((row) =>
      definition.fields.reduce((record, field, index) => {
        record[field] = row[index] || "";
        return record;
      }, {})
    );
}

export async function getHistorialesFromSheets({ userId, aircraftId, mode }) {
  const { spreadsheetId } = await resolveAircraftAccess(userId, aircraftId);
  const keys = mode === "historiales"
    ? ["historialAeronave", "historialMotor", "historialHelice"]
    : [
        "computacionHoras",
        "historialAeronave",
        "historialMotor",
        "historialHelice",
      ];
  const valuesByRange = await batchGetSpreadsheetValues(
    spreadsheetId,
    keys.map((key) => RANGE_DEFINITIONS[key].range)
  );

  return keys.reduce(
    (result, key, index) => {
      result[key] = transformRows(valuesByRange[index], RANGE_DEFINITIONS[key]);
      return result;
    },
    { ok: true }
  );
}
