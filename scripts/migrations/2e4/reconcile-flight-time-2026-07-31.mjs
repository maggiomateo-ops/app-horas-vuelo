import crypto from "node:crypto";
import { Client } from "pg";
import { batchGetSpreadsheetValues } from "../../../api/_googleSheets.js";

const MODE = process.argv.includes("--apply")
  ? "apply"
  : process.argv.includes("--verify")
    ? "verify"
    : "preflight";

const TARGET = Object.freeze({
  spreadsheetId: "1xF3RFKq32RiIGBU-HByvUE3w0Efyq68BQT7z0Cc-1os",
  legacyId: "1789593961053",
  historyRange: "Historial Aeronave!A:K",
  computationRange: "Computacion Horas!A:P",
  historySourceRow: 347,
  computationSourceRow: 275,
  aircraftRegistration: "LV-MHZ",
  flightDate: "2026-07-31",
  departure: "AGR",
  arrival: "RAE",
  pilot: "Christian Maggio",
  remarks: "Traslado RAE para Inspección Anual",
  timeInServiceHours: 2.0,
  oldFlightTimeHours: 21.0,
  correctedFlightTimeHours: 2.1,
  namespace: "6e3e6ad2-0b71-4ca8-9f7c-2d7a3e2d3a01",
  correctionReason: "Source reconciliation: corrected Historial Aeronave flight_time_hours from 21.0 to 2.1 after source-sheet correction; Computacion Horas independently confirms 2.1.",
});

function fail(message, code = "SOURCE_RECONCILIATION_FAILED") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function text(value) {
  return String(value ?? "").trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || text(value) === "") return null;
  const normalized = typeof value === "string" ? value.replace(",", ".") : value;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function nearlyEqual(left, right, tolerance = 0.000001) {
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function dateKey(day, month, year) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
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
    .update(Buffer.concat([uuidBytes(TARGET.namespace), Buffer.from(String(name), "utf8")]))
    .digest()
    .subarray(0, 16);
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return formatUuid(hash);
}

function normalizeDatabaseUrl(rawUrl) {
  const url = new URL(rawUrl);
  const sslMode = String(url.searchParams.get("sslmode") || "").toLowerCase();
  if (["prefer", "require", "verify-ca"].includes(sslMode)) {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}

async function loadAndValidateSources() {
  const [historyValues, computationValues] = await batchGetSpreadsheetValues(
    TARGET.spreadsheetId,
    [TARGET.historyRange, TARGET.computationRange]
  );
  const historyRow = historyValues.find((row) => text(row[0]) === TARGET.legacyId);
  const computationRow = computationValues.find((row) => text(row[0]) === TARGET.legacyId);

  if (!historyRow) fail(`Historial Aeronave: legacy row ${TARGET.legacyId} missing.`);
  if (!computationRow) fail(`Computacion Horas: legacy row ${TARGET.legacyId} missing.`);

  if (dateKey(historyRow[1], historyRow[2], historyRow[3]) !== TARGET.flightDate) fail("Historial Aeronave: date mismatch.");
  if (text(historyRow[4]) !== TARGET.departure || text(historyRow[5]) !== TARGET.arrival) fail("Historial Aeronave: route mismatch.");
  if (!nearlyEqual(numberOrNull(historyRow[6]), TARGET.timeInServiceHours)) fail("Historial Aeronave: TIS mismatch.");
  if (!nearlyEqual(numberOrNull(historyRow[8]), TARGET.correctedFlightTimeHours)) fail("Historial Aeronave: corrected flight time is not 2.1.");
  if (text(historyRow[9]) !== TARGET.pilot || text(historyRow[10]) !== TARGET.remarks) fail("Historial Aeronave: identity/remarks mismatch.");

  if (dateKey(computationRow[1], computationRow[2], computationRow[3]) !== TARGET.flightDate) fail("Computacion Horas: date mismatch.");
  if (text(computationRow[4]) !== TARGET.departure || text(computationRow[5]) !== TARGET.arrival) fail("Computacion Horas: route mismatch.");
  if (!nearlyEqual(numberOrNull(computationRow[6]), TARGET.correctedFlightTimeHours)) fail("Computacion Horas: JPI flight time is not 2.1.");
  if (!nearlyEqual(numberOrNull(computationRow[7]), TARGET.timeInServiceHours)) fail("Computacion Horas: Garmin TIS mismatch.");
  if (text(computationRow[8]) !== TARGET.pilot || text(computationRow[13]) !== TARGET.remarks) fail("Computacion Horas: identity/remarks mismatch.");
}

const flightId = uuidv5(`flight:A001:legacy:${TARGET.legacyId}`);

const databaseUrl = text(process.env.DATABASE_MIGRATION_URL);
if (!databaseUrl) fail("DATABASE_MIGRATION_URL is required.", "DATABASE_MIGRATION_URL_MISSING");
if (!text(process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON)) {
  fail("GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON is required.", "GOOGLE_SERVICE_ACCOUNT_CREDENTIALS_JSON_MISSING");
}

await loadAndValidateSources();

const client = new Client({ connectionString: normalizeDatabaseUrl(databaseUrl) });
await client.connect();

async function loadCurrentFlight(queryable = client, lock = false) {
  const lockClause = lock ? "FOR UPDATE OF flight_record" : "";
  const { rows } = await queryable.query(
    `
      SELECT
        flight_record.flight_id,
        flight_record.aircraft_id,
        flight_record.current_revision_id,
        flight_record.status,
        flight_record.record_source,
        revision.revision_number,
        revision.flight_date::text AS flight_date,
        revision.departure_location,
        revision.arrival_location,
        revision.pilot_person_id,
        pilot.full_name AS pilot_name,
        revision.utilization_owner_party_id,
        revision.flight_purpose_id,
        revision.capture_method,
        revision.flight_time_hours,
        revision.time_in_service_hours,
        revision.tach_start,
        revision.tach_end,
        revision.movement_start_at,
        revision.takeoff_at,
        revision.landing_at,
        revision.final_stop_at,
        revision.remarks,
        revision.created_by_user_id,
        revision.created_at,
        revision.correction_reason,
        registration.registration
      FROM app.flight_records flight_record
      JOIN app.flight_record_revisions revision
        ON revision.flight_revision_id = flight_record.current_revision_id
      LEFT JOIN app.persons pilot
        ON pilot.person_id = revision.pilot_person_id
      LEFT JOIN LATERAL (
        SELECT registration
        FROM app.aircraft_registrations registration_history
        WHERE registration_history.aircraft_id = flight_record.aircraft_id
          AND registration_history.effective_from_at <= now()
          AND (registration_history.effective_to_at IS NULL OR registration_history.effective_to_at > now())
        ORDER BY registration_history.effective_from_at DESC
        LIMIT 1
      ) registration ON true
      WHERE flight_record.flight_id = $1::uuid
      ${lockClause}
    `,
    [flightId]
  );
  if (rows.length !== 1) fail(`Expected exactly one flight ${flightId}; got ${rows.length}.`);
  return rows[0];
}

function assertCanonicalIdentity(row) {
  if (row.status !== "ACTIVE" || row.record_source !== "MIGRATION") fail("Target flight is not ACTIVE MIGRATION data.");
  if (String(row.registration || "") !== TARGET.aircraftRegistration) fail("Target registration mismatch.");
  if (text(row.flight_date) !== TARGET.flightDate) fail("Target DB date mismatch.");
  if (text(row.departure_location) !== TARGET.departure || text(row.arrival_location) !== TARGET.arrival) fail("Target DB route mismatch.");
  if (text(row.pilot_name) !== TARGET.pilot) fail("Target DB pilot mismatch.");
  if (text(row.remarks) !== TARGET.remarks) fail("Target DB remarks mismatch.");
  if (!nearlyEqual(row.time_in_service_hours, TARGET.timeInServiceHours)) fail("Target DB TIS mismatch.");
}

async function copyRevisionChildren(queryable, oldRevisionId, newRevisionId) {
  await queryable.query(`INSERT INTO app.flight_counters (flight_revision_id, counter_code, counter_value) SELECT $2::uuid, counter_code, counter_value FROM app.flight_counters WHERE flight_revision_id = $1::uuid`, [oldRevisionId, newRevisionId]);
  await queryable.query(`INSERT INTO app.flight_component_counters (flight_revision_id, component_installation_id, counter_code, counter_value) SELECT $2::uuid, component_installation_id, counter_code, counter_value FROM app.flight_component_counters WHERE flight_revision_id = $1::uuid`, [oldRevisionId, newRevisionId]);
  await queryable.query(`INSERT INTO app.flight_tank_readings (flight_revision_id, tank_id, entered_value, entered_unit, canonical_liters) SELECT $2::uuid, tank_id, entered_value, entered_unit, canonical_liters FROM app.flight_tank_readings WHERE flight_revision_id = $1::uuid`, [oldRevisionId, newRevisionId]);
  await queryable.query(`INSERT INTO app.flight_component_consumables (flight_revision_id, component_installation_id, consumable_code, entered_value, entered_unit, canonical_liters) SELECT $2::uuid, component_installation_id, consumable_code, entered_value, entered_unit, canonical_liters FROM app.flight_component_consumables WHERE flight_revision_id = $1::uuid`, [oldRevisionId, newRevisionId]);
  await queryable.query(`INSERT INTO app.flight_component_runtime (flight_revision_id, component_installation_id, engine_start_at, engine_stop_at, engine_running_hours) SELECT $2::uuid, component_installation_id, engine_start_at, engine_stop_at, engine_running_hours FROM app.flight_component_runtime WHERE flight_revision_id = $1::uuid`, [oldRevisionId, newRevisionId]);
}

try {
  const before = await loadCurrentFlight();
  assertCanonicalIdentity(before);

  if (MODE === "preflight") {
    if (Number(before.revision_number) !== 1) fail(`Preflight expected revision 1; got ${before.revision_number}.`);
    if (!nearlyEqual(before.flight_time_hours, TARGET.oldFlightTimeHours)) fail(`Preflight expected flight_time_hours 21.0; got ${before.flight_time_hours}.`);
    console.log(JSON.stringify({ ok: true, mode: MODE, flightId, currentRevisionId: before.current_revision_id, revisionNumber: Number(before.revision_number), dbFlightTimeHours: Number(before.flight_time_hours), sourceFlightTimeHours: TARGET.correctedFlightTimeHours, timeInServiceHours: Number(before.time_in_service_hours), persistentWritesPerformed: 0 }, null, 2));
  } else if (MODE === "verify") {
    if (Number(before.revision_number) !== 2) fail(`Verify expected revision 2; got ${before.revision_number}.`);
    if (!nearlyEqual(before.flight_time_hours, TARGET.correctedFlightTimeHours)) fail(`Verify expected flight_time_hours 2.1; got ${before.flight_time_hours}.`);
    const { rows: revisionRows } = await client.query(`SELECT revision_number, flight_time_hours, correction_reason FROM app.flight_record_revisions WHERE flight_id = $1::uuid ORDER BY revision_number`, [flightId]);
    if (revisionRows.length !== 2) fail(`Verify expected exactly 2 revisions; got ${revisionRows.length}.`);
    if (!nearlyEqual(revisionRows[0].flight_time_hours, TARGET.oldFlightTimeHours)) fail("Original revision was mutated; expected preserved 21.0.");
    if (!nearlyEqual(revisionRows[1].flight_time_hours, TARGET.correctedFlightTimeHours)) fail("Revision 2 is not 2.1.");
    const { rows: auditRows } = await client.query(`SELECT action_code, reason, metadata FROM audit.audit_events WHERE entity_type = 'FLIGHT_RECORD' AND entity_id = $1::uuid AND action_code = 'SOURCE_RECONCILED' ORDER BY occurred_at DESC`, [flightId]);
    if (auditRows.length !== 1) fail(`Verify expected one SOURCE_RECONCILED audit event; got ${auditRows.length}.`);
    console.log(JSON.stringify({ ok: true, mode: MODE, flightId, currentRevisionId: before.current_revision_id, revisionNumber: Number(before.revision_number), correctedFlightTimeHours: Number(before.flight_time_hours), timeInServiceHours: Number(before.time_in_service_hours), revisionCount: revisionRows.length, auditCount: auditRows.length, persistentWritesPerformed: 0 }, null, 2));
  } else {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`app-horas:2e4:source-reconcile:${TARGET.legacyId}`]);
      const current = await loadCurrentFlight(client, true);
      assertCanonicalIdentity(current);

      if (Number(current.revision_number) === 2 && nearlyEqual(current.flight_time_hours, TARGET.correctedFlightTimeHours)) {
        await client.query("ROLLBACK");
        console.log(JSON.stringify({ ok: true, mode: MODE, alreadyApplied: true, flightId, currentRevisionId: current.current_revision_id, correctedFlightTimeHours: Number(current.flight_time_hours), persistentWritesPerformed: 0 }, null, 2));
      } else {
        if (Number(current.revision_number) !== 1) fail(`Apply expected revision 1; got ${current.revision_number}.`);
        if (!nearlyEqual(current.flight_time_hours, TARGET.oldFlightTimeHours)) fail(`Apply expected current flight_time_hours 21.0; got ${current.flight_time_hours}.`);

        const oldRevisionId = current.current_revision_id;
        const { rows: idRows } = await client.query("SELECT gen_random_uuid() AS revision_id, gen_random_uuid() AS request_id");
        const newRevisionId = idRows[0].revision_id;
        const requestId = idRows[0].request_id;

        await client.query(`INSERT INTO app.flight_record_revisions (flight_revision_id, flight_id, revision_number, flight_date, departure_location, arrival_location, pilot_person_id, utilization_owner_party_id, flight_purpose_id, capture_method, flight_time_hours, time_in_service_hours, tach_start, tach_end, movement_start_at, takeoff_at, landing_at, final_stop_at, remarks, created_by_user_id, created_at, correction_reason) SELECT $2::uuid, flight_id, revision_number + 1, flight_date, departure_location, arrival_location, pilot_person_id, utilization_owner_party_id, flight_purpose_id, capture_method, $3::numeric(8,1), time_in_service_hours, tach_start, tach_end, movement_start_at, takeoff_at, landing_at, final_stop_at, remarks, NULL, now(), $4 FROM app.flight_record_revisions WHERE flight_revision_id = $1::uuid`, [oldRevisionId, newRevisionId, TARGET.correctedFlightTimeHours, TARGET.correctionReason]);
        await copyRevisionChildren(client, oldRevisionId, newRevisionId);
        const updateResult = await client.query(`UPDATE app.flight_records SET current_revision_id = $2::uuid WHERE flight_id = $1::uuid AND current_revision_id = $3::uuid`, [flightId, newRevisionId, oldRevisionId]);
        if (updateResult.rowCount !== 1) fail(`Expected one flight root update; got ${updateResult.rowCount}.`);
        await client.query(`INSERT INTO audit.audit_events (request_id, actor_type, actor_user_id, operation_source, aircraft_id, entity_type, entity_id, entity_key, action_code, before_state, after_state, reason, metadata, payload_version) VALUES ($1::uuid, 'SYSTEM', NULL, 'MIGRATION', $2::uuid, 'FLIGHT_RECORD', $3::uuid, jsonb_build_object('legacy_id', $4, 'flight_date', $5, 'registration', $6), 'SOURCE_RECONCILED', jsonb_build_object('current_revision_id', $7::uuid, 'revision_number', 1, 'flight_time_hours', $8::numeric, 'time_in_service_hours', $9::numeric), jsonb_build_object('current_revision_id', $10::uuid, 'revision_number', 2, 'flight_time_hours', $11::numeric, 'time_in_service_hours', $9::numeric), $12, jsonb_build_object('source_spreadsheet_id', $13, 'historial_aeronave_row', $14, 'computacion_horas_row', $15, 'source_confirmation', 'Historial Aeronave corrected to 2.1; Computacion Horas independently confirms 2.1', 'legacy_id', $4), 1)`, [requestId, current.aircraft_id, flightId, TARGET.legacyId, TARGET.flightDate, TARGET.aircraftRegistration, oldRevisionId, TARGET.oldFlightTimeHours, TARGET.timeInServiceHours, newRevisionId, TARGET.correctedFlightTimeHours, TARGET.correctionReason, TARGET.spreadsheetId, TARGET.historySourceRow, TARGET.computationSourceRow]);
        await client.query("COMMIT");
        const after = await loadCurrentFlight();
        assertCanonicalIdentity(after);
        if (Number(after.revision_number) !== 2 || !nearlyEqual(after.flight_time_hours, TARGET.correctedFlightTimeHours)) fail("Post-commit verification failed.");
        console.log(JSON.stringify({ ok: true, mode: MODE, alreadyApplied: false, flightId, previousRevisionId: oldRevisionId, currentRevisionId: after.current_revision_id, revisionNumber: Number(after.revision_number), correctedFlightTimeHours: Number(after.flight_time_hours), timeInServiceHours: Number(after.time_in_service_hours), persistentWritesPerformed: 3, writes: ["app.flight_record_revisions INSERT", "app.flight_records UPDATE", "audit.audit_events INSERT"] }, null, 2));
      }
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    }
  }
} finally {
  await client.end();
}
