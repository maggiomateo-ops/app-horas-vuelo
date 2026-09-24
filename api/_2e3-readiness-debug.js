import fs from "node:fs/promises";
import { postgresQuery } from "./_postgres.js";

const targetManifest = JSON.parse(
  await fs.readFile(new URL("../data-migrations/2e3/lv-mhz-target-manifest.json", import.meta.url), "utf8")
);

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `"${value}"`;
}

function quoteTable(tableName) {
  const [schema, table, ...rest] = tableName.split(".");
  if (!schema || !table || rest.length) throw new Error(`Unsafe table: ${tableName}`);
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

export default async function handler(req, res) {
  if (process.env.VERCEL_ENV === "production") {
    return res.status(404).json({ ok: false, error: "not_available_in_production" });
  }

  try {
    const identity = await postgresQuery(`
      SELECT current_database() AS database_name,
             current_user AS role_name,
             has_schema_privilege(current_user, 'app', 'USAGE') AS app_schema_usage
    `);
    const installedOn = await postgresQuery(`
      SELECT is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'app'
         AND table_name = 'component_installations'
         AND column_name = 'installed_on'
    `);
    const constraint = await postgresQuery(`
      SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conname = 'ck_component_installation_values'
         AND conrelid = 'app.component_installations'::regclass
    `);

    const declaredTables = [
      ...Object.keys(targetManifest.fixed_target_counts),
      ...Object.keys(targetManifest.derived_target_counts),
    ];
    const tableCounts = {};
    for (const tableName of declaredTables) {
      const result = await postgresQuery(`SELECT COUNT(*)::int AS count FROM ${quoteTable(tableName)}`);
      tableCounts[tableName] = result.rows[0].count;
    }
    const nonEmptyTables = Object.fromEntries(
      Object.entries(tableCounts).filter(([, count]) => count !== 0)
    );

    return res.status(200).json({
      ok: true,
      databaseName: identity.rows[0]?.database_name ?? null,
      roleName: identity.rows[0]?.role_name ?? null,
      appSchemaUsage: identity.rows[0]?.app_schema_usage === true,
      installedOnNullable: installedOn.rows[0]?.is_nullable ?? null,
      componentInstallationCheck: constraint.rows[0]?.definition ?? null,
      declaredCanonicalTables: new Set(declaredTables).size,
      nonEmptyTables,
      writesPerformed: 0,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: error?.message || String(error),
      writesPerformed: 0,
    });
  }
}
