import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  composeSquawkTimeline,
  createPostgresSquawkRepository,
  SQUAWK_CATEGORIES,
} from "../api/_postgresSquawkRepository.js";
import { resolvePostgresSquawkWriteCapability } from "../api/_settingsWriteCapability.js";
import { buildSquawkPayload } from "../src/services/squawkService.js";
import { getSquawkSummary, selectSquawks } from "../src/utils/squawkPresentation.js";

const USER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const AIRCRAFT = "00000000-0000-4000-8000-000000000010";
const FLIGHT = "00000000-0000-4000-8000-000000000020";
const SQUAWK = "00000000-0000-4000-8000-000000000030";
let sequence = 100;
const nextUuid = () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`;

function squawk(overrides = {}) {
  return {
    squawk_id: SQUAWK,
    aircraft_id: AIRCRAFT,
    reported_at: "2026-09-30T12:00:00.000Z",
    created_by_user_id: USER,
    title: "Vibración leve",
    description: "Observada durante rodaje.",
    category: "POWERPLANT",
    flight_id: FLIGHT,
    status: "OPEN",
    created_at: "2026-09-30T12:01:00.000Z",
    updated_at: "2026-09-30T12:01:00.000Z",
    ...overrides,
  };
}

function createMutationMock({ role = "OWNER", existing = squawk(), flightMatches = true } = {}) {
  const state = { existing: { ...existing }, events: [], comments: [], audits: [], inserted: [] };
  const client = {
    async query(sql, params = []) {
      const text = String(sql);
      if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (text.includes("SELECT membership.role")) return { rows: [{ role }] };
      if (text.includes("FROM app.flight_records") && text.includes("flight_id = $1")) {
        return { rows: flightMatches ? [{ flight_id: FLIGHT }] : [] };
      }
      if (text.includes("FROM app.squawks") && text.includes("FOR UPDATE")) {
        return { rows: state.existing ? [{ ...state.existing }] : [] };
      }
      if (text.includes("INSERT INTO app.squawks")) {
        state.existing = squawk({
          squawk_id: params[0], aircraft_id: params[1], reported_at: params[2],
          created_by_user_id: params[3], title: params[4], description: params[5],
          category: params[6], flight_id: params[7], status: "OPEN",
        });
        state.inserted.push("squawk");
        return { rows: [{ ...state.existing }] };
      }
      if (text.includes("UPDATE app.squawks SET reported_at")) {
        Object.assign(state.existing, { reported_at: params[2], title: params[3], description: params[4], category: params[5], flight_id: params[6] });
        state.inserted.push("update");
        return { rows: [{ ...state.existing }] };
      }
      if (text.includes("INSERT INTO app.squawk_comments")) {
        const row = { comment_id: params[0], squawk_id: params[1], body: params[2], actor_user_id: params[3] };
        state.comments.push(row); return { rows: [row] };
      }
      if (text.includes("INSERT INTO app.squawk_status_events")) {
        state.events.push({
          from_status: params[2], to_status: params[3], transition_note: params[5],
          workshop_name: params[6], workshop_contact: params[7], resolution_note: params[8],
        });
        return { rows: [] };
      }
      if (text.includes("UPDATE app.squawks SET status")) {
        if (state.existing.status !== params[3]) return { rows: [] };
        state.existing.status = params[2]; return { rows: [{ ...state.existing }] };
      }
      if (text.includes("INSERT INTO audit.audit_events")) {
        state.audits.push({ action: params[6] }); return { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  const transaction = async (work, options) => {
    assert.equal(options.isolationLevel, "SERIALIZABLE");
    const snapshot = structuredClone(state);
    try { return await work(client); } catch (error) { Object.assign(state, snapshot); throw error; }
  };
  return { state, repository: createPostgresSquawkRepository({ transaction, randomUUID: nextUuid }) };
}

const VALID_INPUT = {
  reported_at: "2026-09-30T12:00:00Z",
  title: "Vibración leve",
  description: "Observada durante rodaje.",
  category: "POWERPLANT",
  flight_id: FLIGHT,
};

test("write gate is read-safe and enables only literal true", () => {
  const previous = process.env.POSTGRES_SQUAWK_WRITES_ENABLED;
  delete process.env.POSTGRES_SQUAWK_WRITES_ENABLED;
  assert.equal(resolvePostgresSquawkWriteCapability("POSTGRES").enabled, false);
  process.env.POSTGRES_SQUAWK_WRITES_ENABLED = "false";
  assert.equal(resolvePostgresSquawkWriteCapability("POSTGRES").enabled, false);
  process.env.POSTGRES_SQUAWK_WRITES_ENABLED = "true";
  assert.equal(resolvePostgresSquawkWriteCapability("POSTGRES").enabled, true);
  process.env.POSTGRES_SQUAWK_WRITES_ENABLED = "yes";
  assert.throws(() => resolvePostgresSquawkWriteCapability("POSTGRES"), /debe ser true/);
  if (previous === undefined) delete process.env.POSTGRES_SQUAWK_WRITES_ENABLED;
  else process.env.POSTGRES_SQUAWK_WRITES_ENABLED = previous;
});

test("OWNER and PILOT can create OPEN; VIEWER cannot", async () => {
  for (const role of ["OWNER", "PILOT"]) {
    const mock = createMutationMock({ role, existing: null });
    const created = await mock.repository.createSquawk({ userId: USER, aircraftId: AIRCRAFT, squawk: VALID_INPUT });
    assert.equal(created.status, "OPEN");
    assert.deepEqual(mock.state.audits.map((entry) => entry.action), ["SQUAWK_CREATED"]);
  }
  const viewer = createMutationMock({ role: "VIEWER", existing: null });
  await assert.rejects(viewer.repository.createSquawk({ userId: USER, aircraftId: AIRCRAFT, squawk: VALID_INPUT }), (error) => error.statusCode === 403);
  assert.equal(viewer.state.inserted.length, 0);
});

test("category and same-aircraft flight validation fail closed", async () => {
  const invalidCategory = createMutationMock({ existing: null });
  await assert.rejects(invalidCategory.repository.createSquawk({ userId: USER, aircraftId: AIRCRAFT, squawk: { ...VALID_INPUT, category: "ENGINE" } }), /categoria/);
  assert.deepEqual(SQUAWK_CATEGORIES, ["POWERPLANT", "ELECTRICAL", "AVIONICS_INSTRUMENTS", "FUEL", "FLIGHT_CONTROLS", "LANDING_GEAR_BRAKES", "LIGHTING", "STRUCTURE", "CABIN_INTERIOR", "OTHER"]);
  const mismatch = createMutationMock({ existing: null, flightMatches: false });
  await assert.rejects(mismatch.repository.createSquawk({ userId: USER, aircraftId: AIRCRAFT, squawk: VALID_INPUT }), (error) => error.code === "SQUAWK_FLIGHT_MISMATCH" && error.statusCode === 422);
  assert.equal(mismatch.state.inserted.length, 0);
});

test("core edit is OPEN-only and PILOT may edit only own Squawk", async () => {
  const own = createMutationMock({ role: "PILOT" });
  await own.repository.updateSquawk({ userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, squawk: { ...VALID_INPUT, title: "Actualizada" } });
  assert.equal(own.state.existing.title, "Actualizada");
  const other = createMutationMock({ role: "PILOT", existing: squawk({ created_by_user_id: OTHER }) });
  await assert.rejects(other.repository.updateSquawk({ userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, squawk: VALID_INPUT }), (error) => error.statusCode === 403);
  const resolved = createMutationMock({ existing: squawk({ status: "RESOLVED" }) });
  await assert.rejects(resolved.repository.updateSquawk({ userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, squawk: VALID_INPUT }), /estado actual/);
});

test("comment permissions are append-only for OWNER and own OPEN PILOT", async () => {
  const ownerSent = createMutationMock({ role: "OWNER", existing: squawk({ status: "SENT_TO_WORKSHOP" }) });
  await ownerSent.repository.addSquawkComment({ userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, body: "Consulta enviada." });
  assert.equal(ownerSent.state.comments.length, 1);
  const pilotOther = createMutationMock({ role: "PILOT", existing: squawk({ created_by_user_id: OTHER }) });
  await assert.rejects(pilotOther.repository.addSquawkComment({ userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, body: "No permitido" }), (error) => error.statusCode === 403);
  const ownerResolved = createMutationMock({ role: "OWNER", existing: squawk({ status: "RESOLVED" }) });
  await assert.rejects(ownerResolved.repository.addSquawkComment({ userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, body: "No permitido" }), /permiso/);
});

test("OWNER transition graph, metadata and resolution note", async () => {
  const paths = [
    ["OPEN", "SENT_TO_WORKSHOP"], ["OPEN", "RESOLVED"],
    ["SENT_TO_WORKSHOP", "OPEN"], ["SENT_TO_WORKSHOP", "RESOLVED"],
    ["RESOLVED", "OPEN"],
  ];
  for (const [from, to] of paths) {
    const mock = createMutationMock({ existing: squawk({ status: from }) });
    await mock.repository.changeSquawkStatus({
      userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, fromStatus: from, toStatus: to,
      transition: to === "RESOLVED" ? { resolution_note: "Cierre informado por el Owner." }
        : to === "SENT_TO_WORKSHOP" ? { workshop_name: "Taller Norte", workshop_contact: "Contacto" }
          : { transition_note: "Reabierta para seguimiento." },
    });
    assert.equal(mock.state.existing.status, to);
    assert.equal(mock.state.events.length, 1);
    assert.equal(mock.state.audits[0].action, "SQUAWK_STATUS_CHANGED");
    if (to === "SENT_TO_WORKSHOP") {
      const eventInsert = mock.state.events[0];
      assert.equal(eventInsert.to_status, "SENT_TO_WORKSHOP");
      assert.equal(eventInsert.workshop_name, "Taller Norte");
      assert.equal(eventInsert.workshop_contact, "Contacto");
    }
  }
  const missingResolution = createMutationMock();
  await assert.rejects(missingResolution.repository.changeSquawkStatus({ userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, fromStatus: "OPEN", toStatus: "RESOLVED", transition: {} }), /nota de resolucion/);
  const invalid = createMutationMock();
  await assert.rejects(invalid.repository.changeSquawkStatus({ userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, fromStatus: "OPEN", toStatus: "OPEN", transition: {} }), (error) => error.statusCode === 409);
  for (const [fromStatus, toStatus] of [["SENT_TO_WORKSHOP", "SENT_TO_WORKSHOP"], ["RESOLVED", "RESOLVED"], ["RESOLVED", "SENT_TO_WORKSHOP"]]) {
    const rejected = createMutationMock({ existing: squawk({ status: fromStatus }) });
    await assert.rejects(rejected.repository.changeSquawkStatus({ userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, fromStatus, toStatus, transition: {} }), (error) => error.code === "SQUAWK_INVALID_TRANSITION");
  }
});

test("stale/concurrent transition rejects atomically and PILOT cannot transition", async () => {
  const stale = createMutationMock({ existing: squawk({ status: "SENT_TO_WORKSHOP" }) });
  await assert.rejects(stale.repository.changeSquawkStatus({ userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, fromStatus: "OPEN", toStatus: "RESOLVED", transition: { resolution_note: "x" } }), (error) => error.code === "SQUAWK_STALE_STATUS");
  assert.equal(stale.state.events.length, 0);
  assert.equal(stale.state.audits.length, 0);
  const pilot = createMutationMock({ role: "PILOT" });
  await assert.rejects(pilot.repository.changeSquawkStatus({ userId: USER, aircraftId: AIRCRAFT, squawkId: SQUAWK, fromStatus: "OPEN", toStatus: "SENT_TO_WORKSHOP", transition: {} }), (error) => error.statusCode === 403);
});

test("read permissions and timeline composition are canonical", async () => {
  const roots = [{ ...squawk(), reporter_name: "Mateo", reporter_email: "mateo@example.com", flight_date: "2026-09-29", departure_location: "SADP", arrival_location: "SAAR", flight_status: "VOIDED" }];
  const events = [{ squawk_status_event_id: nextUuid(), squawk_id: SQUAWK, from_status: "OPEN", to_status: "SENT_TO_WORKSHOP", changed_at: "2026-09-30T13:00:00Z", occurred_at: "2026-09-30T13:00:00Z", actor_name: "Owner" }];
  const comments = [{ comment_id: nextUuid(), squawk_id: SQUAWK, body: "Comentario", created_at: "2026-09-30T12:30:00Z", actor_name: "Piloto" }];
  const query = async (sql) => {
    const value = String(sql);
    if (value.includes("FROM app.squawks")) return { rows: roots };
    if (value.includes("FROM app.squawk_status_events")) return { rows: events };
    if (value.includes("FROM app.squawk_comments")) return { rows: comments };
    if (value.includes("FROM app.flight_records")) return { rows: [{ flight_id: FLIGHT, status: "VOIDED", flight_date: "2026-09-29" }] };
    throw new Error("Unexpected read query");
  };
  for (const role of ["OWNER", "PILOT", "VIEWER"]) {
    const repository = createPostgresSquawkRepository({ query, getAccess: async () => ({ membership: { role } }) });
    const result = await repository.listSquawks({ userId: USER, aircraftId: AIRCRAFT });
    assert.equal(result.items.length, 1);
    assert.deepEqual(result.items[0].timeline.map((entry) => entry.type), ["CREATED", "COMMENT", "STATUS_CHANGED"]);
    assert.equal(result.capabilities.can_create, role !== "VIEWER");
    assert.equal(result.items[0].permissions.can_change_status, role === "OWNER");
    assert.equal(result.flights[0].status, "VOIDED");
  }
});

test("client payload, search/filter/order and summary preserve canonical values", () => {
  assert.deepEqual(buildSquawkPayload({ ...VALID_INPUT, title: "  Título  ", category: "FUEL" }), { ...VALID_INPUT, title: "Título", category: "FUEL" });
  const items = [
    squawk({ squawk_id: nextUuid(), title: "Luz de cabina", description: "Intermitente", category: "LIGHTING", status: "OPEN", reported_at: "2026-09-29T00:00:00Z" }),
    squawk({ squawk_id: nextUuid(), title: "Indicador", description: "Revisión visual", category: "AVIONICS_INSTRUMENTS", status: "RESOLVED", reported_at: "2026-09-30T00:00:00Z" }),
  ];
  assert.deepEqual(getSquawkSummary(items), { open: 1, workshop: 0, resolved: 1, total: 2 });
  assert.equal(selectSquawks(items, { query: "intermitente" })[0].title, "Luz de cabina");
  assert.equal(selectSquawks(items, { status: "RESOLVED", category: "AVIONICS_INSTRUMENTS" }).length, 1);
  assert.equal(selectSquawks(items, { order: "OLDEST" })[0].title, "Luz de cabina");
});

test("timeline creation is not sourced from Audit", () => {
  const timeline = composeSquawkTimeline({ ...squawk(), reporter_name: "Reporter" }, [], []);
  assert.deepEqual(timeline.map((entry) => entry.type), ["CREATED"]);
});

test("routing keeps reads available with gate off and children append-only", () => {
  const settingsSource = readFileSync(new URL("../api/settings.js", import.meta.url), "utf8");
  const repositorySource = readFileSync(new URL("../api/_postgresSquawkRepository.js", import.meta.url), "utf8");
  const uiSource = readFileSync(new URL("../src/components/SquawksPanel.jsx", import.meta.url), "utf8");
  assert.match(settingsSource, /if \(req\.method === "GET"\)[\s\S]*getSquawksFromPostgres/);
  assert.match(settingsSource, /if \(!capability\.enabled\)[\s\S]*SQUAWK_WRITES_DISABLED/);
  assert.doesNotMatch(repositorySource, /UPDATE app\.squawk_status_events|DELETE FROM app\.squawk_status_events/);
  assert.doesNotMatch(repositorySource, /UPDATE app\.squawk_comments|DELETE FROM app\.squawk_comments/);
  assert.doesNotMatch(repositorySource, /squawk_attachments/);
  assert.match(uiSource, /flight\.status === "VOIDED"/);
  assert.equal(readdirSync(new URL("../api", import.meta.url)).filter((name) => name.endsWith(".js") && !name.startsWith("_")).length, 12);
});
