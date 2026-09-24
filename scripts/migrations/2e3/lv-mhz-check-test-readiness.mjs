import fs from "node:fs/promises";
import { postgresQuery } from "../../../api/_postgres.js";

const targetManifest = JSON.parse(
  await fs.readFile(new URL("../../../data-migrations/2e3/lv-mhz-target-manifest.json", import.meta.url), "utf8")
);

function fail(message) {
  const error = new Error(message);
  error.code = "LV_MHZ_TEST_READINESS_FAILED";
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

if (process.env.VERCEL_ENV === "production") {
  fail("Refusing 2E.3 TEST readiness check in Vercel Production.");
}

const identity = await postgresQuery(`
  SELECT current_database() AS database_name,
         current_user AS role_name,
         has_schema_privilege(current_user, 'app', 'USAGE') AS app_schema_usage
`);
const identityRow = identity.rows[0];
if (identityRow?.database_name !== "app_horas") {
  fail(`Unexpected database '${identityRow?.database_name ?? "unknown"}', expected app_horas.`);
}
if (identityRow?.role_name !== "app_horas_runtime") {
  fail(`Unexpected runtime role '${identityRow?.role_name ?? "unknown"}', expected app_horas_runtime.`);
}
if (identityRow?.app_schema_usage !== true) {
  fail("Runtime role lacks USAGE on app schema.");
}

const installedOn = await postgresQuery(`
  SELECT is_nullable
    FROM information_schema.columns
   WHERE table_schema = 'app'
     AND table_name = 'component_installations'
     AND column_name = 'installed_on'
`);
if (installedOn.rowCount !== 1) fail("component_installations.installed_on was not found.");
if (installedOn.rows[0].is_nullable !== "NO") {
  fail(`Expected pre-003 installed_on state NOT NULL; got is_nullable=${installedOn.rows[0].is_nullable}.`);
}

const constraint = await postgresQuery(`
  SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
   WHERE conname = 'ck_component_installation_values'
     AND conrelid = 'app.component_installations'::regclass
`);
if (constraint.rowCount !== 1) fail("ck_component_installation_values was not found.");
const definition = String(constraint.rows[0].definition || "").replace(/\s+/g, " ").toLowerCase();
if (definition.includes("installed_on is null")) {
  fail("Target already contains the D-207 relaxed CHECK; expected pre-003 schema state.");
}
if (!definition.includes("removed_on >= installed_on")) {
  fail("Pre-003 component installation CHECK fingerprint changed unexpectedly.");
}

const declaredTables = [
  ...Object.keys(targetManifest.fixed_target_counts),
  ...Object.keys(targetManifest.derived_target_counts),
];
if (new Set(declaredTables).size !== 40) {
  fail(`Expected exactly 40 declared canonical target tables, got ${new Set(declaredTables).size}.`);
}

const counts = {};
for (const tableName of declaredTables) {
  const result = await postgresQuery(`SELECT COUNT(*)::int AS count FROM ${quoteTable(tableName)}`);
  counts[tableName] = result.rows[0].count;
}
const nonEmpty = Object.entries(counts).filter(([, count]) => count !== 0);
if (nonEmpty.length) {
  fail(`TEST canonical target is not empty: ${nonEmpty.map(([table, count]) => `${table}=${count}`).join(", ")}`);
}

console.log(JSON.stringify({
  ok: true,
  mode: "READ_ONLY_TEST_READINESS",
  databaseName: identityRow.database_name,
  runtimeRole: identityRow.role_name,
  migration003State: "NOT_APPLIED_EXPECTED",
  installedOnNullable: false,
  canonicalTablesChecked: declaredTables.length,
  canonicalTargetEmpty: true,
  writesPerformed: 0,
}, null, 2));
