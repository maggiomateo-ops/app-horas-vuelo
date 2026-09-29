import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { resolveAircraftPilotForFlight } from "../api/_postgresFlightRepository.js";
import {
  buildPilotOptions,
  findSameNamePilotCandidates,
  getPilotDisplayLabel,
  maskPilotDni,
} from "../src/utils/pilotIdentity.js";

const AIRCRAFT_ID = "11111111-1111-4111-8111-111111111111";
const PILOT_A = "22222222-2222-4222-8222-222222222222";
const PILOT_B = "33333333-3333-4333-8333-333333333333";

function pilot(personId, overrides = {}) {
  return {
    person_id: personId,
    nombre: "Juan Perez",
    licencia: "",
    dni: "",
    estado: "ACTIVO",
    permiso_estado: "ACTIVO",
    ...overrides,
  };
}

test("homonimos con distinta licencia se identifican siempre por person_id", () => {
  const options = buildPilotOptions([
    pilot(PILOT_A, { licencia: "PPA-100" }),
    pilot(PILOT_B, { licencia: "PPA-200" }),
  ]);

  assert.deepEqual(options.map(({ personId, label, ambiguous }) => ({ personId, label, ambiguous })), [
    { personId: PILOT_A, label: "Juan Perez · PPA-100", ambiguous: false },
    { personId: PILOT_B, label: "Juan Perez · PPA-200", ambiguous: false },
  ]);
});

test("display usa DNI enmascarado como fallback y nunca expone el DNI completo", () => {
  assert.equal(maskPilotDni("12345678"), "••••5678");
  assert.equal(getPilotDisplayLabel(pilot(PILOT_A, { dni: "12345678" })), "Juan Perez · DNI ••••5678");
  assert.doesNotMatch(getPilotDisplayLabel(pilot(PILOT_A, { dni: "12345678" })), /12345678/);
});

test("homonimos sin identificadores quedan ambiguos y no admiten eleccion ciega", () => {
  const options = buildPilotOptions([pilot(PILOT_A), pilot(PILOT_B)]);
  assert.equal(options.every((option) => option.ambiguous), true);
  assert.deepEqual(findSameNamePilotCandidates([pilot(PILOT_A), pilot(PILOT_B)], "  JUÁN   PEREZ ").map((item) => item.person_id), [PILOT_A, PILOT_B]);
});

test("resolver canonico rechaza un person_id que no esta ACTIVE para esa aeronave", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    resolveAircraftPilotForFlight(client, AIRCRAFT_ID, PILOT_A),
    (error) => error.code === "FLIGHT_PILOT_NOT_RESOLVED" && error.statusCode === 409
  );
});

test("UI conserva identidad separada, alta OWNER explicita y Sheets legacy", async () => {
  const [appSource, selectorSource, flightSource, historySource, handlerSource] = await Promise.all([
    fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/components/FlightPilotSelector.jsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../api/_postgresFlightRepository.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../api/_postgresHistorialesParityAdapter.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../api/guardar-vuelo.js", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /const \[pilotPersonId, setPilotPersonId\]/);
  assert.match(appSource, /pilot_person_id: pilotPersonId/);
  assert.match(appSource, /setPilotPersonId\(editable\.pilotPersonId\)/);
  assert.match(appSource, /setPilotPersonId\(ultimoInput\.pilotPersonId \?\? ultimoInput\.pilot_person_id/);
  assert.match(appSource, /selectedAircraftRole === "OWNER"/);
  assert.match(selectorSource, /canCreate && writesEnabled/);
  assert.match(selectorSource, /person_id: pilot\.person_id/);
  assert.match(selectorSource, /Es una persona distinta/);
  assert.match(flightSource, /p\.person_id=\$2::uuid/);
  assert.doesNotMatch(flightSource, /lower\(p\.full_name\)=lower\(\$2\)/);
  assert.match(historySource, /pilot_person_id:/);
  assert.match(handlerSource, /source === DATA_SOURCE\.POSTGRES/);
  assert.match(handlerSource, /delete payload\.pilot_person_id/);
  assert.match(appSource, /usesCanonicalPilotSelection[\s\S]*?<input id="piloto" type="text"/);
});
