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
const targetManifestPath = path.join(repoRoot, "data-migrations/2e3/lv-mhz-target-manifest.json");
const sourceManifestPath = path.join(repoRoot, "data-migrations/2e3/lv-mhz-manifest.json");
const migrationsDir = path.join(repoRoot, "db/migrations");
const TIMESTAMP_TOKEN = "$MIGRATION_TIMESTAMP";
const APPLY_ACK = "APPLY_LV_MHZ_2E3";
const EXPECTED_DATABASE = "app_horas";

const targetManifest = JSON.parse(await fs.readFile(targetManifestPath, "utf8"));
const sourceManifest = JSON.parse(await fs.readFile(sourceManifestPath, "utf8"));

function fail(message) {
  const error = new Error(message);
  error.code = "LV_MHZ_WRITE_FAILED";
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

function replaceTimestampToken(value, timestamp) {
  if (value === TIMESTAMP_TOKEN) return timestamp;
  if (Array.isArray(value)) return value.map((item) => replaceTimestampToken(item, timestamp));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceTimestampToken(item, timestamp)]),
    );
  }
  return value;
}

function tableSet(bundle) {
  return new Set(Object.keys(bundle.tables));
}

const INSERT_ORDER = [
  "app.users",
  "app.persons",
  "app.person_identifiers",
  "app.user_person_links",
  "app.aircraft",
  "app.aircraft_persons",
  "app.aircraft_registrations",
  "app.parties",
  "app.aircraft_ownership_interests",
  "app.aircraft_memberships",
  "app.aircraft_membership_capabilities",
  "app.aircraft_settings",
  "app.aircraft_flight_field_settings",
  "app.aircraft_flight_purposes",
  "app.aircraft_tanks",
  "app.components",
  "app.flight_import_batches",
  "app.flight_import_issues",
  "app.flight_records",
  "app.flight_record_revisions",
  "app.component_installations",
  "app.aircraft_utilization_baselines",
  "app.utilization_adjustments",
  "app.flight_counters",
  "app.flight_component_counters",
  "app.flight_tank_readings",
  "app.flight_component_consumables",
  "app.flight_component_runtime",
  "app.tracking_items",
  "app.tracking_item_events",
  "app.squawks",
  "app.squawk_status_events",
  "app.squawk_comments",
  "app.squawk_attachments",
  "app.export_templates",
  "app.export_template_versions",
  "app.export_template_version_fields",
  "app.export_runs",
  "app.export_run_datasets",
  "audit.audit_events",
];

function assertInsertOrderCoversBundle(bundle) {
  const declared = [...tableSet(bundle)].sort();
  const ordered = [...new Set(INSERT_ORDER)].sort();
  if (JSON.stringify(declared) !== JSON.stringify(ordered)) {
    fail(`Writer table order mismatch. Bundle=${JSON.stringify(declared)} writer=${JSON.stringify(ordered)}`);
  }
}

async function generateBundle() {
  const bundlePath = path.join(os.tmpdir(), `app-horas-lv-mhz-2e3-${process.pid}-${Date.now()}.json`);
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [builderPath], {
      cwd: repoRoot,
      env: { ...process.env, MIGRATION_BUNDLE_OUTPUT: bundlePath },
      maxBuffer: 8 * 1024 * 1024,
    });
    if (stderr?.trim()) process.stderr.write(stderr);
    const bundle = JSON.parse(await fs.readFile(bundlePath, "utf8"));
    assertInsertOrderCoversBundle(bundle);
    return { bundle, builderSummary: stdout.trim() ? JSON.parse(stdout) : null };
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
  const result = [];
  for (const filename of filenames) {
    const contents = await fs.readFile(path.join(migrationsDir, filename), "utf8");
    result.push({
      version: filename.slice(0, 3),
      filename,
      checksum_sha256: sha256(contents),
    });
  }
  return result;
}

async function assertDatabaseIdentity(client) {
  const identity = await client.query(`
    SELECT current_database() AS database_name,
           current_user AS role_name,
           r.rolsuper,
           pg_get_userbyid(c.relowner) = current_user AS owns_component_installations
      FROM pg_roles r
      JOIN pg_class c ON c.oid = 'app.component_installations'::regclass
     WHERE r.rolname = current_user
  `);
  if (identity.rowCount !== 1) fail("Could not resolve migration database identity.");
  const row = identity.rows[0];
  if (row.database_name !== EXPECTED_DATABASE) {
    fail(`Refusing target database '${row.database_name}'; expected '${EXPECTED_DATABASE}'.`);
  }
  if (row.role_name === "app_horas_runtime" || row.role_name === "app_runtime") {
    fail(`Refusing runtime role '${row.role_name}'; DATABASE_MIGRATION_URL must use the privileged migration/admin role.`);
  }
  if (row.rolsuper !== true && row.owns_component_installations !== true) {
    fail(`Role '${row.role_name}' is not the component_installations owner/superuser required for migration administration.`);
  }
  return { databaseName: row.database_name, roleName: row.role_name };
}

async function assertMigrationsApplied(client) {
  const ledgerExists = await client.query(`SELECT to_regclass('public.schema_migrations') AS ledger`);
  if (!ledgerExists.rows[0]?.ledger) fail("public.schema_migrations is missing.");

  const expected = await expectedMigrationLedger();
  const applied = await client.query(`
    SELECT version, filename, checksum_sha256
      FROM public.schema_migrations
     WHERE version = ANY($1::text[])
     ORDER BY version
  `, [expected.map((item) => item.version)]);

  const byVersion = new Map(applied.rows.map((row) => [row.version, row]));
  for (const migration of expected) {
    const row = byVersion.get(migration.version);
    if (!row) fail(`Required migration ${migration.version} is not applied.`);
    if (row.filename !== migration.filename || row.checksum_sha256 !== migration.checksum_sha256) {
      fail(`Migration ${migration.version} ledger content does not match the versioned repository file.`);
    }
  }
}

async function assertMigration003Schema(client) {
  const column = await client.query(`
    SELECT is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'app'
       AND table_name = 'component_installations'
       AND column_name = 'installed_on'
  `);
  if (column.rowCount !== 1 || column.rows[0].is_nullable !== "YES") {
    fail("Migration 003 precondition failed: component_installations.installed_on must be nullable.");
  }

  const constraint = await client.query(`
    SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE conname = 'ck_component_installation_values'
       AND conrelid = 'app.component_installations'::regclass
  `);
  if (constraint.rowCount !== 1) fail("ck_component_installation_values is missing.");
  const normalized = String(constraint.rows[0].definition).replace(/\s+/g, " ").toLowerCase();
  for (const required of ["removed_on is null", "installed_on is null", "removed_on >= installed_on", "opening_tis_hours >= 0"]) {
    if (!normalized.includes(required)) {
      fail(`Migration 003 CHECK does not contain required condition: ${required}`);
    }
  }
}

async function readTableCounts(client, tableNames) {
  const counts = {};
  for (const tableName of tableNames) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteTable(tableName)}`);
    counts[tableName] = result.rows[0].count;
  }
  return counts;
}

async function assertTargetEmpty(client, bundle) {
  const counts = await readTableCounts(client, Object.keys(bundle.tables));
  const nonEmpty = Object.entries(counts).filter(([, count]) => count !== 0);
  if (nonEmpty.length) {
    fail(`TEST target is not empty: ${nonEmpty.map(([table, count]) => `${table}=${count}`).join(", ")}`);
  }
  return counts;
}

async function runPreflight(client, bundle) {
  const identity = await assertDatabaseIdentity(client);
  await assertMigrationsApplied(client);
  await assertMigration003Schema(client);
  await assertTargetEmpty(client, bundle);
  return identity;
}

function assertRowsShareColumns(tableName, rows) {
  if (!rows.length) return [];
  const columns = Object.keys(rows[0]);
  const signature = JSON.stringify(columns);
  for (const row of rows) {
    if (JSON.stringify(Object.keys(row)) !== signature) {
      fail(`${tableName}: generated rows do not share the same ordered column set.`);
    }
  }
  return columns;
}

async function insertRows(client, tableName, rows) {
  if (!rows.length) return;
  const columns = assertRowsShareColumns(tableName, rows);
  const maxRowsPerChunk = Math.max(1, Math.floor(30000 / columns.length));

  for (let start = 0; start < rows.length; start += maxRowsPerChunk) {
    const chunk = rows.slice(start, start + maxRowsPerChunk);
    const params = [];
    const valueGroups = chunk.map((row) => {
      const placeholders = columns.map((column) => {
        params.push(row[column]);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    const sql = `INSERT INTO ${quoteTable(tableName)} (${columns.map(quoteIdentifier).join(", ")}) VALUES ${valueGroups.join(", ")}`;
    await client.query(sql, params);
  }
}

async function assertPostInsertCounts(client, bundle) {
  const counts = await readTableCounts(client, Object.keys(bundle.tables));
  for (const [tableName, rows] of Object.entries(bundle.tables)) {
    if (counts[tableName] !== rows.length) {
      fail(`${tableName}: expected ${rows.length} rows after insert, found ${counts[tableName]}.`);
    }
  }
  return counts;
}

async function assertOperationalReconciliation(client, bundle) {
  const aircraftRow = bundle.tables["app.aircraft"]?.[0];
  if (!aircraftRow) fail("Generated bundle has no aircraft row.");
  const aircraftId = aircraftRow.aircraft_id;

  const flights = await client.query(`
    SELECT COUNT(*)::int AS flight_count,
           COALESCE(SUM(revision.time_in_service_hours), 0)::numeric AS tracked_tis,
           COUNT(*) FILTER (WHERE revision.utilization_owner_party_id IS NOT NULL)::int AS utilization_owner_count
      FROM app.flight_records flight
      JOIN app.flight_record_revisions revision
        ON revision.flight_id = flight.flight_id
       AND revision.flight_revision_id = flight.current_revision_id
     WHERE flight.aircraft_id = $1
       AND flight.status = 'ACTIVE'
  `, [aircraftId]);
  const flightSummary = flights.rows[0];
  if (flightSummary.flight_count !== sourceManifest.source_precedence.flight_record_expected_count) {
    fail(`ACTIVE Flight Record reconciliation failed: ${flightSummary.flight_count}.`);
  }
  if (!almostEqual(flightSummary.tracked_tis, sourceManifest.reconciliation.aircraft.tracked_tis_sum_hours)) {
    fail(`Tracked aircraft TIS mismatch: ${flightSummary.tracked_tis}.`);
  }
  if (flightSummary.utilization_owner_count !== 0) {
    fail(`Historical utilization_owner_party_id must remain NULL; found ${flightSummary.utilization_owner_count} rows.`);
  }

  const baseline = await client.query(`
    SELECT baseline_tis_hours
      FROM app.aircraft_utilization_baselines
     WHERE aircraft_id = $1
  `, [aircraftId]);
  if (baseline.rowCount !== 1) fail("Expected exactly one aircraft utilization baseline.");
  const openingAircraft = Number(baseline.rows[0].baseline_tis_hours);
  const tracked = Number(flightSummary.tracked_tis);
  if (!almostEqual(openingAircraft, sourceManifest.reconciliation.aircraft.opening_tis_hours)) {
    fail(`Aircraft opening TIS mismatch: ${openingAircraft}.`);
  }
  if (!almostEqual(openingAircraft + tracked, sourceManifest.reconciliation.aircraft.closing_tis_hours)) {
    fail(`Aircraft closing TIS reconciliation failed: ${openingAircraft + tracked}.`);
  }

  const components = await client.query(`
    SELECT component.component_type, installation.opening_tis_hours
      FROM app.component_installations installation
      JOIN app.components component ON component.component_id = installation.component_id
     WHERE installation.aircraft_id = $1
     ORDER BY component.component_type
  `, [aircraftId]);
  if (components.rowCount !== 2) fail(`Expected 2 migrated component installations, found ${components.rowCount}.`);
  for (const row of components.rows) {
    const key = row.component_type === "ENGINE" ? "engine" : row.component_type === "PROPELLER" ? "propeller" : null;
    if (!key) fail(`Unexpected migrated component type: ${row.component_type}.`);
    const opening = Number(row.opening_tis_hours);
    if (!almostEqual(opening, sourceManifest.reconciliation[key].opening_tis_hours)) {
      fail(`${row.component_type} opening TIS mismatch: ${opening}.`);
    }
    if (!almostEqual(opening + tracked, sourceManifest.reconciliation[key].closing_tis_hours)) {
      fail(`${row.component_type} closing TIS reconciliation failed: ${opening + tracked}.`);
    }
  }

  const ownership = await client.query(`
    SELECT COUNT(*)::int AS count
      FROM app.aircraft_ownership_interests
     WHERE aircraft_id = $1
  `, [aircraftId]);
  if (ownership.rows[0].count !== 0) {
    fail(`No legal ownership interests may be inferred during initial migration; found ${ownership.rows[0].count}.`);
  }

  return {
    activeFlights: flightSummary.flight_count,
    trackedTisHours: tracked,
    aircraftClosingTisHours: openingAircraft + tracked,
    utilizationOwnerMappedRows: flightSummary.utilization_owner_count,
    ownershipInterestRows: ownership.rows[0].count,
  };
}

async function main() {
  const wantsApply = process.argv.includes("--apply");
  const wantsPreflight = process.argv.includes("--preflight");
  if (wantsApply && wantsPreflight) fail("Choose only one mode: --preflight or --apply.");
  const mode = wantsApply ? "APPLY" : wantsPreflight ? "PREFLIGHT" : "PLAN";

  const { bundle, builderSummary } = await generateBundle();
  const bundleDigest = sha256(JSON.stringify(bundle));

  if (mode === "PLAN") {
    console.log(JSON.stringify({
      ok: true,
      mode,
      migrationKey: bundle.migration_key,
      requestId: bundle.request_id,
      bundleSha256: bundleDigest,
      generatedCounts: Object.fromEntries(Object.entries(bundle.tables).map(([table, rows]) => [table, rows.length])),
      writerApplyEnabledByManifest: targetManifest.write_gate.neon_inserts_allowed === true,
      databaseAccessed: false,
      writesPerformed: 0,
      builderSummary,
    }, null, 2));
    return;
  }

  if (process.env.VERCEL_ENV === "production") {
    fail("Refusing LV-MHZ 2E.3 migration writer in Vercel Production.");
  }
  const connectionString = process.env.DATABASE_MIGRATION_URL;
  if (!connectionString) {
    fail("DATABASE_MIGRATION_URL is required for PREFLIGHT/APPLY. The writer never falls back to DATABASE_URL.");
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const identity = await runPreflight(client, bundle);
    if (mode === "PREFLIGHT") {
      console.log(JSON.stringify({
        ok: true,
        mode,
        migrationKey: bundle.migration_key,
        requestId: bundle.request_id,
        bundleSha256: bundleDigest,
        databaseName: identity.databaseName,
        migrationRole: identity.roleName,
        migrationsVerified: ["001", "002", "003"],
        migration003SchemaVerified: true,
        canonicalTargetTablesEmpty: true,
        writesPerformed: 0,
      }, null, 2));
      return;
    }

    if (targetManifest.write_gate.neon_inserts_allowed !== true) {
      fail("Target manifest write gate is CLOSED (neon_inserts_allowed=false). Apply is not authorized.");
    }
    if (process.env.CONFIRM_TEST_MIGRATION !== APPLY_ACK) {
      fail(`Apply requires CONFIRM_TEST_MIGRATION=${APPLY_ACK}.`);
    }

    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('app_horas_lv_mhz_2e3_data_migration'))");
      await assertTargetEmpty(client, bundle);
      const timestampResult = await client.query("SELECT transaction_timestamp() AS migration_timestamp");
      const migrationTimestamp = new Date(timestampResult.rows[0].migration_timestamp).toISOString();
      const resolvedTables = replaceTimestampToken(bundle.tables, migrationTimestamp);

      for (const tableName of INSERT_ORDER) {
        await insertRows(client, tableName, resolvedTables[tableName]);
      }

      const committedShape = { ...bundle, tables: resolvedTables };
      const insertedCounts = await assertPostInsertCounts(client, committedShape);
      const reconciliation = await assertOperationalReconciliation(client, committedShape);
      await client.query("COMMIT");

      console.log(JSON.stringify({
        ok: true,
        mode,
        committed: true,
        migrationKey: bundle.migration_key,
        requestId: bundle.request_id,
        bundleSha256: bundleDigest,
        migrationTimestamp,
        insertedCounts,
        reconciliation,
      }, null, 2));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
