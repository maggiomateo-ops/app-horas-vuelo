import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { createSessionCookie } from "../api/_auth.js";
import {
  createPostgresAircraftConfigurationRepository,
  normalizeAircraftConfigurationInput,
} from "../api/_postgresAircraftConfigurationRepository.js";
import { mapPostgresAircraftRow } from "../api/_postgresAircraftRepository.js";
import aircraftHandler from "../api/aircraft.js";
import { resolvePostgresAircraftConfigurationWriteCapability } from "../api/_settingsWriteCapability.js";
import {
  buildAircraftConfigurationPayload,
  configureAircraftTopology,
  fetchAircrafts,
  validateAircraftConfiguration,
} from "../src/services/aircraftService.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AIRCRAFT_ID = "22222222-2222-4222-8222-222222222222";

function uuid(sequence) {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, "0")}`;
}

function component(componentType, positionIndex, overrides = {}) {
  return {
    componentType,
    positionIndex,
    manufacturer: null,
    model: null,
    serialNumber: null,
    notes: null,
    openingTisHours: null,
    installedOn: "2026-09-29",
    ...overrides,
  };
}

function validInput(overrides = {}) {
  return {
    aircraftId: AIRCRAFT_ID,
    propulsionType: "PISTON",
    engineCount: 2,
    propellerCount: 2,
    components: [
      component("ENGINE", 1),
      component("ENGINE", 2, { manufacturer: "Lycoming", openingTisHours: 12.3 }),
      component("PROPELLER", 1),
      component("PROPELLER", 2),
    ],
    ...overrides,
  };
}

function existingInstallation(componentType, positionIndex, overrides = {}) {
  return {
    component_installation_id: uuid(100 + positionIndex),
    component_id: uuid(200 + positionIndex),
    component_type: componentType,
    position_index: positionIndex,
    manufacturer: componentType === "ENGINE" ? "Lycoming" : "Hartzell",
    model: componentType === "ENGINE" ? "IO-360" : "HC-C2YK",
    serial_number: `${componentType}-${positionIndex}`,
    installed_on: "2020-01-02",
    opening_tis_hours: "123.4",
    component_status: "ACTIVE",
    ...overrides,
  };
}

function createMockRepository({
  ownerAllowed = true,
  existingConfiguration = false,
  existingInstallations = [],
  failOnComponentInsert = false,
} = {}) {
  const queries = [];
  let sequence = 1;
  let transactionOptions;
  let committed = false;
  let componentInsertCount = 0;
  const client = {
    async query(text, params = []) {
      queries.push({ text, params });
      if (text.includes("FROM app.aircraft aircraft")) {
        return { rows: ownerAllowed ? [{ aircraft_id: AIRCRAFT_ID }] : [] };
      }
      if (text.includes("FROM app.aircraft_configuration")) {
        return { rows: existingConfiguration ? [{ aircraft_id: AIRCRAFT_ID }] : [] };
      }
      if (text.includes("FROM app.component_installations installation")) {
        return { rows: existingInstallations };
      }
      if (text.includes("INSERT INTO app.components")) {
        componentInsertCount += 1;
        if (failOnComponentInsert && componentInsertCount === 2) {
          throw new Error("synthetic intermediate failure");
        }
      }
      return { rows: [] };
    },
  };
  const setup = createPostgresAircraftConfigurationRepository({
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
    setup,
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

test("migration 005 define únicamente la topología D-272 y no hace backfill", async () => {
  const sql = await fs.readFile(
    new URL("../db/migrations/005_aircraft_configuration.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /CREATE TABLE app\.aircraft_configuration/);
  assert.match(sql, /aircraft_id uuid PRIMARY KEY REFERENCES app\.aircraft/);
  assert.match(sql, /PISTON.*TURBOPROP.*TURBOJET.*TURBOFAN.*ELECTRIC.*OTHER/s);
  assert.match(sql, /propulsion_type IN \('TURBOJET', 'TURBOFAN'\)[\s\S]*propeller_count = 0/);
  assert.match(sql, /GRANT SELECT, INSERT ON app\.aircraft_configuration TO app_runtime/);
  assert.doesNotMatch(sql, /\bINSERT\b[\s\S]*\bSELECT\b|LV-MHZ|A001/i);
});

test("normaliza topologías válidas y rechaza combinaciones D-272 inválidas", () => {
  assert.equal(normalizeAircraftConfigurationInput(validInput()).components.length, 4);
  assert.equal(
    normalizeAircraftConfigurationInput(validInput({
      propulsionType: "TURBOJET",
      engineCount: 2,
      propellerCount: 0,
      components: [component("ENGINE", 1), component("ENGINE", 2)],
    })).propellerCount,
    0
  );
  assert.equal(
    normalizeAircraftConfigurationInput(validInput({
      propulsionType: "ELECTRIC",
      engineCount: 0,
      propellerCount: 0,
      components: [],
    })).engineCount,
    0
  );
  for (const input of [
    validInput({ engineCount: 0 }),
    validInput({ propellerCount: 0 }),
    validInput({
      propulsionType: "TURBOFAN",
      engineCount: 1,
      propellerCount: 1,
      components: [component("ENGINE", 1), component("PROPELLER", 1)],
    }),
  ]) {
    assert.throws(
      () => normalizeAircraftConfigurationInput(input),
      (error) => error.code === "INVALID_AIRCRAFT_TOPOLOGY" && error.statusCode === 422
    );
  }
});

test("exige posiciones 1..N, fecha explícita y preserva identidad/TIS desconocidos como NULL", () => {
  const normalized = normalizeAircraftConfigurationInput(validInput());
  assert.equal(normalized.components[0].manufacturer, null);
  assert.equal(normalized.components[0].model, null);
  assert.equal(normalized.components[0].serialNumber, null);
  assert.equal(normalized.components[0].openingTisHours, null);
  assert.throws(
    () => normalizeAircraftConfigurationInput(validInput({
      components: [
        component("ENGINE", 1),
        component("ENGINE", 3),
        component("PROPELLER", 1),
        component("PROPELLER", 2),
      ],
    })),
    /posiciones 1\.\.2/
  );
  assert.throws(
    () => normalizeAircraftConfigurationInput(validInput({
      components: [
        component("ENGINE", 1, { installedOn: "" }),
        component("ENGINE", 2),
        component("PROPELLER", 1),
        component("PROPELLER", 2),
      ],
    })),
    /installedOn/
  );
});

test("setup OWNER crea exactamente N componentes/installations y Audit dentro de SERIALIZABLE", async () => {
  const mock = createMockRepository();
  const result = await mock.setup({ userId: USER_ID, input: validInput() });

  assert.deepEqual(mock.getTransactionOptions(), { isolationLevel: "SERIALIZABLE" });
  assert.equal(mock.getCommitted(), true);
  assert.equal(
    mock.queries.filter((query) => query.text.includes("INSERT INTO app.components")).length,
    4
  );
  assert.equal(
    mock.queries.filter((query) => query.text.includes("INSERT INTO app.component_installations")).length,
    4
  );
  const accessSql = mock.queries[0].text;
  assert.match(accessSql, /membership\.role = 'OWNER'/);
  assert.match(accessSql, /FOR UPDATE OF aircraft/);
  const audit = mock.queries.find((query) => query.text.includes("INSERT INTO audit.audit_events"));
  assert.match(audit.text, /'USER'.*'MANUAL'/s);
  assert.match(audit.text, /'AIRCRAFT_CONFIGURATION_CREATED'/);
  const afterState = JSON.parse(audit.params[4]);
  assert.deepEqual(afterState.topology, {
    propulsionType: "PISTON",
    engineCount: 2,
    propellerCount: 2,
  });
  assert.deepEqual(
    afterState.installations.map(({ componentType, positionIndex }) => ({ componentType, positionIndex })),
    [
      { componentType: "ENGINE", positionIndex: 1 },
      { componentType: "ENGINE", positionIndex: 2 },
      { componentType: "PROPELLER", positionIndex: 1 },
      { componentType: "PROPELLER", positionIndex: 2 },
    ]
  );
  assert.equal(result.configurationConfigured, true);
  assert.equal(result.bootstrapMode, "CREATE_COMPONENTS");
  const allSql = mock.queries.map((query) => query.text).join("\n");
  assert.doesNotMatch(allSql, /UPDATE\s+app\.flight_record|INSERT INTO app\.flight_record/i);
  const firstComponentInsert = mock.queries.find((query) =>
    query.text.includes("INSERT INTO app.components")
  );
  assert.deepEqual(firstComponentInsert.params.slice(2), [null, null, null, null]);
  const firstInstallationInsert = mock.queries.find((query) =>
    query.text.includes("INSERT INTO app.component_installations")
  );
  assert.equal(firstInstallationInsert.params[5], null);
  assert.deepEqual(JSON.parse(audit.params[5]), { bootstrap_mode: "CREATE_COMPONENTS" });
});

test("adopta topologia existente exacta 1/1 sin insertar ni alterar componentes", async () => {
  const existing = [
    existingInstallation("ENGINE", 1, {
      component_installation_id: uuid(301),
      component_id: uuid(401),
    }),
    existingInstallation("PROPELLER", 1, {
      component_installation_id: uuid(302),
      component_id: uuid(402),
      installed_on: "2019-04-05",
      opening_tis_hours: null,
    }),
  ];
  const mock = createMockRepository({ existingInstallations: existing });
  const result = await mock.setup({
    userId: USER_ID,
    input: validInput({
      propulsionType: "TURBOPROP",
      engineCount: 1,
      propellerCount: 1,
      components: [],
    }),
  });

  assert.equal(result.bootstrapMode, "ADOPT_EXISTING");
  assert.equal(result.configuration.propulsionType, "TURBOPROP");
  assert.deepEqual(
    result.componentInstallations.map((installation) => ({
      componentInstallationId: installation.componentInstallationId,
      componentId: installation.componentId,
    })),
    [
      { componentInstallationId: uuid(301), componentId: uuid(401) },
      { componentInstallationId: uuid(302), componentId: uuid(402) },
    ]
  );
  const mutationSql = mock.queries
    .filter((query) => /\b(?:INSERT|UPDATE|DELETE)\b/i.test(query.text))
    .map((query) => query.text)
    .join("\n");
  assert.doesNotMatch(mutationSql, /INSERT INTO app\.components|INSERT INTO app\.component_installations/);
  assert.doesNotMatch(mutationSql, /UPDATE\s+app\.(?:components|component_installations)/i);
  assert.equal(result.componentInstallations[0].manufacturer, "Lycoming");
  assert.equal(result.componentInstallations[0].installedOn, "2020-01-02");
  assert.equal(result.componentInstallations[0].openingTisHours, 123.4);
  assert.equal(result.componentInstallations[1].installedOn, "2019-04-05");
  assert.equal(result.componentInstallations[1].openingTisHours, null);
  const audit = mock.queries.find((query) => query.text.includes("INSERT INTO audit.audit_events"));
  assert.deepEqual(JSON.parse(audit.params[5]), { bootstrap_mode: "ADOPT_EXISTING" });
  assert.deepEqual(
    JSON.parse(audit.params[4]).installations.map((installation) => installation.componentId),
    [uuid(401), uuid(402)]
  );
});

test("adopta topologia existente exacta multi-engine/multi-prop", async () => {
  const existing = [
    existingInstallation("ENGINE", 1),
    existingInstallation("ENGINE", 2, {
      component_installation_id: uuid(102),
      component_id: uuid(202),
    }),
    existingInstallation("PROPELLER", 1, {
      component_installation_id: uuid(103),
      component_id: uuid(203),
    }),
    existingInstallation("PROPELLER", 2, {
      component_installation_id: uuid(104),
      component_id: uuid(204),
    }),
  ];
  const mock = createMockRepository({ existingInstallations: existing });
  const result = await mock.setup({
    userId: USER_ID,
    input: validInput({ components: [] }),
  });
  assert.equal(result.bootstrapMode, "ADOPT_EXISTING");
  assert.equal(result.componentInstallations.length, 4);
  assert.equal(
    mock.queries.filter((query) => query.text.includes("INSERT INTO app.components")).length,
    0
  );
});

test("rechaza adopcion por counts, posiciones faltantes o posiciones extra sin writes", async () => {
  const cases = [
    [
      existingInstallation("ENGINE", 1),
      existingInstallation("PROPELLER", 1),
    ],
    [
      existingInstallation("ENGINE", 1),
      existingInstallation("ENGINE", 3),
      existingInstallation("PROPELLER", 1),
      existingInstallation("PROPELLER", 2),
    ],
    [
      existingInstallation("ENGINE", 1),
      existingInstallation("ENGINE", 2),
      existingInstallation("ENGINE", 3),
      existingInstallation("PROPELLER", 1),
      existingInstallation("PROPELLER", 2),
    ],
  ];
  for (const existingInstallations of cases) {
    const mock = createMockRepository({ existingInstallations });
    await assert.rejects(
      mock.setup({ userId: USER_ID, input: validInput({ components: [] }) }),
      (error) => error.code === "AIRCRAFT_COMPONENT_TOPOLOGY_MISMATCH"
        && error.statusCode === 409
    );
    assert.equal(mock.getCommitted(), false);
    assert.equal(mock.queries.some((query) => /\bINSERT\b/i.test(query.text)), false);
  }
});

test("installations removidas no cuentan y componente abierto inactivo bloquea adopcion", async () => {
  const removedOnly = createMockRepository({ existingInstallations: [] });
  const created = await removedOnly.setup({ userId: USER_ID, input: validInput() });
  assert.equal(created.bootstrapMode, "CREATE_COMPONENTS");
  const source = await fs.readFile(
    new URL("../api/_postgresAircraftConfigurationRepository.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /installation\.removed_on IS NULL/);

  const inactive = createMockRepository({
    existingInstallations: [
      existingInstallation("ENGINE", 1, { component_status: "INACTIVE" }),
      existingInstallation("PROPELLER", 1),
    ],
  });
  await assert.rejects(
    inactive.setup({
      userId: USER_ID,
      input: validInput({ engineCount: 1, propellerCount: 1, components: [] }),
    }),
    (error) => error.code === "AIRCRAFT_COMPONENT_TOPOLOGY_MISMATCH"
      && error.statusCode === 409
  );
  assert.equal(inactive.queries.some((query) => /\bINSERT\b/i.test(query.text)), false);
});

test("rechaza no-OWNER y setup duplicado antes de cualquier INSERT", async () => {
  for (const [mock, code, statusCode] of [
    [createMockRepository({ ownerAllowed: false }), "AIRCRAFT_CONFIGURATION_ACCESS_DENIED", 403],
    [createMockRepository({ existingConfiguration: true }), "AIRCRAFT_CONFIGURATION_ALREADY_EXISTS", 409],
  ]) {
    await assert.rejects(
      mock.setup({ userId: USER_ID, input: validInput() }),
      (error) => error.code === code && error.statusCode === statusCode
    );
    assert.equal(mock.queries.some((query) => /\bINSERT\b/i.test(query.text)), false);
  }
});

test("un fallo intermedio no confirma configuración, componentes ni Audit", async () => {
  const mock = createMockRepository({ failOnComponentInsert: true });
  await assert.rejects(
    mock.setup({ userId: USER_ID, input: validInput() }),
    /synthetic intermediate failure/
  );
  assert.equal(mock.getCommitted(), false);
  assert.equal(
    mock.queries.some((query) => query.text.includes("INSERT INTO audit.audit_events")),
    false
  );
});

test("flag de configuración falla cerrado antes de abrir Postgres", async () => {
  const previous = {
    sessionSecret: process.env.SESSION_SECRET,
    source: process.env.AIRCRAFT_DATA_SOURCE,
    flag: process.env.POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED,
  };
  try {
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.AIRCRAFT_DATA_SOURCE = "postgres";
    delete process.env.POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED;
    const req = {
      method: "PATCH",
      headers: { cookie: createSessionCookie({ userId: USER_ID }).split(";")[0] },
      body: { action: "setup-configuration", ...validInput() },
    };
    const res = createResponse();
    await aircraftHandler(req, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, "POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_NOT_ENABLED");
  } finally {
    if (previous.sessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous.sessionSecret;
    if (previous.source === undefined) delete process.env.AIRCRAFT_DATA_SOURCE;
    else process.env.AIRCRAFT_DATA_SOURCE = previous.source;
    if (previous.flag === undefined) delete process.env.POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED;
    else process.env.POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED = previous.flag;
  }
});

test("capability de configuración sólo habilita true exacto sobre Postgres", () => {
  const previous = process.env.POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED;
  try {
    delete process.env.POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED;
    assert.equal(resolvePostgresAircraftConfigurationWriteCapability("POSTGRES").enabled, false);
    process.env.POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED = "true";
    assert.equal(resolvePostgresAircraftConfigurationWriteCapability("POSTGRES").enabled, true);
    assert.equal(resolvePostgresAircraftConfigurationWriteCapability("SHEETS").enabled, false);
    process.env.POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED = "yes";
    assert.throws(
      () => resolvePostgresAircraftConfigurationWriteCapability("POSTGRES"),
      /debe ser true, false o estar ausente/
    );
  } finally {
    if (previous === undefined) delete process.env.POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED;
    else process.env.POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED = previous;
  }
});

test("GET normaliza configuración ausente o configurada e instalaciones activas", () => {
  assert.deepEqual(mapPostgresAircraftRow({
    aircraft_id: AIRCRAFT_ID,
    configurationConfigured: false,
    configuration: undefined,
    componentInstallations: undefined,
  }), {
    aircraft_id: AIRCRAFT_ID,
    configurationConfigured: false,
    configuration: null,
    componentInstallations: [],
  });
  const configured = mapPostgresAircraftRow({
    aircraft_id: AIRCRAFT_ID,
    configurationConfigured: true,
    configuration: { propulsionType: "TURBOJET", engineCount: 2, propellerCount: 0 },
    componentInstallations: [{ componentType: "ENGINE", positionIndex: 1 }],
  });
  assert.equal(configured.configuration.engineCount, 2);
  assert.equal(configured.componentInstallations.length, 1);
});

test("lectura Postgres limita el resumen a installations activas", async () => {
  const source = await fs.readFile(
    new URL("../api/_postgresAircraftRepository.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /installation\.removed_on IS NULL/);
  assert.match(source, /component\.status = 'ACTIVE'/);
  for (const field of [
    "componentInstallationId",
    "componentId",
    "componentType",
    "positionIndex",
    "manufacturer",
    "model",
    "serialNumber",
    "installedOn",
    "openingTisHours",
  ]) {
    assert.match(source, new RegExp(`'${field}'`));
  }
});

test("UI genera componentes dinámicos, fecha explícita y unknown como NULL", () => {
  const values = {
    propulsionType: "TURBOJET",
    engineCount: "2",
    propellerCount: "0",
    installedOn: "2026-09-29",
    components: [
      { componentType: "ENGINE", positionIndex: 1, manufacturer: "GE", openingTisHours: "" },
      { componentType: "ENGINE", positionIndex: 2, serialNumber: "SN-2", openingTisHours: "5.5" },
    ],
  };
  assert.equal(validateAircraftConfiguration(values).valid, true);
  const payload = buildAircraftConfigurationPayload(AIRCRAFT_ID, values);
  assert.deepEqual(Object.keys(payload), [
    "action",
    "aircraftId",
    "propulsionType",
    "engineCount",
    "propellerCount",
    "components",
  ]);
  assert.equal(payload.components.length, 2);
  assert.equal(payload.components[0].openingTisHours, null);
  assert.equal(payload.components[0].installedOn, "2026-09-29");
  assert.equal(payload.components[1].openingTisHours, 5.5);
});

test("UI de adopcion envia solo topologia y no solicita identidad fisica/TIS", async () => {
  const values = {
    propulsionType: "PISTON",
    engineCount: "1",
    propellerCount: "1",
    installedOn: "",
    components: [],
    adoptExisting: true,
  };
  assert.equal(validateAircraftConfiguration(values).valid, true);
  assert.deepEqual(buildAircraftConfigurationPayload(AIRCRAFT_ID, values), {
    action: "setup-configuration",
    aircraftId: AIRCRAFT_ID,
    propulsionType: "PISTON",
    engineCount: 1,
    propellerCount: 1,
    components: [],
  });
  const source = await fs.readFile(
    new URL("../src/components/AircraftConfigurationOnboarding.jsx", import.meta.url),
    "utf8"
  );
  assert.match(source, /Componentes existentes que se vincularán/);
  assert.match(source, /!adoptingExisting/);
});

test("UI usa PATCH consolidado con sesión y conserva compatibilidad Sheets legacy", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      if (options.method === "PATCH") {
        return {
          ok: true,
          status: 201,
          json: async () => ({ ok: true, configurationConfigured: true }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          aircrafts: [{ aircraft_id: "A001", matricula: "LV-MHZ", rol: "OWNER" }],
        }),
      };
    };
    const values = {
      propulsionType: "OTHER",
      engineCount: 0,
      propellerCount: 0,
      installedOn: "2026-09-29",
      components: [],
    };
    await configureAircraftTopology(AIRCRAFT_ID, values);
    const legacyAircrafts = await fetchAircrafts();
    assert.equal(legacyAircrafts[0].configurationConfigured, undefined);
  } finally {
    globalThis.fetch = previousFetch;
  }
  assert.equal(requests[0].url, "/api/aircraft");
  assert.equal(requests[0].options.method, "PATCH");
  assert.equal(requests[0].options.credentials, "include");
});

test("la extensión consolidada conserva el límite de 12 funciones Vercel", async () => {
  const apiDirectory = new URL("../api/", import.meta.url);
  const entries = await fs.readdir(apiDirectory, { withFileTypes: true });
  const functions = entries.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".js") && !entry.name.startsWith("_")
  );
  assert.equal(functions.length, 12);
  assert.equal(functions.some((entry) => /configuration/i.test(entry.name)), false);
});
