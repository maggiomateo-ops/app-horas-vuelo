import fs from "node:fs/promises";
import { batchGetSpreadsheetValues } from "../../../api/_googleSheets.js";

const manifest = JSON.parse(
  await fs.readFile(new URL("../../../data-migrations/2e3/lv-mhz-manifest.json", import.meta.url), "utf8")
);

function fail(message) {
  const error = new Error(message);
  error.code = "LV_MHZ_DRY_RUN_FAILED";
  throw error;
}

function text(value) {
  return String(value ?? "").trim();
}

function id(value) {
  const normalized = text(value);
  if (!normalized) return "";
  return /^\d+(?:\.0+)?$/.test(normalized)
    ? String(Math.trunc(Number(normalized)))
    : normalized;
}

function numberOrNull(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round1(value) {
  return Math.round((Number(value) + Number.EPSILON) * 10) / 10;
}

function sameNumber(a, b, tolerance = 0.000001) {
  const left = numberOrNull(a);
  const right = numberOrNull(b);
  if (left === null || right === null) return left === right;
  return Math.abs(left - right) <= tolerance;
}

function normalizeYear(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric >= 0 && numeric < 100) return 2000 + numeric;
  return Math.trunc(numeric);
}

function dateKey(day, month, year) {
  const d = Number(day);
  const m = Number(month);
  const y = normalizeYear(year);
  if (![d, m, y].every(Number.isFinite)) return null;
  return `${String(y).padStart(4, "0")}-${String(Math.trunc(m)).padStart(2, "0")}-${String(Math.trunc(d)).padStart(2, "0")}`;
}

function nonblankRows(values, idIndex = 0, startIndex = 2) {
  return values
    .slice(startIndex)
    .filter((row) => id(row[idIndex]))
    .map((row, offset) => ({ row, rowNumber: startIndex + offset + 1, legacyId: id(row[idIndex]) }));
}

function uniqueIdMap(rows, label) {
  const map = new Map();
  for (const item of rows) {
    if (map.has(item.legacyId)) fail(`${label}: duplicate ID ${item.legacyId}`);
    map.set(item.legacyId, item);
  }
  return map;
}

function assertCount(actual, expected, label) {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
}

function assertSetEqual(left, right, label) {
  const missing = [...left].filter((value) => !right.has(value));
  const extra = [...right].filter((value) => !left.has(value));
  if (missing.length || extra.length) {
    fail(`${label}: ID-set mismatch; missing=${missing.slice(0, 10).join(",")}; extra=${extra.slice(0, 10).join(",")}`);
  }
}

function assertTextEqual(a, b, label) {
  if (text(a) !== text(b)) fail(`${label}: '${text(a)}' != '${text(b)}'`);
}

function assertNullableNumberEqual(a, b, label) {
  if (!sameNumber(a, b)) fail(`${label}: ${text(a)} != ${text(b)}`);
}

function numericIdRange(from, to) {
  const values = [];
  for (let current = from; current <= to; current += 1) values.push(String(current));
  return values;
}

const adminSource = manifest.sources.admin_spreadsheet;
const aircraftSource = manifest.sources.aircraft_spreadsheet;

const [usersValues, permissionsValues, aircraftValues] = await batchGetSpreadsheetValues(
  adminSource.spreadsheet_id,
  ["USUARIOS!A:K", "PERMISOS!A:H", "AERONAVES!A:H"]
);

const users = usersValues.slice(1).filter((row) => text(row[0]));
const permissions = permissionsValues.slice(1).filter((row) => text(row[0]));
const aircraft = aircraftValues.slice(1).filter((row) => text(row[0]));

assertCount(users.length, adminSource.expected_counts.users, "USUARIOS count");
assertCount(permissions.length, adminSource.expected_counts.permissions, "PERMISOS count");
assertCount(aircraft.length, adminSource.expected_counts.aircraft, "AERONAVES count");

const sourceAircraft = aircraft.find((row) => text(row[0]) === aircraftSource.legacy_aircraft_id);
if (!sourceAircraft) fail(`AERONAVES: missing ${aircraftSource.legacy_aircraft_id}`);
assertTextEqual(sourceAircraft[1], aircraftSource.registration, "AERONAVES registration");
assertTextEqual(sourceAircraft[4], aircraftSource.spreadsheet_id, "AERONAVES spreadsheet_id");

const [computacionValues, aircraftHistoryValues, engineHistoryValues, propellerHistoryValues, settingsValues] =
  await batchGetSpreadsheetValues(aircraftSource.spreadsheet_id, [
    "Computacion Horas!A:P",
    "Historial Aeronave!A:K",
    "Historial Motor!A:J",
    "Historial Helice!A:K",
    "CONFIGURACION!A:B",
  ]);

const computacionRows = nonblankRows(computacionValues);
const aircraftHistoryRows = nonblankRows(aircraftHistoryValues);
const engineHistoryRows = nonblankRows(engineHistoryValues);
const propellerHistoryRows = nonblankRows(propellerHistoryValues);

assertCount(computacionRows.length, manifest.source_precedence.enrichment_expected_count, "Computacion Horas count");
assertCount(aircraftHistoryRows.length, manifest.source_precedence.flight_record_expected_count, "Historial Aeronave count");
assertCount(engineHistoryRows.length, manifest.source_precedence.component_history_expected_count_each, "Historial Motor count");
assertCount(propellerHistoryRows.length, manifest.source_precedence.component_history_expected_count_each, "Historial Helice count");

const computacion = uniqueIdMap(computacionRows, "Computacion Horas");
const aircraftHistory = uniqueIdMap(aircraftHistoryRows, "Historial Aeronave");
const engineHistory = uniqueIdMap(engineHistoryRows, "Historial Motor");
const propellerHistory = uniqueIdMap(propellerHistoryRows, "Historial Helice");

const aircraftIds = new Set(aircraftHistory.keys());
assertSetEqual(aircraftIds, new Set(engineHistory.keys()), "Historial Motor vs Aeronave");
assertSetEqual(aircraftIds, new Set(propellerHistory.keys()), "Historial Helice vs Aeronave");

for (const computacionId of computacion.keys()) {
  if (!aircraftIds.has(computacionId)) fail(`Computacion ID ${computacionId} missing from Historial Aeronave`);
}

const historyOnly = [...aircraftIds].filter((legacyId) => !computacion.has(legacyId));
const expectedHistoryOnly = numericIdRange(1, 72);
assertSetEqual(new Set(historyOnly), new Set(expectedHistoryOnly), "History-only IDs");

for (const [legacyId, aircraftItem] of aircraftHistory.entries()) {
  const a = aircraftItem.row;
  const e = engineHistory.get(legacyId).row;
  const p = propellerHistory.get(legacyId).row;

  const canonicalDate = dateKey(a[1], a[2], a[3]);
  if (canonicalDate !== dateKey(e[1], e[2], e[3])) fail(`ID ${legacyId}: engine date mismatch`);
  if (canonicalDate !== dateKey(p[1], p[2], p[3])) fail(`ID ${legacyId}: propeller date mismatch`);

  assertTextEqual(a[4], e[4], `ID ${legacyId}: engine From`);
  assertTextEqual(a[5], e[5], `ID ${legacyId}: engine To`);
  assertNullableNumberEqual(a[6], e[6], `ID ${legacyId}: engine TIS`);
  assertTextEqual(a[9], e[8], `ID ${legacyId}: engine pilot`);
  assertTextEqual(a[10], e[9], `ID ${legacyId}: engine remarks`);

  assertTextEqual(a[4], p[4], `ID ${legacyId}: propeller From`);
  assertTextEqual(a[5], p[5], `ID ${legacyId}: propeller To`);
  assertNullableNumberEqual(a[6], p[6], `ID ${legacyId}: propeller TIS`);
  assertTextEqual(a[9], p[9], `ID ${legacyId}: propeller pilot`);
  assertTextEqual(a[10], p[10], `ID ${legacyId}: propeller remarks`);

  const cItem = computacion.get(legacyId);
  if (!cItem) continue;
  const c = cItem.row;

  if (canonicalDate !== dateKey(c[1], c[2], c[3])) fail(`ID ${legacyId}: Computacion date mismatch`);
  assertTextEqual(a[4], c[4], `ID ${legacyId}: Computacion From`);
  assertTextEqual(a[5], c[5], `ID ${legacyId}: Computacion To`);
  assertTextEqual(a[9], c[8], `ID ${legacyId}: Computacion pilot`);
  assertTextEqual(a[10], c[13], `ID ${legacyId}: Computacion remarks`);

  const numericLegacyId = /^\d+$/.test(legacyId) ? Number(legacyId) : null;
  if (numericLegacyId !== null && numericLegacyId <= 200) {
    if (numberOrNull(a[8]) !== null) fail(`ID ${legacyId}: historical Flight Time should remain NULL`);
    if (numberOrNull(c[7]) !== null) fail(`ID ${legacyId}: legacy Garmin TIS should be blank`);
    assertNullableNumberEqual(a[6], c[6], `ID ${legacyId}: frozen TIS vs raw JPI`);
  } else {
    assertNullableNumberEqual(a[6], c[7], `ID ${legacyId}: canonical TIS vs Garmin`);
    assertNullableNumberEqual(a[8], c[6], `ID ${legacyId}: canonical Flight Time vs JPI`);
  }
}

const tisValues = aircraftHistoryRows.map(({ row }) => numberOrNull(row[6])).filter((value) => value !== null);
const trackedTis = round1(tisValues.reduce((sum, value) => sum + value, 0));
const firstAircraftRow = aircraftHistoryRows[0].row;
const lastAircraftRow = aircraftHistoryRows.at(-1).row;
const firstEngineRow = engineHistoryRows[0].row;
const lastEngineRow = engineHistoryRows.at(-1).row;
const firstPropellerRow = propellerHistoryRows[0].row;
const lastPropellerRow = propellerHistoryRows.at(-1).row;

const derived = {
  aircraft: {
    opening: round1(Number(firstAircraftRow[7]) - Number(firstAircraftRow[6])),
    tracked: trackedTis,
    closing: round1(Number(lastAircraftRow[7])),
  },
  engine: {
    opening: round1(Number(firstEngineRow[7]) - Number(firstEngineRow[6])),
    tracked: trackedTis,
    closing: round1(Number(lastEngineRow[7])),
  },
  propeller: {
    opening: round1(Number(firstPropellerRow[8]) - Number(firstPropellerRow[6])),
    tracked: trackedTis,
    closing: round1(Number(lastPropellerRow[8])),
  },
};

for (const domain of ["aircraft", "engine", "propeller"]) {
  const expected = manifest.reconciliation[domain];
  if (!sameNumber(derived[domain].opening, expected.opening_tis_hours)) fail(`${domain}: opening TIS mismatch`);
  if (!sameNumber(derived[domain].tracked, expected.tracked_tis_sum_hours)) fail(`${domain}: tracked TIS mismatch`);
  if (!sameNumber(derived[domain].closing, expected.closing_tis_hours)) fail(`${domain}: closing TIS mismatch`);
  if (!sameNumber(round1(derived[domain].opening + derived[domain].tracked), derived[domain].closing)) {
    fail(`${domain}: opening + tracked does not reconcile to closing`);
  }
}

const settingsRow = settingsValues.slice(1).find((row) => text(row[0]) === "APP_HORAS_SETTINGS");
if (!settingsRow) fail("CONFIGURACION: APP_HORAS_SETTINGS missing");
try {
  JSON.parse(text(settingsRow[1]));
} catch {
  fail("CONFIGURACION: APP_HORAS_SETTINGS is not valid JSON");
}

const pilotLabels = new Set(aircraftHistoryRows.map(({ row }) => text(row[9])).filter(Boolean));
const ownerLabels = new Set(computacionRows.map(({ row }) => text(row[9])).filter(Boolean));

assertSetEqual(
  pilotLabels,
  new Set(manifest.identity_preflight.pilot_source_labels_requiring_explicit_mapping),
  "Pilot source labels"
);
assertSetEqual(
  ownerLabels,
  new Set(manifest.identity_preflight.utilization_owner_source_labels_requiring_explicit_mapping),
  "Owner source labels"
);

console.log(JSON.stringify({
  ok: true,
  source: {
    admin: {
      users: users.length,
      permissions: permissions.length,
      aircraft: aircraft.length,
    },
    lv_mhz: {
      flight_records_authority: aircraftHistoryRows.length,
      computacion_enrichment: computacionRows.length,
      engine_history: engineHistoryRows.length,
      propeller_history: propellerHistoryRows.length,
      history_only_ids: historyOnly.length,
      pilot_source_labels: pilotLabels.size,
      owner_source_labels: ownerLabels.size,
    },
  },
  utilization: derived,
  writesPerformed: 0,
}, null, 2));
