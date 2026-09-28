import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { buildCutoverSnapshot } from "../scripts/migrations/2e7/cutover-snapshot-core.mjs";

const manifestUrl = new URL("../data-migrations/2e7/lv-mhz-cutover-manifest.json", import.meta.url);

async function loadManifest() {
  return JSON.parse(await fs.readFile(manifestUrl, "utf8"));
}

function buildFixture() {
  const aircraftHistoryValues = [["header"], ["header-2"]];
  const engineHistoryValues = [["header"], ["header-2"]];
  const propellerHistoryValues = [["header"], ["header-2"]];
  const computacionValues = [["header"], ["header-2"]];
  let aircraftTotal = 2302.2;
  let engineTotal = 99.9;
  let propellerTotal = 188;

  for (let id = 1; id <= 346; id += 1) {
    const tis = id === 300 ? 2 : id === 346 ? 59.6 : 1;
    aircraftTotal = Math.round((aircraftTotal + tis) * 10) / 10;
    engineTotal = Math.round((engineTotal + tis) * 10) / 10;
    propellerTotal = Math.round((propellerTotal + tis) * 10) / 10;
    const correction = id === 300;
    const day = correction ? 31 : 1;
    const month = correction ? 7 : 1;
    const year = correction ? 2026 : 2023;
    const departure = correction ? "AGR" : "AAA";
    const arrival = correction ? "RAE" : "BBB";
    const flightTime = correction ? 2.1 : tis;
    aircraftHistoryValues.push([
      id, day, month, year, departure, arrival, tis, aircraftTotal,
      flightTime, "Mateo Maggio", "",
    ]);
    engineHistoryValues.push([id, day, month, year, departure, arrival, tis, engineTotal]);
    propellerHistoryValues.push([id, day, month, year, departure, arrival, tis, null, propellerTotal]);
    if (id >= 73) {
      computacionValues.push([
        id, day, month, year, departure, arrival,
        correction ? 2.1 : flightTime,
        correction ? 2 : tis,
        "", "MAGGIO", "", "", "",
      ]);
    }
  }

  const source = {
    usersValues: [
      ["user_id", "email", "nombre", "estado"],
      ["U001", "owner@example.test", "Mateo Maggio", "ACTIVO"],
    ],
    permissionsValues: [
      ["user_id", "aircraft_id", "rol", "estado"],
      ["U001", "A001", "OWNER", "ACTIVO"],
    ],
    aircraftValues: [
      ["aircraft_id", "matricula", "fabricante", "modelo", "spreadsheet_id", "estado"],
      ["A001", "LV-MHZ", "PIPER", "PA28R-201", "source-sheet-id", "ACTIVA"],
    ],
    computacionValues,
    aircraftHistoryValues,
    engineHistoryValues,
    propellerHistoryValues,
    settingsValues: [
      ["clave", "valor_json"],
      ["APP_HORAS_SETTINGS", JSON.stringify({
        kpiParams: { thresholds: { inspection100: { warningHours: 15 } } },
      })],
    ],
  };

  const revisions = Array.from({ length: 346 }, (_, index) => ({
    flight_revision_id: `revision-${index + 1}`,
    flight_id: `flight-${index + 1}`,
  }));
  const legacyBundle = {
    migration_key: "lv-mhz-production-cutover-v1",
    tables: {
      "app.flight_records": revisions.map((revision) => ({
        flight_id: revision.flight_id,
        current_revision_id: revision.flight_revision_id,
        status: "ACTIVE",
      })),
      "app.flight_record_revisions": revisions,
      "app.aircraft_ownership_interests": [],
      "app.export_runs": [],
      "app.export_templates": [],
      "app.aircraft_registrations": [{ registration: "LV-MHZ" }],
      "app.tracking_items": [{ interval_hours: 100, alert_before_value: 15 }],
    },
  };

  return { source, legacyBundle };
}

test("2E.7 genera un hash lógico estable y la reconciliación canónica", async () => {
  const manifest = await loadManifest();
  const fixture = buildFixture();
  const first = buildCutoverSnapshot({ manifest, ...fixture });
  const second = buildCutoverSnapshot({ manifest, ...fixture });

  assert.equal(first.report.sha256, second.report.sha256);
  assert.equal(first.report.sourceFingerprint.sha256, second.report.sourceFingerprint.sha256);
  assert.deepEqual(first.report.sourceCounts, {
    users: 1,
    permissions: 1,
    aircraft: 1,
    computacionHoras: 274,
    historialAeronave: 346,
    historialMotor: 346,
    historialHelice: 346,
  });
  assert.deepEqual(first.report.utilization, {
    trackedTisHours: 405.6,
    aircraftClosingTisHours: 2707.8,
    engineClosingTisHours: 505.5,
    propellerClosingTisHours: 593.6,
  });
  assert.equal(first.report.currentRevisionCoverage, 346);
  assert.equal(first.report.knownCorrections[0].verified, true);
  assert.equal(first.report.settings.inspection100WarningHours, 15);
  assert.equal(first.report.writesPerformed, 0);
  assert.equal(first.report.databaseConnections, 0);
});

test("2E.7 mantiene ownership legal fuera del snapshot y declara su bootstrap", async () => {
  const manifest = await loadManifest();
  const result = buildCutoverSnapshot({ manifest, ...buildFixture() });

  assert.equal(result.report.targetCounts["app.aircraft_ownership_interests"], 0);
  assert.deepEqual(
    result.report.canonicalBootstrapRequired[0].interests.map(({ partyName, percentage }) => ({ partyName, percentage })),
    [
      { partyName: "Christian Maggio", percentage: 50 },
      { partyName: "Facundo Alegre", percentage: 50 },
    ]
  );
  assert.ok(result.report.excludedTestOnlyState.every((item) => item.status === "EXCLUDED"));
  assert.ok(result.report.excludedTestOnlyState.some((item) => item.code === "LV-TST"));
  assert.ok(result.report.excludedTestOnlyState.some((item) => item.code === "TEST_SETTINGS_15_1"));
});

test("2E.7 falla cerrado ante cambios de counts, IDs, corrección o Settings", async () => {
  const manifest = await loadManifest();

  const changedCount = buildFixture();
  changedCount.source.engineHistoryValues.pop();
  assert.throws(() => buildCutoverSnapshot({ manifest, ...changedCount }), /Historial Motor count/);

  const changedId = buildFixture();
  changedId.source.propellerHistoryValues.at(-1)[0] = 999;
  assert.throws(() => buildCutoverSnapshot({ manifest, ...changedId }), /conjunto de IDs cambió/);

  const changedCorrection = buildFixture();
  changedCorrection.source.aircraftHistoryValues.find((row) => row[0] === 300)[8] = 2;
  assert.throws(() => buildCutoverSnapshot({ manifest, ...changedCorrection }), /Corrección Flight Time/);

  const changedSettings = buildFixture();
  changedSettings.source.settingsValues[1][1] = JSON.stringify({
    kpiParams: { thresholds: { inspection100: { warningHours: 15.1 } } },
  });
  assert.throws(() => buildCutoverSnapshot({ manifest, ...changedSettings }), /Settings warning 100h/);
});

test("el runner 2E.7 sólo expone lectura Sheets y no contiene acceso Postgres", async () => {
  const runner = await fs.readFile(
    new URL("../scripts/migrations/2e7/lv-mhz-cutover-snapshot.mjs", import.meta.url),
    "utf8"
  );
  const sheets = await fs.readFile(
    new URL("../scripts/migrations/2e7/google-sheets-readonly.mjs", import.meta.url),
    "utf8"
  );
  const combined = `${runner}\n${sheets}`;

  assert.match(sheets, /spreadsheets\.readonly/);
  assert.doesNotMatch(combined, /DATABASE_URL|from ["']pg["']|postgres|batchUpdateSpreadsheetValues|appendSpreadsheetValues|clearSpreadsheetValues/);
  assert.match(sheets, /method: "GET"/);
});
