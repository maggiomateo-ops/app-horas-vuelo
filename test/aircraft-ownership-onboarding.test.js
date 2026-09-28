import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAircraftOwnershipPayload,
  configureAircraftOwnership,
  configureOwnershipAndRefresh,
  createOwnershipSubmissionGuard,
  removeOwnershipOwner,
  validateOwnershipOwners,
} from "../src/services/aircraftService.js";

const AIRCRAFT_ID = "22222222-2222-4222-8222-222222222222";

const CREATOR = Object.freeze({
  id: "local-creator",
  kind: "CREATOR_PERSON",
  ownershipShare: "50.00",
  party_id: "must-not-travel",
  role: "OWNER",
});
const PERSON = Object.freeze({
  id: "local-person",
  kind: "PERSON",
  fullName: " Ana Propietaria ",
  email: "ana@example.com",
  countryCode: " ar ",
  ownershipShare: "25",
  person_id: "must-not-travel",
});
const ORGANIZATION = Object.freeze({
  id: "local-organization",
  kind: "ORGANIZATION",
  organizationName: " Aeroclub ",
  countryCode: "uy",
  ownershipShare: "25.0",
  user_id: "must-not-travel",
});

test("construye payloads exactos para CREATOR_PERSON, PERSON y ORGANIZATION", () => {
  const payload = buildAircraftOwnershipPayload(AIRCRAFT_ID, [
    CREATOR,
    PERSON,
    ORGANIZATION,
  ]);

  assert.deepEqual(payload, {
    aircraftId: AIRCRAFT_ID,
    owners: [
      { kind: "CREATOR_PERSON", ownershipShare: 50 },
      {
        kind: "PERSON",
        fullName: "Ana Propietaria",
        email: "ana@example.com",
        countryCode: "AR",
        ownershipShare: 25,
      },
      {
        kind: "ORGANIZATION",
        organizationName: "Aeroclub",
        countryCode: "UY",
        ownershipShare: 25,
      },
    ],
  });
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(
    serialized,
    /party_id|person_id|user_id|membership|role|status|local-creator/
  );
});

test("valida múltiples propietarios con suma exacta en centésimas", () => {
  const valid = validateOwnershipOwners([
    { ...CREATOR, ownershipShare: "33.33" },
    { ...PERSON, ownershipShare: "33.33" },
    { ...ORGANIZATION, ownershipShare: "33.34" },
  ]);
  const invalid = validateOwnershipOwners([
    { ...CREATOR, ownershipShare: "33.33" },
    { ...PERSON, ownershipShare: "66.66" },
  ]);

  assert.equal(valid.valid, true);
  assert.equal(valid.totalCents, 10_000);
  assert.equal(invalid.valid, false);
  assert.equal(invalid.totalCents, 9_999);
});

test("bloquea CREATOR_PERSON duplicado y campos condicionales incompletos", () => {
  const duplicate = validateOwnershipOwners([
    { ...CREATOR, ownershipShare: 50 },
    { ...CREATOR, id: "second", ownershipShare: 50 },
  ]);
  const missingPersonName = validateOwnershipOwners([
    { ...PERSON, fullName: "", ownershipShare: 100 },
  ]);
  const missingOrganizationName = validateOwnershipOwners([
    { ...ORGANIZATION, organizationName: "", ownershipShare: 100 },
  ]);

  assert.equal(duplicate.valid, false);
  assert.match(duplicate.formError, /una sola vez/i);
  assert.match(missingPersonName.ownerErrors[0].fullName, /nombre completo/i);
  assert.match(
    missingOrganizationName.ownerErrors[0].organizationName,
    /organización/i
  );
});

test("elimina únicamente el propietario seleccionado", () => {
  assert.deepEqual(
    removeOwnershipOwner([CREATOR, PERSON, ORGANIZATION], PERSON.id).map(
      (owner) => owner.id
    ),
    [CREATOR.id, ORGANIZATION.id]
  );
});

test("el guard impide doble submit", () => {
  const guard = createOwnershipSubmissionGuard();
  assert.equal(guard.tryStart(), true);
  assert.equal(guard.tryStart(), false);
  guard.finish();
  assert.equal(guard.tryStart(), true);
});

test("envía PATCH /api/aircraft con credentials y payload exacto", async () => {
  const previousFetch = globalThis.fetch;
  let request;
  try {
    globalThis.fetch = async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 201,
        async json() {
          return {
            ok: true,
            aircraftId: AIRCRAFT_ID,
            ownershipConfigured: true,
            ownershipTotal: 100,
            flightWritesReady: true,
          };
        },
      };
    };
    await configureAircraftOwnership(AIRCRAFT_ID, [
      { ...CREATOR, ownershipShare: 100 },
    ]);
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(request.url, "/api/aircraft");
  assert.equal(request.options.method, "PATCH");
  assert.equal(request.options.credentials, "include");
  assert.deepEqual(JSON.parse(request.options.body), {
    aircraftId: AIRCRAFT_ID,
    owners: [{ kind: "CREATOR_PERSON", ownershipShare: 100 }],
  });
});

test("success habilita readiness local y conserva el aircraft_id canónico", async () => {
  const currentAircrafts = [
    {
      aircraft_id: AIRCRAFT_ID,
      rol: "OWNER",
      ownershipConfigured: false,
      flightWritesReady: false,
    },
  ];
  const result = await configureOwnershipAndRefresh(
    AIRCRAFT_ID,
    [{ ...CREATOR, ownershipShare: 100 }],
    {
      currentAircrafts,
      configureRequest: async () => ({
        aircraftId: AIRCRAFT_ID,
        ownershipConfigured: true,
        flightWritesReady: true,
      }),
      loadAircrafts: async () => {
        throw new Error("temporary refresh failure");
      },
    }
  );

  assert.equal(result.aircrafts[0].aircraft_id, AIRCRAFT_ID);
  assert.equal(result.aircrafts[0].ownershipConfigured, true);
  assert.equal(result.aircrafts[0].flightWritesReady, true);
  assert.equal(result.onboarding.flightWritesReady, true);
});

test("409 refresca readiness sin intentar un segundo setup", async () => {
  let setupCalls = 0;
  let refreshCalls = 0;
  const result = await configureOwnershipAndRefresh(AIRCRAFT_ID, [CREATOR], {
    configureRequest: async () => {
      setupCalls += 1;
      const error = new Error("already configured");
      error.statusCode = 409;
      error.code = "OWNERSHIP_ALREADY_CONFIGURED";
      throw error;
    },
    loadAircrafts: async () => {
      refreshCalls += 1;
      return [
        {
          aircraft_id: AIRCRAFT_ID,
          ownershipConfigured: true,
          flightWritesReady: true,
        },
      ];
    },
  });

  assert.equal(setupCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.equal(result.alreadyConfigured, true);
});

test("role OWNER no se interpreta como ownership legal ni readiness", async () => {
  await assert.rejects(
    configureOwnershipAndRefresh(AIRCRAFT_ID, [CREATOR], {
      configureRequest: async () => {
        const error = new Error("already configured");
        error.statusCode = 409;
        error.code = "OWNERSHIP_ALREADY_CONFIGURED";
        throw error;
      },
      loadAircrafts: async () => [
        {
          aircraft_id: AIRCRAFT_ID,
          rol: "OWNER",
          ownershipConfigured: false,
          flightWritesReady: false,
        },
      ],
    }),
    (error) => error.code === "OWNERSHIP_ALREADY_CONFIGURED"
  );
});
