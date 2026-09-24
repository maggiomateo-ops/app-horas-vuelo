import { postgresQuery } from "./_postgres.js";

const EXPECTED_BRANCH = "etapa-2e2-postgres-repositories";
const EXPECTED_ROLE = "app_horas_runtime";
const EXPECTED_DATABASE = "app_horas";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex");
}

export default async function handler(req, res) {
  noStore(res);

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const vercelEnv = String(process.env.VERCEL_ENV || "").trim().toLowerCase();
  const gitBranch = String(process.env.VERCEL_GIT_COMMIT_REF || "").trim();

  if (vercelEnv !== "preview" || gitBranch !== EXPECTED_BRANCH) {
    return res.status(404).json({ ok: false, error: "Not found." });
  }

  try {
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

    return res.status(200).json({
      ok: Object.values(checks).every(Boolean),
      currentUser: result?.current_user || null,
      currentDatabase: result?.current_database || null,
      checks,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      errorCode: error?.code || "POSTGRES_RUNTIME_CHECK_FAILED",
      error: error?.message || "Postgres runtime check failed.",
    });
  }
}
