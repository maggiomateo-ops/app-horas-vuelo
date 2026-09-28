import crypto from "node:crypto";

function fail(message) {
  const error = new Error(message);
  error.code = "CUTOVER_SNAPSHOT_FAILED";
  throw error;
}

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function legacyId(value) {
  const normalized = text(value);
  if (!normalized) return "";
  return /^\d+(?:\.0+)?$/.test(normalized)
    ? String(Math.trunc(Number(normalized)))
    : normalized;
}

function numberOrNull(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const numeric = Number(typeof value === "string" ? value.replace(",", ".") : value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round1(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
}

function sameNumber(left, right) {
  return Math.abs(Number(left) - Number(right)) < 0.0001;
}

function dateKey(day, month, year) {
  const numericYear = Number(year);
  const normalizedYear = numericYear >= 0 && numericYear < 100
    ? numericYear + 2000
    : numericYear;
  if (![day, month, normalizedYear].every((value) => Number.isFinite(Number(value)))) {
    return null;
  }
  return `${String(Math.trunc(normalizedYear)).padStart(4, "0")}-${String(Math.trunc(Number(month))).padStart(2, "0")}-${String(Math.trunc(Number(day))).padStart(2, "0")}`;
}

function nonblankRows(values, startIndex = 2) {
  return (Array.isArray(values) ? values : [])
    .slice(startIndex)
    .map((row, offset) => ({
      row: Array.isArray(row) ? row : [],
      rowNumber: startIndex + offset + 1,
      legacyId: legacyId(row?.[0]),
    }))
    .filter((item) => item.legacyId);
}

function uniqueMap(rows, label) {
  const result = new Map();
  for (const item of rows) {
    if (result.has(item.legacyId)) fail(`${label}: ID legacy duplicado ${item.legacyId}.`);
    result.set(item.legacyId, item);
  }
  return result;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) fail(`${label}: esperado ${expected}, obtenido ${actual}.`);
}

function assertNumber(actual, expected, label) {
  if (!sameNumber(actual, expected)) fail(`${label}: esperado ${expected}, obtenido ${actual}.`);
}

function assertSetEqual(left, right, label) {
  if (left.size !== right.size || [...left].some((value) => !right.has(value))) {
    fail(`${label}: el conjunto de IDs cambió.`);
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function normalizeRange(values) {
  const rows = (Array.isArray(values) ? values : []).map((sourceRow) => {
    const row = Array.isArray(sourceRow) ? [...sourceRow] : [];
    while (row.length && (row.at(-1) === "" || row.at(-1) === null || row.at(-1) === undefined)) row.pop();
    return row.map((value) => value === undefined ? null : value);
  });
  while (rows.length && rows.at(-1).length === 0) rows.pop();
  return rows;
}

function tableRows(bundle, table) {
  const rows = bundle?.tables?.[table];
  if (!Array.isArray(rows)) fail(`El bundle canónico no contiene ${table}.`);
  return rows;
}

function validateAdminSource(source, manifest) {
  const expected = manifest.expected_source_counts;
  const identity = manifest.source_identity;
  const users = normalizeRange(source.usersValues).slice(1).filter((row) => text(row[0]));
  const permissions = normalizeRange(source.permissionsValues).slice(1).filter((row) => text(row[0]));
  const aircraft = normalizeRange(source.aircraftValues).slice(1).filter((row) => text(row[0]));

  assertEqual(users.length, expected.users, "USUARIOS count");
  assertEqual(permissions.length, expected.permissions, "PERMISOS count");
  assertEqual(aircraft.length, expected.aircraft, "AERONAVES count");

  const user = users.find((row) => text(row[0]) === identity.legacy_user_id);
  if (!user || upper(user[3]) !== identity.required_user_status) {
    fail("El usuario canónico no existe o dejó de estar ACTIVO.");
  }
  const permission = permissions.find((row) =>
    text(row[0]) === identity.legacy_user_id
    && text(row[1]) === identity.legacy_aircraft_id
  );
  if (!permission
    || upper(permission[2]) !== identity.required_permission_role
    || upper(permission[3]) !== identity.required_permission_status) {
    fail("El permiso canónico OWNER ACTIVO cambió.");
  }
  const aircraftRow = aircraft.find((row) => text(row[0]) === identity.legacy_aircraft_id);
  if (!aircraftRow
    || upper(aircraftRow[1]) !== identity.registration
    || upper(aircraftRow[5]) !== identity.required_aircraft_status) {
    fail("La aeronave canónica activa cambió.");
  }

  return { users: users.length, permissions: permissions.length, aircraft: aircraft.length };
}

function validateSourceTables(source, manifest) {
  const expected = manifest.expected_source_counts;
  const computacionRows = nonblankRows(source.computacionValues);
  const aircraftRows = nonblankRows(source.aircraftHistoryValues);
  const engineRows = nonblankRows(source.engineHistoryValues);
  const propellerRows = nonblankRows(source.propellerHistoryValues);

  assertEqual(computacionRows.length, expected.computacionHoras, "Computacion Horas count");
  assertEqual(aircraftRows.length, expected.historialAeronave, "Historial Aeronave count");
  assertEqual(engineRows.length, expected.historialMotor, "Historial Motor count");
  assertEqual(propellerRows.length, expected.historialHelice, "Historial Helice count");

  const computacionById = uniqueMap(computacionRows, "Computacion Horas");
  const aircraftById = uniqueMap(aircraftRows, "Historial Aeronave");
  const engineById = uniqueMap(engineRows, "Historial Motor");
  const propellerById = uniqueMap(propellerRows, "Historial Helice");
  const aircraftIds = new Set(aircraftById.keys());
  assertSetEqual(aircraftIds, new Set(engineById.keys()), "Historial Motor vs Aeronave");
  assertSetEqual(aircraftIds, new Set(propellerById.keys()), "Historial Helice vs Aeronave");
  for (const id of computacionById.keys()) {
    if (!aircraftById.has(id)) fail(`Computacion Horas contiene el ID inesperado ${id}.`);
  }
  const historyOnly = [...aircraftIds]
    .filter((id) => !computacionById.has(id))
    .map(Number)
    .sort((a, b) => a - b);
  assertEqual(historyOnly.length, 72, "IDs históricos sin Computacion Horas");
  if (historyOnly.some((id, index) => id !== index + 1)) {
    fail("Los IDs históricos sin Computacion Horas dejaron de ser exactamente 1..72.");
  }

  const trackedTisHours = round1(aircraftRows.reduce((sum, item) => sum + Number(numberOrNull(item.row[6]) || 0), 0));
  const aircraftClosingTisHours = round1(numberOrNull(aircraftRows.at(-1).row[7]));
  const engineClosingTisHours = round1(numberOrNull(engineRows.at(-1).row[7]));
  const propellerClosingTisHours = round1(numberOrNull(propellerRows.at(-1).row[8]));
  const utilization = {
    trackedTisHours,
    aircraftClosingTisHours,
    engineClosingTisHours,
    propellerClosingTisHours,
  };
  for (const [key, expectedValue] of Object.entries(manifest.expected_utilization)) {
    assertNumber(utilization[key], expectedValue, key);
  }

  const correctionSpec = manifest.known_corrections[0];
  const correctionRows = aircraftRows.filter(({ row }) =>
    dateKey(row[1], row[2], row[3]) === correctionSpec.date
    && upper(row[4]) === correctionSpec.departure
    && upper(row[5]) === correctionSpec.arrival
  );
  assertEqual(correctionRows.length, 1, "Corrección 31-Jul-2026 AGR→RAE");
  const correction = correctionRows[0];
  const correctionComputacion = computacionById.get(correction.legacyId);
  if (!correctionComputacion) fail("La corrección 31-Jul-2026 no existe en Computacion Horas.");
  assertNumber(numberOrNull(correction.row[6]), correctionSpec.aircraftHistory.timeInServiceHours, "Corrección TIS Historial Aeronave");
  assertNumber(numberOrNull(correction.row[8]), correctionSpec.aircraftHistory.flightTimeHours, "Corrección Flight Time Historial Aeronave");
  assertNumber(numberOrNull(correctionComputacion.row[6]), correctionSpec.computacionHoras.jpiHours, "Corrección JPI Computacion Horas");
  assertNumber(numberOrNull(correctionComputacion.row[7]), correctionSpec.computacionHoras.garminHours, "Corrección Garmin Computacion Horas");

  const settingsRow = normalizeRange(source.settingsValues)
    .slice(1)
    .find((row) => text(row[0]) === "APP_HORAS_SETTINGS");
  if (!settingsRow) fail("CONFIGURACION no contiene APP_HORAS_SETTINGS.");
  let settings;
  try {
    settings = JSON.parse(text(settingsRow[1]));
  } catch {
    fail("APP_HORAS_SETTINGS dejó de contener JSON válido.");
  }
  const warning = numberOrNull(settings?.kpiParams?.thresholds?.inspection100?.warningHours);
  assertNumber(warning, manifest.expected_settings.inspection100WarningHours, "Settings warning 100h");

  return {
    counts: {
      computacionHoras: computacionRows.length,
      historialAeronave: aircraftRows.length,
      historialMotor: engineRows.length,
      historialHelice: propellerRows.length,
    },
    utilization,
    knownCorrections: [{
      code: correctionSpec.code,
      verified: true,
      date: correctionSpec.date,
      route: `${correctionSpec.departure}→${correctionSpec.arrival}`,
      aircraftHistory: correctionSpec.aircraftHistory,
      computacionHoras: correctionSpec.computacionHoras,
    }],
    settings: { inspection100WarningHours: warning },
  };
}

function validateCanonicalBundle(bundle, manifest) {
  const targetCounts = Object.fromEntries(
    Object.entries(bundle?.tables || {}).map(([table, rows]) => [table, Array.isArray(rows) ? rows.length : -1])
  );
  assertEqual(tableRows(bundle, "app.flight_records").length, 346, "Flight Records target count");
  assertEqual(tableRows(bundle, "app.flight_record_revisions").length, 346, "Flight revisions target count");
  assertEqual(tableRows(bundle, "app.aircraft_ownership_interests").length, 0, "Legal ownership inferred rows");
  assertEqual(tableRows(bundle, "app.export_runs").length, 0, "TEST export runs");
  assertEqual(tableRows(bundle, "app.export_templates").length, 0, "TEST export templates");

  const revisions = new Map(tableRows(bundle, "app.flight_record_revisions").map((row) => [row.flight_revision_id, row]));
  const flights = tableRows(bundle, "app.flight_records");
  for (const flight of flights) {
    if (flight.status !== "ACTIVE") fail("El snapshot contiene un vuelo no ACTIVE.");
    const revision = revisions.get(flight.current_revision_id);
    if (!revision || revision.flight_id !== flight.flight_id) {
      fail("La cobertura de current_revision dejó de ser completa.");
    }
  }

  const registrations = tableRows(bundle, "app.aircraft_registrations");
  if (registrations.length !== 1 || upper(registrations[0].registration) !== manifest.source_identity.registration) {
    fail("El bundle contiene una matrícula distinta de LV-MHZ.");
  }
  const inspection100 = tableRows(bundle, "app.tracking_items").find((row) => Number(row.interval_hours) === 100);
  assertNumber(inspection100?.alert_before_value, manifest.expected_settings.inspection100WarningHours, "Tracking 100h target warning");

  return {
    targetCounts,
    currentRevisionCoverage: flights.length,
  };
}

export function buildCutoverSnapshot({ manifest, source, legacyBundle }) {
  if (!manifest || !source || !legacyBundle) fail("Faltan entradas para construir el snapshot 2E.7.");
  if (manifest.write_policy?.writesPerformed !== 0
    || manifest.write_policy?.postgresConnectionsAllowed !== false
    || manifest.write_policy?.postgresWritesAllowed !== false) {
    fail("El manifiesto 2E.7 no conserva la política de cero conexiones/escrituras Postgres.");
  }

  const adminCounts = validateAdminSource(source, manifest);
  const sourceValidation = validateSourceTables(source, manifest);
  const targetValidation = validateCanonicalBundle(legacyBundle, manifest);
  const normalizedSource = {
    admin: {
      users: normalizeRange(source.usersValues),
      permissions: normalizeRange(source.permissionsValues),
      aircraft: normalizeRange(source.aircraftValues),
    },
    aircraft: {
      computacionHoras: normalizeRange(source.computacionValues),
      historialAeronave: normalizeRange(source.aircraftHistoryValues),
      historialMotor: normalizeRange(source.engineHistoryValues),
      historialHelice: normalizeRange(source.propellerHistoryValues),
      configuracion: normalizeRange(source.settingsValues),
    },
  };
  const sourceFingerprintSha256 = sha256(normalizedSource);
  const sourceCounts = { ...adminCounts, ...sourceValidation.counts };
  const excludedTestOnlyState = manifest.excluded_test_only_state.map((code) => ({ code, status: "EXCLUDED" }));
  const logicalPayload = {
    snapshotVersion: manifest.snapshot_version,
    stage: manifest.stage,
    source: manifest.source,
    sourceFingerprint: { algorithm: "SHA-256", sha256: sourceFingerprintSha256 },
    sourceCounts,
    targetCounts: targetValidation.targetCounts,
    currentRevisionCoverage: targetValidation.currentRevisionCoverage,
    utilization: sourceValidation.utilization,
    knownCorrections: sourceValidation.knownCorrections,
    settings: sourceValidation.settings,
    targetMigrations: manifest.target_migrations,
    canonicalBootstrapRequired: manifest.canonical_bootstrap_required,
    excludedTestOnlyState,
    canonicalBundle: legacyBundle,
    databaseConnections: 0,
    writesPerformed: 0,
  };
  const snapshotSha256 = sha256(logicalPayload);
  const snapshot = { ok: true, sha256: snapshotSha256, ...logicalPayload };
  const report = {
    ok: true,
    snapshotVersion: manifest.snapshot_version,
    sourceFingerprint: snapshot.sourceFingerprint,
    sha256: snapshotSha256,
    sourceCounts,
    targetCounts: targetValidation.targetCounts,
    currentRevisionCoverage: targetValidation.currentRevisionCoverage,
    utilization: sourceValidation.utilization,
    knownCorrections: sourceValidation.knownCorrections,
    settings: sourceValidation.settings,
    targetMigrations: manifest.target_migrations,
    canonicalBootstrapRequired: manifest.canonical_bootstrap_required,
    excludedTestOnlyState,
    databaseConnections: 0,
    writesPerformed: 0,
  };

  return { snapshot, report };
}

export const cutoverSnapshotInternals = { canonicalJson, sha256, normalizeRange };
