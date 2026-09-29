import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { createSessionCookie } from "../api/_auth.js";
import {
  createPostgresComponentLifecycleRepository,
  normalizeComponentLifecycleInput,
} from "../api/_postgresComponentLifecycleRepository.js";
import aircraftHandler from "../api/aircraft.js";
import { resolvePostgresComponentLifecycleWriteCapability } from "../api/_settingsWriteCapability.js";
import {
  mutateAircraftComponent,
  mutateAircraftComponentAndRefresh,
} from "../src/services/aircraftService.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AIRCRAFT_ID = "22222222-2222-4222-8222-222222222222";
const INSTALLATION_ID = "33333333-3333-4333-8333-333333333333";
const COMPONENT_ID = "44444444-4444-4444-8444-444444444444";
const FIRST_FLIGHT_ID = "55555555-5555-4555-8555-555555555555";
const LAST_FLIGHT_ID = "66666666-6666-4666-8666-666666666666";

function uuid(sequence) {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, "0")}`;
}

function installationRow(overrides = {}) {
  return {
    component_installation_id: INSTALLATION_ID,
    component_id: COMPONENT_ID,
    component_type: "ENGINE",
    position_index: 1,
    manufacturer: "Lycoming",
    model: "IO-360",
    serial_number: "OLD-SN",
    notes: "existing notes",
    component_status: "ACTIVE",
    installed_on: null,
    removed_on: null,
    opening_tis_hours: "200.1",
    first_applicable_flight_id: null,
    last_applicable_flight_id: null,
    ...overrides,
  };
}

function installInput(overrides = {}) {
  return {
    aircraftId: AIRCRAFT_ID,
    componentType: "ENGINE",
    positionIndex: 1,
    installedOn: "2026-09-01",
    manufacturer: null,
    model: null,
    serialNumber: null,
    notes: null,
    openingTisHours: null,
    ...overrides,
  };
}

function createMockRepository({
  ownerAllowed = true,
  configuration = { engine_count: 2, propeller_count: 1 },
  activePosition,
  installation = installationRow(),
  firstFlightId = FIRST_FLIGHT_ID,
  lastFlightId = LAST_FLIGHT_ID,
  failOn = "",
} = {}) {
  const queries = [];
  let sequence = 1;
  let committed = false;
  let transactionOptions;
  const client = {
    async query(text, params = []) {
      queries.push({ text, params });
      if (failOn && text.includes(failOn)) throw new Error("synthetic intermediate failure");
      if (text.includes("FROM app.aircraft aircraft")) {
        return { rows: ownerAllowed ? [{ aircraft_id: AIRCRAFT_ID }] : [] };
      }
      if (text.includes("FROM app.aircraft_configuration")) {
        return { rows: configuration ? [{ aircraft_id: AIRCRAFT_ID, ...configuration }] : [] };
      }
      if (text.includes("AND component.component_type = $2::text")) {
        const installationWasLocked = queries.some((query) =>
          query !== queries.at(-1)
          && query.text.includes("installation.component_installation_id = $2::uuid")
        );
        const row = activePosition !== undefined
          ? activePosition
          : (installationWasLocked ? installation : null);
        return { rows: row ? [row] : [] };
      }
      if (text.includes("installation.component_installation_id = $2::uuid")) {
        return { rows: installation ? [installation] : [] };
      }
      if (text.includes("FROM app.flight_records flight")) {
        return {
          rows: text.includes("revision.flight_date >=")
            ? (firstFlightId ? [{ flight_id: firstFlightId }] : [])
            : (lastFlightId ? [{ flight_id: lastFlightId }] : []),
        };
      }
      if (text.includes("UPDATE app.components component")) {
        return { rows: [{ status: "ARCHIVED" }] };
      }
      return { rows: [] };
    },
  };
  const mutate = createPostgresComponentLifecycleRepository({
    transaction: async (work, options) => {
      transactionOptions = options;
      try {
        const result = await work(client);
        committed = true;
        return result;
      } catch (error) {
        committed = false;
        throw error;
      }
    },
    randomUUID: () => uuid(sequence++),
  });
  return {
    mutate,
    queries,
    getCommitted: () => committed,
    getTransactionOptions: () => transactionOptions,
  };
}

function createResponse() {
  return {
    statusCode: null,
    payload: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test("flag lifecycle OFF falla cerrado antes de abrir Postgres", async () => {
  const previous = {
    secret: process.env.SESSION_SECRET,
    source: process.env.AIRCRAFT_DATA_SOURCE,
    flag: process.env.POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED,
  };
  try {
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.AIRCRAFT_DATA_SOURCE = "postgres";
    delete process.env.POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED;
    const req = {
      method: "PATCH",
      headers: { cookie: createSessionCookie({ userId: USER_ID }).split(";")[0] },
      body: { action: "install-component", ...installInput() },
    };
    const res = createResponse();
    await aircraftHandler(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, "POSTGRES_COMPONENT_LIFECYCLE_WRITES_NOT_ENABLED");
  } finally {
    if (previous.secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous.secret;
    if (previous.source === undefined) delete process.env.AIRCRAFT_DATA_SOURCE;
    else process.env.AIRCRAFT_DATA_SOURCE = previous.source;
    if (previous.flag === undefined) delete process.env.POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED;
    else process.env.POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED = previous.flag;
  }
});

test("capability lifecycle sólo habilita true exacto y Postgres", () => {
  const previous = process.env.POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED;
  try {
    delete process.env.POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED;
    assert.equal(resolvePostgresComponentLifecycleWriteCapability("POSTGRES").enabled, false);
    process.env.POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED = "true";
    assert.equal(resolvePostgresComponentLifecycleWriteCapability("POSTGRES").enabled, true);
    assert.equal(resolvePostgresComponentLifecycleWriteCapability("SHEETS").enabled, false);
    process.env.POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED = "yes";
    assert.throws(
      () => resolvePostgresComponentLifecycleWriteCapability("POSTGRES"),
      /debe ser true, false o estar ausente/
    );
  } finally {
    if (previous === undefined) delete process.env.POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED;
    else process.env.POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED = previous;
  }
});

test("normaliza unknown como NULL y exige fechas/posiciones canonicas", () => {
  const normalized = normalizeComponentLifecycleInput("install-component", installInput({
    manufacturer: "",
    openingTisHours: "",
  }));
  assert.equal(normalized.manufacturer, null);
  assert.equal(normalized.openingTisHours, null);
  assert.throws(
    () => normalizeComponentLifecycleInput("install-component", installInput({ positionIndex: 0 })),
    /positionIndex/
  );
  assert.throws(
    () => normalizeComponentLifecycleInput("remove-component", {
      aircraftId: AIRCRAFT_ID,
      componentInstallationId: INSTALLATION_ID,
      removedOn: "",
    }),
    /removedOn/
  );
});

test("deniega no OWNER y exige aircraft_configuration sin writes", async () => {
  for (const [mock, code, status] of [
    [createMockRepository({ ownerAllowed: false }), "COMPONENT_LIFECYCLE_ACCESS_DENIED", 403],
    [createMockRepository({ configuration: null }), "AIRCRAFT_CONFIGURATION_REQUIRED", 409],
  ]) {
    await assert.rejects(
      mock.mutate({ userId: USER_ID, action: "install-component", input: installInput() }),
      (error) => error.code === code && error.statusCode === status
    );
    assert.equal(
      mock.queries.some((query) => /\bINSERT\b|\bUPDATE\s+app\./i.test(query.text)),
      false
    );
  }
});

test("rechaza posicion fuera del rango configurado", async () => {
  const mock = createMockRepository();
  await assert.rejects(
    mock.mutate({
      userId: USER_ID,
      action: "install-component",
      input: installInput({ positionIndex: 3 }),
    }),
    (error) => error.code === "COMPONENT_POSITION_OUT_OF_RANGE" && error.statusCode === 422
  );
  assert.equal(mock.queries.some((query) => /\bINSERT\b/i.test(query.text)), false);
});

test("INSTALL crea componente/installation en posicion vacia y deriva primer vuelo", async () => {
  const mock = createMockRepository();
  const result = await mock.mutate({
    userId: USER_ID,
    action: "install-component",
    input: installInput(),
  });
  assert.deepEqual(mock.getTransactionOptions(), { isolationLevel: "SERIALIZABLE" });
  assert.equal(mock.getCommitted(), true);
  assert.equal(result.installation.firstApplicableFlightId, FIRST_FLIGHT_ID);
  assert.equal(result.installation.openingTisHours, null);
  const insertComponent = mock.queries.find((query) => query.text.includes("INSERT INTO app.components"));
  assert.deepEqual(insertComponent.params.slice(2), [null, null, null, null]);
  const insertInstallation = mock.queries.find((query) =>
    query.text.includes("INSERT INTO app.component_installations")
  );
  assert.equal(insertInstallation.params[6], FIRST_FLIGHT_ID);
  const boundary = mock.queries.find((query) => query.text.includes("revision.flight_date >="));
  assert.match(boundary.text, /flight\.status = 'ACTIVE'/);
  const audit = mock.queries.find((query) => query.text.includes("INSERT INTO audit.audit_events"));
  assert.equal(audit.params[5], "COMPONENT_INSTALLED");
  assert.match(audit.text, /'USER'.*'MANUAL'/s);
  assert.equal(JSON.parse(audit.params[7]).newInstallation.firstApplicableFlightId, FIRST_FLIGHT_ID);
});

test("INSTALL rechaza posicion ocupada con 409 sin inserts", async () => {
  const mock = createMockRepository({ activePosition: installationRow() });
  await assert.rejects(
    mock.mutate({ userId: USER_ID, action: "install-component", input: installInput() }),
    (error) => error.code === "COMPONENT_POSITION_OCCUPIED" && error.statusCode === 409
  );
  assert.equal(mock.queries.some((query) => /\bINSERT\b/i.test(query.text)), false);
});

test("REMOVE cierra installation migrada con installed_on NULL y deriva ultimo vuelo", async () => {
  const mock = createMockRepository({ installation: installationRow({ installed_on: null }) });
  const result = await mock.mutate({
    userId: USER_ID,
    action: "remove-component",
    input: {
      aircraftId: AIRCRAFT_ID,
      componentInstallationId: INSTALLATION_ID,
      removedOn: "2026-09-15",
    },
  });
  assert.equal(result.installation.installedOn, null);
  assert.equal(result.installation.removedOn, "2026-09-15");
  assert.equal(result.installation.lastApplicableFlightId, LAST_FLIGHT_ID);
  assert.equal(result.installation.status, "ARCHIVED");
  const boundary = mock.queries.find((query) => query.text.includes("revision.flight_date <"));
  assert.match(boundary.text, /ORDER BY revision\.flight_date DESC/);
  const close = mock.queries.find((query) => query.text.includes("UPDATE app.component_installations"));
  assert.deepEqual(close.params, [INSTALLATION_ID, "2026-09-15", LAST_FLIGHT_ID]);
  const archive = mock.queries.find((query) => query.text.includes("UPDATE app.components component"));
  assert.match(archive.text, /NOT EXISTS/);
  const audit = mock.queries.find((query) => query.text.includes("INSERT INTO audit.audit_events"));
  assert.equal(audit.params[5], "COMPONENT_REMOVED");
});

test("REMOVE rechaza inexistente o ya removida con 409", async () => {
  for (const installation of [null, installationRow({ removed_on: "2026-09-01" })]) {
    const mock = createMockRepository({ installation });
    await assert.rejects(
      mock.mutate({
        userId: USER_ID,
        action: "remove-component",
        input: {
          aircraftId: AIRCRAFT_ID,
          componentInstallationId: INSTALLATION_ID,
          removedOn: "2026-09-15",
        },
      }),
      (error) => error.code === "ACTIVE_COMPONENT_INSTALLATION_NOT_FOUND"
        && error.statusCode === 409
    );
  }
});

test("REPLACE usa boundary exacto, crea IDs fisicos nuevos y no copia identidad", async () => {
  const mock = createMockRepository();
  const result = await mock.mutate({
    userId: USER_ID,
    action: "replace-component",
    input: {
      aircraftId: AIRCRAFT_ID,
      oldComponentInstallationId: INSTALLATION_ID,
      effectiveDate: "2026-09-20",
      newComponent: {
        manufacturer: null,
        model: null,
        serialNumber: null,
        notes: null,
        openingTisHours: null,
      },
    },
  });
  assert.notEqual(result.installation.componentId, COMPONENT_ID);
  assert.notEqual(result.installation.componentInstallationId, INSTALLATION_ID);
  assert.equal(result.oldInstallation.removedOn, "2026-09-20");
  assert.equal(result.oldInstallation.lastApplicableFlightId, LAST_FLIGHT_ID);
  assert.equal(result.oldInstallation.status, "ARCHIVED");
  assert.equal(result.installation.installedOn, "2026-09-20");
  assert.equal(result.installation.firstApplicableFlightId, FIRST_FLIGHT_ID);
  assert.equal(result.installation.manufacturer, null);
  assert.equal(result.installation.model, null);
  assert.equal(result.installation.serialNumber, null);
  const componentInsert = mock.queries.find((query) => query.text.includes("INSERT INTO app.components"));
  assert.deepEqual(componentInsert.params.slice(2), [null, null, null, null]);
  const audit = mock.queries.find((query) => query.text.includes("INSERT INTO audit.audit_events"));
  assert.equal(audit.params[5], "COMPONENT_REPLACED");
  const after = JSON.parse(audit.params[7]);
  assert.equal(after.oldInstallation.removedOn, "2026-09-20");
  assert.equal(after.newInstallation.installedOn, "2026-09-20");
});

test("un fallo intermedio hace rollback y no escribe Audit", async () => {
  const mock = createMockRepository({ failOn: "INSERT INTO app.component_installations" });
  await assert.rejects(
    mock.mutate({ userId: USER_ID, action: "install-component", input: installInput() }),
    /synthetic intermediate failure/
  );
  assert.equal(mock.getCommitted(), false);
  assert.equal(
    mock.queries.some((query) => query.text.includes("INSERT INTO audit.audit_events")),
    false
  );
});

test("concurrencia se serializa por aircraft lock y revalida posicion bajo lock", async () => {
  const mock = createMockRepository({ activePosition: installationRow() });
  await assert.rejects(
    mock.mutate({ userId: USER_ID, action: "install-component", input: installInput() }),
    /posicion ya tiene/
  );
  assert.match(mock.queries[0].text, /FOR UPDATE OF aircraft/);
  const positionQuery = mock.queries.find((query) =>
    query.text.includes("AND component.component_type = $2::text")
  );
  assert.match(positionQuery.text, /FOR UPDATE OF installation, component/);
  assert.deepEqual(mock.getTransactionOptions(), { isolationLevel: "SERIALIZABLE" });
});

test("repository no modifica vuelos, revisiones ni hijos historicos", async () => {
  const source = await fs.readFile(
    new URL("../api/_postgresComponentLifecycleRepository.js", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(
    source,
    /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?app\.(?:flight_records|flight_record_revisions|flight_component_runtime|flight_component_counters|flight_component_consumables)/i
  );
  assert.match(source, /FROM app\.flight_records flight/);
});

test("cliente usa PATCH consolidado, credentials y refresh canonico", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, action: "install-component", installation: {} }),
      };
    };
    await mutateAircraftComponent("install-component", AIRCRAFT_ID, {
      componentType: "ENGINE",
      positionIndex: 1,
      installedOn: "2026-09-01",
    });
    assert.equal(requests[0].url, "/api/aircraft");
    assert.equal(requests[0].options.method, "PATCH");
    assert.equal(requests[0].options.credentials, "include");
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.action, "install-component");
    assert.equal(body.aircraftId, AIRCRAFT_ID);
  } finally {
    globalThis.fetch = previousFetch;
  }

  const refreshed = await mutateAircraftComponentAndRefresh(
    "remove-component",
    AIRCRAFT_ID,
    {},
    {
      mutateRequest: async () => ({
        ok: true,
        action: "remove-component",
        installation: { componentInstallationId: INSTALLATION_ID, removedOn: "2026-09-15" },
      }),
      loadAircrafts: async () => [{ aircraft_id: AIRCRAFT_ID, canonical: true }],
      currentAircrafts: [],
    }
  );
  assert.equal(refreshed.aircrafts[0].canonical, true);
});

test("read model expone activas e historial y legacy Sheets no recibe controles", async () => {
  const repositorySource = await fs.readFile(
    new URL("../api/_postgresAircraftRepository.js", import.meta.url),
    "utf8"
  );
  const handlerSource = await fs.readFile(
    new URL("../api/aircraft.js", import.meta.url),
    "utf8"
  );
  assert.match(repositorySource, /component_history\.installations AS "componentInstallationHistory"/);
  assert.match(repositorySource, /'removedOn'/);
  assert.match(handlerSource, /if \(source !== DATA_SOURCE\.POSTGRES\) return getAircraftsForUser/);
  assert.match(handlerSource, /componentLifecycleWritesAvailable/);
});

test("UI owner muestra posiciones, historial y confirmacion sin edicion in-place", async () => {
  const source = await fs.readFile(
    new URL("../src/components/AircraftComponentLifecyclePanel.jsx", import.meta.url),
    "utf8"
  );
  for (const text of [
    "Motor",
    "Hélice",
    "Posición vacía",
    "Instalar componente",
    "Reemplazar",
    "Remover",
    "Historial anterior",
    "Confirmá esta operación",
  ]) {
    assert.match(source, new RegExp(text));
  }
  assert.doesNotMatch(source, /editar identidad|guardar identidad/i);
  const settingsSource = await fs.readFile(
    new URL("../src/components/SettingsPanel.jsx", import.meta.url),
    "utf8"
  );
  assert.match(settingsSource, /aircraftConfigurationPanel/);
});

test("no crea migration 006 ni una funcion serverless numero 13", async () => {
  const migrations = await fs.readdir(new URL("../db/migrations/", import.meta.url));
  assert.equal(migrations.some((filename) => filename.startsWith("006_")), false);
  const entries = await fs.readdir(new URL("../api/", import.meta.url), { withFileTypes: true });
  const functions = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".js") && !entry.name.startsWith("_")
  );
  assert.equal(functions.length, 12);
});
