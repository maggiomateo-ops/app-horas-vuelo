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
const EXPECTED_CANONICAL_TABLES = 40;

function fail(message) {
  const error = new Error(message);
  error.code = "MIGRATION_003_PREFLIGHT_FAILED";
  throw error;
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
    if (!pattern.test(normalized)) {
      fail(`003 replacement CHECK is missing required condition: ${label}`);
    }
  }
}

async function readInstalledOnState(client) {
  const column = await client.query(`
    SELECT is_nullable
      FROM information_schema.columns
     WHERE table_schema = 'app'
       AND table_name = 'component_installations'
       AND column_name = 'installed_on'
  `);
  if (column.rowCount !== 1) fail("Could not resolve app.component_installations.installed_on.");

  const constraint = await client.query(`
    SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE conname = 'ck_component_installation_values'
       AND conrelid = 'app.component_installations'::regclass
  `);
  if (constraint.rowCount !== 1) fail("Could not resolve ck_component_installation_values.");

  return {
    isNullable: column.rows[0].is_nullable,
    constraintDefinition: String(constraint.rows[0].definition),
  };
}

async function readMigration003LedgerCount(client) {
  const ledger = await client.query(`
    SELECT COUNT(*)::int AS count
      FROM public.schema_migrations
     WHERE version = '003'
        OR filename = '003_component_installation_historical_date.sql'
  `);
  return ledger.rows[0].count;
}

async function assertAdminIdentity(client) {
  const result = await client.query(`
    SELECT current_database() AS database_name,
           current_user AS role_name,
           r.rolsuper,
           pg_get_userbyid(c.relowner) = current_user AS owns_component_installations
      FROM pg_roles r
      JOIN pg_class c ON c.oid = 'app.component_installations'::regclass
     WHERE r.rolname = current_user
  `);
  if (result.rowCount !== 1) fail("Could not resolve migration database identity.");
  const row = result.rows[0];
  if (row.database_name !== EXPECTED_DATABASE) {
    fail(`Refusing database '${row.database_name}'; expected '${EXPECTED_DATABASE}'.`);
  }
  if (row.role_name === "app_horas_runtime" || row.role_name === "app_runtime") {
    fail(`Refusing runtime role '${row.role_name}'.`);
  }
  if (row.rolsuper !== true && row.owns_component_installations !== true) {
    fail(`Role '${row.role_name}' is not privileged to administer component_installations.`);
  }
  return { databaseName: row.database_name, roleName: row.role_name };
}

async function assertCanonicalTargetEmpty(client, targetManifest) {
  const tableNames = [
    ...Object.keys(targetManifest.fixed_target_counts || {}),
    ...Object.keys(targetManifest.derived_target_counts || {}),
  ];
  const uniqueNames = [...new Set(tableNames)].sort();
  if (uniqueNames.length !== EXPECTED_CANONICAL_TABLES) {
    fail(`Target manifest declares ${uniqueNames.length} canonical tables; expected ${EXPECTED_CANONICAL_TABLES}.`);
  }

  const nonEmpty = [];
  for (const tableName of uniqueNames) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteTable(tableName)}`);
    const count = result.rows[0].count;
    if (count !== 0) nonEmpty.push(`${tableName}=${count}`);
  }
  if (nonEmpty.length) fail(`TEST target is not empty: ${nonEmpty.join(", ")}`);
  return uniqueNames.length;
}

async function main() {
  if (process.env.VERCEL_ENV === "production") {
    fail("Refusing migration 003 preflight in Vercel Production.");
  }
  if (process.env.GITHUB_REF_NAME && process.env.GITHUB_REF_NAME !== "etapa-2e3-test-data-migration") {
    fail(`Refusing GitHub branch '${process.env.GITHUB_REF_NAME}'.`);
  }

  const rawConnectionString = process.env.DATABASE_MIGRATION_URL;
  if (!rawConnectionString) fail("DATABASE_MIGRATION_URL is required.");

  const [migrationSql, targetManifest] = await Promise.all([
    fs.readFile(migrationPath, "utf8"),
    fs.readFile(targetManifestPath, "utf8").then(JSON.parse),
  ]);

  const client = new Client({ connectionString: hardenedConnectionString(rawConnectionString) });
  await client.connect();

  let inTransaction = false;
  try {
    const identity = await assertAdminIdentity(client);
    const canonicalTableCount = await assertCanonicalTargetEmpty(client, targetManifest);
    const ledgerBefore = await readMigration003LedgerCount(client);
    if (ledgerBefore !== 0) fail("Migration 003 is already present in schema_migrations; rollback preflight expects pre-003 TEST.");

    const before = await readInstalledOnState(client);
    if (before.isNullable !== "NO") {
      fail(`Preflight expects installed_on NOT NULL before 003; found is_nullable=${before.isNullable}.`);
    }

    await client.query("BEGIN");
    inTransaction = true;
    await client.query(migrationSql);

    const during = await readInstalledOnState(client);
    if (during.isNullable !== "YES") {
      fail(`003 did not make installed_on nullable; found is_nullable=${during.isNullable}.`);
    }
    assertMigration003ConstraintSemantics(during.constraintDefinition);
    if (during.constraintDefinition === before.constraintDefinition) {
      fail("003 did not replace ck_component_installation_values as expected.");
    }

    await client.query("ROLLBACK");
    inTransaction = false;

    const restored = await readInstalledOnState(client);
    if (restored.isNullable !== "NO") {
      fail(`Rollback did not restore installed_on NOT NULL; found is_nullable=${restored.isNullable}.`);
    }
    if (restored.constraintDefinition !== before.constraintDefinition) {
      fail("Rollback did not restore the original ck_component_installation_values definition exactly.");
    }

    const ledgerAfter = await readMigration003LedgerCount(client);
    if (ledgerAfter !== 0) fail("Rollback preflight unexpectedly changed schema_migrations.");
    await assertCanonicalTargetEmpty(client, targetManifest);

    console.log(JSON.stringify({
      ok: true,
      mode: "003_TRANSACTIONAL_ROLLBACK_PREFLIGHT",
      databaseName: identity.databaseName,
      migrationRole: identity.roleName,
      canonicalTablesVerifiedEmpty: canonicalTableCount,
      migration003AppliedInsideTransaction: true,
      migration003SchemaValidatedInsideTransaction: true,
      rollbackRestoredExactPre003Constraint: true,
      rollbackRestoredInstalledOnNotNull: true,
      migration003LedgerRowsBefore: ledgerBefore,
      migration003LedgerRowsAfter: ledgerAfter,
      persistentWritesPerformed: 0,
    }, null, 2));
  } catch (error) {
    if (inTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original preflight error.
      }
    }
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
