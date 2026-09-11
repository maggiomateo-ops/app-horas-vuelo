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
      aircraftRegistration: "",
      oilUnitLabel: "Qrt",
      currency: "USD"
    },
    operationalConfig: {
      ownerOptions: [],
      defaultOrigin: "",
      defaultDestination: "",
      defaultFlightTimeJPI: "",
      defaultServiceTimeGarmin: ""
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
        const userId = String(data.userId || "").trim();
        const aircraftId = String(data.aircraftId || "").trim();
        const settings = saveAircraftSettings(userId, aircraftId, data.settings || {});

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
      if (action === "resolveUser") {
        const email = e && e.parameter
          ? String(e.parameter.email || "").trim()
          : "";

        if (!email) {
          throw new Error("Falta email.");
        }

        return jsonOutput({
          ok: true,
          user: getUserByEmail(email)
        });
      }

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
        const userId = e && e.parameter
          ? String(e.parameter.userId || "").trim()
          : "";
        const aircraftId = e && e.parameter
          ? String(e.parameter.aircraftId || "").trim()
          : "";
        const mode = e && e.parameter
          ? String(e.parameter.mode || "").trim().toLowerCase()
          : "";

        if (!userId) {
          throw new Error("Falta userId.");
        }

        if (!aircraftId) {
          throw new Error("Falta aircraftId.");
        }

        const access = getValidatedAccessContext(userId, aircraftId);
        const ss = getAircraftSpreadsheet(access.aircraft, aircraftId);

        if (mode === "historiales") {
          return jsonOutput({
            ok: true,
            historialAeronave: leerHistorialAeronave(ss, "Historial Aeronave"),
            historialMotor: leerHistorialMotor(ss, "Historial Motor"),
            historialHelice: leerHistorialHelice(ss, "Historial Helice")
          });
        }

        if (mode && mode !== "dashboard") {
          throw new Error("Modo de historiales no válido.");
        }

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
        const userId = e && e.parameter
          ? String(e.parameter.userId || "").trim()
          : "";
        const aircraftId = e && e.parameter
          ? String(e.parameter.aircraftId || "").trim()
          : "";

        if (!userId) {
          throw new Error("Falta userId.");
        }

        if (!aircraftId) {
          throw new Error("Falta aircraftId.");
        }

        return jsonOutput({
          ok: true,
          settings: getAircraftSettings(userId, aircraftId)
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
    const userId = String(data.userId || "").trim();
    const aircraftId = String(data.aircraftId || "").trim();

    if (!userId) {
      throw new Error("Falta userId.");
    }

    if (!aircraftId) {
      throw new Error("Falta aircraftId.");
    }

    const access = getValidatedAccessContext(userId, aircraftId);
    const role = String(access.permission.rol || "").trim().toUpperCase();

    if (role !== "OWNER" && role !== "ADMIN") {
      throw new Error("El usuario no tiene permiso para modificar vuelos.");
    }

    const sheetName = "Computacion Horas";
    const ss = getAircraftSpreadsheet(access.aircraft, aircraftId);
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

  function getAircraftConfigurationSheet(ss) {
    const sheet = ss.getSheetByName("CONFIGURACION");

    if (!sheet) {
      throw new Error("No se encontró la hoja CONFIGURACION.");
    }

    return sheet;
  }

  function getAircraftConfigurationValue(sheet, key) {
    const lastRow = sheet.getLastRow();

    if (lastRow < 2) {
      return null;
    }

    const values = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    const row = values.find(function(currentRow) {
      return String(currentRow[0]).trim() === key;
    });

    return row ? row[1] : null;
  }

  function setAircraftConfigurationValue(sheet, key, value) {
    const lastRow = sheet.getLastRow();

    if (lastRow >= 2) {
      const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
      const index = keys.findIndex(function(currentKey) {
        return String(currentKey).trim() === key;
      });

      if (index !== -1) {
        sheet.getRange(index + 2, 2).setValue(value);
        return;
      }
    }

    sheet.appendRow([key, value]);
  }

  function getAircraftSettings(userId, aircraftId) {
    const access = getValidatedAccessContext(userId, aircraftId);
    const ss = getAircraftSpreadsheet(access.aircraft, aircraftId);
    const sheet = getAircraftConfigurationSheet(ss);
    const rawValue = getAircraftConfigurationValue(sheet, SETTINGS_PROPERTY_KEY);

    if (rawValue === null) {
      return aircraftId === "A001"
        ? getStoredSettings()
        : cloneObject(DEFAULT_SETTINGS);
    }

    try {
      return normalizeSettings(JSON.parse(String(rawValue)));
    } catch (error) {
      throw new Error("El valor APP_HORAS_SETTINGS de CONFIGURACION no contiene JSON válido.");
    }
  }

  function saveAircraftSettings(userId, aircraftId, settings) {
    if (!userId) {
      throw new Error("Falta userId.");
    }

    if (!aircraftId) {
      throw new Error("Falta aircraftId.");
    }

    const access = getValidatedAccessContext(userId, aircraftId);
    const role = String(access.permission.rol || "").trim().toUpperCase();

    if (role !== "OWNER" && role !== "ADMIN") {
      throw new Error("El usuario no tiene permiso para modificar settings.");
    }

    const normalized = normalizeSettings(settings);
    const ss = getAircraftSpreadsheet(access.aircraft, aircraftId);
    const sheet = getAircraftConfigurationSheet(ss);

    setAircraftConfigurationValue(
      sheet,
      SETTINGS_PROPERTY_KEY,
      JSON.stringify(normalized)
    );

    return normalized;
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

  const ADMIN_CACHE_KEY = "APP_HORAS_ADMIN_DATA_V1";
  const ADMIN_CACHE_TTL_SECONDS = 60;

  function readAdminSheetRecords(ss, sheetName, requiredHeaders) {
    const sheet = ss.getSheetByName(sheetName);

    if (!sheet) {
      throw new Error("No se encontró la hoja " + sheetName + ".");
    }

    const values = sheet.getDataRange().getValues();

    if (!values.length) {
      return [];
    }

    const headers = values[0].map(function(value) {
      return String(value).trim();
    });
    const indexes = requiredHeaders.map(function(header) {
      return headers.indexOf(header);
    });

    if (indexes.some(function(index) { return index === -1; })) {
      throw new Error("Faltan columnas requeridas en " + sheetName + ".");
    }

    return values.slice(1).map(function(row) {
      const record = {};

      requiredHeaders.forEach(function(header, index) {
        record[header] = row[indexes[index]];
      });

      return record;
    });
  }

  function loadAdminData() {
    const ss = getAdminSpreadsheet();

    return {
      users: readAdminSheetRecords(
        ss,
        "USUARIOS",
        ["user_id", "email", "nombre", "estado"]
      ),
      permissions: readAdminSheetRecords(
        ss,
        "PERMISOS",
        ["user_id", "aircraft_id", "rol", "estado"]
      ),
      aircrafts: readAdminSheetRecords(
        ss,
        "AERONAVES",
        ["aircraft_id", "matricula", "fabricante", "modelo", "spreadsheet_id", "estado"]
      )
    };
  }

  function getAdminData() {
    let cache = null;

    try {
      cache = CacheService.getScriptCache();
      const cachedValue = cache.get(ADMIN_CACHE_KEY);

      if (cachedValue) {
        const parsed = JSON.parse(cachedValue);

        if (
          Array.isArray(parsed.users) &&
          Array.isArray(parsed.permissions) &&
          Array.isArray(parsed.aircrafts)
        ) {
          return parsed;
        }
      }
    } catch (cacheReadError) {
      cache = null;
    }

    const adminData = loadAdminData();

    try {
      (cache || CacheService.getScriptCache()).put(
        ADMIN_CACHE_KEY,
        JSON.stringify(adminData),
        ADMIN_CACHE_TTL_SECONDS
      );
    } catch (cacheWriteError) {
      // La caché es opcional; los datos leídos de Sheets siguen siendo válidos.
    }

    return adminData;
  }

  function getAircraftById(aircraftId, adminData) {
    const aircrafts = (adminData || getAdminData()).aircrafts;

    if (!aircrafts.length) {
      throw new Error("La hoja AERONAVES no tiene datos.");
    }

    const aircraft = aircrafts.find(function(currentAircraft) {
      return String(currentAircraft.aircraft_id).trim() === String(aircraftId).trim();
    });

    if (!aircraft) {
      throw new Error("No se encontró la aeronave " + aircraftId);
    }

    return aircraft;
  }
  function getAircraftSpreadsheetById(aircraftId) {
    const aircraft = getAircraftById(aircraftId);

    return getAircraftSpreadsheet(aircraft, aircraftId);
  }

  function getAircraftSpreadsheet(aircraft, aircraftId) {
    if (String(aircraft.estado).trim().toUpperCase() !== "ACTIVA") {
      throw new Error("La aeronave " + aircraftId + " no está activa.");
    }

    const spreadsheetId = String(aircraft.spreadsheet_id || "").trim();

    if (!spreadsheetId) {
      throw new Error("La aeronave " + aircraftId + " no tiene spreadsheet_id configurado.");
    }

    return SpreadsheetApp.openById(spreadsheetId);
  }

  function getUserById(userId, adminData) {
    const users = (adminData || getAdminData()).users;
    const user = users.find(function(currentUser) {
      return String(currentUser.user_id).trim() === String(userId).trim();
    });

    if (!user) {
      throw new Error("No se encontró el usuario " + userId);
    }

    return user;
  }

  function getUserByEmail(email) {
    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!normalizedEmail) {
      throw new Error("Falta email.");
    }

    const users = getAdminData().users;
    const user = users.find(function(currentUser) {
      return String(currentUser.email).trim().toLowerCase() === normalizedEmail;
    });

    if (!user) {
      throw new Error("No se encontró un usuario con ese email.");
    }

    const status = String(user.estado).trim();

    if (status.toUpperCase() !== "ACTIVO") {
      throw new Error("El usuario no está activo.");
    }

    return {
      user_id: String(user.user_id).trim(),
      email: String(user.email).trim(),
      nombre: String(user.nombre).trim(),
      estado: status
    };
  }

  function getUserPermissionForAircraft(userId, aircraftId, adminData) {
    const permissions = (adminData || getAdminData()).permissions;
    const permission = permissions.find(function(currentPermission) {
      return (
        String(currentPermission.user_id).trim() === String(userId).trim() &&
        String(currentPermission.aircraft_id).trim() === String(aircraftId).trim()
      );
    });

    if (!permission) {
      throw new Error("El usuario " + userId + " no tiene permiso sobre " + aircraftId);
    }

    return permission;
  }

  function validateUserAircraftAccess(userId, aircraftId) {
    return getValidatedAccessContext(userId, aircraftId);
  }

  function getValidatedAccessContext(userId, aircraftId) {
    const adminData = getAdminData();
    const user = getUserById(userId, adminData);
    const permission = getUserPermissionForAircraft(userId, aircraftId, adminData);
    const aircraft = getAircraftById(aircraftId, adminData);

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
    const adminData = getAdminData();
    const user = getUserById(userId, adminData);

    if (String(user.estado).trim().toUpperCase() !== "ACTIVO") {
      throw new Error("El usuario " + userId + " no está activo.");
    }

    return adminData.permissions
      .filter(function(permission) {
        return (
          String(permission.user_id).trim() === String(userId).trim() &&
          String(permission.estado).trim().toUpperCase() === "ACTIVO"
        );
      })
      .map(function(permission) {
        const aircraftId = String(permission.aircraft_id).trim();

        const aircraft = adminData.aircrafts.find(function(currentAircraft) {
          return String(currentAircraft.aircraft_id).trim() === aircraftId;
        });

        if (!aircraft) {
          return null;
        }

        if (String(aircraft.estado).trim().toUpperCase() !== "ACTIVA") {
          return null;
        }

        return {
          aircraft_id: aircraftId,
          matricula: aircraft.matricula,
          fabricante: aircraft.fabricante,
          modelo: aircraft.modelo,
          rol: permission.rol
        };
      })
      .filter(function(aircraft) {
        return aircraft !== null;
      });
  }
