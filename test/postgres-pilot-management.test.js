import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { resolveUserManagementDataSource } from "../api/_managementHttp.js";
import {
  createPostgresPilotManagementRepository,
} from "../api/_postgresPilotManagementRepository.js";
import { resolveAircraftPilotForFlight } from "../api/_postgresFlightRepository.js";
import { revokeAircraftPilot as revokeAircraftPilotFromUi } from "../src/services/usersService.js";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const LINKED_USER_ID = "22222222-2222-4222-8222-222222222222";
const AIRCRAFT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_AIRCRAFT_ID = "44444444-4444-4444-8444-444444444444";
const EXISTING_PERSON_ID = "55555555-5555-4555-8555-555555555555";

function uuid(sequence) {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, "0")}`;
}

function cloneState(state) {
  return structuredClone(state);
}

function createMockRepository(overrides = {}) {
  const state = {
    users: [
      { user_id: OWNER_ID, status: "ACTIVE" },
      { user_id: LINKED_USER_ID, status: "ACTIVE" },
    ],
    aircraft: [
      { aircraft_id: AIRCRAFT_ID, status: "ACTIVE", registration: "LV-MHZ" },
      { aircraft_id: OTHER_AIRCRAFT_ID, status: "ACTIVE", registration: "LV-OTH" },
    ],
    memberships: [
      {
        membership_id: uuid(90),
        aircraft_id: AIRCRAFT_ID,
        user_id: OWNER_ID,
        role: "OWNER",
        status: "ACTIVE",
      },
    ],
    persons: [
      {
        person_id: EXISTING_PERSON_ID,
        full_name: "Pilot Existing",
        email: "pilot@example.com",
        phone: "123",
        license_number: "PPA-1",
        status: "ACTIVE",
      },
    ],
    links: [{ user_id: LINKED_USER_ID, person_id: EXISTING_PERSON_ID }],
    identifiers: [
      {
        person_id: EXISTING_PERSON_ID,
        issuer_country_code: "AR",
        identifier_type: "DNI",
        identifier_value: "12345678",
        normalized_value: "12345678",
      },
    ],
    associations: [],
    audits: [],
    ...overrides,
  };
  const queries = [];
  let sequence = 1;
  let committed = false;
  let transactionOptions;

  async function query(text, params = []) {
    queries.push({ text, params });

    if (text.includes("FROM app.users actor")) {
      const [actorUserId, aircraftId] = params;
      const actor = state.users.find((user) => user.user_id === actorUserId && user.status === "ACTIVE");
      const aircraft = state.aircraft.find((item) => item.aircraft_id === aircraftId && item.status === "ACTIVE");
      const membership = state.memberships.find((item) =>
        item.user_id === actorUserId
        && item.aircraft_id === aircraftId
        && item.status === "ACTIVE"
      );
      return {
        rows: actor && aircraft && membership
          ? [{
              user_id: actorUserId,
              membership_id: membership.membership_id,
              role: membership.role,
              aircraft_id: aircraftId,
              registration: aircraft.registration,
            }]
          : [],
      };
    }

    if (text.includes("SELECT association.status, person.status AS person_status")) {
      const [aircraftId, personId] = params;
      const association = state.associations.find((item) =>
        item.aircraft_id === aircraftId && item.person_id === personId
      );
      const person = state.persons.find((item) => item.person_id === personId);
      return { rows: association && person ? [{ status: association.status, person_status: person.status }] : [] };
    }

    if (text.includes("SELECT status") && text.includes("FROM app.aircraft_persons")) {
      const [aircraftId, personId] = params;
      const association = state.associations.find((item) =>
        item.aircraft_id === aircraftId && item.person_id === personId
      );
      return { rows: association ? [{ status: association.status }] : [] };
    }

    if (text.includes("FROM app.aircraft_persons association")) {
      const [aircraftId] = params;
      return {
        rows: state.associations
          .filter((association) => association.aircraft_id === aircraftId)
          .map((association) => {
            const person = state.persons.find((item) => item.person_id === association.person_id);
            const link = state.links.find((item) => item.person_id === association.person_id);
            const user = state.users.find((item) => item.user_id === link?.user_id);
            const dni = state.identifiers.find((item) =>
              item.person_id === association.person_id && item.identifier_type === "DNI"
            );
            return {
              person_id: person.person_id,
              user_id: link?.user_id || null,
              full_name: person.full_name,
              email: person.email,
              phone: person.phone,
              license_number: person.license_number,
              person_status: person.status,
              user_status: user?.status || null,
              association_status: association.status,
              dni: dni?.identifier_value || null,
            };
          }),
      };
    }

    if (text.includes("FROM app.persons") && text.includes("person_id = $1::uuid")) {
      const [personId] = params;
      return {
        rows: state.persons.filter((person) => person.person_id === personId),
      };
    }

    if (text.includes("FROM app.person_identifiers")) {
      const [, normalizedValue] = params;
      return {
        rows: state.identifiers
          .filter((identifier) => identifier.normalized_value === normalizedValue)
          .map((identifier) => ({ person_id: identifier.person_id })),
      };
    }

    if (text.includes("INSERT INTO app.persons")) {
      state.persons.push({
        person_id: params[0],
        full_name: params[1],
        email: params[2],
        phone: params[3],
        license_number: params[4],
        status: "ACTIVE",
      });
      return { rows: [] };
    }

    if (text.includes("INSERT INTO app.person_identifiers")) {
      state.identifiers.push({
        person_id: params[1],
        issuer_country_code: params[2],
        identifier_type: "DNI",
        identifier_value: params[3],
        normalized_value: params[4],
      });
      return { rows: [] };
    }

    if (text.includes("INSERT INTO app.aircraft_persons")) {
      state.associations.push({ aircraft_id: params[0], person_id: params[1], status: "ACTIVE" });
      return { rows: [] };
    }

    if (text.includes("UPDATE app.aircraft_persons")) {
      const association = state.associations.find((item) =>
        item.aircraft_id === params[0] && item.person_id === params[1]
      );
      association.status = text.includes("'ARCHIVED'") ? "ARCHIVED" : "ACTIVE";
      return { rows: [] };
    }

    if (text.includes("INSERT INTO audit.audit_events")) {
      state.audits.push({
        actor_user_id: params[2],
        aircraft_id: params[3],
        person_id: params[4],
        action_code: params[6],
        before_state: params[7],
        after_state: params[8],
      });
      return { rows: [] };
    }

    if (text.includes("FROM app.aircraft_persons ap") && text.includes("p.person_id=$2::uuid")) {
      const [aircraftId, personId] = params;
      return {
        rows: state.associations
          .filter((association) => association.aircraft_id === aircraftId && association.status === "ACTIVE")
          .map((association) => state.persons.find((person) =>
            person.person_id === association.person_id
            && person.status === "ACTIVE"
            && person.person_id === personId
          ))
          .filter(Boolean)
          .map((person) => ({ person_id: person.person_id, full_name: person.full_name })),
      };
    }

    return { rows: [] };
  }

  const repository = createPostgresPilotManagementRepository({
    query,
    transaction: async (work, options) => {
      transactionOptions = options;
      const snapshot = cloneState(state);
      try {
        const result = await work({ query });
        committed = true;
        return result;
      } catch (error) {
        Object.keys(state).forEach((key) => { state[key] = snapshot[key]; });
        committed = false;
        throw error;
      }
    },
    randomUUID: () => uuid(sequence++),
  });

  return {
    repository,
    query,
    queries,
    state,
    getCommitted: () => committed,
    getTransactionOptions: () => transactionOptions,
  };
}

function pilotInput(overrides = {}) {
  return {
    aircraft_id: AIRCRAFT_ID,
    email: "new.pilot@example.com",
    nombre: "New Pilot",
    telefono: "555",
    dni: "87654321",
    licencia: "PPA-2",
    ...overrides,
  };
}

test("routing Postgres exige identidad y aeronaves Postgres y falla cerrado ante mezcla", () => {
  const previous = {
    identity: process.env.GOOGLE_USER_RESOLUTION_SOURCE,
    aircraft: process.env.AIRCRAFT_DATA_SOURCE,
  };
  try {
    delete process.env.GOOGLE_USER_RESOLUTION_SOURCE;
    delete process.env.AIRCRAFT_DATA_SOURCE;
    assert.equal(resolveUserManagementDataSource(), "SHEETS");

    process.env.GOOGLE_USER_RESOLUTION_SOURCE = "postgres";
    process.env.AIRCRAFT_DATA_SOURCE = "postgres";
    assert.equal(resolveUserManagementDataSource(), "POSTGRES");

    process.env.AIRCRAFT_DATA_SOURCE = "sheets-api";
    assert.throws(
      () => resolveUserManagementDataSource(),
      (error) => error.code === "USER_MANAGEMENT_SOURCE_MISMATCH"
    );
  } finally {
    if (previous.identity === undefined) delete process.env.GOOGLE_USER_RESOLUTION_SOURCE;
    else process.env.GOOGLE_USER_RESOLUTION_SOURCE = previous.identity;
    if (previous.aircraft === undefined) delete process.env.AIRCRAFT_DATA_SOURCE;
    else process.env.AIRCRAFT_DATA_SOURCE = previous.aircraft;
  }
});

test("lectura Postgres lista asociaciones canonical y mantiene login opcional", async () => {
  const mock = createMockRepository({
    associations: [{ aircraft_id: AIRCRAFT_ID, person_id: EXISTING_PERSON_ID, status: "ACTIVE" }],
  });
  const result = await mock.repository.listAircraftPilotsForMember(OWNER_ID, AIRCRAFT_ID);

  assert.equal(result.aircraft.matricula, "LV-MHZ");
  assert.equal(result.canManagePilots, true);
  assert.deepEqual(result.pilots[0], {
    person_id: EXISTING_PERSON_ID,
    user_id: LINKED_USER_ID,
    nombre: "Pilot Existing",
    email: "pilot@example.com",
    telefono: "123",
    dni: "12345678",
    licencia: "PPA-1",
    estado: "ACTIVO",
    user_estado: "ACTIVO",
    permiso_estado: "ACTIVO",
  });
});

test("members activos pueden leer, pero solo OWNER puede gestionar pilotos", async () => {
  const mock = createMockRepository();
  mock.state.memberships.push({
    membership_id: uuid(91), aircraft_id: AIRCRAFT_ID, user_id: LINKED_USER_ID,
    role: "PILOT", status: "ACTIVE",
  });
  const readable = await mock.repository.listAircraftPilotsForMember(LINKED_USER_ID, AIRCRAFT_ID);
  assert.deepEqual(readable.pilots, []);
  assert.equal(readable.canManagePilots, false);
  mock.state.memberships.find((membership) => membership.user_id === LINKED_USER_ID).role = "VIEWER";
  const viewerReadable = await mock.repository.listAircraftPilotsForMember(LINKED_USER_ID, AIRCRAFT_ID);
  assert.equal(viewerReadable.canManagePilots, false);
  await assert.rejects(
    mock.repository.authorizeAircraftPilot(LINKED_USER_ID, pilotInput()),
    (error) => error.code === "AIRCRAFT_ACCESS_DENIED" && error.statusCode === 403
  );
  await assert.rejects(
    mock.repository.authorizeAircraftPilot(OWNER_ID, pilotInput({ aircraft_id: OTHER_AIRCRAFT_ID })),
    (error) => error.code === "AIRCRAFT_ACCESS_DENIED" && error.statusCode === 403
  );
  assert.equal(mock.state.associations.length, 0);
  assert.equal(mock.state.audits.length, 0);
});

test("autorizar con solo nombre crea persona y aircraft_person sin identidad de login", async () => {
  const mock = createMockRepository();
  const result = await mock.repository.authorizeAircraftPilot(OWNER_ID, pilotInput({
    email: "",
    telefono: "",
    dni: "",
    licencia: "",
  }));

  assert.equal(result.changed, true);
  assert.equal(result.user_id, null);
  assert.equal(mock.getCommitted(), true);
  assert.equal(mock.getTransactionOptions().isolationLevel, "SERIALIZABLE");
  assert.equal(mock.state.persons.length, 2);
  assert.equal(mock.state.persons[1].full_name, "New Pilot");
  assert.equal(mock.state.persons[1].email, null);
  assert.equal(mock.state.persons[1].license_number, null);
  assert.equal(mock.state.identifiers.length, 1);
  assert.equal(mock.state.associations.length, 1);
  assert.equal(mock.state.memberships.length, 1);
  assert.equal(mock.state.users.length, 2);
  assert.equal(mock.state.audits[0].action_code, "AIRCRAFT_PERSON_AUTHORIZED");
  assert.equal(JSON.parse(mock.state.audits[0].after_state).created_person, true);
  const writeSql = mock.queries.map(({ text }) => text).join("\n");
  assert.doesNotMatch(writeSql, /INSERT INTO app\.users/i);
  assert.doesNotMatch(writeSql, /INSERT INTO app\.aircraft_memberships/i);
  assert.doesNotMatch(writeSql, /aircraft_ownership_interests/i);
  assert.doesNotMatch(writeSql, /is_admin|ADMIN/);
});

test("dos persons pueden compartir email sin auto-merge", async () => {
  const mock = createMockRepository();
  const result = await mock.repository.authorizeAircraftPilot(OWNER_ID, pilotInput({
    email: "pilot@example.com",
    nombre: "Different Pilot",
    dni: "87654321",
  }));

  assert.notEqual(result.person_id, EXISTING_PERSON_ID);
  assert.equal(mock.state.persons.filter((person) => person.email === "pilot@example.com").length, 2);
  assert.equal(mock.state.associations[0].person_id, result.person_id);
  const sql = mock.queries.map(({ text }) => text).join("\n");
  assert.doesNotMatch(sql, /WHERE lower\(email\)/i);
});

test("crear otra persona homonima es explicito y no auto-mergea", async () => {
  const mock = createMockRepository();
  const first = await mock.repository.authorizeAircraftPilot(OWNER_ID, pilotInput({
    nombre: "Mismo Nombre",
    email: "",
    dni: "",
    licencia: "LIC-1",
  }));
  const second = await mock.repository.authorizeAircraftPilot(OWNER_ID, pilotInput({
    nombre: "Mismo Nombre",
    email: "",
    dni: "",
    licencia: "LIC-2",
  }));

  assert.notEqual(first.person_id, second.person_id);
  assert.equal(mock.state.persons.filter((person) => person.full_name === "Mismo Nombre").length, 2);
});

test("adapter UI revoca por person_id canonical y conserva user_id para Sheets", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  try {
    await revokeAircraftPilotFromUi({ person_id: EXISTING_PERSON_ID }, AIRCRAFT_ID);
    await revokeAircraftPilotFromUi({ user_id: LINKED_USER_ID }, AIRCRAFT_ID);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(bodies, [
    { aircraft_id: AIRCRAFT_ID, person_id: EXISTING_PERSON_ID, action: "revoke" },
    { aircraft_id: AIRCRAFT_ID, user_id: LINKED_USER_ID, action: "revoke" },
  ]);
});

test("revocar archiva la asociacion y registra Audit en la misma transaccion", async () => {
  const mock = createMockRepository({
    associations: [{ aircraft_id: AIRCRAFT_ID, person_id: EXISTING_PERSON_ID, status: "ACTIVE" }],
  });
  const result = await mock.repository.revokeAircraftPilot(OWNER_ID, {
    aircraft_id: AIRCRAFT_ID,
    person_id: EXISTING_PERSON_ID,
  });

  assert.equal(result.changed, true);
  assert.equal(mock.state.associations[0].status, "ARCHIVED");
  assert.equal(mock.state.audits[0].action_code, "AIRCRAFT_PERSON_REVOKED");
  assert.equal(mock.state.persons[0].status, "ACTIVE");
});

test("reactivar reutiliza la misma asociacion y preserva la persona", async () => {
  const mock = createMockRepository({
    associations: [{ aircraft_id: AIRCRAFT_ID, person_id: EXISTING_PERSON_ID, status: "ARCHIVED" }],
  });
  const originalPerson = cloneState(mock.state.persons[0]);
  const result = await mock.repository.authorizeAircraftPilot(
    OWNER_ID,
    pilotInput({
      person_id: EXISTING_PERSON_ID,
      email: "pilot@example.com",
      nombre: "Ignored New Name",
      telefono: "999",
      dni: "99999999",
      licencia: "OTHER",
    })
  );

  assert.equal(result.changed, true);
  assert.equal(mock.state.associations.length, 1);
  assert.equal(mock.state.associations[0].status, "ACTIVE");
  assert.deepEqual(mock.state.persons[0], originalPerson);
  assert.equal(mock.state.audits[0].action_code, "AIRCRAFT_PERSON_REACTIVATED");
});

test("piloto autorizado queda resoluble por el Flight Repository actual", async () => {
  const mock = createMockRepository();
  const result = await mock.repository.authorizeAircraftPilot(OWNER_ID, pilotInput({
    email: "",
    dni: "",
    licencia: "",
  }));
  const resolvedPersonId = await resolveAircraftPilotForFlight(
    { query: mock.query },
    AIRCRAFT_ID,
    result.person_id
  );

  assert.equal(resolvedPersonId, result.person_id);
});

test("ruta Postgres global permanece separada y no introduce ADMIN legacy", async () => {
  const [usersSource, permissionsSource, repositorySource] = await Promise.all([
    fs.readFile(new URL("../api/users.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../api/permissions.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../api/_postgresPilotManagementRepository.js", import.meta.url), "utf8"),
  ]);

  assert.match(usersSource, /source === DATA_SOURCE\.POSTGRES/);
  assert.match(permissionsSource, /source === DATA_SOURCE\.POSTGRES/);
  assert.doesNotMatch(repositorySource, /aircraft_ownership_interests/);
  assert.doesNotMatch(repositorySource, /INSERT INTO app\.users/);
  assert.doesNotMatch(repositorySource, /INSERT INTO app\.aircraft_memberships/);
  assert.doesNotMatch(repositorySource, /is_admin/);
  assert.doesNotMatch(repositorySource, /lower\(email\)/i);
});
