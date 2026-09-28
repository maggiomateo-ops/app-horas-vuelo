import assert from "node:assert/strict";
import test from "node:test";

import { createSessionCookie } from "../api/_auth.js";
import {
  createPostgresOnboardingRepository,
  normalizeAircraftOnboardingInput,
} from "../api/_postgresOnboardingRepository.js";
import aircraftHandler from "../api/aircraft.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const AIRCRAFT_ID = "22222222-2222-4222-8222-222222222222";
const MEMBERSHIP_ID = "33333333-3333-4333-8333-333333333333";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";

const VALID_INPUT = Object.freeze({
  registration: " lv-test ",
  manufacturer: " Piper ",
  model: " PA-28 ",
  serialNumber: " SN-001 ",
  countryCode: " ar ",
  baselineEffectiveDate: "2026-09-27",
});

function createMockRepository({ duplicate = false } = {}) {
  const queries = [];
  let transactionOptions;
  const client = {
    async query(text, params = []) {
      queries.push({ text, params });

      if (text.includes("FROM app.users")) {
        return { rows: [{ user_id: USER_ID, status: "ACTIVE" }] };
      }

      if (text.includes("registration_duplicate")) {
        return {
          rows: [
            {
              registration_duplicate: duplicate,
              serial_duplicate: false,
            },
          ],
        };
      }

      return { rows: [] };
    },
  };
  const ids = [AIRCRAFT_ID, MEMBERSHIP_ID, REQUEST_ID];
  const createAircraft = createPostgresOnboardingRepository({
    transaction: async (work, options) => {
      transactionOptions = options;
      return work(client);
    },
    randomUUID: () => ids.shift(),
  });

  return {
    createAircraft,
    queries,
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

test("normaliza el input canonico y conserva TIS desconocido como null", () => {
  const normalized = normalizeAircraftOnboardingInput({
    ...VALID_INPUT,
    serialNumber: " ",
    openingTisHours: "   ",
    defaultCaptureMethod: " ",
  });

  assert.deepEqual(normalized, {
    registration: "LV-TEST",
    manufacturer: "Piper",
    model: "PA-28",
    serialNumber: null,
    countryCode: "AR",
    openingTisHours: null,
    baselineEffectiveDate: "2026-09-27",
    defaultCaptureMethod: "DIRECT",
    defaultOilUnit: "US_QUART",
  });
});

test("rechaza campos de estado de negocio no soportados", () => {
  assert.throws(
    () => normalizeAircraftOnboardingInput({ ...VALID_INPUT, ownership: [] }),
    (error) =>
      error.statusCode === 422 && error.code === "UNSUPPORTED_ONBOARDING_FIELDS"
  );
});

test("rechaza fechas y enums invalidos antes de abrir una transaccion", () => {
  assert.throws(
    () =>
      normalizeAircraftOnboardingInput({
        ...VALID_INPUT,
        baselineEffectiveDate: "2026-02-30",
      }),
    (error) => error.statusCode === 400
  );
  assert.throws(
    () =>
      normalizeAircraftOnboardingInput({
        ...VALID_INPUT,
        defaultCaptureMethod: "LEGACY",
      }),
    (error) => error.statusCode === 422
  );
});

test("crea el bootstrap completo dentro de una transaccion SERIALIZABLE", async () => {
  const mock = createMockRepository();
  const result = await mock.createAircraft({
    userId: USER_ID,
    input: { ...VALID_INPUT, openingTisHours: "12.3" },
  });

  assert.deepEqual(mock.getTransactionOptions(), {
    isolationLevel: "SERIALIZABLE",
  });
  assert.equal(result.aircraft.aircraft_id, AIRCRAFT_ID);
  assert.equal(result.aircraft.rol, "OWNER");
  assert.deepEqual(result.onboarding, {
    ownershipConfigured: false,
    flightWritesReady: false,
  });

  const sql = mock.queries.map((query) => query.text).join("\n");
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /INSERT INTO app\.aircraft\s/);
  assert.match(sql, /INSERT INTO app\.aircraft_registrations/);
  assert.match(sql, /INSERT INTO app\.aircraft_memberships/);
  assert.match(sql, /INSERT INTO app\.aircraft_membership_capabilities/);
  assert.match(sql, /INSERT INTO app\.aircraft_settings/);
  assert.match(sql, /INSERT INTO app\.aircraft_utilization_baselines/);
  assert.match(sql, /'OWNER_ENTRY'/);
  assert.match(sql, /INSERT INTO audit\.audit_events/);
  assert.match(sql, /'MANUAL'/);
  assert.doesNotMatch(sql, /aircraft_ownership_interests/);

  const auditIndex = mock.queries.findIndex((query) =>
    query.text.includes("INSERT INTO audit.audit_events")
  );
  const baselineIndex = mock.queries.findIndex((query) =>
    query.text.includes("INSERT INTO app.aircraft_utilization_baselines")
  );
  assert.ok(auditIndex > baselineIndex);
});

test("envia null a Postgres cuando openingTisHours es desconocido", async () => {
  const mock = createMockRepository();
  await mock.createAircraft({ userId: USER_ID, input: VALID_INPUT });
  const baselineQuery = mock.queries.find((query) =>
    query.text.includes("INSERT INTO app.aircraft_utilization_baselines")
  );

  assert.equal(baselineQuery.params[1], null);
});

test("el error de duplicado es 409 y no filtra detalles del registro", async () => {
  const mock = createMockRepository({ duplicate: true });

  await assert.rejects(
    mock.createAircraft({ userId: USER_ID, input: VALID_INPUT }),
    (error) => {
      assert.equal(error.statusCode, 409);
      assert.equal(error.code, "AIRCRAFT_POSSIBLE_DUPLICATE");
      assert.equal(error.message, "La aeronave podria estar registrada previamente.");
      assert.doesNotMatch(error.message, new RegExp(AIRCRAFT_ID, "i"));
      return true;
    }
  );

  assert.equal(
    mock.queries.some((query) => query.text.includes("INSERT INTO")),
    false
  );
});

test("POST /api/aircraft queda bloqueado por defecto sin abrir Postgres", async () => {
  const previousSessionSecret = process.env.SESSION_SECRET;
  const previousAircraftSource = process.env.AIRCRAFT_DATA_SOURCE;
  const previousOnboardingFlag = process.env.POSTGRES_ONBOARDING_WRITES_ENABLED;

  try {
    process.env.SESSION_SECRET = "test-session-secret";
    process.env.AIRCRAFT_DATA_SOURCE = "postgres";
    delete process.env.POSTGRES_ONBOARDING_WRITES_ENABLED;

    const cookie = createSessionCookie({ userId: USER_ID }).split(";")[0];
    const req = {
      method: "POST",
      headers: { cookie },
      body: VALID_INPUT,
    };
    const res = createResponse();

    await aircraftHandler(req, res);

    assert.equal(res.statusCode, 503);
    assert.equal(res.payload.code, "POSTGRES_ONBOARDING_WRITES_NOT_ENABLED");
  } finally {
    if (previousSessionSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSessionSecret;
    }

    if (previousAircraftSource === undefined) {
      delete process.env.AIRCRAFT_DATA_SOURCE;
    } else {
      process.env.AIRCRAFT_DATA_SOURCE = previousAircraftSource;
    }

    if (previousOnboardingFlag === undefined) {
      delete process.env.POSTGRES_ONBOARDING_WRITES_ENABLED;
    } else {
      process.env.POSTGRES_ONBOARDING_WRITES_ENABLED = previousOnboardingFlag;
    }
  }
});
