import fs from "node:fs/promises";
import { postgresQuery } from "../../../api/_postgres.js";

const probe = process.argv[2];
const targetManifest = JSON.parse(
  await fs.readFile(new URL("../../../data-migrations/2e3/lv-mhz-target-manifest.json", import.meta.url), "utf8")
);

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`Unsafe identifier: ${value}`);
  return `"${value}"`;
}

function quoteTable(tableName) {
  const [schema, table, ...rest] = tableName.split(".");
  if (!schema || !table || rest.length) throw new Error(`Unsafe table: ${tableName}`);
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

if (process.env.VERCEL_ENV === "production") {
  throw new Error("Refusing TEST probe in Production.");
}

if (probe === "identity") {
  const result = await postgresQuery(`
    SELECT current_database() AS database_name,
           current_user AS role_name,
           has_schema_privilege(current_user, 'app', 'USAGE') AS app_schema_usage
  `);
  const row = result.rows[0];
  console.log(JSON.stringify(row));
  if (row?.database_name !== "app_horas") fail(`database=${row?.database_name}`);
  if (row?.role_name !== "app_horas_runtime") fail(`role=${row?.role_name}`);
  if (row?.app_schema_usage !== true) fail("app_schema_usage=false");
} else if (probe === "schema") {
  const column = await postgresQuery(`
    SELECT is_nullable
      FROM information_schema.columns
     WHERE table_schema='app' AND table_name='component_installations' AND column_name='installed_on'
  `);
  const constraint = await postgresQuery(`
    SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
     WHERE conname='ck_component_installation_values'
       AND conrelid='app.component_installations'::regclass
  `);
  console.log(JSON.stringify({ column: column.rows, constraint: constraint.rows }));
  if (column.rowCount !== 1 || column.rows[0].is_nullable !== "NO") fail(`installed_on.is_nullable=${column.rows[0]?.is_nullable}`);
  const definition = String(constraint.rows[0]?.definition || "").replace(/\s+/g, " ").toLowerCase();
  if (constraint.rowCount !== 1) fail("component CHECK missing");
  if (definition.includes("installed_on is null")) fail("003 relaxed CHECK already present");
  if (!definition.includes("removed_on >= installed_on")) fail("pre-003 CHECK fingerprint changed");
} else if (probe === "empty") {
  const tables = [...Object.keys(targetManifest.fixed_target_counts), ...Object.keys(targetManifest.derived_target_counts)];
  if (new Set(tables).size !== 40) fail(`declaredTables=${new Set(tables).size}`);
  const nonEmpty = [];
  for (const tableName of tables) {
    const result = await postgresQuery(`SELECT COUNT(*)::int AS count FROM ${quoteTable(tableName)}`);
    if (result.rows[0].count !== 0) nonEmpty.push([tableName, result.rows[0].count]);
  }
  console.log(JSON.stringify({ declaredTables: new Set(tables).size, nonEmpty }));
  if (nonEmpty.length) fail(`nonEmpty=${JSON.stringify(nonEmpty)}`);
} else {
  throw new Error("Usage: lv-mhz-test-probe.mjs identity|schema|empty");
}
