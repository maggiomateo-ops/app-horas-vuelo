import crypto from "node:crypto";
import fs from "node:fs/promises";
import { batchGetSpreadsheetValues } from "../../../api/_googleSheets.js";

const sourceManifest = JSON.parse(
  await fs.readFile(new URL("../../../data-migrations/2e3/lv-mhz-manifest.json", import.meta.url), "utf8")
);
const targetManifest = JSON.parse(
  await fs.readFile(new URL("../../../data-migrations/2e3/lv-mhz-target-manifest.json", import.meta.url), "utf8")
);

const TIMESTAMP = targetManifest.execution_metadata.timestamp_token;
const NAMESPACE = targetManifest.uuid_scheme.namespace;
const EXPECTED_DECLARED_TARGET_TABLE_COUNT = 40;
const US_QUART_TO_LITER = 0.946352946;

function fail(message) {
  const error = new Error(message);
  error.code = "LV_MHZ_BUNDLE_FAILED";
  throw error;
}

function text(value) {
  return String(value ?? "").trim();
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
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function round3(value) {
  return Math.round((Number(value) + Number.EPSILON) * 1000) / 1000;
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
    .map((row, offset) => ({ row, rowNumber: startIndex + offset + 1, legacyId: legacyId(row[idIndex]) }))
    .filter((item) => item.legacyId);
}

function uniqueMap(rows, label) {
  const map = new Map();
  for (const item of rows) {
    if (map.has(item.legacyId)) fail(`${label}: duplicate legacy ID ${item.legacyId}`);
    map.set(item.legacyId, item);
  }
  return map;
}

function uuidBytes(uuid) {
  const hex = uuid.replace(/-/g, "");
  if (!/^[0-9a-f]{32}$/i.test(hex)) fail(`Invalid namespace UUID: ${uuid}`);
  return Buffer.from(hex, "hex");
}

function formatUuid(bytes) {
  const hex = Buffer.from(bytes).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function uuidv5(name) {
  const hash = crypto
    .createHash("sha1")
    .update(Buffer.concat([uuidBytes(NAMESPACE), Buffer.from(String(name), "utf8")]))
    .digest()
    .subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return formatUuid(hash);
}

function stableSha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const allDeclaredTables = [
  ...Object.keys(targetManifest.fixed_target_counts),
  ...Object.keys(targetManifest.derived_target_counts),
];
if (new Set(allDeclaredTables).size !== EXPECTED_DECLARED_TARGET_TABLE_COUNT) {
  fail(`Target manifest must declare exactly ${EXPECTED_DECLARED_TARGET_TABLE_COUNT} canonical tables; got ${new Set(allDeclaredTables).size}`);
}
if (!allDeclaredTables.every((name) => name.startsWith("app.") || name === "audit.audit_events")) {
  fail("Target manifest contains a non-canonical table name.");
}

const tables = Object.fromEntries(allDeclaredTables.map((name) => [name, []]));
const push = (table, row) => {
  if (!tables[table]) fail(`Undeclared target table: ${table}`);
  tables[table].push(row);
};

const admin = sourceManifest.sources.admin_spreadsheet;
const source = sourceManifest.sources.aircraft_spreadsheet;

const [usersValues, permissionsValues, aircraftValues] = await batchGetSpreadsheetValues(
  admin.spreadsheet_id,
  ["USUARIOS!A:K", "PERMISOS!A:H", "AERONAVES!A:H"]
);
const [computacionValues, historyValues, settingsValues] = await batchGetSpreadsheetValues(
  source.spreadsheet_id,
  ["Computacion Horas!A:P", "Historial Aeronave!A:K", "CONFIGURACION!A:B"]
);

const legacyUserRow = usersValues.slice(1).find((row) => text(row[0]) === targetManifest.source_identity_mapping.legacy_user_id);
if (!legacyUserRow) fail("Legacy U001 user row missing.");
const legacyPermissionRow = permissionsValues.slice(1).find(
  (row) => text(row[0]) === targetManifest.source_identity_mapping.legacy_user_id
    && text(row[1]) === targetManifest.source_identity_mapping.legacy_aircraft_id
);
if (!legacyPermissionRow || text(legacyPermissionRow[2]) !== "OWNER" || text(legacyPermissionRow[3]) !== "ACTIVO") {
  fail("Legacy OWNER permission U001/A001 missing or not active.");
}
const legacyAircraftRow = aircraftValues.slice(1).find((row) => text(row[0]) === targetManifest.source_identity_mapping.legacy_aircraft_id);
if (!legacyAircraftRow) fail("Legacy A001 aircraft row missing.");
if (text(legacyAircraftRow[1]) !== targetManifest.aircraft_transform.registration) fail("Legacy registration mismatch.");

const historyRows = nonblankRows(historyValues);
const computacionRows = nonblankRows(computacionValues);
if (historyRows.length !== sourceManifest.source_precedence.flight_record_expected_count) {
  fail(`Historial Aeronave count mismatch: ${historyRows.length}`);
}
if (computacionRows.length !== sourceManifest.source_precedence.enrichment_expected_count) {
  fail(`Computacion Horas count mismatch: ${computacionRows.length}`);
}
const historyById = uniqueMap(historyRows, "Historial Aeronave");
const computacionById = uniqueMap(computacionRows, "Computacion Horas");
for (const id of computacionById.keys()) {
  if (!historyById.has(id)) fail(`Computacion legacy ID ${id} is absent from Historial Aeronave.`);
}

const settingsRow = settingsValues.slice(1).find((row) => text(row[0]) === "APP_HORAS_SETTINGS");
if (!settingsRow) fail("APP_HORAS_SETTINGS missing.");
const legacySettings = JSON.parse(text(settingsRow[1]));

const userId = uuidv5(`user:${targetManifest.source_identity_mapping.legacy_user_id}`);
const aircraftId = uuidv5(`aircraft:${targetManifest.source_identity_mapping.legacy_aircraft_id}`);
const requestId = uuidv5(`request:${targetManifest.migration_key}:manifest:${targetManifest.target_manifest_version}`);
const migrationEmail = text(legacyUserRow[1]);
const migrationName = text(legacyUserRow[2]);

const personIdByLabel = new Map();
for (const label of targetManifest.source_identity_mapping.pilot_source_labels) {
  const personId = uuidv5(`person:pilot-label:${label}`);
  personIdByLabel.set(label, personId);
  push("app.persons", {
    person_id: personId,
    full_name: label,
    email: label === migrationName ? migrationEmail : null,
    phone: null,
    license_number: null,
    notes: `Migrated source identity from exact legacy pilot label: ${label}`,
    status: "ACTIVE",
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  });
  push("app.aircraft_persons", {
    aircraft_id: aircraftId,
    person_id: personId,
    status: "ACTIVE",
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  });
}

const linkedPersonId = personIdByLabel.get(targetManifest.source_identity_mapping.exact_user_person_link.pilot_source_label);
if (!linkedPersonId || migrationName !== targetManifest.source_identity_mapping.exact_user_person_link.pilot_source_label) {
  fail("Exact U001 -> Mateo Maggio source match is no longer true.");
}

push("app.users", {
  user_id: userId,
  email: migrationEmail,
  status: text(legacyUserRow[3]) === "ACTIVO" ? "ACTIVE" : "DISABLED",
  preferred_locale: targetManifest.canonical_defaults.user_preferred_locale,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
});
push("app.user_person_links", {
  user_id: userId,
  person_id: linkedPersonId,
  linked_at: TIMESTAMP,
  verified_at: TIMESTAMP,
});

push("app.aircraft", {
  aircraft_id: aircraftId,
  manufacturer: targetManifest.aircraft_transform.manufacturer,
  model: targetManifest.aircraft_transform.model,
  serial_number: targetManifest.aircraft_transform.serial_number,
  status: "ACTIVE",
  created_by_user_id: null,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
});

const registrationId = uuidv5(`registration:A001:${targetManifest.aircraft_transform.registration}:2022-10-26`);
push("app.aircraft_registrations", {
  aircraft_registration_id: registrationId,
  aircraft_id: aircraftId,
  registration: targetManifest.aircraft_transform.registration,
  country_code: null,
  effective_from_at: targetManifest.aircraft_transform.registration_effective_from,
  effective_to_at: null,
  created_at: TIMESTAMP,
});

const membershipId = uuidv5("membership:A001:U001");
push("app.aircraft_memberships", {
  membership_id: membershipId,
  aircraft_id: aircraftId,
  user_id: userId,
  invited_email: null,
  role: "OWNER",
  status: "ACTIVE",
  invited_by_user_id: null,
  invited_at: null,
  activated_at: TIMESTAMP,
  revoked_at: null,
  revoked_by_user_id: null,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
});
push("app.aircraft_membership_capabilities", {
  membership_capability_id: uuidv5("capability:A001:U001:MANAGE_OWNERSHIP"),
  membership_id: membershipId,
  capability: "MANAGE_OWNERSHIP",
  granted_by_user_id: null,
  granted_at: TIMESTAMP,
  revoked_by_user_id: null,
  revoked_at: null,
});

push("app.aircraft_settings", {
  aircraft_id: aircraftId,
  ...targetManifest.settings_transform.aircraft_settings,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
});
for (const field of targetManifest.settings_transform.flight_fields) {
  push("app.aircraft_flight_field_settings", {
    aircraft_id: aircraftId,
    ...field,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  });
}

const tankIdBySourceKey = new Map();
for (const tank of targetManifest.settings_transform.tanks) {
  const tankId = uuidv5(`tank:A001:${tank.source_key}`);
  tankIdBySourceKey.set(tank.source_key, tankId);
  push("app.aircraft_tanks", {
    tank_id: tankId,
    aircraft_id: aircraftId,
    name: tank.name,
    position_code: tank.position_code,
    display_unit: tank.display_unit,
    display_order: tank.display_order,
    status: tank.status,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  });
}

const componentIdByType = new Map();
const installationIdByType = new Map();
const firstFlightId = uuidv5(`flight:A001:legacy:${targetManifest.utilization_transform.first_applicable_legacy_flight_id}`);
for (const component of targetManifest.component_transform) {
  const componentId = uuidv5(`component:A001:${component.source_key}`);
  const installationId = uuidv5(`component-installation:A001:${component.source_key}`);
  componentIdByType.set(component.component_type, componentId);
  installationIdByType.set(component.component_type, installationId);
  push("app.components", {
    component_id: componentId,
    component_type: component.component_type,
    manufacturer: component.manufacturer,
    model: component.model,
    serial_number: component.serial_number,
    status: "ACTIVE",
    notes: `Legacy ${component.component_type.toLowerCase()} history; physical installation date unavailable in source.`,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  });
  push("app.component_installations", {
    component_installation_id: installationId,
    component_id: componentId,
    aircraft_id: aircraftId,
    position_index: component.position_index,
    installed_on: null,
    removed_on: null,
    opening_tis_hours: component.opening_tis_hours,
    first_applicable_flight_id: firstFlightId,
    last_applicable_flight_id: null,
    created_by_user_id: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  });
}

push("app.aircraft_utilization_baselines", {
  aircraft_id: aircraftId,
  baseline_tis_hours: targetManifest.utilization_transform.aircraft_opening_tis_hours,
  baseline_effective_date: targetManifest.utilization_transform.baseline_effective_date,
  first_tracked_flight_id: firstFlightId,
  source: "MIGRATION",
  notes: "Opening TIS reconciled from Historial Aeronave: first cumulative total minus first tracked TIS.",
  created_by_user_id: null,
  created_at: TIMESTAMP,
  updated_at: TIMESTAMP,
});

const trackingProvenance = {
  annual: legacySettings?.kpiParams?.thresholds?.annualInspection || null,
  inspection50: {
    lastInspectionDate: legacySettings?.kpiParams?.inspection50?.lastInspectionDate || null,
    thresholds: legacySettings?.kpiParams?.thresholds?.inspection50 || null,
  },
  inspection100: {
    lastInspectionDate: legacySettings?.kpiParams?.inspection100?.lastInspectionDate || null,
    thresholds: legacySettings?.kpiParams?.thresholds?.inspection100 || null,
  },
};
for (const item of targetManifest.tracking_transform) {
  const provenance = item.source_key === "ANNUAL"
    ? { thresholds: trackingProvenance.annual }
    : item.source_key === "50H"
      ? trackingProvenance.inspection50
      : trackingProvenance.inspection100;
  push("app.tracking_items", {
    tracking_item_id: uuidv5(`tracking:A001:${item.source_key}`),
    aircraft_id: aircraftId,
    concept: item.concept,
    due_basis: item.due_basis,
    recurrence: item.recurrence,
    reference_mode: item.reference_mode,
    due_date: item.due_date,
    reference_tis_hours: item.reference_tis_hours,
    tracking_start_date: item.tracking_start_date,
    tracking_start_after_flight_id: null,
    interval_hours: item.interval_hours,
    alert_before_value: item.alert_before_value,
    notes: JSON.stringify({ legacy_kpi_provenance: provenance }),
    status: item.status,
    created_by_user_id: null,
    created_at: TIMESTAMP,
    updated_at: TIMESTAMP,
  });
}

for (const item of historyRows) {
  const a = item.row;
  const id = item.legacyId;
  const cItem = computacionById.get(id) || null;
  const c = cItem?.row || [];
  const flightId = uuidv5(`flight:A001:legacy:${id}`);
  const revisionId = uuidv5(`flight-revision:A001:legacy:${id}:rev:1`);
  const pilotLabel = text(a[9]);
  const pilotPersonId = pilotLabel ? personIdByLabel.get(pilotLabel) : null;
  if (pilotLabel && !pilotPersonId) fail(`Unmapped pilot source label '${pilotLabel}' at legacy ID ${id}`);
  const flightDate = dateKey(a[1], a[2], a[3]);
  if (!flightDate) fail(`Invalid flight date at legacy ID ${id}`);

  push("app.flight_records", {
    flight_id: flightId,
    aircraft_id: aircraftId,
    current_revision_id: revisionId,
    status: "ACTIVE",
    record_source: "MIGRATION",
    created_by_user_id: null,
    created_at: TIMESTAMP,
    voided_at: null,
    voided_by_user_id: null,
    void_reason: null,
    import_batch_id: null,
    import_row_number: null,
  });
  push("app.flight_record_revisions", {
    flight_revision_id: revisionId,
    flight_id: flightId,
    revision_number: 1,
    flight_date: flightDate,
    departure_location: text(a[4]) || null,
    arrival_location: text(a[5]) || null,
    pilot_person_id: pilotPersonId,
    utilization_owner_party_id: null,
    flight_purpose_id: null,
    capture_method: null,
    flight_time_hours: numberOrNull(a[8]),
    time_in_service_hours: numberOrNull(a[6]),
    tach_start: null,
    tach_end: null,
    movement_start_at: null,
    takeoff_at: null,
    landing_at: null,
    final_stop_at: null,
    remarks: text(a[10]) || null,
    created_by_user_id: null,
    created_at: TIMESTAMP,
    correction_reason: null,
  });

  if (cItem) {
    const fuelLeft = numberOrNull(c[11]);
    const fuelRight = numberOrNull(c[12]);
    const oil = numberOrNull(c[10]);
    if (fuelLeft !== null) {
      push("app.flight_tank_readings", {
        flight_revision_id: revisionId,
        tank_id: tankIdBySourceKey.get("LEFT"),
        entered_value: fuelLeft,
        entered_unit: "LITER",
        canonical_liters: fuelLeft,
      });
    }
    if (fuelRight !== null) {
      push("app.flight_tank_readings", {
        flight_revision_id: revisionId,
        tank_id: tankIdBySourceKey.get("RIGHT"),
        entered_value: fuelRight,
        entered_unit: "LITER",
        canonical_liters: fuelRight,
      });
    }
    if (oil !== null) {
      push("app.flight_component_consumables", {
        flight_revision_id: revisionId,
        component_installation_id: installationIdByType.get("ENGINE"),
        consumable_code: "OIL_ADDED",
        entered_value: oil,
        entered_unit: "US_QUART",
        canonical_liters: round3(oil * US_QUART_TO_LITER),
      });
    }
  }

  const numericId = /^\d+$/.test(id) ? Number(id) : null;
  push("audit.audit_events", {
    audit_event_id: uuidv5(`audit:flight:A001:legacy:${id}:created`),
    occurred_at: TIMESTAMP,
    request_id: requestId,
    actor_type: "SYSTEM",
    actor_user_id: null,
    operation_source: "MIGRATION",
    aircraft_id: aircraftId,
    entity_type: "FLIGHT_RECORD",
    entity_id: flightId,
    entity_key: { legacy_aircraft_id: "A001", legacy_flight_id: id },
    action_code: "MIGRATION_CREATED",
    before_state: null,
    after_state: { flight_id: flightId, flight_revision_id: revisionId, status: "ACTIVE" },
    reason: "Initial LV-MHZ legacy migration into Neon TEST.",
    metadata: {
      authoritative_source: { sheet: "Historial Aeronave", row: item.rowNumber },
      pilot_source_label: pilotLabel || null,
      utilization_owner_source_label: cItem ? (text(c[9]) || null) : null,
      enrichment_source: cItem ? { sheet: "Computacion Horas", row: cItem.rowNumber } : null,
      historical_time_semantics: numericId !== null && numericId <= 200
        ? "HISTORIAL_AERONAVE_TIS_WITH_NULL_FLIGHT_TIME_PRESERVED"
        : "HISTORIAL_AERONAVE_FROZEN_FLIGHT_TIME_AND_TIS",
      source_precedence: "D-208",
      ownership_boundary: "D-209",
      raw_enrichment_nonfinancial: cItem ? {
        raw_flight_time_jpi: numberOrNull(c[6]),
        raw_service_time_garmin: numberOrNull(c[7]),
        oil_added: numberOrNull(c[10]),
        fuel_left: numberOrNull(c[11]),
        fuel_right: numberOrNull(c[12]),
      } : null,
    },
    payload_version: 1,
  });
}

const derivedExpectedCounts = {
  "app.flight_tank_readings": computacionRows.reduce((sum, { row }) =>
    sum + (numberOrNull(row[11]) !== null ? 1 : 0) + (numberOrNull(row[12]) !== null ? 1 : 0), 0),
  "app.flight_component_consumables": computacionRows.reduce((sum, { row }) =>
    sum + (numberOrNull(row[10]) !== null ? 1 : 0), 0),
};

const preliminaryCounts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
const targetCountsForSummary = {
  ...preliminaryCounts,
  "audit.audit_events": preliminaryCounts["audit.audit_events"] + 1,
};

push("audit.audit_events", {
  audit_event_id: uuidv5(`audit:batch:${targetManifest.migration_key}:summary`),
  occurred_at: TIMESTAMP,
  request_id: requestId,
  actor_type: "SYSTEM",
  actor_user_id: null,
  operation_source: "MIGRATION",
  aircraft_id: aircraftId,
  entity_type: "MIGRATION_BATCH",
  entity_id: null,
  entity_key: {
    migration_key: targetManifest.migration_key,
    source_manifest_version: sourceManifest.manifest_version,
    target_manifest_version: targetManifest.target_manifest_version,
  },
  action_code: "MIGRATION_COMPLETED",
  before_state: null,
  after_state: {
    source_counts: {
      history_flights: historyRows.length,
      computacion_enrichment_rows: computacionRows.length,
    },
    target_counts: targetCountsForSummary,
    utilization_reconciliation: sourceManifest.reconciliation,
  },
  reason: "Initial deterministic LV-MHZ migration bundle completed.",
  metadata: {
    registration_provenance: {
      effective_from_at: targetManifest.aircraft_transform.registration_effective_from,
      precision: targetManifest.aircraft_transform.registration_effective_from_precision,
      meaning: targetManifest.aircraft_transform.registration_effective_from_meaning,
      country_code_source_status: "UNAVAILABLE",
    },
    locale_provenance: {
      preferred_locale: targetManifest.canonical_defaults.user_preferred_locale,
      source_status: "LEGACY_APP_DEFAULT",
    },
    settings_tracking_transform: "D-210",
    identity_mapping: "D-212",
    target_count_gate: "D-213",
    audit_contract: "D-214",
    uuid_scheme: "D-215",
  },
  payload_version: 1,
});

const actualCounts = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length]));
for (const [table, expected] of Object.entries(targetManifest.fixed_target_counts)) {
  if (actualCounts[table] !== expected) {
    fail(`${table}: expected ${expected} generated rows, got ${actualCounts[table]}`);
  }
}
for (const [table, expected] of Object.entries(derivedExpectedCounts)) {
  if (actualCounts[table] !== expected) {
    fail(`${table}: source-derived expected ${expected} rows, got ${actualCounts[table]}`);
  }
}

const bundle = {
  bundle_version: 1,
  source_manifest_version: sourceManifest.manifest_version,
  target_manifest_version: targetManifest.target_manifest_version,
  migration_key: targetManifest.migration_key,
  request_id: requestId,
  execution_timestamp_token: TIMESTAMP,
  ids: {
    user_id: userId,
    aircraft_id: aircraftId,
    registration_id: registrationId,
    membership_id: membershipId,
    first_flight_id: firstFlightId,
  },
  tables,
};

const outputPath = text(process.env.MIGRATION_BUNDLE_OUTPUT);
if (outputPath) {
  await fs.writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify({
  ok: true,
  migrationKey: targetManifest.migration_key,
  requestId,
  declaredCanonicalTables: allDeclaredTables.length,
  generatedCounts: actualCounts,
  derivedExpectedCounts,
  bundleSha256: stableSha256(bundle),
  outputWritten: Boolean(outputPath),
  writesPerformed: 0,
  neonWritesAllowedByManifest: targetManifest.write_gate.neon_inserts_allowed,
}, null, 2));
