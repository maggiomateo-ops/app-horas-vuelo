import { postgresQuery } from "./_postgres.js";
import { getAircraftsForUserFromPostgres } from "./_postgresAircraftRepository.js";
import { getLegacyHistorialesShapeFromPostgres } from "./_postgresHistorialesParityAdapter.js";
import { getLegacySettingsShapeFromPostgres } from "./_postgresSettingsParityAdapter.js";

const EXPECTED_BRANCH = "etapa-2e4-test-app-parity";
const EXPECTED_ROLE = "app_horas_runtime";
const EXPECTED_DATABASE = "app_horas";

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex");
}

function nearlyEqual(left, right, tolerance = 0.000001) {
  return Math.abs(Number(left) - Number(right)) <= tolerance;
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
    const [{ rows: privilegeRows }, { rows: activeUsers }] = await Promise.all([
      postgresQuery(`
        SELECT
          current_user AS current_user,
          current_database() AS current_database,
          has_schema_privilege(current_user, 'app', 'USAGE') AS app_schema_usage,
          has_table_privilege(current_user, 'audit.audit_events', 'SELECT') AS audit_select,
          has_table_privilege(current_user, 'audit.audit_events', 'INSERT') AS audit_insert,
          has_table_privilege(current_user, 'audit.audit_events', 'UPDATE') AS audit_update,
          has_table_privilege(current_user, 'audit.audit_events', 'DELETE') AS audit_delete
      `),
      postgresQuery(`
        SELECT user_id
        FROM app.users
        WHERE status = 'ACTIVE'
        ORDER BY created_at, user_id
      `),
    ]);

    const result = privilegeRows[0];
    const activeUserId = activeUsers.length === 1 ? String(activeUsers[0].user_id) : "";
    const aircrafts = activeUserId
      ? await getAircraftsForUserFromPostgres(activeUserId)
      : [];
    const aircraftId = aircrafts.length === 1 ? String(aircrafts[0].aircraft_id) : "";

    const [settings, histories] = activeUserId && aircraftId
      ? await Promise.all([
          getLegacySettingsShapeFromPostgres({ userId: activeUserId, aircraftId }),
          getLegacyHistorialesShapeFromPostgres({
            userId: activeUserId,
            aircraftId,
            mode: "dashboard",
          }),
        ])
      : [null, null];

    const latestAircraft = histories?.historialAeronave?.at(-1) || null;
    const latestEngine = histories?.historialMotor?.at(-1) || null;
    const latestPropeller = histories?.historialHelice?.at(-1) || null;

    const checks = {
      role: result?.current_user === EXPECTED_ROLE,
      database: result?.current_database === EXPECTED_DATABASE,
      appSchemaUsage: result?.app_schema_usage === true,
      auditSelect: result?.audit_select === true,
      auditInsert: result?.audit_insert === true,
      auditUpdateDenied: result?.audit_update === false,
      auditDeleteDenied: result?.audit_delete === false,
      exactlyOneActiveUser: activeUsers.length === 1,
      exactlyOneAircraft: aircrafts.length === 1,
      aircraftRegistration: aircrafts[0]?.matricula === "LV-MHZ",
      settingsRegistration: settings?.appConfig?.aircraftRegistration === "LV-MHZ",
      ownershipStillUnconfigured: settings?.operationalConfig?.ownerOptions?.length === 0,
      aircraftHistoryCount: histories?.historialAeronave?.length === 346,
      engineHistoryCount: histories?.historialMotor?.length === 346,
      propellerHistoryCount: histories?.historialHelice?.length === 346,
      computacionHistoryCount: histories?.computacionHoras?.length === 274,
      aircraftClosingTis: nearlyEqual(latestAircraft?.tiempoTotalEnServicio, 2707.8),
      engineClosingTis: nearlyEqual(latestEngine?.tiempoTotalEnServicio, 505.5),
      legacyPropellerAircraftTisColumn: nearlyEqual(
        latestPropeller?.tiempoTotalEnServicio,
        2707.8
      ),
      propellerClosingDurg: nearlyEqual(latestPropeller?.durg, 593.6),
    };

    return res.status(200).json({
      ok: Object.values(checks).every(Boolean),
      currentUser: result?.current_user || null,
      currentDatabase: result?.current_database || null,
      runtimeCredentialScope: "branch-preview",
      checks,
      paritySummary: {
        aircrafts: aircrafts.length,
        historialAeronave: histories?.historialAeronave?.length ?? null,
        historialMotor: histories?.historialMotor?.length ?? null,
        historialHelice: histories?.historialHelice?.length ?? null,
        computacionHoras: histories?.computacionHoras?.length ?? null,
        aircraftClosingTis: latestAircraft?.tiempoTotalEnServicio ?? null,
        engineClosingTis: latestEngine?.tiempoTotalEnServicio ?? null,
        propellerClosingDurg: latestPropeller?.durg ?? null,
        ownerOptions: settings?.operationalConfig?.ownerOptions?.length ?? null,
      },
      writesPerformed: 0,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      errorCode: error?.code || "POSTGRES_RUNTIME_CHECK_FAILED",
      error: error?.message || "Postgres runtime check failed.",
    });
  }
}
