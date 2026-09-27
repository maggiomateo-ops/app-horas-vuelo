import { postgresQuery } from "./_postgres.js";
import { DATA_SOURCE, resolveDataSource } from "./_dataSource.js";
import { getAircraftsForUserFromPostgres } from "./_postgresAircraftRepository.js";
import { getLegacyHistorialesShapeFromPostgres } from "./_postgresHistorialesParityAdapter.js";
import { getLegacySettingsShapeFromPostgres } from "./_postgresSettingsParityAdapter.js";
import { resolveSettingsWriteCapability, resolvePostgresFlightWriteCapability } from "./_settingsWriteCapability.js";
import { saveLegacyFlightToPostgres, requireCanonicalOwnershipReadyForFlightFromPostgres } from "./_postgresFlightRepository.js";

const EXPECTED_BRANCH = "etapa-2e4-test-app-parity";
const EXPECTED_ROLE = "app_horas_runtime";
const EXPECTED_DATABASE = "app_horas";
const ROUTING_VARIABLES = [
  "GOOGLE_USER_RESOLUTION_SOURCE",
  "AIRCRAFT_DATA_SOURCE",
  "SETTINGS_DATA_SOURCE",
  "HISTORIALES_DATA_SOURCE",
  "FLIGHT_DATA_SOURCE",
];

function noStore(res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Robots-Tag", "noindex");
}

function nearlyEqual(left, right, tolerance = 0.000001) {
  return Math.abs(Number(left) - Number(right)) <= tolerance;
}

function selectorDiagnostic(variableName) {
  const raw = String(process.env[variableName] || "").trim();
  return {
    present: raw.length > 0,
    rawValue: raw || null,
    normalized: resolveDataSource(variableName),
  };
}

export default async function handler(req, res) {
  noStore(res);

  if (!["GET", "POST"].includes(req.method)) {
    return res.status(405).json({ ok: false, error: "Method not allowed." });
  }

  const vercelEnv = String(process.env.VERCEL_ENV || "").trim().toLowerCase();
  const gitBranch = String(process.env.VERCEL_GIT_COMMIT_REF || "").trim();

  if (vercelEnv !== "preview" || gitBranch !== EXPECTED_BRANCH) {
    return res.status(404).json({ ok: false, error: "Not found." });
  }

  try {
    const routingDiagnostics = Object.fromEntries(
      ROUTING_VARIABLES.map((variableName) => [variableName, selectorDiagnostic(variableName)])
    );
    const routing = Object.fromEntries(
      ROUTING_VARIABLES.map((variableName) => [
        variableName,
        routingDiagnostics[variableName].normalized,
      ])
    );
    const settingsWriteCapability = resolveSettingsWriteCapability(
      routing.SETTINGS_DATA_SOURCE
    );
    const flightWriteCapability = resolvePostgresFlightWriteCapability(
      routing.FLIGHT_DATA_SOURCE
    );

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

    const canaryQueryAction = String(req.query?.canaryAction || "").trim().toUpperCase();
    const isCanaryRequest = req.method === "POST" || canaryQueryAction.length > 0;
    if (isCanaryRequest) {
      const canaryAction = String(req.body?.canaryAction || canaryQueryAction).trim().toUpperCase();
      if (!flightWriteCapability.enabled || flightWriteCapability.mode !== "CANONICAL_REVISIONED") {
        return res.status(409).json({ ok: false, code: "FLIGHT_CANARY_GATE_DISABLED", error: "Flight canary gate is disabled." });
      }
      if (!activeUserId || !aircraftId) {
        return res.status(409).json({ ok: false, code: "FLIGHT_CANARY_CONTEXT_INVALID", error: "Expected exactly one active TEST user and aircraft." });
      }
      await requireCanonicalOwnershipReadyForFlightFromPostgres({ userId: activeUserId, aircraftId });

      if (canaryAction === "CREATE") {
        const data = await saveLegacyFlightToPostgres({
          userId: activeUserId,
          aircraftId,
          payload: {
            modo: "create", dia: "27", mes: "09", anio: "2026",
            desde: "TST", hasta: "TST", tiempoVueloJPI: 0.1, tiempoEnServicioGarmin: 0.1,
            piloto: "Mateo Maggio", propietario: "Christian Maggio",
            combustibleTanqueIzquierdo: "", combustibleTanqueDerecho: "", aceiteAgregado: "",
            observaciones: "2E.4 D-237 controlled TEST canary"
          }
        });
        return res.status(200).json({ ok: true, canaryAction, data });
      }

      const { rows: canaryRows } = await postgresQuery(
        `SELECT f.flight_id,f.status,r.revision_number,r.flight_time_hours,r.time_in_service_hours,r.remarks
           FROM app.flight_records f JOIN app.flight_record_revisions r ON r.flight_revision_id=f.current_revision_id
          WHERE f.aircraft_id=$1::uuid AND f.record_source='MANUAL'
            AND r.remarks LIKE '2E.4 D-237 controlled TEST canary%'
          ORDER BY f.created_at DESC LIMIT 1`,
        [aircraftId]
      );
      const canary = canaryRows[0];
      if (!canary) return res.status(404).json({ ok: false, code: "FLIGHT_CANARY_NOT_FOUND", error: "Canary Flight Record not found." });

      if (canaryAction === "CORRECT") {
        const data = await saveLegacyFlightToPostgres({
          userId: activeUserId,
          aircraftId,
          payload: {
            modo: "update", id: canary.flight_id, dia: "27", mes: "09", anio: "2026",
            desde: "TST", hasta: "TST", tiempoVueloJPI: 0.2, tiempoEnServicioGarmin: 0.2,
            piloto: "Mateo Maggio", propietario: "Christian Maggio",
            combustibleTanqueIzquierdo: "", combustibleTanqueDerecho: "", aceiteAgregado: "",
            observaciones: "2E.4 D-237 controlled TEST canary corrected",
            correctionReason: "2E.4 controlled correction canary"
          }
        });
        return res.status(200).json({ ok: true, canaryAction, data });
      }

      if (canaryAction === "VOID") {
        const data = await saveLegacyFlightToPostgres({
          userId: activeUserId,
          aircraftId,
          payload: { modo: "delete", id: canary.flight_id, voidReason: "2E.4 controlled void canary" }
        });
        return res.status(200).json({ ok: true, canaryAction, data });
      }
      return res.status(400).json({ ok: false, code: "FLIGHT_CANARY_ACTION_INVALID", error: "Use CREATE, CORRECT or VOID." });
    }

    const latestAircraft = histories?.historialAeronave?.at(-1) || null;
    const latestEngine = histories?.historialMotor?.at(-1) || null;
    const latestPropeller = histories?.historialHelice?.at(-1) || null;

    const checks = {
      allParitySelectorsPostgres: Object.values(routing).every(
        (source) => source === DATA_SOURCE.POSTGRES
      ),
      settingsWritesFailClosed: settingsWriteCapability.enabled === false,
      settingsWriteModeDisabled: settingsWriteCapability.mode === "DISABLED",
      settingsEditablePathsEmpty:
        Array.isArray(settingsWriteCapability.editablePaths) &&
        settingsWriteCapability.editablePaths.length === 0,
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
      settingsOilUnitParity: settings?.appConfig?.oilUnitLabel === "Qrt",
      settingsAnnualDueDateParity:
        settings?.kpiParams?.annualInspection?.nextDueDate === "2027-09-30",
      settingsAnnualWarningParity:
        nearlyEqual(settings?.kpiParams?.thresholds?.annualInspection?.warningDays, 60),
      settings50WarningParity:
        nearlyEqual(settings?.kpiParams?.thresholds?.inspection50?.warningHours, 10),
      settings100WarningParity:
        nearlyEqual(settings?.kpiParams?.thresholds?.inspection100?.warningHours, 15),
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
      routing,
      routingDiagnostics,
      settingsWriteCapability,
      flightWriteCapability,
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
        settingsOilUnit: settings?.appConfig?.oilUnitLabel ?? null,
        settingsAnnualDueDate: settings?.kpiParams?.annualInspection?.nextDueDate ?? null,
        settingsWarningThresholds: {
          annualDays:
            settings?.kpiParams?.thresholds?.annualInspection?.warningDays ?? null,
          inspection50Hours:
            settings?.kpiParams?.thresholds?.inspection50?.warningHours ?? null,
          inspection100Hours:
            settings?.kpiParams?.thresholds?.inspection100?.warningHours ?? null,
        },
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
