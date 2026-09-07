function getAppSecret() {
  const appSecret = PropertiesService
    .getScriptProperties()
    .getProperty("APP_SECRET");

  if (!appSecret) {
    throw new Error("Falta configurar APP_SECRET.");
  }

  return appSecret;
}

const SETTINGS_PROPERTY_KEY = "APP_HORAS_SETTINGS";

const DEFAULT_SETTINGS = {
  appConfig: {
    aircraftName: "App Horas de Vuelo",
    aircraftRegistration: "LV-MHZ",
    oilUnitLabel: "Qrt",
    currency: "USD"
  },
  kpiParams: {
    annualInspection: {
      nextDueDate: ""
    },
    inspection50: {
      cutoffAircraftTotalServiceTime: ""
    },
    inspection100: {
      cutoffAircraftTotalServiceTime: ""
    },
    oil: {
      currentPrice: "",
      analysisWindowMonths: 6
    },
    thresholds: {
      annualInspection: {
        dangerDays: 30,
        warningDays: 60
      },
      inspection50: {
        dangerHours: 5,
        warningHours: 10
      },
      inspection100: {
        dangerHours: 10,
        warningHours: 20
      }
    },
    annualUtilizationLegacy: {
      2022: ""
    }
  }
};

function jsonOutput(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function isAuthorizedRequest(e, body) {
  const expectedSecret = getAppSecret();

  const secretFromQuery = e && e.parameter
    ? String(e.parameter.appSecret || "").trim()
    : "";

  const secretFromBody = body
    ? String(body.appSecret || "").trim()
    : "";

  return (
    secretFromQuery === expectedSecret ||
    secretFromBody === expectedSecret
  );
}

function doPost(e) {
  try {
    let data = {};

    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseError) {
      throw new Error("JSON invalido.");
    }

    if (!isAuthorizedRequest(e, data)) {
      throw new Error("No autorizado.");
    }

    if (data.action === "settings" || data.mode === "saveSettings") {
      const settings = normalizeSettings(data.settings || {});
      saveSettings(settings);

      return jsonOutput({
        ok: true,
        settings: settings
      });
    }

    return handleFlightPost(data);

  } catch (error) {
    return jsonOutput({
      ok: false,
      error: error.message
    });
  }
}

function doGet(e) {
  try {
    if (!isAuthorizedRequest(e, null)) {
      throw new Error("No autorizado.");
    }

    const action = e && e.parameter ? String(e.parameter.action || "").trim() : "";
    if (action === "aircrafts") {
      const userId = e && e.parameter
      ? String(e.parameter.userId || "").trim()
      : "";

      if (!userId) {
       throw new Error("Falta userId.");
      }

      return jsonOutput({
        ok: true,
        aircrafts: getAircraftsForUser(userId)
        });
      }
    if (action === "historiales") {
      const ss = SpreadsheetApp.getActiveSpreadsheet();

      const computacionHoras = leerComputacionHoras(ss, "Computacion Horas");
      const historialAeronave = leerHistorialAeronave(ss, "Historial Aeronave");
      const historialMotor = leerHistorialMotor(ss, "Historial Motor");
      const historialHelice = leerHistorialHelice(ss, "Historial Helice");

      return jsonOutput({
        ok: true,
        computacionHoras: computacionHoras,
        historialAeronave: historialAeronave,
        historialMotor: historialMotor,
        historialHelice: historialHelice
      });
    }

    if (action === "settings") {
      return jsonOutput({
        ok: true,
        settings: getStoredSettings()
      });
    }

    return jsonOutput({
      ok: false,
      error: "Acción no válida. Usa ?action=historiales o ?action=settings"
    });

  } catch (error) {
    return jsonOutput({
      ok: false,
      error: error.message
    });
  }
}

function handleFlightPost(data) {
  const sheetName = "Computacion Horas";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("No se encontró la hoja: " + sheetName);
  }

  const modo = data.modo || "create";
  const id = data.id || String(Date.now());

  if (modo === "delete") {
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      throw new Error("No hay registros para borrar.");
    }

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const index = ids.findIndex(function(value) {
      return String(value) === String(id);
    });

    if (index === -1) {
      throw new Error("No se encontró un registro con ID " + id);
    }

    const filaReal = index + 2;
    sheet.getRange(filaReal, 1, 1, 14).clearContent();

    return jsonOutput({
      ok: true,
      modo: "delete",
      id: id,
      message: "Vuelo eliminado correctamente"
    });
  }

  const filaData = [
    id,
    data.dia || "",
    data.mes || "",
    data.anio || "",
    data.desde || "",
    data.hasta || "",
    data.tiempoVueloJPI || "",
    data.tiempoEnServicioGarmin || "",
    data.piloto || "",
    data.propietario || "",
    data.aceiteAgregado || "",
    data.combustibleTanqueIzquierdo || "",
    data.combustibleTanqueDerecho || "",
    data.observaciones || ""
  ];

  if (modo === "update") {
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      throw new Error("No hay registros para actualizar.");
    }

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    const index = ids.findIndex(function(value) {
      return String(value) === String(id);
    });

    if (index === -1) {
      throw new Error("No se encontró un registro con ID " + id);
    }

    const filaReal = index + 2;
    sheet.getRange(filaReal, 1, 1, 14).setValues([filaData]);

    return jsonOutput({
      ok: true,
      modo: "update",
      id: id,
      message: "Vuelo actualizado correctamente"
    });
  }

  const filaInicio = 2;
  const ultimaFila = sheet.getLastRow();
  const filaDestino = Math.max(ultimaFila + 1, filaInicio);

  sheet.getRange(filaDestino, 1, 1, 14).setValues([filaData]);

  return jsonOutput({
    ok: true,
    modo: "create",
    id: id,
    message: "Vuelo guardado correctamente"
  });
}

function leerComputacionHoras(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("No se encontró la hoja: " + sheetName);
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 2) {
    return [];
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();

  return rows
    .filter(function(row) {
      return !filaVacia(row);
    })
    .map(function(row) {
      return {
        id: row[0] || "",
        dia: row[1] || "",
        mes: row[2] || "",
        anio: row[3] || "",
        desde: row[4] || "",
        hasta: row[5] || "",
        tiempoVuelo: row[6] || "",
        tiempoEnServicio: row[7] || "",
        piloto: row[8] || "",
        propietario: row[9] || "",
        aceiteAgregado: row[10] || "",
        combustibleTanqueIzquierdo: row[11] || "",
        combustibleTanqueDerecho: row[12] || "",
        observaciones: row[13] || ""
      };
    });
}

function leerHistorialAeronave(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("No se encontró la hoja: " + sheetName);
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 3) {
    return [];
  }

  const rows = sheet.getRange(3, 1, lastRow - 2, lastColumn).getValues();

  return rows
    .filter(function(row) {
      return !filaVacia(row);
    })
    .map(function(row) {
      return {
        id: row[0] || "",
        dia: row[1] || "",
        mes: row[2] || "",
        anio: row[3] || "",
        desde: row[4] || "",
        hasta: row[5] || "",
        tiempoEnServicio: row[6] || "",
        tiempoTotalEnServicio: row[7] || "",
        tiempoDeVuelo: row[8] || "",
        piloto: row[9] || "",
        observaciones: row[10] || ""
      };
    });
}

function leerHistorialMotor(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("No se encontró la hoja: " + sheetName);
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 3) {
    return [];
  }

  const rows = sheet.getRange(3, 1, lastRow - 2, lastColumn).getValues();

  return rows
    .filter(function(row) {
      return !filaVacia(row);
    })
    .map(function(row) {
      return {
        id: row[0] || "",
        dia: row[1] || "",
        mes: row[2] || "",
        anio: row[3] || "",
        desde: row[4] || "",
        hasta: row[5] || "",
        tiempoEnServicio: row[6] || "",
        tiempoTotalEnServicio: row[7] || "",
        piloto: row[8] || "",
        observaciones: row[9] || ""
      };
    });
}

function leerHistorialHelice(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error("No se encontró la hoja: " + sheetName);
  }

  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();

  if (lastRow < 3) {
    return [];
  }

  const rows = sheet.getRange(3, 1, lastRow - 2, lastColumn).getValues();

  return rows
    .filter(function(row) {
      return !filaVacia(row);
    })
    .map(function(row) {
      return {
        id: row[0] || "",
        dia: row[1] || "",
        mes: row[2] || "",
        anio: row[3] || "",
        desde: row[4] || "",
        hasta: row[5] || "",
        tiempoEnServicio: row[6] || "",
        tiempoTotalEnServicio: row[7] || "",
        durg: row[8] || "",
        piloto: row[9] || "",
        observaciones: row[10] || ""
      };
    });
}

function filaVacia(row) {
  return row.every(function(cell) {
    return String(cell).trim() === "";
  });
}

function getStoredSettings() {
  const properties = PropertiesService.getDocumentProperties();
  const rawValue = properties.getProperty(SETTINGS_PROPERTY_KEY);

  if (!rawValue) {
    return cloneObject(DEFAULT_SETTINGS);
  }

  try {
    return normalizeSettings(JSON.parse(rawValue));
  } catch (error) {
    return cloneObject(DEFAULT_SETTINGS);
  }
}

function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  PropertiesService
    .getDocumentProperties()
    .setProperty(SETTINGS_PROPERTY_KEY, JSON.stringify(normalized));
}

function normalizeSettings(input) {
  return mergeDeep(DEFAULT_SETTINGS, input || {});
}

function mergeDeep(base, override) {
  if (!isPlainObject(base)) {
    return override === undefined ? base : override;
  }

  const result = cloneObject(base);

  Object.keys(override || {}).forEach(function(key) {
    const value = override[key];

    if (isPlainObject(value) && isPlainObject(base[key])) {
      result[key] = mergeDeep(base[key], value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  });

  return result;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneObject(value) {
  return JSON.parse(JSON.stringify(value));
}
function getAdminSpreadsheet() {
  const adminSpreadsheetId = PropertiesService
    .getScriptProperties()
    .getProperty("ADMIN_SPREADSHEET_ID");

  if (!adminSpreadsheetId) {
    throw new Error("Falta configurar ADMIN_SPREADSHEET_ID.");
  }

  return SpreadsheetApp.openById(adminSpreadsheetId);
}

function getAircraftById(aircraftId) {
  const ss = getAdminSpreadsheet();
  const sheet = ss.getSheetByName("AERONAVES");

  if (!sheet) {
    throw new Error("No se encontró la hoja AERONAVES.");
  }

  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    throw new Error("La hoja AERONAVES no tiene datos.");
  }

  const headers = values[0].map(function(value) {
    return String(value).trim();
  });

  const aircraftIdIndex = headers.indexOf("aircraft_id");

  if (aircraftIdIndex === -1) {
    throw new Error("No se encontró la columna aircraft_id.");
  }

  const row = values.slice(1).find(function(currentRow) {
    return String(currentRow[aircraftIdIndex]).trim() === String(aircraftId).trim();
  });

  if (!row) {
    throw new Error("No se encontró la aeronave " + aircraftId);
  }

  const result = {};

  headers.forEach(function(header, index) {
    result[header] = row[index];
  });

  return result;
}
function getAircraftSpreadsheetById(aircraftId) {
  const aircraft = getAircraftById(aircraftId);

  if (String(aircraft.estado).trim().toUpperCase() !== "ACTIVA") {
    throw new Error("La aeronave " + aircraftId + " no está activa.");
  }

  const spreadsheetId = String(aircraft.spreadsheet_id || "").trim();

  if (!spreadsheetId) {
    throw new Error("La aeronave " + aircraftId + " no tiene spreadsheet_id configurado.");
  }

  return SpreadsheetApp.openById(spreadsheetId);
}

function getUserById(userId) {
  const ss = getAdminSpreadsheet();
  const sheet = ss.getSheetByName("USUARIOS");

  if (!sheet) {
    throw new Error("No se encontró la hoja USUARIOS.");
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(value) {
    return String(value).trim();
  });

  const userIdIndex = headers.indexOf("user_id");

  if (userIdIndex === -1) {
    throw new Error("No se encontró la columna user_id.");
  }

  const row = values.slice(1).find(function(currentRow) {
    return String(currentRow[userIdIndex]).trim() === String(userId).trim();
  });

  if (!row) {
    throw new Error("No se encontró el usuario " + userId);
  }

  const result = {};

  headers.forEach(function(header, index) {
    result[header] = row[index];
  });

  return result;
}

function getUserPermissionForAircraft(userId, aircraftId) {
  const ss = getAdminSpreadsheet();
  const sheet = ss.getSheetByName("PERMISOS");

  if (!sheet) {
    throw new Error("No se encontró la hoja PERMISOS.");
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(value) {
    return String(value).trim();
  });

  const userIdIndex = headers.indexOf("user_id");
  const aircraftIdIndex = headers.indexOf("aircraft_id");

  if (userIdIndex === -1 || aircraftIdIndex === -1) {
    throw new Error("Faltan columnas requeridas en PERMISOS.");
  }

  const row = values.slice(1).find(function(currentRow) {
    return (
      String(currentRow[userIdIndex]).trim() === String(userId).trim() &&
      String(currentRow[aircraftIdIndex]).trim() === String(aircraftId).trim()
    );
  });

  if (!row) {
    throw new Error("El usuario " + userId + " no tiene permiso sobre " + aircraftId);
  }

  const result = {};

  headers.forEach(function(header, index) {
    result[header] = row[index];
  });

  return result;
}

function validateUserAircraftAccess(userId, aircraftId) {
  const user = getUserById(userId);
  const permission = getUserPermissionForAircraft(userId, aircraftId);
  const aircraft = getAircraftById(aircraftId);

  if (String(user.estado).trim().toUpperCase() !== "ACTIVO") {
    throw new Error("El usuario " + userId + " no está activo.");
  }

  if (String(permission.estado).trim().toUpperCase() !== "ACTIVO") {
    throw new Error("El permiso no está activo.");
  }

  if (String(aircraft.estado).trim().toUpperCase() !== "ACTIVA") {
    throw new Error("La aeronave " + aircraftId + " no está activa.");
  }

  return {
    user: user,
    permission: permission,
    aircraft: aircraft
  };
}
function getAircraftsForUser(userId) {
  const user = getUserById(userId);

  if (String(user.estado).trim().toUpperCase() !== "ACTIVO") {
    throw new Error("El usuario " + userId + " no está activo.");
  }

  const adminSs = getAdminSpreadsheet();

  const permissionsSheet = adminSs.getSheetByName("PERMISOS");
  const aircraftSheet = adminSs.getSheetByName("AERONAVES");

  if (!permissionsSheet) {
    throw new Error("No se encontró la hoja PERMISOS.");
  }

  if (!aircraftSheet) {
    throw new Error("No se encontró la hoja AERONAVES.");
  }

  const permissionValues = permissionsSheet.getDataRange().getValues();
  const permissionHeaders = permissionValues[0].map(function(value) {
    return String(value).trim();
  });

  const pUserId = permissionHeaders.indexOf("user_id");
  const pAircraftId = permissionHeaders.indexOf("aircraft_id");
  const pRole = permissionHeaders.indexOf("rol");
  const pStatus = permissionHeaders.indexOf("estado");

  const aircraftValues = aircraftSheet.getDataRange().getValues();
  const aircraftHeaders = aircraftValues[0].map(function(value) {
    return String(value).trim();
  });

  const aAircraftId = aircraftHeaders.indexOf("aircraft_id");
  const aRegistration = aircraftHeaders.indexOf("matricula");
  const aManufacturer = aircraftHeaders.indexOf("fabricante");
  const aModel = aircraftHeaders.indexOf("modelo");
  const aStatus = aircraftHeaders.indexOf("estado");

  return permissionValues
    .slice(1)
    .filter(function(row) {
      return (
        String(row[pUserId]).trim() === String(userId).trim() &&
        String(row[pStatus]).trim().toUpperCase() === "ACTIVO"
      );
    })
    .map(function(permissionRow) {
      const aircraftId = String(permissionRow[pAircraftId]).trim();

      const aircraftRow = aircraftValues.slice(1).find(function(row) {
        return String(row[aAircraftId]).trim() === aircraftId;
      });

      if (!aircraftRow) {
        return null;
      }

      if (String(aircraftRow[aStatus]).trim().toUpperCase() !== "ACTIVA") {
        return null;
      }

      return {
        aircraft_id: aircraftId,
        matricula: aircraftRow[aRegistration],
        fabricante: aircraftRow[aManufacturer],
        modelo: aircraftRow[aModel],
        rol: permissionRow[pRole]
      };
    })
    .filter(function(aircraft) {
      return aircraft !== null;
    });
}

