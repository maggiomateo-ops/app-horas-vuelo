import { batchGetSpreadsheetValues } from "./_googleSheets.js";

const ADMIN_RANGES = ["USUARIOS!A:E", "PERMISOS!A:D", "AERONAVES!A:F"];

function rowsToRecords(values, requiredHeaders, sheetName) {
  if (!values.length) {
    throw new Error(`La hoja ${sheetName} no tiene datos.`);
  }

  const headers = values[0].map((value) => String(value ?? "").trim());
  const indexes = requiredHeaders.map((header) => headers.indexOf(header));

  if (indexes.some((index) => index === -1)) {
    throw new Error(`Faltan columnas requeridas en ${sheetName}.`);
  }

  return values.slice(1).map((row) =>
    requiredHeaders.reduce((record, header, index) => {
      record[header] = row[indexes[index]] ?? "";
      return record;
    }, {})
  );
}

export async function resolveAircraftAccess(userId, aircraftId) {
  const adminSpreadsheetId = String(process.env.ADMIN_SPREADSHEET_ID || "").trim();

  if (!adminSpreadsheetId) {
    throw new Error("Falta ADMIN_SPREADSHEET_ID en variables de entorno.");
  }

  const [userValues, permissionValues, aircraftValues] =
    await batchGetSpreadsheetValues(adminSpreadsheetId, ADMIN_RANGES);
  const users = rowsToRecords(
    userValues,
    ["user_id", "email", "nombre", "estado"],
    "USUARIOS"
  );
  const permissions = rowsToRecords(
    permissionValues,
    ["user_id", "aircraft_id", "rol", "estado"],
    "PERMISOS"
  );
  const aircrafts = rowsToRecords(
    aircraftValues,
    ["aircraft_id", "matricula", "fabricante", "modelo", "spreadsheet_id", "estado"],
    "AERONAVES"
  );
  const normalizedUserId = String(userId || "").trim();
  const normalizedAircraftId = String(aircraftId || "").trim();
  const user = users.find(
    (currentUser) => String(currentUser.user_id).trim() === normalizedUserId
  );

  if (!user) {
    throw new Error("El usuario no existe.");
  }

  if (String(user.estado).trim().toUpperCase() !== "ACTIVO") {
    throw new Error("El usuario no esta activo.");
  }

  const permission = permissions.find(
    (currentPermission) =>
      String(currentPermission.user_id).trim() === normalizedUserId &&
      String(currentPermission.aircraft_id).trim() === normalizedAircraftId
  );

  if (!permission) {
    throw new Error("El usuario no tiene permiso sobre la aeronave.");
  }

  if (String(permission.estado).trim().toUpperCase() !== "ACTIVO") {
    throw new Error("El permiso no esta activo.");
  }

  const aircraft = aircrafts.find(
    (currentAircraft) =>
      String(currentAircraft.aircraft_id).trim() === normalizedAircraftId
  );

  if (!aircraft) {
    throw new Error("La aeronave no existe.");
  }

  if (String(aircraft.estado).trim().toUpperCase() !== "ACTIVA") {
    throw new Error("La aeronave no esta activa.");
  }

  const spreadsheetId = String(aircraft.spreadsheet_id || "").trim();

  if (!spreadsheetId) {
    throw new Error("La aeronave no tiene una planilla configurada.");
  }

  return { user, permission, aircraft, spreadsheetId };
}
