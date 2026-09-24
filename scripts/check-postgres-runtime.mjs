import { postgresQuery } from "../api/_postgres.js";

const EXPECTED_ROLE = "app_horas_runtime";
const EXPECTED_DATABASE = "app_horas";

async function main() {
  const { rows } = await postgresQuery(`
    SELECT
      current_user AS current_user,
      current_database() AS current_database,
      has_schema_privilege(current_user, 'app', 'USAGE') AS app_schema_usage,
      has_table_privilege(current_user, 'audit.audit_events', 'SELECT') AS audit_select,
      has_table_privilege(current_user, 'audit.audit_events', 'INSERT') AS audit_insert,
      has_table_privilege(current_user, 'audit.audit_events', 'UPDATE') AS audit_update,
      has_table_privilege(current_user, 'audit.audit_events', 'DELETE') AS audit_delete
  `);

  const result = rows[0];
  const checks = {
    role: result?.current_user === EXPECTED_ROLE,
    database: result?.current_database === EXPECTED_DATABASE,
    appSchemaUsage: result?.app_schema_usage === true,
    auditSelect: result?.audit_select === true,
    auditInsert: result?.audit_insert === true,
    auditUpdateDenied: result?.audit_update === false,
    auditDeleteDenied: result?.audit_delete === false,
  };
  const ok = Object.values(checks).every(Boolean);

  console.log(JSON.stringify({
    ok,
    currentUser: result?.current_user,
    currentDatabase: result?.current_database,
    checks,
  }, null, 2));

  if (!ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Postgres runtime check failed:", error?.message || error);
  process.exitCode = 1;
});
