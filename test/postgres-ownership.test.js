import assert from "node:assert/strict";
import test from "node:test";

import { createSessionCookie } from "../api/_auth.js";
import {
  createPostgresOwnershipRepository,
  normalizeOwnershipSetupInput,
} from "../api/_postgresOwnershipRepository.js";
import aircraftHandler from "../api/aircraft.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AIRCRAFT_ID = "22222222-2222-4222-8222-222222222222";
const PERSON_ID = "33333333-3333-4333-8333-333333333333";
const EXISTING_PARTY_ID = "44444444-4444-4444-8444-444444444444";

function uuid(sequence) {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, "0")}`;
}

function createMockRepository({
  accessAllowed = true,
  currentOwnership = false,
  creatorLinked = true,
  creatorParty = null,
  total = "100.00",
} = {}) {
  const queries = [];
  let transactionOptions;
  let transactionCalls = 0;
  let sequence = 1;
  const client = {
    async query(text, params = []) {
      queries.push({ text, params });

      if (text.includes("FROM app.users user_account")) {
        return { rows: accessAllowed ? [{ membership_id: uuid(90) }] : [] };
      }
      if (text.includes("sum(ownership_share)")) {
        return { rows: [{ ownership_total: total }] };
      }
      if (
        text.includes("FROM app.aircraft_ownership_interests") &&
        text.includes("FOR UPDATE")
      ) {
        return {
          rows: currentOwnership ? [{ ownership_interest_id: uuid(91) }] : [],
        };
      }
      if (text.includes("FROM app.user_person_links")) {
        return { rows: creatorLinked ? [{ person_id: PERSON_ID }] : [] };
      }
      if (text.includes("FROM app.parties")) {
        return { rows: creatorParty ? [creatorParty] : [] };
      }

      return { rows: [] };
    },
  };
  const setupOwnership = createPostgresOwnershipRepository({
    transaction: async (work, options) => {
      transactionCalls += 1;
      transactionOptions = options;
      return work(client);
    },
    randomUUID: () => uuid(sequence++),
  });

  return {
    setupOwnership,
    queries,
    getTransactionOptions: () => transactionOptions,
    getTransactionCalls: () => transactionCalls,
  };
}

function validInput(owners) {
  return { aircraftId: AIRCRAFT_ID, owners };
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

test("normaliza shares en centesimas y exige un total exacto de 100.00", () => {
  const normalized = normalizeOwnershipSetupInput(
    validInput([
      { kind: "PERSON", fullName: " Ana ", ownershipShare: "33.33" },
      {
        kind: "ORGANIZATION",
        organizationName: " Club ",
        countryCode: " ar ",
        ownershipShare: 66.67,
      },
    ])
  );

  assert.equal(normalized.owners[0].ownershipShare, "33.33");
  assert.equal(normalized.owners[1].ownershipShare, "66.67");
  assert.equal(normalized.owners[1].countryCode, "AR");
  assert.throws(
    () =>
      normalizeOwnershipSetupInput(
        validInput([{ kind: "CREATOR_PERSON", ownershipShare: "99.99" }])
      ),
    (error) => error.code === "INVALID_OWNERSHIP_TOTAL" && error.statusCode === 400
  );
});

test("permite CREATOR_PERSON una sola vez", () => {
  assert.throws(
    () =>
      normalizeOwnershipSetupInput(
        validInput([
          { kind: "CREATOR_PERSON", ownershipShare: 50 },
          { kind: "CREATOR_PERSON", ownershipShare: 50 },
        ])
      ),
    (error) => error.code === "INVALID_OWNERSHIP_INPUT" && error.statusCode === 400
  );
});

test("rechaza IDs y estado de negocio enviados por el cliente", () => {
  for (const field of ["party_id", "person_id", "user_id", "membership", "role", "status"]) {
    assert.throws(
      () =>
        normalizeOwnershipSetupInput(
          validInput([
            {
              kind: "PERSON",
              fullName: "Ana",
              ownershipShare: 100,
              [field]: "forbidden",
            },
          ])
        ),
      (error) =>
        error.code === "UNSUPPORTED_OWNERSHIP_FIELDS" && error.statusCode === 422
    );
  }
});

test("OWNER sin capability activa MANAGE_OWNERSHIP no alcanza", async () => {
  const mock = createMockRepository({ accessAllowed: false });
  await assert.rejects(
    mock.setupOwnership({
      userId: USER_ID,
      input: validInput([{ kind: "CREATOR_PERSON", ownershipShare: 100 }]),
    }),
    (error) => error.code === "OWNERSHIP_ACCESS_DENIED" && error.statusCode === 403
  );

  const accessSql = mock.queries.find((query) =>
    query.text.includes("FROM app.users user_account")
  ).text;
  assert.match(accessSql, /capability\.capability = 'MANAGE_OWNERSHIP'/);
  assert.match(accessSql, /capability\.revoked_at IS NULL/);
  assert.match(accessSql, /user_account\.status = 'ACTIVE'/);
  assert.match(accessSql, /aircraft\.status = 'ACTIVE'/);
  assert.match(accessSql, /membership\.status = 'ACTIVE'/);
});

test("ownership existente devuelve 409 antes de realizar escrituras", async () => {
  const mock = createMockRepository({ currentOwnership: true });
  await assert.rejects(
    mock.setupOwnership({
      userId: USER_ID,
      input: validInput([{ kind: "CREATOR_PERSON", ownershipShare: 100 }]),
    }),
    (error) => error.code === "OWNERSHIP_ALREADY_CONFIGURED" && error.statusCode === 409
  );

  assert.equal(
    mock.queries.some((query) => /\bINSERT\b/i.test(query.text)),
    false
  );
});

test("CREATOR_PERSON se resuelve solo por link canonico verificado", async () => {
  const mock = createMockRepository({ creatorLinked: false });
  await assert.rejects(
    mock.setupOwnership({
      userId: USER_ID,
      input: validInput([{ kind: "CREATOR_PERSON", ownershipShare: 100 }]),
    }),
    (error) => error.code === "CREATOR_PERSON_NOT_RESOLVED" && error.statusCode === 409
  );

  const linkSql = mock.queries.find((query) =>
    query.text.includes("FROM app.user_person_links")
  ).text;
  assert.match(linkSql, /user_person\.verified_at IS NOT NULL/);
  assert.match(linkSql, /person\.status = 'ACTIVE'/);
  assert.doesNotMatch(linkSql, /email|full_name/i);
});

test("CREATOR_PERSON reutiliza una party PERSON activa existente", async () => {
  const mock = createMockRepository({
    creatorParty: { party_id: EXISTING_PARTY_ID, status: "ACTIVE" },
  });
  await mock.setupOwnership({
    userId: USER_ID,
    input: validInput([{ kind: "CREATOR_PERSON", ownershipShare: 100 }]),
  });

  const partyInserts = mock.queries.filter((query) =>
    query.text.includes("INSERT INTO app.parties")
  );
  const interestInsert = mock.queries.find((query) =>
    query.text.includes("INSERT INTO app.aircraft_ownership_interests")
  );
  assert.equal(partyInserts.length, 0);
  assert.equal(interestInsert.params[2], EXISTING_PARTY_ID);
});

test("CREATOR_PERSON crea una party PERSON cuando no existe", async () => {
  const mock = createMockRepository();
  await mock.setupOwnership({
    userId: USER_ID,
    input: validInput([{ kind: "CREATOR_PERSON", ownershipShare: 100 }]),
  });

  const partyInsert = mock.queries.find((query) =>
    query.text.includes("INSERT INTO app.parties")
  );
  assert.ok(partyInsert);
  assert.match(partyInsert.text, /'PERSON'/);
  assert.equal(partyInsert.params[1], PERSON_ID);
});

test("PERSON explicita crea person y party nuevas sin deduplicar por nombre o email", async () => {
  const mock = createMockRepository();
  await mock.setupOwnership({
    userId: USER_ID,
    input: validInput([
      {
        kind: "PERSON",
        fullName: "Ana Propietaria",
        email: "ANA@EXAMPLE.COM",
        countryCode: "uy",
        ownershipShare: 100,
      },
    ]),
  });

  const personInsert = mock.queries.find((query) =>
    query.text.includes("INSERT INTO app.persons")
  );
  const partyInsert = mock.queries.find((query) =>
    query.text.includes("INSERT INTO app.parties")
  );
  assert.ok(personInsert);
  assert.deepEqual(personInsert.params.slice(1), ["Ana Propietaria", "ana@example.com"]);
  assert.ok(partyInsert);
  assert.equal(partyInsert.params[2], "UY");
  assert.equal(
    mock.queries.some(
      (query) =>
        query.text.includes("FROM app.persons") && /email|full_name/i.test(query.text)
    ),
    false
  );
});

test("ORGANIZATION crea una party ORGANIZATION sin crear person", async () => {
  const mock = createMockRepository();
  await mock.setupOwnership({
    userId: USER_ID,
    input: validInput([
      {
        kind: "ORGANIZATION",
        organizationName: "Aeroclub",
        countryCode: "cl",
        ownershipShare: 100,
      },
    ]),
  });

  assert.equal(
    mock.queries.some((query) => query.text.includes("INSERT INTO app.persons")),
    false
  );
  const partyInsert = mock.queries.find((query) =>
    query.text.includes("INSERT INTO app.parties")
  );
  assert.match(partyInsert.text, /'ORGANIZATION'/);
  assert.deepEqual(partyInsert.params.slice(1), ["Aeroclub", "CL"]);
});

test("setup es SERIALIZABLE, bloquea antes del check y audita en la misma transaccion", async () => {
  const mock = createMockRepository();
  const result = await mock.setupOwnership({
    userId: USER_ID,
    input: validInput([{ kind: "CREATOR_PERSON", ownershipShare: 100 }]),
  });

  assert.deepEqual(mock.getTransactionOptions(), { isolationLevel: "SERIALIZABLE" });
  assert.equal(mock.getTransactionCalls(), 1);
  const lockIndex = mock.queries.findIndex((query) =>
    query.text.includes("app-horas:aircraft-ownership") ||
    query.params.some((param) => String(param).includes("app-horas:aircraft-ownership"))
  );
  const ownershipCheckIndex = mock.queries.findIndex(
    (query) =>
      query.text.includes("FROM app.aircraft_ownership_interests") &&
      query.text.includes("FOR UPDATE")
  );
  const auditIndex = mock.queries.findIndex((query) =>
    query.text.includes("INSERT INTO audit.audit_events")
  );
  assert.ok(lockIndex >= 0 && lockIndex < ownershipCheckIndex);
  assert.ok(auditIndex > ownershipCheckIndex);

  const sql = mock.queries.map((query) => query.text).join("\n");
  assert.match(sql, /'MANUAL'/);
  assert.match(sql, /'OWNERSHIP_CONFIGURED'/);
  assert.doesNotMatch(sql, /INSERT INTO app\.users|INSERT INTO app\.aircraft_memberships/i);
  assert.equal(
    mock.queries.some((query) => /^\s*(?:UPDATE|DELETE)\b/i.test(query.text)),
    false
  );
  assert.deepEqual(result, {
    ok: true,
    aircraftId: AIRCRAFT_ID,
    ownershipConfigured: true,
    ownershipTotal: 100,
    flightWritesReady: true,
  });
});

test("readiness se deriva del total canonico y falla si Postgres no devuelve 100", async () => {
  const mock = createMockRepository({ total: "99.99" });
  await assert.rejects(
    mock.setupOwnership({
      userId: USER_ID,
      input: validInput([{ kind: "CREATOR_PERSON", ownershipShare: 100 }]),
    }),
    (error) => error.code === "OWNERSHIP_TOTAL_INVARIANT_FAILED"
  );
});

test("PATCH /api/aircraft ownership queda bloqueado por defecto", async () => {
  const previousSessionSecret = process.env.SESSION_SECRET;
  const previousAircraftSource = process.env.AIRCRAFT_DATA_SOURCE;
  const previousFlag = process.env.POSTGRES_OWNERSHIP_WRITES_ENABLED;

  try {
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.AIRCRAFT_DATA_SOURCE = "postgres";
    delete process.env.POSTGRES_OWNERSHIP_WRITES_ENABLED;
    const req = {
      method: "PATCH",
      headers: { cookie: createSessionCookie({ userId: USER_ID }).split(";")[0] },
      body: validInput([{ kind: "CREATOR_PERSON", ownershipShare: 100 }]),
    };
    const res = createResponse();
    await aircraftHandler(req, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, "POSTGRES_OWNERSHIP_WRITES_NOT_ENABLED");
  } finally {
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
    if (previousAircraftSource === undefined) delete process.env.AIRCRAFT_DATA_SOURCE;
    else process.env.AIRCRAFT_DATA_SOURCE = previousAircraftSource;
    if (previousFlag === undefined) delete process.env.POSTGRES_OWNERSHIP_WRITES_ENABLED;
    else process.env.POSTGRES_OWNERSHIP_WRITES_ENABLED = previousFlag;
  }
});
