import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresFlightRepository,
  resolveComponentInstallationForFlightDate,
} from "../api/_postgresFlightRepository.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AIRCRAFT_ID = "22222222-2222-4222-8222-222222222222";
const FLIGHT_ID = "33333333-3333-4333-8333-333333333333";
const OLD_REVISION_ID = "44444444-4444-4444-8444-444444444444";
const OLD_INSTALLATION_ID = "55555555-5555-4555-8555-555555555555";
const NEW_INSTALLATION_ID = "66666666-6666-4666-8666-666666666666";
const PILOT_ID = "77777777-7777-4777-8777-777777777777";
const OWNER_ID = "88888888-8888-4888-8888-888888888888";
const REPLACEMENT_DATE = "2026-08-01";

const INSTALLATIONS = [
  {
    component_installation_id: OLD_INSTALLATION_ID,
    component_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    component_type: "ENGINE",
    position_index: 1,
    installed_on: null,
    removed_on: REPLACEMENT_DATE,
  },
  {
    component_installation_id: NEW_INSTALLATION_ID,
    component_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    component_type: "ENGINE",
    position_index: 1,
    installed_on: REPLACEMENT_DATE,
    removed_on: null,
  },
];

function uuid(sequence) {
  return `99999999-9999-4999-8999-${String(sequence).padStart(12, "0")}`;
}

function applicableInstallations(installations, componentType, positionIndex, flightDate) {
  return installations.filter((installation) =>
    installation.component_type === componentType
    && installation.position_index === Number(positionIndex)
    && (!installation.installed_on || installation.installed_on <= flightDate)
    && (!installation.removed_on || flightDate < installation.removed_on)
  );
}

function componentResolverClient(installations = INSTALLATIONS) {
  const queries = [];
  return {
    queries,
    async query(text, params) {
      queries.push({ text, params });
      const [, componentType, positionIndex, flightDate] = params;
      return {
        rows: applicableInstallations(installations, componentType, positionIndex, flightDate),
      };
    },
  };
}

function flightPayload(overrides = {}) {
  return {
    modo: "create",
    dia: "31",
    mes: "07",
    anio: "2026",
    desde: "AGR",
    hasta: "RAE",
    piloto: "Pilot One",
    pilot_person_id: PILOT_ID,
    propietario: "Owner One",
    tiempoVueloJPI: 1.1,
    tiempoEnServicioGarmin: 1,
    aceiteAgregado: 1,
    combustibleTanqueIzquierdo: "",
    combustibleTanqueDerecho: "",
    observaciones: "",
    ...overrides,
  };
}

function createMockFlightRepository({
  engineCount = 1,
  installations = INSTALLATIONS,
  currentRevision = null,
  initialConsumables = [],
} = {}) {
  const queries = [];
  const consumables = initialConsumables.map((row) => ({ ...row }));
  let sequence = 1;
  let committed = false;
  let transactionOptions;
  const client = {
    async query(text, params = []) {
      queries.push({ text, params });
      if (text.includes("FROM app.aircraft_memberships m")) {
        return { rows: [{ membership_id: uuid(90), role: "OWNER", status: "ACTIVE" }] };
      }
      if (text.includes("FROM app.aircraft_persons ap")) {
        return { rows: [{ person_id: PILOT_ID }] };
      }
      if (text.includes("count(*)::int AS owner_count")) {
        return { rows: [{ owner_count: 1, total_share: "100" }] };
      }
      if (text.includes("FROM app.aircraft_ownership_interests oi") && text.includes("oi.party_id")) {
        return { rows: [{ party_id: OWNER_ID }] };
      }
      if (text.includes("FROM app.aircraft_configuration configuration")) {
        return { rows: [{ engine_count: engineCount, default_oil_unit: "US_QUART" }] };
      }
      if (text.includes("FROM app.component_installations installation")) {
        const [, componentType, positionIndex, flightDate] = params;
        return {
          rows: applicableInstallations(installations, componentType, positionIndex, flightDate),
        };
      }
      if (text.includes("INSERT INTO app.flight_component_consumables")) {
        consumables.push({
          flight_revision_id: params[0],
          component_installation_id: params[1],
          entered_value: params[2],
          entered_unit: params[3],
          canonical_liters: params[4],
        });
        return { rows: [] };
      }
      if (text.includes("FROM app.flight_records f JOIN app.flight_record_revisions r")) {
        return { rows: currentRevision ? [{ ...currentRevision }] : [] };
      }
      return { rows: [] };
    },
  };
  const saveFlight = createPostgresFlightRepository({
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
    saveFlight,
    queries,
    consumables,
    getCommitted: () => committed,
    getTransactionOptions: () => transactionOptions,
  };
}

for (const [label, flightDate, expectedInstallationId] of [
  ["antes del boundary usa el componente anterior", "2026-07-31", OLD_INSTALLATION_ID],
  ["en el boundary usa el componente nuevo", REPLACEMENT_DATE, NEW_INSTALLATION_ID],
  ["despues del boundary usa el componente nuevo", "2026-08-02", NEW_INSTALLATION_ID],
]) {
  test(label, async () => {
    const client = componentResolverClient();
    const installation = await resolveComponentInstallationForFlightDate(client, {
      aircraftId: AIRCRAFT_ID,
      componentType: "ENGINE",
      positionIndex: 1,
      flightDate,
    });

    assert.equal(installation.component_installation_id, expectedInstallationId);
    assert.match(client.queries[0].text, /installed_on IS NULL OR installation\.installed_on <= \$4::date/);
    assert.match(client.queries[0].text, /removed_on IS NULL OR \$4::date < installation\.removed_on/);
    assert.doesNotMatch(client.queries[0].text, /component\.status\s*=\s*'ACTIVE'/);
    assert.doesNotMatch(client.queries[0].text, /LIMIT\s+1/i);
  });
}

test("cero instalaciones aplicables falla cerrado con 409", async () => {
  const client = componentResolverClient([]);
  await assert.rejects(
    resolveComponentInstallationForFlightDate(client, {
      aircraftId: AIRCRAFT_ID,
      componentType: "ENGINE",
      positionIndex: 1,
      flightDate: "2026-07-31",
    }),
    (error) => error.code === "FLIGHT_COMPONENT_INSTALLATION_NOT_RESOLVED"
      && error.statusCode === 409
  );
});

test("mas de una instalacion aplicable falla cerrado con 409", async () => {
  const overlap = [
    { ...INSTALLATIONS[0], removed_on: null },
    { ...INSTALLATIONS[1], installed_on: "2026-07-01" },
  ];
  const client = componentResolverClient(overlap);
  await assert.rejects(
    resolveComponentInstallationForFlightDate(client, {
      aircraftId: AIRCRAFT_ID,
      componentType: "ENGINE",
      positionIndex: 1,
      flightDate: "2026-07-31",
    }),
    (error) => error.code === "FLIGHT_COMPONENT_INSTALLATION_NOT_RESOLVED"
      && error.statusCode === 409
  );
});

test("aceite singular falla cerrado para una configuracion multimotor", async () => {
  const mock = createMockFlightRepository({ engineCount: 2 });
  await assert.rejects(
    mock.saveFlight({ userId: USER_ID, aircraftId: AIRCRAFT_ID, payload: flightPayload() }),
    (error) => error.code === "FLIGHT_ENGINE_POSITION_AMBIGUOUS" && error.statusCode === 409
  );
  assert.equal(mock.getCommitted(), false);
  assert.equal(mock.consumables.length, 0);
});

test("texto de piloto sin pilot_person_id canonico falla antes de persistir", async () => {
  const mock = createMockFlightRepository();
  await assert.rejects(
    mock.saveFlight({
      userId: USER_ID,
      aircraftId: AIRCRAFT_ID,
      payload: flightPayload({ pilot_person_id: "", piloto: "Typo Pilot" }),
    }),
    (error) => error.code === "FLIGHT_INVALID_PAYLOAD" && error.statusCode === 422
  );
  assert.equal(mock.getCommitted(), false);
  assert.equal(mock.queries.some(({ text }) => text.includes("INSERT INTO app.flight_records")), false);
});

test("aceite singular monomotor conserva el flujo y usa la instalacion vigente", async () => {
  const mock = createMockFlightRepository();
  const result = await mock.saveFlight({
    userId: USER_ID,
    aircraftId: AIRCRAFT_ID,
    payload: flightPayload(),
  });

  assert.equal(result.modo, "create");
  assert.equal(mock.getCommitted(), true);
  assert.equal(mock.getTransactionOptions().isolationLevel, "SERIALIZABLE");
  assert.equal(mock.consumables.length, 1);
  assert.equal(mock.consumables[0].component_installation_id, OLD_INSTALLATION_ID);
});

test("correction que cruza el boundary preserva children anteriores y vincula la nueva revision", async () => {
  const previousChild = {
    flight_revision_id: OLD_REVISION_ID,
    component_installation_id: OLD_INSTALLATION_ID,
    entered_value: 1,
    entered_unit: "US_QUART",
    canonical_liters: 0.946352946,
  };
  const mock = createMockFlightRepository({
    currentRevision: {
      status: "ACTIVE",
      current_revision_id: OLD_REVISION_ID,
      revision_number: 1,
      flight_date: "2026-07-31",
      departure_location: "AGR",
      arrival_location: "RAE",
      pilot_person_id: PILOT_ID,
      utilization_owner_party_id: OWNER_ID,
      capture_method: "DIRECT",
      flight_time_hours: "1.1",
      time_in_service_hours: "1.0",
      remarks: null,
    },
    initialConsumables: [previousChild],
  });
  const result = await mock.saveFlight({
    userId: USER_ID,
    aircraftId: AIRCRAFT_ID,
    payload: flightPayload({
      modo: "update",
      id: FLIGHT_ID,
      dia: "01",
      mes: "08",
      correctionReason: "Fecha corregida",
    }),
  });

  assert.equal(result.modo, "update");
  assert.equal(mock.consumables.length, 2);
  assert.deepEqual(mock.consumables[0], previousChild);
  assert.equal(mock.consumables[1].flight_revision_id, result.flight_revision_id);
  assert.equal(mock.consumables[1].component_installation_id, NEW_INSTALLATION_ID);
  assert.equal(
    mock.queries.some(({ text }) => /(?:UPDATE|DELETE).*flight_component_consumables/is.test(text)),
    false
  );
});
