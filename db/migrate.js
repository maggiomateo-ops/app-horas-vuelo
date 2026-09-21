import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const connectionString = process.env.DATABASE_MIGRATION_URL;
const adoptExisting = process.argv.includes('--adopt-existing');
const adoptionAck = process.env.MIGRATION_ADOPT_EXISTING;

if (!connectionString) {
  throw new Error(
    'DATABASE_MIGRATION_URL is required. The migration runner never falls back to DATABASE_URL.',
  );
}

if (process.env.VERCEL_ENV === 'production') {
  throw new Error('Refusing to run App Horas 2E.1 migrations in Vercel Production.');
}

if (adoptExisting && adoptionAck !== 'YES_I_VERIFIED_NEON_TEST') {
  throw new Error(
    'Adoption requires MIGRATION_ADOPT_EXISTING=YES_I_VERIFIED_NEON_TEST.',
  );
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, 'migrations');

const expectedTables = [
  'app.aircraft',
  'app.aircraft_flight_field_settings',
  'app.aircraft_flight_purposes',
  'app.aircraft_membership_capabilities',
  'app.aircraft_memberships',
  'app.aircraft_ownership_interests',
  'app.aircraft_persons',
  'app.aircraft_registrations',
  'app.aircraft_settings',
  'app.aircraft_tanks',
  'app.aircraft_utilization_baselines',
  'app.component_installations',
  'app.components',
  'app.export_run_datasets',
  'app.export_runs',
  'app.export_template_version_fields',
  'app.export_template_versions',
  'app.export_templates',
  'app.flight_component_consumables',
  'app.flight_component_counters',
  'app.flight_component_runtime',
  'app.flight_counters',
  'app.flight_import_batches',
  'app.flight_import_issues',
  'app.flight_record_revisions',
  'app.flight_records',
  'app.flight_tank_readings',
  'app.parties',
  'app.person_identifiers',
  'app.persons',
  'app.squawk_attachments',
  'app.squawk_comments',
  'app.squawk_status_events',
  'app.squawks',
  'app.tracking_item_events',
  'app.tracking_items',
  'app.user_person_links',
  'app.users',
  'app.utilization_adjustments',
  'audit.audit_events',
].sort();

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function migrationVersion(filename) {
  const match = /^(\d{3})_.*\.sql$/.exec(filename);
  if (!match) return null;
  return match[1];
}

async function ensureMigrationLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      version text PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      checksum_sha256 text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function readMigrations() {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const filenames = entries
    .filter((entry) => entry.isFile() && migrationVersion(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'));

  const seenVersions = new Set();
  const migrations = [];

  for (const filename of filenames) {
    const version = migrationVersion(filename);
    if (seenVersions.has(version)) {
      throw new Error(`Duplicate migration version ${version}.`);
    }
    seenVersions.add(version);

    const sql = await readFile(path.join(migrationsDir, filename), 'utf8');
    migrations.push({ version, filename, sql, checksum: sha256(sql) });
  }

  return migrations;
}

function assertExactSet(actual, expected, label) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (JSON.stringify(actualSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `${label} mismatch. Expected ${JSON.stringify(expectedSorted)}, got ${JSON.stringify(actualSorted)}.`,
    );
  }
}

async function validateAdoptableSchema(client) {
  const tables = await client.query(`
    SELECT table_schema || '.' || table_name AS table_name
      FROM information_schema.tables
     WHERE table_type = 'BASE TABLE'
       AND table_schema IN ('app', 'audit')
     ORDER BY table_schema, table_name
  `);
  assertExactSet(
    tables.rows.map((row) => row.table_name),
    expectedTables,
    'Canonical table fingerprint',
  );

  const runtimeRole = await client.query(`
    SELECT rolname, rolcanlogin
      FROM pg_roles
     WHERE rolname = 'app_runtime'
  `);
  if (runtimeRole.rowCount !== 1 || runtimeRole.rows[0].rolcanlogin !== false) {
    throw new Error('app_runtime must exist as exactly one NOLOGIN role.');
  }

  const circularFks = await client.query(`
    SELECT conname, condeferrable, condeferred
      FROM pg_constraint
     WHERE conname IN (
       'fk_flight_current_revision',
       'fk_export_template_current_version'
     )
     ORDER BY conname
  `);
  if (
    circularFks.rowCount !== 2 ||
    circularFks.rows.some(
      (row) => row.condeferrable !== true || row.condeferred !== true,
    )
  ) {
    throw new Error('Both circular foreign keys must be DEFERRABLE INITIALLY DEFERRED.');
  }

  const auditPrivileges = await client.query(`
    SELECT privilege_type
      FROM information_schema.table_privileges
     WHERE grantee = 'app_runtime'
       AND table_schema = 'audit'
       AND table_name = 'audit_events'
     ORDER BY privilege_type
  `);
  assertExactSet(
    auditPrivileges.rows.map((row) => row.privilege_type),
    ['INSERT', 'SELECT'],
    'audit.audit_events runtime privileges',
  );

  const capabilityUpdates = await client.query(`
    SELECT column_name
      FROM information_schema.column_privileges
     WHERE grantee = 'app_runtime'
       AND table_schema = 'app'
       AND table_name = 'aircraft_membership_capabilities'
       AND privilege_type = 'UPDATE'
     ORDER BY column_name
  `);
  assertExactSet(
    capabilityUpdates.rows.map((row) => row.column_name),
    ['revoked_at', 'revoked_by_user_id'],
    'aircraft_membership_capabilities UPDATE columns',
  );
}

async function adoptExistingSchema(client, migrations) {
  const ledgerExists = await client.query(
    `SELECT to_regclass('public.schema_migrations') AS ledger`,
  );
  if (ledgerExists.rows[0].ledger) {
    const existing = await client.query(
      'SELECT version, filename, checksum_sha256 FROM public.schema_migrations ORDER BY version',
    );
    if (existing.rowCount > 0) {
      throw new Error('Cannot adopt: schema_migrations already contains applied migrations.');
    }
  }

  await validateAdoptableSchema(client);

  await client.query('BEGIN');
  try {
    await ensureMigrationLedger(client);
    const recheck = await client.query('SELECT count(*)::int AS count FROM public.schema_migrations');
    if (recheck.rows[0].count !== 0) {
      throw new Error('Cannot adopt: schema_migrations changed during adoption.');
    }

    for (const migration of migrations) {
      await client.query(
        `INSERT INTO public.schema_migrations (version, filename, checksum_sha256)
         VALUES ($1, $2, $3)`,
        [migration.version, migration.filename, migration.checksum],
      );
      console.log(`adopt ${migration.filename}`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function applyMigration(client, migration) {
  const existing = await client.query(
    `SELECT filename, checksum_sha256
       FROM public.schema_migrations
      WHERE version = $1`,
    [migration.version],
  );

  if (existing.rowCount === 1) {
    const applied = existing.rows[0];
    if (
      applied.filename !== migration.filename ||
      applied.checksum_sha256 !== migration.checksum
    ) {
      throw new Error(
        `Migration ${migration.version} was already applied with different content.`,
      );
    }

    console.log(`skip  ${migration.filename}`);
    return;
  }

  await client.query('BEGIN');
  try {
    await client.query(migration.sql);
    await client.query(
      `INSERT INTO public.schema_migrations (version, filename, checksum_sha256)
       VALUES ($1, $2, $3)`,
      [migration.version, migration.filename, migration.checksum],
    );
    await client.query('COMMIT');
    console.log(`apply ${migration.filename}`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('app_horas_schema_migrations'))");
    const migrations = await readMigrations();

    if (adoptExisting) {
      await adoptExistingSchema(client, migrations);
      return;
    }

    await ensureMigrationLedger(client);
    for (const migration of migrations) {
      await applyMigration(client, migration);
    }
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext('app_horas_schema_migrations'))");
    } catch {
      // Connection teardown also releases session advisory locks.
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
