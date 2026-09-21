import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const connectionString = process.env.DATABASE_MIGRATION_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_MIGRATION_URL is required. The migration runner never falls back to DATABASE_URL.',
  );
}

if (process.env.VERCEL_ENV === 'production') {
  throw new Error('Refusing to run App Horas 2E.1 migrations in Vercel Production.');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, 'migrations');

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
    await ensureMigrationLedger(client);

    const migrations = await readMigrations();
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
