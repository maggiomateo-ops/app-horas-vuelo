import assert from "node:assert/strict";
import test from "node:test";

import {
  createPostgresIdentityRepository,
  resolvePostgresSelfServiceUserCreationCapability,
} from "../api/_postgresIdentityRepository.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PERSON_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

const EXISTING_IDENTITY = Object.freeze({
  user_id: USER_ID,
  email: "pilot@example.com",
  status: "ACTIVE",
  preferred_locale: "es",
  person_id: PERSON_ID,
  full_name: "Existing Pilot",
  person_status: "ACTIVE",
});

function createRepository({
  initialIdentityRows = [],
  existingUserAfterLock = false,
  transactionIdentityRows = [],
  creationEnabled = true,
} = {}) {
  const outsideQueries = [];
  const transactionQueries = [];
  let transactionOptions;
  let transactionCalls = 0;
  const ids = [USER_ID, PERSON_ID, REQUEST_ID];
  const query = async (text, params = []) => {
    outsideQueries.push({ text, params });
    return { rows: initialIdentityRows };
  };
  const client = {
    async query(text, params = []) {
      transactionQueries.push({ text, params });

      if (text.includes("SELECT user_id") && text.includes("FROM app.users")) {
        return {
          rows: existingUserAfterLock ? [{ user_id: USER_ID }] : [],
        };
      }

      if (text.includes("JOIN app.user_person_links")) {
        return { rows: transactionIdentityRows };
      }

      return { rows: [] };
    },
  };
  const repository = createPostgresIdentityRepository({
    query,
    transaction: async (work, options) => {
      transactionCalls += 1;
      transactionOptions = options;
      return work(client);
    },
    randomUUID: () => ids.shift(),
    isSelfServiceCreationEnabled: () => creationEnabled,
  });

  return {
    repository,
    outsideQueries,
    transactionQueries,
    getTransactionCalls: () => transactionCalls,
    getTransactionOptions: () => transactionOptions,
  };
}

test("un usuario existente conserva la resolucion y el shape previo", async () => {
  const mock = createRepository({
    initialIdentityRows: [EXISTING_IDENTITY],
    creationEnabled: false,
  });

  const user = await mock.repository.resolveOrCreateActiveUserByVerifiedGoogleIdentity({
    email: " PILOT@EXAMPLE.COM ",
    displayName: "",
  });

  assert.deepEqual(user, {
    user_id: USER_ID,
    email: "pilot@example.com",
    nombre: "Existing Pilot",
    estado: "ACTIVO",
    preferred_locale: "es",
    is_admin: false,
  });
  assert.equal(mock.getTransactionCalls(), 0);
});

test("el gate ausente o false conserva el rechazo y no crea filas", async () => {
  const mock = createRepository({ creationEnabled: false });

  await assert.rejects(
    mock.repository.resolveOrCreateActiveUserByVerifiedGoogleIdentity({
      email: "new@example.com",
      displayName: "New Pilot",
    }),
    (error) => error.code === "USER_NOT_AUTHORIZED" && error.statusCode === 403
  );

  assert.equal(mock.getTransactionCalls(), 0);
  assert.equal(mock.transactionQueries.length, 0);
});

test("el gate de self-service es fail-closed cuando falta o vale false", () => {
  const previousValue = process.env.POSTGRES_SELF_SERVICE_USER_CREATION_ENABLED;

  try {
    delete process.env.POSTGRES_SELF_SERVICE_USER_CREATION_ENABLED;
    assert.equal(resolvePostgresSelfServiceUserCreationCapability(), false);

    process.env.POSTGRES_SELF_SERVICE_USER_CREATION_ENABLED = "false";
    assert.equal(resolvePostgresSelfServiceUserCreationCapability(), false);
  } finally {
    if (previousValue === undefined) {
      delete process.env.POSTGRES_SELF_SERVICE_USER_CREATION_ENABLED;
    } else {
      process.env.POSTGRES_SELF_SERVICE_USER_CREATION_ENABLED = previousValue;
    }
  }
});

test("crea user, person, link y Audit con email normalizado en SERIALIZABLE", async () => {
  const mock = createRepository();
  const user = await mock.repository.resolveOrCreateActiveUserByVerifiedGoogleIdentity({
    email: " New.Pilot@Example.COM ",
    displayName: " New Pilot ",
  });

  assert.deepEqual(mock.getTransactionOptions(), {
    isolationLevel: "SERIALIZABLE",
  });
  assert.deepEqual(user, {
    user_id: USER_ID,
    email: "new.pilot@example.com",
    nombre: "New Pilot",
    estado: "ACTIVO",
    preferred_locale: "es",
    is_admin: false,
  });
  assert.equal(mock.outsideQueries[0].params[0], "new.pilot@example.com");

  const sql = mock.transactionQueries.map((entry) => entry.text).join("\n");
  assert.match(sql, /INSERT INTO app\.users/);
  assert.match(sql, /INSERT INTO app\.persons/);
  assert.match(sql, /INSERT INTO app\.user_person_links/);
  assert.match(sql, /INSERT INTO audit\.audit_events/);
  assert.match(sql, /'USER_PROFILE_CREATED'/);
  assert.match(sql, /'MANUAL'/);
  assert.doesNotMatch(sql, /INSERT INTO app\.aircraft/i);
  assert.doesNotMatch(sql, /INSERT INTO app\.aircraft_memberships/i);
  assert.doesNotMatch(sql, /INSERT INTO app\.aircraft_ownership_interests/i);
  assert.doesNotMatch(sql, /is_admin/i);
  assert.equal(
    mock.transactionQueries.filter((entry) => entry.text.includes("INSERT INTO"))
      .length,
    4
  );

  const lockIndex = mock.transactionQueries.findIndex((entry) =>
    entry.text.includes("pg_advisory_xact_lock")
  );
  const userRecheckIndex = mock.transactionQueries.findIndex(
    (entry) => entry.text.includes("SELECT user_id") && entry.text.includes("FROM app.users")
  );
  const userInsertIndex = mock.transactionQueries.findIndex((entry) =>
    entry.text.includes("INSERT INTO app.users")
  );
  const auditIndex = mock.transactionQueries.findIndex((entry) =>
    entry.text.includes("INSERT INTO audit.audit_events")
  );
  assert.ok(lockIndex >= 0 && lockIndex < userRecheckIndex);
  assert.ok(userRecheckIndex < userInsertIndex);
  assert.ok(auditIndex > userInsertIndex);

  const userInsert = mock.transactionQueries[userInsertIndex];
  assert.equal(userInsert.params[1], "new.pilot@example.com");
  assert.equal(userInsert.params[2], "es");
});

test("display name vacio se rechaza sin inserts", async () => {
  const mock = createRepository();

  await assert.rejects(
    mock.repository.resolveOrCreateActiveUserByVerifiedGoogleIdentity({
      email: "new@example.com",
      displayName: "   ",
    }),
    (error) => error.code === "INVALID_GOOGLE_IDENTITY" && error.statusCode === 400
  );

  assert.equal(
    mock.transactionQueries.some((entry) => entry.text.includes("INSERT INTO")),
    false
  );
});

test("una identidad existente incompleta falla cerrada y no se autorepara", async () => {
  const mock = createRepository({
    existingUserAfterLock: true,
    transactionIdentityRows: [],
  });

  await assert.rejects(
    mock.repository.resolveOrCreateActiveUserByVerifiedGoogleIdentity({
      email: "broken@example.com",
      displayName: "Broken User",
    }),
    (error) => error.code === "USER_NOT_AUTHORIZED" && error.statusCode === 403
  );

  const sql = mock.transactionQueries.map((entry) => entry.text).join("\n");
  assert.doesNotMatch(sql, /INSERT INTO/);
  assert.doesNotMatch(sql, /FROM app\.persons\s+WHERE/i);
});

test("el bootstrap no busca personas existentes por nombre ni email", async () => {
  const mock = createRepository();

  await mock.repository.resolveOrCreateActiveUserByVerifiedGoogleIdentity({
    email: "isolated@example.com",
    displayName: "Isolated Identity",
  });

  const selectSql = mock.transactionQueries
    .filter((entry) => /^\s*SELECT/i.test(entry.text))
    .map((entry) => entry.text)
    .join("\n");
  assert.doesNotMatch(selectSql, /FROM app\.persons/i);
});

test("una carrera en uq_users_email_ci resuelve la identidad ya creada", async () => {
  let queryCount = 0;
  const repository = createPostgresIdentityRepository({
    query: async () => {
      queryCount += 1;
      return { rows: queryCount === 1 ? [] : [EXISTING_IDENTITY] };
    },
    transaction: async () => {
      const error = new Error("duplicate key");
      error.code = "23505";
      error.constraint = "uq_users_email_ci";
      throw error;
    },
    isSelfServiceCreationEnabled: () => true,
  });

  const user = await repository.resolveOrCreateActiveUserByVerifiedGoogleIdentity({
    email: "PILOT@EXAMPLE.COM",
    displayName: "Existing Pilot",
  });

  assert.equal(queryCount, 2);
  assert.deepEqual(user, {
    user_id: USER_ID,
    email: "pilot@example.com",
    nombre: "Existing Pilot",
    estado: "ACTIVO",
    preferred_locale: "es",
    is_admin: false,
  });
});
