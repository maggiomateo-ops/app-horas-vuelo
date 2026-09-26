import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "pg";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const builderPath = path.join(__dirname, "lv-mhz-build-bundle.mjs");
const migrationsDir = path.join(repoRoot, "db/migrations");
const EXPECTED_DATABASE = "app_horas";
const EXPECTED_BUNDLE_SHA256 = "8b00c687f097a8de63e184b143882bd68679333988bfdbc1329626ee21501f00";
const EXPECTED_REQUEST_ID = "032cd18c-d662-57f3-bba5-51fdeb8b1646";
const EXPECTED_ACTIVE_FLIGHTS = 346;
const EXPECTED_TRACKED_TIS = 405.6;
const EXPECTED_AIRCRAFT_OPENING_TIS = 2302.2;

function fail(message) {
  const error = new Error(message);
  error.code = "LV_MHZ_POST_LOAD_VERIFY_FAILED";
  throw error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function almostEqual(left, right, tolerance = 0.000001) {
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) fail(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

function quoteTable(tableName) {
  const parts = tableName.split(".");
  if (parts.length !== 2) fail(`Expected schema-qualified table: ${tableName}`);
  return `${quoteIdentifier(parts[0])}.${quoteIdentifier(parts[1])}`;
}

function hardenedConnectionString(raw) {
  const url = new URL(raw);
  if (url.searchParams.get("sslmode") === "require") {
    url.searchParams.set("sslmode", "verify-full");
  }
  return url.toString();
}

function assertMigration003ConstraintSemantics(definition) {
  const normalized = String(definition).replace(/\s+/g, " ").toLowerCase();
  const requiredPatterns = [
    ["installed_on IS NULL", /installed_on\s+is\s+null/],
    ["removed_on IS NULL", /removed_on\s+is\s+null/],
    ["removed_on >= installed_on", /removed_on\s*>=\s*installed_on/],
    ["opening_tis_hours >= 0", /opening_tis_hours\s*>=\s*\(?0(?:\.0+)?\)?(?:::[a-z0-9_.]+)?/],
  ];
  for (const [label, pattern] of requiredPatterns) {
    if (!pattern.test(normalized)) fail(`003 CHECK missing required condition: ${label}`);
  }
}

async function generateBundle() {
  const bundlePath = path.join(os.tmpdir(), `app-horas-lv-mhz-verify-${process.pid}-${Date.now()}.json`);
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [builderPath], {
      cwd: repoRoot,
      env: { ...process.env, MIGRATION_BUNDLE_OUTPUT: bundlePath },
      maxBuffer: 8 * 1024 * 1024,
    });
    if (stderr?.trim()) process.stderr.write(stderr);
    const bundle = JSON.parse(await fs.readFile(bundlePath, "utf8"));
    const digest = sha256(JSON.stringify(bundle));
    if (digest !== EXPECTED_BUNDLE_SHA256) {
      fail(`Live-source bundle digest changed: ${digest}; expected ${EXPECTED_BUNDLE_SHA256}.`);
    }
    if (bundle.request_id !== EXPECTED_REQUEST_ID) {
      fail(`Unexpected request_id ${bundle.request_id}.`);
    }
    return { bundle, digest, builderSummary: stdout.trim() ? JSON.parse(stdout) : null };
  } finally {
    await fs.rm(bundlePath, { force: true });
  }
}

async function expectedMigrationLedger() {
  const filenames = [
    "001_initial_schema.sql",
    "002_runtime_grant_hardening.sql",
    "003_component_installation_historical_date.sql",
  ];
  const expected = [];
  for (const filename of filenames) {
    const contents = await fs.readFile(path.join(migrationsDir, filename), "utf8");
    expected.push({ version: filename.slice(0, 3), filename, checksum_sha256: sha256(contents) });
  }
  return expected;
}

async function assertIdentityAndMigrations(client) {
  const identity = await client.query(`SELECT current_database() AS database_name, current_user AS role_name`);
  const row = identity.rows[0];
  if (row.database_name !== EXPECTED_DATABASE) fail(`Wrong database ${row.database_name}.`);
  if (row.role_name === "app_horas_runtime" || row.role_name === "app_runtime") fail(`Refusing runtime role ${row.role_name}.`);

  const expected = await expectedMigrationLedger();
  const applied = await client.query(`
    SELECT version, filename, checksum_sha256
      FROM public.schema_migrations
     WHERE version = ANY($1::text[])
     ORDER BY version
  `, [expected.map((item) => item.version)]);
  const byVersion = new Map(applied.rows.map((item) => [item.version, item]));
  for (const migration of expected) {
    const actual = byVersion.get(migration.version);
    if (!actual || actual.filename !== migration.filename || actual.checksum_sha256 !== migration.checksum_sha256) {
      fail(`Migration ${migration.version} ledger mismatch.`);
    }
  }

  const column = await client.query(`
    SELECT is_nullable
      FROM information_schema.columns
     WHERE table_schema='app' AND table_name='component_installations' AND column_name='installed_on'
  `);
  if (column.rows[0]?.is_nullable !== "YES") fail("Post-003 installed_on is not nullable.");
  const constraint = await client.query(`
    SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE conname='ck_component_installation_values'
       AND conrelid='app.component_installations'::regclass
  `);
  if (constraint.rowCount !== 1) fail("ck_component_installation_values missing.");
  assertMigration003ConstraintSemantics(constraint.rows[0].definition);
  return { databaseName: row.database_name, migrationRole: row.role_name };
}

async function assertCounts(client, bundle) {
  const counts = {};
  for (const [tableName, rows] of Object.entries(bundle.tables)) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteTable(tableName)}`);
    const count = result.rows[0].count;
    counts[tableName] = count;
    if (count !== rows.length) fail(`${tableName}: persisted ${count}, expected ${rows.length}.`);
  }
  return counts;
}

async function assertReconciliation(client, bundle) {
  const aircraftId = bundle.ids.aircraft_id;
  const flightSummary = await client.query(`
    SELECT COUNT(*)::int AS active_flights,
           COALESCE(SUM(r.time_in_service_hours), 0)::numeric AS tracked_tis,
           COUNT(*) FILTER (WHERE r.utilization_owner_party_id IS NOT NULL)::int AS mapped_owner_rows
      FROM app.flight_records f
      JOIN app.flight_record_revisions r
        ON r.flight_id=f.flight_id AND r.flight_revision_id=f.current_revision_id
     WHERE f.aircraft_id=$1 AND f.status='ACTIVE'
  `, [aircraftId]);
  const flight = flightSummary.rows[0];
  if (flight.active_flights !== EXPECTED_ACTIVE_FLIGHTS) fail(`Active flights ${flight.active_flights}.`);
  if (!almostEqual(flight.tracked_tis, EXPECTED_TRACKED_TIS)) fail(`Tracked TIS ${flight.tracked_tis}.`);
  if (flight.mapped_owner_rows !== 0) fail(`Historical utilization owner rows ${flight.mapped_owner_rows}.`);

  const baseline = await client.query(`SELECT baseline_tis_hours FROM app.aircraft_utilization_baselines WHERE aircraft_id=$1`, [aircraftId]);
  if (baseline.rowCount !== 1) fail(`Expected one aircraft baseline; found ${baseline.rowCount}.`);
  const openingTis = Number(baseline.rows[0].baseline_tis_hours);
  if (!almostEqual(openingTis, EXPECTED_AIRCRAFT_OPENING_TIS)) fail(`Opening TIS ${openingTis}.`);
  const closingTis = openingTis + Number(flight.tracked_tis);
  if (!almostEqual(closingTis, 2707.8)) fail(`Closing TIS ${closingTis}.`);

  const ownership = await client.query(`SELECT COUNT(*)::int AS count FROM app.aircraft_ownership_interests WHERE aircraft_id=$1`, [aircraftId]);
  if (ownership.rows[0].count !== 0) fail(`Ownership interests ${ownership.rows[0].count}.`);

  const currentRevisionCoverage = await client.query(`
    SELECT COUNT(*)::int AS count
      FROM app.flight_records f
      JOIN app.flight_record_revisions r ON r.flight_revision_id=f.current_revision_id AND r.flight_id=f.flight_id
     WHERE f.aircraft_id=$1
  `, [aircraftId]);
  if (currentRevisionCoverage.rows[0].count !== EXPECTED_ACTIVE_FLIGHTS) fail("Current revision coverage mismatch.");

  const audit = await client.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE entity_type='MIGRATION_BATCH' AND action_code='MIGRATION_COMPLETED')::int AS summary_count
      FROM audit.audit_events
     WHERE request_id=$1
  `, [EXPECTED_REQUEST_ID]);
  if (audit.rows[0].total !== 347 || audit.rows[0].summary_count !== 1) fail(`Audit reconciliation failed: ${JSON.stringify(audit.rows[0])}.`);

  return {
    activeFlights: flight.active_flights,
    trackedTisHours: Number(flight.tracked_tis),
    aircraftClosingTisHours: closingTis,
    utilizationOwnerMappedRows: flight.mapped_owner_rows,
    ownershipInterestRows: ownership.rows[0].count,
    currentRevisionCoverage: currentRevisionCoverage.rows[0].count,
    auditEventsForRequest: audit.rows[0].total,
    auditBatchSummaryEvents: audit.rows[0].summary_count,
  };
}

async function main() {
  if (process.env.VERCEL_ENV === "production") fail("Refusing verification in Vercel Production.");
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== "etapa-2e3-test-data-migration") {
    fail(`Refusing GitHub branch ${process.env.GITHUB_REF_NAME}.`);
  }
  const raw = process.env.DATABASE_MIGRATION_URL;
  if (!raw) fail("DATABASE_MIGRATION_URL is required.");

  const { bundle, digest, builderSummary } = await generateBundle();
  const client = new Client({ connectionString: hardenedConnectionString(raw) });
  await client.connect();
  try {
    const identity = await assertIdentityAndMigrations(client);
    const persistedCounts = await assertCounts(client, bundle);
    const reconciliation = await assertReconciliation(client, bundle);
    console.log(JSON.stringify({
      ok: true,
      mode: "POST_LOAD_VERIFY",
      migrationKey: bundle.migration_key,
      requestId: bundle.request_id,
      bundleSha256: digest,
      databaseName: identity.databaseName,
      migrationRole: identity.migrationRole,
      migrationsVerified: ["001", "002", "003"],
      persistedCounts,
      reconciliation,
      writesPerformed: 0,
      builderSummary,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
