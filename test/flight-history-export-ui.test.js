import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import {
  EXPORT_PERIOD_TYPES,
  buildFlightHistoryExportPayload,
  createExportSubmissionGuard,
  createInitialExportState,
  downloadExportBlob,
  flightHistoryExportReducer,
  getSafeExportFilename,
  normalizeExportLocale,
  requestFlightHistoryExport,
} from "../src/services/historialesService.js";

const AIRCRAFT_ID = "22222222-2222-4222-8222-222222222222";

function form(overrides = {}) {
  return {
    aircraftId: AIRCRAFT_ID,
    periodType: EXPORT_PERIOD_TYPES.allHistory,
    periodStartDate: "",
    periodEndDate: "",
    locale: "es",
    ...overrides,
  };
}

function errorResponse(status, payload = null) {
  return {
    ok: false,
    status,
    async json() {
      if (payload === null) throw new Error("not json");
      return payload;
    },
  };
}

test("el panel abre, cierra y vuelve a defaults canónicos", () => {
  const initial = createInitialExportState("es-AR");
  assert.equal(initial.isOpen, false);
  assert.equal(initial.periodType, "ALL_HISTORY");
  assert.equal(initial.locale, "es");

  const opened = flightHistoryExportReducer(initial, { type: "open", locale: "en" });
  assert.equal(opened.isOpen, true);
  assert.equal(opened.locale, "en");
  const changed = flightHistoryExportReducer(opened, {
    type: "change",
    field: "periodType",
    value: "CUSTOM",
  });
  const closed = flightHistoryExportReducer(changed, { type: "close" });
  assert.equal(closed.isOpen, false);
  assert.equal(closed.periodType, "ALL_HISTORY");
});

test("construye payloads exactos ALL_HISTORY y YEAR_TO_DATE sin fechas", () => {
  for (const periodType of ["ALL_HISTORY", "YEAR_TO_DATE"]) {
    const payload = buildFlightHistoryExportPayload(
      form({ periodType, periodStartDate: "2026-01-01", periodEndDate: "2026-12-31" })
    );
    assert.deepEqual(payload, {
      aircraftId: AIRCRAFT_ID,
      datasetCode: "AIRCRAFT_FLIGHT_HISTORY",
      periodType,
      locale: "es",
    });
  }
});

test("CUSTOM envía límites inclusivos y bloquea fechas faltantes o invertidas", () => {
  assert.deepEqual(
    buildFlightHistoryExportPayload(
      form({
        periodType: "CUSTOM",
        periodStartDate: "2026-01-01",
        periodEndDate: "2026-01-31",
        locale: "en",
      })
    ),
    {
      aircraftId: AIRCRAFT_ID,
      datasetCode: "AIRCRAFT_FLIGHT_HISTORY",
      periodType: "CUSTOM",
      periodStartDate: "2026-01-01",
      periodEndDate: "2026-01-31",
      locale: "en",
    }
  );
  assert.throws(() => buildFlightHistoryExportPayload(form({ periodType: "CUSTOM" })));
  assert.throws(() =>
    buildFlightHistoryExportPayload(
      form({
        periodType: "CUSTOM",
        periodStartDate: "2026-02-01",
        periodEndDate: "2026-01-31",
      })
    )
  );
});

test("locale admite es/en y usa es como fallback", () => {
  assert.equal(normalizeExportLocale("es-AR"), "es");
  assert.equal(normalizeExportLocale("en-US"), "en");
  assert.equal(normalizeExportLocale("pt-BR"), "es");
});

test("el guard impide doble submit", () => {
  const guard = createExportSubmissionGuard();
  assert.equal(guard.tryStart(), true);
  assert.equal(guard.tryStart(), false);
  guard.finish();
  assert.equal(guard.tryStart(), true);
});

test("POST usa credentials include y devuelve Blob con filename seguro", async () => {
  let request;
  const blob = new Blob(["xlsx-bytes"], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const artifact = await requestFlightHistoryExport(form(), async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        "Content-Disposition": 'attachment; filename="app-horas_LV-TEST.xlsx"',
      }),
      async blob() {
        return blob;
      },
    };
  });

  assert.equal(request.url, "/api/historiales");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.credentials, "include");
  assert.deepEqual(JSON.parse(request.options.body), buildFlightHistoryExportPayload(form()));
  assert.equal(artifact.blob, blob);
  assert.equal(artifact.filename, "app-horas_LV-TEST.xlsx");
});

test("la descarga crea URL temporal, hace click y siempre la revoca", () => {
  const calls = [];
  const anchor = {
    click() {
      calls.push(["click", this.href, this.download]);
    },
  };
  downloadExportBlob(
    { blob: new Blob(["xlsx"]), filename: "history.xlsx" },
    {
      createObjectURL: () => {
        calls.push(["create"]);
        return "blob:temporary";
      },
      revokeObjectURL: (url) => calls.push(["revoke", url]),
      createElement: () => anchor,
    }
  );
  assert.deepEqual(calls, [
    ["create"],
    ["click", "blob:temporary", "history.xlsx"],
    ["revoke", "blob:temporary"],
  ]);
});

test("Content-Disposition inseguro usa un filename local neutro", () => {
  assert.equal(getSafeExportFilename('attachment; filename="../../secret.xlsx"'), "app-horas-historial.xlsx");
  assert.equal(getSafeExportFilename("attachment; filename=history.csv"), "app-horas-historial.xlsx");
});

test("mapea 403, 400/422, 503 y 5xx sin filtrar detalles internos", async () => {
  const cases = [
    [403, { error: "internal role", code: "DENIED" }, "No tenés permiso"],
    [400, { error: "Período inválido." }, "Período inválido."],
    [422, { error: "Dataset no soportado." }, "Dataset no soportado."],
    [503, { error: "database secret" }, "no está disponible temporalmente"],
    [500, { error: "database secret" }, "No se pudo generar el archivo Excel."],
  ];

  for (const [status, payload, expected] of cases) {
    await assert.rejects(
      requestFlightHistoryExport(form(), async () => errorResponse(status, payload)),
      (error) => error.statusCode === status && error.message.includes(expected)
    );
  }

  await assert.rejects(
    requestFlightHistoryExport(form(), async () => {
      throw new Error("socket with internal hostname");
    }),
    (error) =>
      error.statusCode === 0 &&
      error.message === "No se pudo generar el archivo Excel." &&
      !error.message.includes("hostname")
  );
});

test("CTA depende sólo de OWNER y no usa legacy ADMIN ni storage", async () => {
  const appSource = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const panelSource = await readFile(
    new URL("../src/components/HistorialesPanel.jsx", import.meta.url),
    "utf8"
  );
  const serviceSource = await readFile(
    new URL("../src/services/historialesService.js", import.meta.url),
    "utf8"
  );

  assert.match(appSource, /canExport=\{selectedAircraftRole === "OWNER"\}/);
  assert.doesNotMatch(appSource, /canExport=\{[^}]*isGlobalAdmin/);
  assert.match(panelSource, /Exportar Excel/);
  assert.match(panelSource, /dispatchExport\(\{ type: "close" \}\)/);
  assert.doesNotMatch(serviceSource, /localStorage|sessionStorage/);
});

test("no agrega una nueva función API top-level", async () => {
  const files = await readdir(new URL("../api/", import.meta.url));
  assert.equal(
    files.filter((file) => file.endsWith(".js") && !file.startsWith("_")).length,
    12
  );
});
