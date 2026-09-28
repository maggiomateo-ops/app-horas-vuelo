import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import ExcelJS from "exceljs";

import {
  FLIGHT_HISTORY_DATASET,
  SYSTEM_FLIGHT_HISTORY_FIELDS,
  SYSTEM_FLIGHT_HISTORY_TEMPLATE_ID,
  SYSTEM_FLIGHT_HISTORY_VERSION_ID,
  buildFlightHistoryExportModel,
  createPostgresExportRepository,
  ensureSystemFlightHistoryPreset,
  normalizeFlightHistoryExportInput,
} from "../api/_postgresExportRepository.js";
import { renderFlightHistoryWorkbook } from "../api/_xlsxFlightHistoryRenderer.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AIRCRAFT_ID = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";
const GENERATED_AT = new Date("2026-09-27T15:30:00.000Z");

const TEMPLATE = Object.freeze({
  export_template_id: SYSTEM_FLIGHT_HISTORY_TEMPLATE_ID,
  export_template_version_id: SYSTEM_FLIGHT_HISTORY_VERSION_ID,
  version_number: 1,
  name: "System Aircraft Flight History V1",
  render_options: { workbook_version: 1, sheets: ["Summary", "Aircraft"] },
});

function templateFields() {
  return SYSTEM_FLIGHT_HISTORY_FIELDS.map((fieldCode, index) => ({
    field_code: fieldCode,
    display_order: index + 1,
    custom_label: null,
    format_options: {},
  }));
}

function validInput(overrides = {}) {
  return {
    aircraftId: AIRCRAFT_ID,
    datasetCode: FLIGHT_HISTORY_DATASET,
    periodType: "ALL_HISTORY",
    locale: "es",
    ...overrides,
  };
}

function createClient({
  access = true,
  templateInitiallyExists = true,
  flights = [],
  adjustments = [],
  registration = "LV-TEST",
} = {}) {
  const queries = [];
  let templateExists = templateInitiallyExists;
  const client = {
    async query(text, params = []) {
      queries.push({ text, params });
      if (text.includes("FROM app.users user_account")) {
        return {
          rows: access
            ? [{
                aircraft_id: AIRCRAFT_ID,
                manufacturer: "Piper",
                model: "PA-28",
                registration,
                baseline_tis_hours: "100.0",
                baseline_effective_date: "2026-01-01",
                first_tracked_flight_id: null,
              }]
            : [],
        };
      }
      if (text.includes("FROM app.export_templates template")) {
        return { rows: templateExists ? [TEMPLATE] : [] };
      }
      if (text.includes("INSERT INTO app.export_template_versions")) {
        templateExists = true;
      }
      if (text.includes("FROM app.export_template_version_fields")) {
        return { rows: templateFields() };
      }
      if (text.includes("FROM app.flight_records flight")) return { rows: flights };
      if (text.includes("FROM app.utilization_adjustments")) return { rows: adjustments };
      return { rows: [] };
    },
  };
  return { client, queries };
}

test("normaliza los tres periodos y resuelve YEAR_TO_DATE de forma inclusiva", () => {
  assert.deepEqual(normalizeFlightHistoryExportInput(validInput(), GENERATED_AT), {
    aircraftId: AIRCRAFT_ID,
    datasetCode: FLIGHT_HISTORY_DATASET,
    locale: "es",
    periodType: "ALL_HISTORY",
    periodStartDate: null,
    periodEndDate: null,
  });
  assert.deepEqual(
    normalizeFlightHistoryExportInput(
      validInput({ periodType: "YEAR_TO_DATE", locale: "en" }),
      GENERATED_AT
    ),
    {
      aircraftId: AIRCRAFT_ID,
      datasetCode: FLIGHT_HISTORY_DATASET,
      locale: "en",
      periodType: "YEAR_TO_DATE",
      periodStartDate: "2026-01-01",
      periodEndDate: "2026-09-27",
    }
  );
  assert.equal(
    normalizeFlightHistoryExportInput(
      validInput({
        periodType: "CUSTOM",
        periodStartDate: "2026-02-01",
        periodEndDate: "2026-02-28",
      }),
      GENERATED_AT
    ).periodEndDate,
    "2026-02-28"
  );
});

test("rechaza periodos, locales, datasets y campos fuera del contrato", () => {
  const invalidInputs = [
    validInput({ locale: "pt" }),
    validInput({ datasetCode: "USERS" }),
    validInput({ periodType: "CUSTOM", periodStartDate: "2026-02-10", periodEndDate: "2026-02-01" }),
    validInput({ periodStartDate: "2026-01-01" }),
    { ...validInput(), spreadsheetId: "forbidden" },
  ];
  for (const input of invalidInputs) assert.throws(() => normalizeFlightHistoryExportInput(input));
});

test("calcula utilización en backend y conserva baseline desconocido como null", () => {
  const flights = [
    {
      flight_id: "f1",
      flight_date: "2026-01-01",
      departure_location: "A",
      arrival_location: "B",
      flight_time_hours: "1.0",
      time_in_service_hours: "1.2",
      landings: "1",
    },
    {
      flight_id: "f2",
      flight_date: "2026-02-01",
      departure_location: "B",
      arrival_location: "C",
      flight_time_hours: "2.0",
      time_in_service_hours: "2.3",
      landings: "2",
    },
  ];
  const period = {
    periodStartDate: "2026-02-01",
    periodEndDate: "2026-02-01",
  };
  const known = buildFlightHistoryExportModel({
    aircraft: { baseline_tis_hours: "100.0", baseline_effective_date: "2026-01-01" },
    flights,
    adjustments: [],
    period,
  });
  assert.equal(known.rows.length, 1);
  assert.equal(known.openingUtilization, 101.2);
  assert.equal(known.periodUtilization, 2.3);
  assert.equal(known.closingUtilization, 103.5);

  const unknown = buildFlightHistoryExportModel({
    aircraft: { baseline_tis_hours: null, baseline_effective_date: null },
    flights,
    adjustments: [],
    period,
  });
  assert.equal(unknown.openingUtilization, null);
  assert.equal(unknown.closingUtilization, null);
  assert.equal(unknown.rows[0].accumulated_aircraft_tis, null);
  assert.equal(unknown.trackedUtilization, 2.3);
});

test("ALL_HISTORY incluye vuelos activos sin fecha y CUSTOM mantiene límites inclusivos", () => {
  const flights = [
    { flight_id: "f0", flight_date: null, time_in_service_hours: "0.5" },
    { flight_id: "f1", flight_date: "2026-01-01", time_in_service_hours: "1.0" },
    { flight_id: "f2", flight_date: "2026-01-31", time_in_service_hours: "2.0" },
    { flight_id: "f3", flight_date: "2026-02-01", time_in_service_hours: "3.0" },
  ];
  const aircraft = { baseline_tis_hours: null, baseline_effective_date: null };
  assert.equal(
    buildFlightHistoryExportModel({
      aircraft,
      flights,
      adjustments: [],
      period: { periodStartDate: null, periodEndDate: null },
    }).rows.length,
    4
  );
  assert.deepEqual(
    buildFlightHistoryExportModel({
      aircraft,
      flights,
      adjustments: [],
      period: { periodStartDate: "2026-01-01", periodEndDate: "2026-01-31" },
    }).rows.map((row) => row.flight_date),
    ["2026-01-01", "2026-01-31"]
  );
});

test("el preset SYSTEM se crea una vez y conserva la versión exacta", async () => {
  const { client, queries } = createClient({ templateInitiallyExists: false });
  const first = await ensureSystemFlightHistoryPreset(client);
  const second = await ensureSystemFlightHistoryPreset(client);

  assert.equal(first.templateId, SYSTEM_FLIGHT_HISTORY_TEMPLATE_ID);
  assert.equal(first.versionId, SYSTEM_FLIGHT_HISTORY_VERSION_ID);
  assert.equal(second.versionId, first.versionId);
  assert.equal(
    queries.filter(({ text }) => text.includes("INSERT INTO app.export_templates")).length,
    1
  );
  assert.equal(
    queries.filter(({ text }) => text.includes("INSERT INTO app.export_template_version_fields")).length,
    SYSTEM_FLIGHT_HISTORY_FIELDS.length
  );
  assert.equal(
    queries.filter(({ text }) => text.includes("pg_advisory_xact_lock")).length,
    2
  );
});

test("deniega PILOT y VIEWER y exige OWNER sin privilegio legacy ADMIN", async () => {
  for (const role of ["PILOT", "VIEWER"]) {
    const { client, queries } = createClient({ access: false });
    const repository = createPostgresExportRepository({
      transaction: (work) => work(client),
      renderer: async () => Buffer.from(`unused-${role}`),
      randomUUID: () => RUN_ID,
      clock: () => GENERATED_AT,
    });
    await assert.rejects(
      repository({ userId: USER_ID, input: validInput() }),
      (error) => error.statusCode === 403 && error.code === "EXPORT_ACCESS_DENIED"
    );
    const accessSql = queries.find(({ text }) => text.includes("FROM app.users user_account")).text;
    assert.match(accessSql, /membership\.role = 'OWNER'/);
    assert.doesNotMatch(accessSql, /is_admin|role = 'ADMIN'/i);
  }
});

test("genera artifact real y persiste COMPLETED direct response con provenance exacta", async () => {
  const { client, queries } = createClient({
    registration: "../../LV TÉST\"",
    flights: [{
      flight_id: "f1",
      current_revision_id: "r1",
      flight_date: "2026-01-10",
      departure_location: "SADF",
      arrival_location: "SABE",
      time_in_service_hours: "1.0",
      flight_time_hours: "0.9",
      landings: "1",
    }],
  });
  let options;
  const bytes = Buffer.from("canonical xlsx bytes");
  const repository = createPostgresExportRepository({
    transaction: async (work, transactionOptions) => {
      options = transactionOptions;
      return work(client);
    },
    renderer: async () => bytes,
    randomUUID: () => RUN_ID,
    clock: () => GENERATED_AT,
  });
  const result = await repository({ userId: USER_ID, input: validInput() });

  assert.deepEqual(options, { isolationLevel: "REPEATABLE READ" });
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.size, bytes.length);
  assert.equal(result.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.match(result.filename, /^app-horas_[A-Za-z0-9_-]+_all_history_[A-Za-z0-9]+\.xlsx$/);
  assert.doesNotMatch(result.filename, /\.\.|\/|\\|"/);
  const runInsert = queries.find(({ text }) => text.includes("INSERT INTO app.export_runs"));
  assert.match(runInsert.text, /'COMPLETED'/);
  assert.match(runInsert.text, /NULL, NULL, NULL\s*\)/);
  assert.equal(runInsert.params[9], result.sha256);
  assert.equal(runInsert.params[10], bytes.length);
  const datasetInsert = queries.find(({ text }) => text.includes("INSERT INTO app.export_run_datasets"));
  assert.deepEqual(datasetInsert.params, [RUN_ID, FLIGHT_HISTORY_DATASET, SYSTEM_FLIGHT_HISTORY_VERSION_ID]);
  const flightSql = queries.find(({ text }) => text.includes("FROM app.flight_records flight")).text;
  assert.match(flightSql, /revision\.flight_revision_id = flight\.current_revision_id/);
  assert.match(flightSql, /flight\.status = 'ACTIVE'/);
});

test("un fallo del renderer aborta antes de crear un run COMPLETED", async () => {
  const { client, queries } = createClient();
  const repository = createPostgresExportRepository({
    transaction: (work) => work(client),
    renderer: async () => {
      throw new Error("render failed");
    },
    randomUUID: () => RUN_ID,
    clock: () => GENERATED_AT,
  });
  await assert.rejects(repository({ userId: USER_ID, input: validInput() }), /render failed/);
  assert.equal(
    queries.some(({ text }) => text.includes("INSERT INTO app.export_runs")),
    false
  );
});

test("el renderer produce Summary + Aircraft localizado y sin formulas de negocio", async () => {
  const template = {
    name: TEMPLATE.name,
    versionNumber: 1,
    fields: templateFields().map((field) => ({
      fieldCode: field.field_code,
      displayOrder: field.display_order,
      customLabel: null,
      formatOptions: {},
    })),
  };
  const buffer = await renderFlightHistoryWorkbook({
    locale: "en",
    template,
    summary: {
      registration: "LV-TEST",
      manufacturer: "Piper",
      model: "PA-28",
      periodType: "ALL_HISTORY",
      generatedAt: GENERATED_AT.toISOString(),
      openingUtilization: null,
      periodUtilization: 1.2,
      closingUtilization: null,
      trackedUtilization: 1.2,
    },
    rows: [{
      flight_date: "2026-01-10",
      departure_location: "SADF",
      arrival_location: "SABE",
      pilot: "Pilot",
      utilization_owner: "Owner",
      flight_time_hours: 1,
      time_in_service_hours: 1.2,
      accumulated_aircraft_tis: null,
      landings: 1,
      purpose: "Training",
      remarks: "Test",
    }],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Summary", "Aircraft"]);
  assert.equal(workbook.getWorksheet("Summary").getCell("B10").value, "Unavailable");
  assert.deepEqual(
    workbook.getWorksheet("Aircraft").getRow(1).values.slice(1, 4),
    ["Date", "Departure", "Arrival"]
  );
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row) => row.eachCell((cell) => assert.equal(cell.type === ExcelJS.ValueType.Formula, false)));
  }

  const spanishBuffer = await renderFlightHistoryWorkbook({
    locale: "es",
    template,
    summary: {
      registration: "LV-TEST",
      manufacturer: "Piper",
      model: "PA-28",
      periodType: "ALL_HISTORY",
      generatedAt: GENERATED_AT.toISOString(),
      openingUtilization: null,
      periodUtilization: 0,
      closingUtilization: null,
      trackedUtilization: 0,
    },
    rows: [],
  });
  const spanishWorkbook = new ExcelJS.Workbook();
  await spanishWorkbook.xlsx.load(spanishBuffer);
  assert.equal(spanishWorkbook.getWorksheet("Aircraft").getCell("A1").value, "Fecha");
  assert.equal(spanishWorkbook.getWorksheet("Summary").getCell("B10").value, "No disponible");
});

test("la API conserva el límite de doce funciones serverless", async () => {
  const apiDirectory = new URL("../api/", import.meta.url);
  const files = await readdir(apiDirectory);
  const functions = files.filter((file) => file.endsWith(".js") && !file.startsWith("_"));
  assert.equal(functions.length, 12);
  const handler = await readFile(new URL("../api/historiales.js", import.meta.url), "utf8");
  assert.match(handler, /req\.method === "POST"/);
  assert.match(handler, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
});
