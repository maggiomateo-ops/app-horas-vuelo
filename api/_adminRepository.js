import {
  batchGetSpreadsheetValues,
  batchUpdateSpreadsheetValues,
} from "./_googleSheets.js";

const ADMIN_RANGES = ["USUARIOS!A:K", "PERMISOS!A:H", "AERONAVES!A:H"];

function createRepositoryError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getAdminSpreadsheetId() {
  const adminSpreadsheetId = String(process.env.ADMIN_SPREADSHEET_ID || "").trim();

  if (!adminSpreadsheetId) {
    throw new Error("Falta ADMIN_SPREADSHEET_ID en variables de entorno.");
  }

  return adminSpreadsheetId;
}

function rowsToRecords(values, requiredHeaders, sheetName) {
  if (!values.length) {
    throw new Error(`La hoja ${sheetName} no tiene datos.`);
  }

  const headers = values[0].map((value) => String(value ?? "").trim());
  const indexes = requiredHeaders.map((header) => headers.indexOf(header));

  if (indexes.some((index) => index === -1)) {
    throw new Error(`Faltan columnas requeridas en ${sheetName}.`);
  }

  return values.slice(1).map((row, rowOffset) =>
    requiredHeaders.reduce((record, header, index) => {
      record[header] = row[indexes[index]] ?? "";
      record.__rowNumber = rowOffset + 2;
      return record;
    }, {})
  );
}

async function getAdminData() {
  const adminSpreadsheetId = getAdminSpreadsheetId();
  const [userValues, permissionValues, aircraftValues] =
    await batchGetSpreadsheetValues(adminSpreadsheetId, ADMIN_RANGES);

  return {
    users: rowsToRecords(
      userValues,
      ["user_id", "email", "nombre", "estado", "google_sub", "is_admin"],
      "USUARIOS"
    ),
    permissions: rowsToRecords(
      permissionValues,
      ["user_id", "aircraft_id", "rol", "estado"],
      "PERMISOS"
    ),
    aircrafts: rowsToRecords(
      aircraftValues,
      ["aircraft_id", "matricula", "fabricante", "modelo", "spreadsheet_id", "estado"],
      "AERONAVES"
    ),
  };
}

function findActiveUserById(users, userId) {
  const normalizedUserId = String(userId || "").trim();
  const user = users.find(
    (currentUser) => String(currentUser.user_id).trim() === normalizedUserId
  );

  if (!user) throw new Error("El usuario no existe.");
  if (String(user.estado).trim().toUpperCase() !== "ACTIVO") {
    throw new Error("El usuario no esta activo.");
  }

  return user;
}

function normalizeBoolean(value) {
  return value === true || String(value ?? "").trim().toUpperCase() === "TRUE";
}

function sanitizeUser(user) {
  return {
    user_id: String(user.user_id).trim(),
    email: String(user.email).trim().toLowerCase(),
    nombre: String(user.nombre).trim(),
    estado: String(user.estado).trim(),
    google_sub: String(user.google_sub || "").trim(),
    is_admin: normalizeBoolean(user.is_admin),
  };
}

export async function getActiveUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) throw new Error("Falta email.");

  const { users } = await getAdminData();
  const user = users.find(
    (currentUser) => String(currentUser.email).trim().toLowerCase() === normalizedEmail
  );

  if (!user) {
    throw createRepositoryError(
      "No se encontro un usuario con ese email.",
      "USER_NOT_AUTHORIZED"
    );
  }

  const status = String(user.estado).trim();
  if (status.toUpperCase() !== "ACTIVO") {
    throw createRepositoryError("El usuario no esta activo.", "USER_NOT_AUTHORIZED");
  }

  return sanitizeUser(user);
}

export async function resolveGoogleUser({ email, googleSub }) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedGoogleSub = String(googleSub || "").trim();

  if (!normalizedEmail || !normalizedGoogleSub) {
    throw createRepositoryError(
      "Faltan datos de identidad de Google.",
      "INVALID_GOOGLE_IDENTITY"
    );
  }

  const adminSpreadsheetId = getAdminSpreadsheetId();
  let { users } = await getAdminData();

  const userBySub = users.find(
    (user) => String(user.google_sub || "").trim() === normalizedGoogleSub
  );

  if (userBySub) {
    const resolved = sanitizeUser(userBySub);

    if (resolved.estado.toUpperCase() !== "ACTIVO") {
      throw createRepositoryError("El usuario no esta activo.", "USER_NOT_AUTHORIZED");
    }

    if (resolved.email !== normalizedEmail) {
      throw createRepositoryError(
        "La identidad de Google no coincide con el email autorizado.",
        "GOOGLE_IDENTITY_MISMATCH"
      );
    }

    return resolved;
  }

  const userByEmail = users.find(
    (user) => String(user.email).trim().toLowerCase() === normalizedEmail
  );

  if (!userByEmail || String(userByEmail.estado).trim().toUpperCase() !== "ACTIVO") {
    throw createRepositoryError("Usuario no habilitado.", "USER_NOT_AUTHORIZED");
  }

  const existingSub = String(userByEmail.google_sub || "").trim();
  if (existingSub && existingSub !== normalizedGoogleSub) {
    throw createRepositoryError(
      "La cuenta de Google no coincide con la identidad registrada.",
      "GOOGLE_IDENTITY_MISMATCH"
    );
  }

  if (!existingSub) {
    const latestAdminData = await getAdminData();
    const latestUser = latestAdminData.users.find(
      (user) => String(user.user_id).trim() === String(userByEmail.user_id).trim()
    );

    if (!latestUser || String(latestUser.estado).trim().toUpperCase() !== "ACTIVO") {
      throw createRepositoryError("Usuario no habilitado.", "USER_NOT_AUTHORIZED");
    }

    const conflictingUser = latestAdminData.users.find(
      (user) =>
        String(user.user_id).trim() !== String(userByEmail.user_id).trim() &&
        String(user.google_sub || "").trim() === normalizedGoogleSub
    );

    if (conflictingUser) {
      throw createRepositoryError(
        "La identidad de Google ya esta vinculada a otro usuario.",
        "GOOGLE_IDENTITY_MISMATCH"
      );
    }

    const latestSub = String(latestUser.google_sub || "").trim();

    if (latestSub && latestSub !== normalizedGoogleSub) {
      throw createRepositoryError(
        "La identidad de Google fue vinculada por otra sesion.",
        "GOOGLE_IDENTITY_MISMATCH"
      );
    }

    if (!latestSub) {
      const rowNumber = Number(latestUser.__rowNumber);

      if (!Number.isInteger(rowNumber) || rowNumber < 2) {
        throw new Error("No se pudo determinar la fila del usuario en USUARIOS.");
      }

      await batchUpdateSpreadsheetValues(adminSpreadsheetId, [
        {
          range: `USUARIOS!E${rowNumber}`,
          values: [[normalizedGoogleSub]],
        },
      ]);
    }

    users = (await getAdminData()).users;
  }

  const resolvedUser = users.find(
    (user) => String(user.user_id).trim() === String(userByEmail.user_id).trim()
  );

  if (!resolvedUser) {
    throw new Error("No se pudo releer el usuario despues de vincular Google.");
  }

  return sanitizeUser(resolvedUser);
}

export async function getAircraftsForUser(userId) {
  const adminData = await getAdminData();
  const user = findActiveUserById(adminData.users, userId);
  const normalizedUserId = String(user.user_id).trim();

  return adminData.permissions
    .filter(
      (permission) =>
        String(permission.user_id).trim() === normalizedUserId &&
        String(permission.estado).trim().toUpperCase() === "ACTIVO"
    )
    .map((permission) => {
      const aircraftId = String(permission.aircraft_id).trim();
      const aircraft = adminData.aircrafts.find(
        (currentAircraft) => String(currentAircraft.aircraft_id).trim() === aircraftId
      );

      if (!aircraft || String(aircraft.estado).trim().toUpperCase() !== "ACTIVA") {
        return null;
      }

      return {
        aircraft_id: aircraftId,
        matricula: aircraft.matricula,
        fabricante: aircraft.fabricante,
        modelo: aircraft.modelo,
        rol: permission.rol,
      };
    })
    .filter((aircraft) => aircraft !== null);
}

export async function getValidatedAircraftAccess(userId, aircraftId) {
  const adminData = await getAdminData();
  const user = findActiveUserById(adminData.users, userId);
  const normalizedUserId = String(user.user_id).trim();
  const normalizedAircraftId = String(aircraftId || "").trim();
  const permission = adminData.permissions.find(
    (currentPermission) =>
      String(currentPermission.user_id).trim() === normalizedUserId &&
      String(currentPermission.aircraft_id).trim() === normalizedAircraftId
  );

  if (!permission) throw new Error("El usuario no tiene permiso sobre la aeronave.");
  if (String(permission.estado).trim().toUpperCase() !== "ACTIVO") {
    throw new Error("El permiso no esta activo.");
  }

  const aircraft = adminData.aircrafts.find(
    (currentAircraft) => String(currentAircraft.aircraft_id).trim() === normalizedAircraftId
  );

  if (!aircraft) throw new Error("La aeronave no existe.");
  if (String(aircraft.estado).trim().toUpperCase() !== "ACTIVA") {
    throw new Error("La aeronave no esta activa.");
  }

  const spreadsheetId = String(aircraft.spreadsheet_id || "").trim();
  if (!spreadsheetId) throw new Error("La aeronave no tiene una planilla configurada.");

  return { user, permission, aircraft, spreadsheetId };
}

export const resolveAircraftAccess = getValidatedAircraftAccess;
