import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  calculateUtilizationSnapshot,
  createPostgresTrackingRepository,
  deriveTrackingItemState,
} from "../api/_postgresTrackingRepository.js";
import { buildTrackingItemPayload } from "../src/services/trackingService.js";
import { getAllowedMainTabIds } from "../src/utils/rolePermissions.js";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const PILOT_ID = "22222222-2222-4222-8222-222222222222";
const VIEWER_ID = "33333333-3333-4333-8333-333333333333";
const AIRCRAFT_ID = "44444444-4444-4444-8444-444444444444";
const FLIGHT_1 = "55555555-5555-4555-8555-555555555551";
const FLIGHT_2 = "55555555-5555-4555-8555-555555555552";
const NOW = new Date("2026-09-30T15:00:00.000Z");

function uuid(sequence) {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${String(sequence).padStart(12, "0")}`;
}

function clone(value) {
  return structuredClone(value);
}

function legacyItems() {
  return [
    {
      tracking_item_id: uuid(101), aircraft_id: AIRCRAFT_ID,
      concept: "Annual inspection", due_basis: "DATE", recurrence: "RECURRING",
      reference_mode: null, due_date: "2027-09-30", reference_tis_hours: null,
      tracking_start_date: null, tracking_start_after_flight_id: null,
      interval_hours: null, alert_before_value: "60.0", notes: "legacy annual",
      status: "ACTIVE", created_at: NOW, updated_at: NOW,
    },
    {
      tracking_item_id: uuid(102), aircraft_id: AIRCRAFT_ID,
      concept: "50-hour inspection", due_basis: "TIME_IN_SERVICE", recurrence: "RECURRING",
      reference_mode: "ABSOLUTE_TIS", due_date: null, reference_tis_hours: "2659.4",
      tracking_start_date: null, tracking_start_after_flight_id: null,
      interval_hours: "50.0", alert_before_value: "10.0", notes: "legacy 50",
      status: "ACTIVE", created_at: NOW, updated_at: NOW,
    },
    {
      tracking_item_id: uuid(103), aircraft_id: AIRCRAFT_ID,
      concept: "100-hour inspection", due_basis: "TIME_IN_SERVICE", recurrence: "RECURRING",
      reference_mode: "ABSOLUTE_TIS", due_date: null, reference_tis_hours: "2606.2",
      tracking_start_date: null, tracking_start_after_flight_id: null,
      interval_hours: "100.0", alert_before_value: "15.0", notes: "legacy 100",
      status: "ACTIVE", created_at: NOW, updated_at: NOW,
    },
  ];
}

function dateItem(overrides = {}) {
  return {
    concept: "ELT battery",
    due_basis: "DATE",
    recurrence: "ONE_TIME",
    reference_mode: null,
    due_date: "2026-10-30",
    reference_tis_hours: null,
    tracking_start_date: null,
    tracking_start_after_flight_id: null,
    interval_hours: null,
    alert_before_value: 10,
    notes: "Owner reminder",
    status: "ACTIVE",
    ...overrides,
  };
}

function createMockRepository(overrides = {}) {
  const state = {
    memberships: [
      { user_id: OWNER_ID, aircraft_id: AIRCRAFT_ID, role: "OWNER", status: "ACTIVE" },
      { user_id: PILOT_ID, aircraft_id: AIRCRAFT_ID, role: "PILOT", status: "ACTIVE" },
      { user_id: VIEWER_ID, aircraft_id: AIRCRAFT_ID, role: "VIEWER", status: "ACTIVE" },
    ],
    baseline: {
      baseline_tis_hours: "1000.0",
      baseline_effective_date: "2026-09-01",
      first_tracked_flight_id: FLIGHT_1,
    },
    flights: [
      { flight_id: FLIGHT_1, flight_date: "2026-09-29", time_in_service_hours: "5.0", flight_created_at: "2026-09-29T10:00:00Z" },
      { flight_id: FLIGHT_2, flight_date: "2026-09-30", time_in_service_hours: "2.0", flight_created_at: "2026-09-30T10:00:00Z" },
    ],
    adjustments: [{ adjustment_hours: "1.0", effective_date: "2026-09-15", after_flight_id: null }],
    items: legacyItems(),
    events: [],
    audits: [],
    failAudit: false,
    ...overrides,
  };
  const queries = [];
  let sequence = 1;
  let transactionOptions;

  const accessFor = (userId) => {
    const membership = state.memberships.find((entry) => (
      entry.user_id === userId
      && entry.aircraft_id === AIRCRAFT_ID
      && entry.status === "ACTIVE"
    ));
    if (!membership) {
      const error = new Error("Sin acceso");
      error.statusCode = 403;
      throw error;
    }
    return {
      user: { user_id: userId, status: "ACTIVE" },
      aircraft: { aircraft_id: AIRCRAFT_ID, registration: "LV-TST", status: "ACTIVE" },
      membership,
    };
  };

  async function query(text, params = []) {
    queries.push({ text, params });

    if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
    if (text.includes("FROM app.users user_account") && text.includes("FOR UPDATE OF membership")) {
      const membership = state.memberships.find((entry) => (
        entry.user_id === params[0]
        && entry.aircraft_id === params[1]
        && entry.status === "ACTIVE"
        && entry.role === "OWNER"
      ));
      return { rows: membership ? [{ membership_id: uuid(90), role: "OWNER" }] : [] };
    }
    if (text.includes("FROM app.aircraft_utilization_baselines")) {
      return { rows: state.baseline ? [state.baseline] : [] };
    }
    if (text.includes("FROM app.flight_records flight")) {
      return { rows: clone(state.flights) };
    }
    if (text.includes("FROM app.utilization_adjustments")) {
      return { rows: clone(state.adjustments) };
    }
    if (text.includes("FROM app.tracking_item_events")) {
      const ids = new Set((params[0] || []).map(String));
      return { rows: clone(state.events.filter((event) => ids.has(String(event.tracking_item_id)))) };
    }
    if (text.includes("FROM app.tracking_items") && text.includes("FOR UPDATE")) {
      return {
        rows: clone(state.items.filter((item) => (
          item.aircraft_id === params[0] && item.tracking_item_id === params[1]
        ))),
      };
    }
    if (text.includes("FROM app.tracking_items")) {
      const status = params[1];
      return {
        rows: clone(state.items.filter((item) => (
          item.aircraft_id === params[0] && (!status || item.status === status)
        ))),
      };
    }
    if (text.includes("INSERT INTO app.tracking_items")) {
      state.items.push({
        tracking_item_id: params[0], aircraft_id: params[1], concept: params[2],
        due_basis: params[3], recurrence: params[4], reference_mode: params[5],
        due_date: params[6], reference_tis_hours: params[7], tracking_start_date: params[8],
        tracking_start_after_flight_id: params[9], interval_hours: params[10],
        alert_before_value: params[11], notes: params[12], status: "ACTIVE",
        created_at: NOW, updated_at: NOW,
      });
      return { rows: [] };
    }
    if (text.includes("UPDATE app.tracking_items")) {
      const item = state.items.find((entry) => entry.tracking_item_id === params[0]);
      if (text.includes("status = 'ARCHIVED'")) item.status = "ARCHIVED";
      else if (text.includes("SET due_date")) item.due_date = params[1];
      else if (text.includes("SET reference_tis_hours")) item.reference_tis_hours = params[1];
      else if (text.includes("SET tracking_start_date")) {
        item.tracking_start_date = params[1];
        item.tracking_start_after_flight_id = params[2];
      } else {
        Object.assign(item, {
          concept: params[1], due_basis: params[2], recurrence: params[3],
          reference_mode: params[4], due_date: params[5], reference_tis_hours: params[6],
          tracking_start_date: params[7], tracking_start_after_flight_id: params[8],
          interval_hours: params[9], alert_before_value: params[10], notes: params[11],
        });
      }
      return { rows: [] };
    }
    if (text.includes("INSERT INTO app.tracking_item_events")) {
      state.events.push({
        tracking_event_id: params[0], tracking_item_id: params[1], event_type: "COMPLETED",
        completed_at: NOW, completed_by_user_id: params[2], completed_at_tis: params[3],
        completed_after_flight_id: params[4], note: params[5],
        cycle_snapshot: JSON.parse(params[6]), next_due_date: params[7],
      });
      return { rows: [] };
    }
    if (text.includes("INSERT INTO audit.audit_events")) {
      if (state.failAudit) throw new Error("audit unavailable");
      state.audits.push({
        actor_user_id: params[2], aircraft_id: params[3], tracking_item_id: params[4],
        action_code: params[6], before_state: params[7] ? JSON.parse(params[7]) : null,
        after_state: params[8] ? JSON.parse(params[8]) : null,
      });
      return { rows: [] };
    }
    return { rows: [] };
  }

  const repository = createPostgresTrackingRepository({
    query,
    getAccess: async (userId, aircraftId) => {
      assert.equal(aircraftId, AIRCRAFT_ID);
      return accessFor(userId);
    },
    transaction: async (work, options) => {
      transactionOptions = options;
      const snapshot = clone(state);
      try {
        return await work({ query });
      } catch (error) {
        Object.keys(state).forEach((key) => { state[key] = snapshot[key]; });
        throw error;
      }
    },
    randomUUID: () => uuid(sequence++),
    now: () => NOW,
  });

  return { repository, state, queries, getTransactionOptions: () => transactionOptions };
}

test("DATE deriva normal, due-soon, due y overdue sin persistir estado", () => {
  const utilization = { currentTisHours: 100, flights: [] };
  assert.equal(deriveTrackingItemState(dateItem({ due_date: "2026-10-30" }), utilization, "2026-09-30").due_state, "OK");
  assert.equal(deriveTrackingItemState(dateItem({ due_date: "2026-10-05" }), utilization, "2026-09-30").due_state, "DUE_SOON");
  assert.equal(deriveTrackingItemState(dateItem({ due_date: "2026-09-30" }), utilization, "2026-09-30").due_state, "DUE");
  assert.equal(deriveTrackingItemState(dateItem({ due_date: "2026-09-29" }), utilization, "2026-09-30").due_state, "OVERDUE");
});

test("ABSOLUTE_TIS y TRACKED_FROM_NOW derivan remaining desde TIS canonical", () => {
  const flights = [
    { flight_id: FLIGHT_1, flight_date: "2026-09-29", time_in_service_hours: "3.0" },
    { flight_id: FLIGHT_2, flight_date: "2026-09-30", time_in_service_hours: "2.0" },
  ];
  const absolute = deriveTrackingItemState({
    ...dateItem(), due_basis: "TIME_IN_SERVICE", due_date: null,
    reference_mode: "ABSOLUTE_TIS", reference_tis_hours: 100,
    interval_hours: 10, alert_before_value: 3,
  }, { currentTisHours: 108, flights }, "2026-09-30");
  assert.equal(absolute.remaining_value, 2);
  assert.equal(absolute.due_state, "DUE_SOON");

  const tracked = deriveTrackingItemState({
    ...dateItem(), due_basis: "TIME_IN_SERVICE", due_date: null,
    reference_mode: "TRACKED_FROM_NOW", tracking_start_date: "2026-09-29",
    tracking_start_after_flight_id: FLIGHT_1, interval_hours: 5, alert_before_value: 1,
  }, { currentTisHours: null, flights }, "2026-09-30");
  assert.equal(tracked.elapsed_hours, 2);
  assert.equal(tracked.remaining_value, 3);
  assert.equal(tracked.due_state, "OK");
});

test("TIS absoluto conserva NULL si el baseline es desconocido", () => {
  const snapshot = calculateUtilizationSnapshot({
    baseline: { baseline_tis_hours: null, baseline_effective_date: "2026-01-01" },
    flights: [{ flight_id: FLIGHT_1, flight_date: "2026-09-29", time_in_service_hours: 9 }],
    adjustments: [],
  });
  assert.equal(snapshot.currentTisHours, null);
});

test("OWNER, PILOT y VIEWER activos leen; solo OWNER obtiene capacidad de mutacion", async () => {
  const mock = createMockRepository();
  assert.equal((await mock.repository.listTrackingItems({ userId: OWNER_ID, aircraftId: AIRCRAFT_ID, status: "ALL" })).canManage, true);
  assert.equal((await mock.repository.listTrackingItems({ userId: PILOT_ID, aircraftId: AIRCRAFT_ID, status: "ACTIVE" })).canManage, false);
  assert.equal((await mock.repository.listTrackingItems({ userId: VIEWER_ID, aircraftId: AIRCRAFT_ID, status: "ARCHIVED" })).canManage, false);

  await assert.rejects(
    mock.repository.createTrackingItem({ userId: PILOT_ID, aircraftId: AIRCRAFT_ID, item: dateItem() }),
    (error) => error.code === "TRACKING_ACCESS_DENIED" && error.statusCode === 403
  );
  assert.equal(mock.state.items.length, 3);
  assert.equal(mock.state.audits.length, 0);
});

test("crear reminder no recrea ni altera los tres conceptos legacy de Settings", async () => {
  const mock = createMockRepository();
  const beforeLegacy = clone(mock.state.items);
  await mock.repository.createTrackingItem({
    userId: OWNER_ID,
    aircraftId: AIRCRAFT_ID,
    item: dateItem(),
  });
  assert.equal(mock.state.items.length, 4);
  assert.deepEqual(mock.state.items.slice(0, 3), beforeLegacy);
  assert.equal(mock.state.audits[0].action_code, "TRACKING_ITEM_CREATED");
  assert.deepEqual(mock.getTransactionOptions(), { isolationLevel: "SERIALIZABLE" });
});

test("reminders legacy conservan identidad para que Settings apunte a las mismas filas", async () => {
  const mock = createMockRepository();
  const annualId = mock.state.items[0].tracking_item_id;
  await mock.repository.updateTrackingItem({
    userId: OWNER_ID,
    aircraftId: AIRCRAFT_ID,
    trackingItemId: annualId,
    item: {
      concept: "Annual inspection",
      due_basis: "DATE",
      recurrence: "RECURRING",
      due_date: "2028-09-30",
      alert_before_value: 45,
      notes: "legacy annual",
    },
  });
  assert.equal(mock.state.items[0].tracking_item_id, annualId);
  assert.equal(mock.state.items[0].due_date, "2028-09-30");
  assert.equal(mock.state.items[0].alert_before_value, 45);

  await assert.rejects(
    mock.repository.archiveTrackingItem({
      userId: OWNER_ID,
      aircraftId: AIRCRAFT_ID,
      trackingItemId: annualId,
    }),
    (error) => error.code === "TRACKING_LEGACY_SETTINGS_CONFLICT" && error.statusCode === 409
  );
  assert.equal(mock.state.items[0].status, "ACTIVE");
});

test("TRACKED_FROM_NOW toma fecha actual y boundary del ultimo vuelo del dia", async () => {
  const mock = createMockRepository();
  await mock.repository.createTrackingItem({
    userId: OWNER_ID,
    aircraftId: AIRCRAFT_ID,
    item: {
      concept: "Vacuum pump",
      due_basis: "TIME_IN_SERVICE",
      recurrence: "RECURRING",
      reference_mode: "TRACKED_FROM_NOW",
      interval_hours: 25,
      alert_before_value: 5,
    },
  });
  const created = mock.state.items.at(-1);
  assert.equal(created.tracking_start_date, "2026-09-30");
  assert.equal(created.tracking_start_after_flight_id, FLIGHT_2);
  assert.equal(created.reference_tis_hours, null);
});

test("editar y archivar requieren la misma aeronave y escriben Audit", async () => {
  const item = {
    ...dateItem(), tracking_item_id: uuid(200), aircraft_id: AIRCRAFT_ID,
  };
  const mock = createMockRepository({ items: [item] });
  await mock.repository.updateTrackingItem({
    userId: OWNER_ID,
    aircraftId: AIRCRAFT_ID,
    trackingItemId: item.tracking_item_id,
    item: { ...dateItem(), concept: "ELT battery updated", alert_before_value: 12 },
  });
  assert.equal(mock.state.items[0].concept, "ELT battery updated");
  assert.equal(mock.state.audits[0].action_code, "TRACKING_ITEM_UPDATED");

  await mock.repository.archiveTrackingItem({
    userId: OWNER_ID,
    aircraftId: AIRCRAFT_ID,
    trackingItemId: item.tracking_item_id,
  });
  assert.equal(mock.state.items[0].status, "ARCHIVED");
  assert.equal(mock.state.audits[1].action_code, "TRACKING_ITEM_ARCHIVED");

  mock.state.items[0].aircraft_id = uuid(999);
  await assert.rejects(
    mock.repository.updateTrackingItem({
      userId: OWNER_ID,
      aircraftId: AIRCRAFT_ID,
      trackingItemId: item.tracking_item_id,
      item: dateItem(),
    }),
    (error) => error.code === "TRACKING_ITEM_NOT_FOUND" && error.statusCode === 404
  );
});

test("ONE_TIME completion inserta evento inmutable, archiva y audita atomicamente", async () => {
  const item = { ...dateItem(), tracking_item_id: uuid(201), aircraft_id: AIRCRAFT_ID };
  const mock = createMockRepository({ items: [item] });
  await mock.repository.completeTrackingItem({
    userId: OWNER_ID,
    aircraftId: AIRCRAFT_ID,
    trackingItemId: item.tracking_item_id,
    note: "Atendido por el propietario",
  });
  assert.equal(mock.state.items[0].status, "ARCHIVED");
  assert.equal(mock.state.events.length, 1);
  assert.equal(mock.state.events[0].cycle_snapshot.due_date, "2026-10-30");
  assert.equal(mock.state.audits[0].action_code, "TRACKING_ITEM_COMPLETED");
  const sql = mock.queries.map(({ text }) => text).join("\n");
  assert.doesNotMatch(sql, /UPDATE app\.tracking_item_events|DELETE FROM app\.tracking_item_events/i);
});

test("RECURRING DATE exige y registra next_due_date", async () => {
  const item = {
    ...dateItem({ recurrence: "RECURRING" }),
    tracking_item_id: uuid(202), aircraft_id: AIRCRAFT_ID,
  };
  const mock = createMockRepository({ items: [item] });
  await mock.repository.completeTrackingItem({
    userId: OWNER_ID,
    aircraftId: AIRCRAFT_ID,
    trackingItemId: item.tracking_item_id,
    nextDueDate: "2027-10-30",
  });
  assert.equal(mock.state.items[0].due_date, "2027-10-30");
  assert.equal(mock.state.items[0].status, "ACTIVE");
  assert.equal(mock.state.events[0].next_due_date, "2027-10-30");
});

test("RECURRING ABSOLUTE_TIS reinicia referencia en TIS actual", async () => {
  const item = {
    ...dateItem(), tracking_item_id: uuid(203), aircraft_id: AIRCRAFT_ID,
    due_basis: "TIME_IN_SERVICE", recurrence: "RECURRING", due_date: null,
    reference_mode: "ABSOLUTE_TIS", reference_tis_hours: "990.0",
    interval_hours: "50.0", alert_before_value: "10.0",
  };
  const mock = createMockRepository({ items: [item] });
  await mock.repository.completeTrackingItem({
    userId: OWNER_ID,
    aircraftId: AIRCRAFT_ID,
    trackingItemId: item.tracking_item_id,
  });
  assert.equal(mock.state.items[0].reference_tis_hours, 1008);
  assert.equal(mock.state.events[0].completed_at_tis, 1008);
});

test("RECURRING TRACKED_FROM_NOW avanza boundary sin editar eventos previos", async () => {
  const item = {
    ...dateItem(), tracking_item_id: uuid(204), aircraft_id: AIRCRAFT_ID,
    due_basis: "TIME_IN_SERVICE", recurrence: "RECURRING", due_date: null,
    reference_mode: "TRACKED_FROM_NOW", reference_tis_hours: null,
    tracking_start_date: "2026-09-01", tracking_start_after_flight_id: null,
    interval_hours: "10.0", alert_before_value: "2.0",
  };
  const oldEvent = {
    tracking_event_id: uuid(300), tracking_item_id: item.tracking_item_id,
    event_type: "COMPLETED", completed_at: "2026-09-01T00:00:00Z",
    completed_at_tis: null, completed_after_flight_id: null, note: "old",
    cycle_snapshot: { concept: "old" }, next_due_date: null,
  };
  const mock = createMockRepository({ items: [item], events: [oldEvent] });
  await mock.repository.completeTrackingItem({
    userId: OWNER_ID,
    aircraftId: AIRCRAFT_ID,
    trackingItemId: item.tracking_item_id,
  });
  assert.equal(mock.state.items[0].tracking_start_date, "2026-09-30");
  assert.equal(mock.state.items[0].tracking_start_after_flight_id, FLIGHT_2);
  assert.deepEqual(mock.state.events[0], oldEvent);
  assert.equal(mock.state.events.length, 2);
});

test("fallo de Audit revierte item y evento", async () => {
  const item = { ...dateItem(), tracking_item_id: uuid(205), aircraft_id: AIRCRAFT_ID };
  const mock = createMockRepository({ items: [item], failAudit: true });
  await assert.rejects(mock.repository.completeTrackingItem({
    userId: OWNER_ID,
    aircraftId: AIRCRAFT_ID,
    trackingItemId: item.tracking_item_id,
  }), /audit unavailable/);
  assert.equal(mock.state.items[0].status, "ACTIVE");
  assert.equal(mock.state.events.length, 0);
});

test("payload UI no envia estado derivado ni identidad del usuario", () => {
  const payload = buildTrackingItemPayload({
    ...dateItem(),
    remaining_value: 10,
    due_state: "DUE_SOON",
    user_id: OWNER_ID,
  });
  assert.equal(payload.concept, "ELT battery");
  assert.equal(Object.hasOwn(payload, "remaining_value"), false);
  assert.equal(Object.hasOwn(payload, "due_state"), false);
  assert.equal(Object.hasOwn(payload, "user_id"), false);
});

test("Seguimiento se agrega solo para aeronaves Postgres y mantiene permisos de lectura", () => {
  assert.equal(getAllowedMainTabIds({ isAdmin: false, aircraftRole: "OWNER", trackingAvailable: false }).includes("seguimiento"), false);
  assert.equal(getAllowedMainTabIds({ isAdmin: false, aircraftRole: "OWNER", trackingAvailable: true }).includes("seguimiento"), true);
  assert.equal(getAllowedMainTabIds({ isAdmin: false, aircraftRole: "PILOT", trackingAvailable: true }).includes("seguimiento"), true);
  assert.equal(getAllowedMainTabIds({ isAdmin: false, aircraftRole: "VIEWER", trackingAvailable: true }).includes("seguimiento"), true);
});

test("contrato no agrega migration ni funcion serverless y Settings legacy conserva sus filas", async () => {
  const [settingsRepository, trackingRepository] = await Promise.all([
    fs.readFile(new URL("../api/_postgresSettingsRepository.js", import.meta.url), "utf8"),
    fs.readFile(new URL("../api/_postgresTrackingRepository.js", import.meta.url), "utf8"),
  ]);
  assert.match(settingsRepository, /Annual inspection/);
  assert.match(settingsRepository, /50-hour inspection/);
  assert.match(settingsRepository, /100-hour inspection/);
  assert.doesNotMatch(trackingRepository, /Annual inspection|50-hour inspection|100-hour inspection/);
  const apiFiles = (await fs.readdir(new URL("../api/", import.meta.url)))
    .filter((name) => name.endsWith(".js") && !name.startsWith("_"));
  assert.equal(apiFiles.length <= 12, true);
});
