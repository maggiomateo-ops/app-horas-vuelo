import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAircraftOnboardingPayload,
  createAircraft,
  createAircraftSubmissionGuard,
  createFirstAircraftAndRefresh,
  getAircraftOnboardingErrorMessage,
} from "../src/services/aircraftService.js";

const FORM_VALUES = Object.freeze({
  registration: " lv-new ",
  manufacturer: " Piper ",
  model: " PA-28 ",
  serialNumber: " SN-NEW ",
  countryCode: " ar ",
  openingTisHours: "12.3",
  baselineEffectiveDate: "2026-09-27",
  ownership: { share: 100 },
  components: [{ type: "ENGINE" }],
  legacyTotals: { tis: 12.3 },
});

test("construye exactamente el payload D-244", () => {
  const payload = buildAircraftOnboardingPayload(FORM_VALUES);

  assert.deepEqual(payload, {
    registration: "LV-NEW",
    manufacturer: "Piper",
    model: "PA-28",
    serialNumber: "SN-NEW",
    countryCode: "AR",
    openingTisHours: 12.3,
    baselineEffectiveDate: "2026-09-27",
    defaultCaptureMethod: "DIRECT",
    defaultOilUnit: "US_QUART",
  });
  assert.deepEqual(Object.keys(payload), [
    "registration",
    "manufacturer",
    "model",
    "serialNumber",
    "countryCode",
    "openingTisHours",
    "baselineEffectiveDate",
    "defaultCaptureMethod",
    "defaultOilUnit",
  ]);
  assert.equal("ownership" in payload, false);
  assert.equal("components" in payload, false);
  assert.equal("legacyTotals" in payload, false);
});

test("TIS vacio se envia como null y nunca como cero", () => {
  const payload = buildAircraftOnboardingPayload({
    ...FORM_VALUES,
    openingTisHours: "   ",
  });

  assert.equal(payload.openingTisHours, null);
});

test("POST envia credentials y solamente el payload canonico", async () => {
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
            aircraft: {
              aircraft_id: "canonical-id",
              matricula: "LV-NEW",
              fabricante: "Piper",
              modelo: "PA-28",
              rol: "OWNER",
            },
            onboarding: {
              ownershipConfigured: false,
              flightWritesReady: false,
            },
          };
        },
      };
    };

    await createAircraft(FORM_VALUES);
  } finally {
    globalThis.fetch = previousFetch;
  }

  assert.equal(request.url, "/api/aircraft");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.credentials, "include");
  assert.deepEqual(JSON.parse(request.options.body), buildAircraftOnboardingPayload(FORM_VALUES));
});

test("el guard bloquea un segundo submit mientras el primero sigue activo", () => {
  const guard = createAircraftSubmissionGuard();

  assert.equal(guard.tryStart(), true);
  assert.equal(guard.tryStart(), false);
  guard.finish();
  assert.equal(guard.tryStart(), true);
});

test("success usa aircraft_id canonico y refresca la lista", async () => {
  let refreshCalls = 0;
  const result = await createFirstAircraftAndRefresh(FORM_VALUES, {
    createRequest: async () => ({
      aircraft: {
        aircraft_id: "canonical-aircraft-id",
        matricula: "LV-NEW",
        fabricante: "Piper",
        modelo: "PA-28",
        rol: "OWNER",
      },
      onboarding: {
        ownershipConfigured: false,
        flightWritesReady: false,
      },
    }),
    loadAircrafts: async () => {
      refreshCalls += 1;
      return [];
    },
  });

  assert.equal(refreshCalls, 1);
  assert.equal(result.selectedAircraftId, "canonical-aircraft-id");
  assert.equal(result.aircrafts[0].aircraft_id, "canonical-aircraft-id");
  assert.equal(result.onboarding.flightWritesReady, false);
});

test("si falla el refresh conserva el alta canonica sin inducir un duplicado", async () => {
  const result = await createFirstAircraftAndRefresh(FORM_VALUES, {
    createRequest: async () => ({
      aircraft: {
        aircraft_id: "created-aircraft-id",
        matricula: "LV-NEW",
        fabricante: "Piper",
        modelo: "PA-28",
        rol: "OWNER",
      },
      onboarding: {
        ownershipConfigured: false,
        flightWritesReady: false,
      },
    }),
    loadAircrafts: async () => {
      throw new Error("network unavailable");
    },
  });

  assert.equal(result.selectedAircraftId, "created-aircraft-id");
  assert.deepEqual(result.aircrafts.map((aircraft) => aircraft.aircraft_id), [
    "created-aircraft-id",
  ]);
});

test("duplicate 409 se presenta de forma neutral", () => {
  const message = getAircraftOnboardingErrorMessage({
    code: "AIRCRAFT_POSSIBLE_DUPLICATE",
    statusCode: 409,
    message: "internal matched aircraft id secret-id",
  });

  assert.match(message, /registro existente/i);
  assert.doesNotMatch(message, /secret-id|matched aircraft/i);
});
