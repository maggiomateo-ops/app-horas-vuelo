import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../..");
const migrationPath = path.join(repoRoot, "db/migrations/003_component_installation_historical_date.sql");
const targetManifestPath = path.join(repoRoot, "data-migrations/2e3/lv-mhz-target-manifest.json");
const EXPECTED_DATABASE = "app_horas";
const EXPECTED_TABLES = 40;

function fail(message) {
  const error = new Error(message);
  error.code = "MIGRATION_003_VERIFY_FAILED";
  throw error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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
  if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

function assertCheckSemantics(definition) {
  const normalized = String(definition).replace(/\s+/g, " ").toLowerCase();
  const requiredPatterns = [
    /installed_on\s+is\s+null/,
    /removed_on\s+is\s+null/,
    /removed_on\s*>=\s*installed_on/,
    /opening_tis_hours\s*>=\s*(?:\(+\s*)?(?:0(?:\.0+)?)?(?:::\w+)?/,
  ];
  if (!requiredPatterns.every((pattern) => pattern.test(normalized))) {
    fail(`Migration 003 CHECK semantics are not present: ${definition}`);
  }
}

async function main() {
  const raw = process.env.DATABASE_MIGRATION_URL;
  if (!raw) fail("DATABASE_MIGRATION_URL is required.");
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== "etapa-2e3-test-data-migration") {
    fail(`Refusing GitHub branch '${process.env.GITHUB_REF_NAME}'.`);
  }

  const [migrationSql, targetManifest] = await Promise.all([
    fs.readFile(migrationPath, "utf8"),
    fs.readFile(targetManifestPath, "utf8").then(JSON.parse),
  ]);
  const expectedChecksum = sha256(migrationSql);
  const tableNames = [...new Set([
    ...Object.keys(targetManifest.fixed_target_counts || {}),
    ...Object.keys(targetManifest.derived_target_counts || {}),
  ])].sort();
  if (tableNames.length !== EXPECTED_TABLES) fail(`Expected ${EXPECTED_TABLES} canonical tables, found ${tableNames.length}.`);

  const client = new Client({ connectionString: hardenedConnectionString(raw) });
  await client.connect();
  try {
    const identity = await client.query(`SELECT current_database() AS database_name, current_user AS role_name`);
    const { database_name: databaseName, role_name: roleName } = identity.rows[0] || {};
    if (databaseName !== EXPECTED_DATABASE) fail(`Refusing database '${databaseName}'.`);
    if (roleName === "app_horas_runtime" || roleName === "app_runtime") fail(`Refusing runtime role '${roleName}'.`);

    const ledger = await client.query(`
      SELECT version, filename, checksum_sha256
        FROM public.schema_migrations
       WHERE version = '003'
    `);
    if (ledger.rowCount !== 1) fail(`Expected exactly one ledger row for 003; found ${ledger.rowCount}.`);
    const row = ledger.rows[0];
    if (row.filename !== "003_component_installation_historical_date.sql") fail(`Unexpected 003 filename: ${row.filename}`);
    if (row.checksum_sha256 !== expectedChecksum) fail("Migration 003 ledger checksum does not match the exact repository file.");

    const column = await client.query(`
      SELECT is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'app'
         AND table_name = 'component_installations'
         AND column_name = 'installed_on'
    `);
    if (column.rowCount !== 1 || column.rows[0].is_nullable !== "YES") fail("component_installations.installed_on is not nullable after 003.");

    const constraint = await client.query(`
      SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conname = 'ck_component_installation_values'
         AND conrelid = 'app.component_installations'::regclass
    `);
    if (constraint.rowCount !== 1) fail("ck_component_installation_values is missing.");
    assertCheckSemantics(constraint.rows[0].definition);

    const nonEmpty = [];
    for (const tableName of tableNames) {
      const count = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteTable(tableName)}`);
      if (count.rows[0].count !== 0) nonEmpty.push(`${tableName}=${count.rows[0].count}`);
    }
    if (nonEmpty.length) fail(`Canonical TEST target is not empty: ${nonEmpty.join(", ")}`);

    console.log(JSON.stringify({
      ok: true,
      mode: "003_POST_APPLY_VERIFY",
      databaseName,
      migrationRole: roleName,
      migration003Filename: row.filename,
      migration003ChecksumSha256: expectedChecksum,
      migration003LedgerChecksumExact: true,
      migration003SchemaVerified: true,
      canonicalTablesVerifiedEmpty: tableNames.length,
      writesPerformed: 0,
    }, null, 2));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
