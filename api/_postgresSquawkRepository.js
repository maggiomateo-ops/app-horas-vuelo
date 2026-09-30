import crypto from "node:crypto";

import { postgresQuery, withPostgresTransaction } from "./_postgres.js";
import { getValidatedAircraftAccessFromPostgres } from "./_postgresAircraftRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SQUAWK_CATEGORIES = Object.freeze([
  "POWERPLANT", "ELECTRICAL", "AVIONICS_INSTRUMENTS", "FUEL",
  "FLIGHT_CONTROLS", "LANDING_GEAR_BRAKES", "LIGHTING", "STRUCTURE",
  "CABIN_INTERIOR", "OTHER",
]);
const CATEGORY_SET = new Set(SQUAWK_CATEGORIES);
const STATUS_SET = new Set(["OPEN", "SENT_TO_WORKSHOP", "RESOLVED"]);
const TRANSITIONS = Object.freeze({
  OPEN: new Set(["SENT_TO_WORKSHOP", "RESOLVED"]),
  SENT_TO_WORKSHOP: new Set(["OPEN", "RESOLVED"]),
  RESOLVED: new Set(["OPEN"]),
});

function repositoryError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function uuid(value, label) {
  const normalized = String(value || "").trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw repositoryError(`${label} no es valido.`, "SQUAWK_VALIDATION_ERROR", 400);
  }
  return normalized;
}

function text(value, label, max, required = false) {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) {
    throw repositoryError(`Falta ${label}.`, "SQUAWK_VALIDATION_ERROR", 400);
  }
  if (normalized.length > max) {
    throw repositoryError(`${label} es demasiado largo.`, "SQUAWK_VALIDATION_ERROR", 400);
  }
  return normalized || null;
}

function timestamp(value, label) {
  const normalized = String(value || "").trim();
  const parsed = new Date(normalized);
  if (!normalized || !Number.isFinite(parsed.getTime())) {
    throw repositoryError(`${label} no es valido.`, "SQUAWK_VALIDATION_ERROR", 400);
  }
  return parsed.toISOString();
}

function category(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized) return null;
  if (!CATEGORY_SET.has(normalized)) {
    throw repositoryError("La categoria no es valida.", "SQUAWK_VALIDATION_ERROR", 400);
  }
  return normalized;
}

function status(value, label = "estado") {
  const normalized = String(value || "").trim().toUpperCase();
  if (!STATUS_SET.has(normalized)) {
    throw repositoryError(`${label} no es valido.`, "SQUAWK_VALIDATION_ERROR", 400);
  }
  return normalized;
}

function coreInput(input = {}) {
  return {
    reported_at: timestamp(input.reported_at, "reported_at"),
    title: text(input.title, "titulo", 200, true),
    description: text(input.description, "descripcion", 5000, true),
    category: category(input.category),
    flight_id: input.flight_id ? uuid(input.flight_id, "flight_id") : null,
  };
}

function roleOf(access) {
  return String(access?.membership?.role || "").trim().toUpperCase();
}

function canCreate(role) {
  return role === "OWNER" || role === "PILOT";
}

async function lockMembership(client, userId, aircraftId) {
  const { rows } = await client.query(
    `SELECT membership.role
       FROM app.users actor
       JOIN app.aircraft_memberships membership ON membership.user_id = actor.user_id
       JOIN app.aircraft aircraft ON aircraft.aircraft_id = membership.aircraft_id
      WHERE actor.user_id = $1::uuid AND membership.aircraft_id = $2::uuid
        AND actor.status = 'ACTIVE' AND membership.status = 'ACTIVE'
        AND aircraft.status = 'ACTIVE'
      FOR UPDATE OF membership`,
    [userId, aircraftId]
  );
  if (rows.length !== 1) {
    throw repositoryError("No tenes acceso activo a la aeronave.", "SQUAWK_ACCESS_DENIED", 403);
  }
  return String(rows[0].role || "").toUpperCase();
}

async function assertFlight(client, aircraftId, flightId) {
  if (!flightId) return;
  const { rows } = await client.query(
    `SELECT flight_id FROM app.flight_records
      WHERE flight_id = $1::uuid AND aircraft_id = $2::uuid`,
    [flightId, aircraftId]
  );
  if (rows.length !== 1) {
    throw repositoryError(
      "El vuelo relacionado no pertenece a esta aeronave.",
      "SQUAWK_FLIGHT_MISMATCH",
      422
    );
  }
}

async function lockSquawk(client, aircraftId, squawkId) {
  const { rows } = await client.query(
    `SELECT squawk_id, aircraft_id, reported_at, created_by_user_id, title,
            description, category, flight_id, status, created_at, updated_at
       FROM app.squawks
      WHERE squawk_id = $1::uuid AND aircraft_id = $2::uuid
      FOR UPDATE`,
    [squawkId, aircraftId]
  );
  if (rows.length !== 1) {
    throw repositoryError("La novedad no existe.", "SQUAWK_NOT_FOUND", 404);
  }
  return rows[0];
}

async function audit(client, randomUUID, {
  userId, aircraftId, squawkId, actionCode, beforeState, afterState, metadata = {},
}) {
  await client.query(
    `INSERT INTO audit.audit_events (
       audit_event_id, request_id, actor_type, actor_user_id, operation_source,
       aircraft_id, entity_type, entity_id, entity_key, action_code,
       before_state, after_state, metadata, payload_version
     ) VALUES ($1::uuid, $2::uuid, 'USER', $3::uuid, 'MANUAL', $4::uuid,
       'SQUAWK', $5::uuid, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10::jsonb, 1)`,
    [randomUUID(), randomUUID(), userId, aircraftId, squawkId,
      JSON.stringify({ aircraft_id: aircraftId, squawk_id: squawkId }), actionCode,
      beforeState ? JSON.stringify(beforeState) : null,
      afterState ? JSON.stringify(afterState) : null,
      JSON.stringify({ contract: "OWNER_SQUAWKS_V1", ...metadata })]
  );
}

function actorName(row, prefix) {
  return String(row[`${prefix}_name`] || row[`${prefix}_email`] || "Usuario");
}

export function composeSquawkTimeline(squawk, events = [], comments = []) {
  return [
    { timeline_id: `created:${squawk.squawk_id}`, type: "CREATED", occurred_at: squawk.created_at,
      actor_name: squawk.reporter_name, body: null, from_status: null, to_status: "OPEN" },
    ...events.map((event) => ({ ...event, timeline_id: `status:${event.squawk_status_event_id}`, type: "STATUS_CHANGED" })),
    ...comments.map((comment) => ({ ...comment, timeline_id: `comment:${comment.comment_id}`, type: "COMMENT", occurred_at: comment.created_at })),
  ].sort((left, right) => new Date(left.occurred_at) - new Date(right.occurred_at));
}

export function createPostgresSquawkRepository({
  query = postgresQuery,
  transaction = withPostgresTransaction,
  getAccess = getValidatedAircraftAccessFromPostgres,
  randomUUID = crypto.randomUUID,
} = {}) {
  async function listSquawks({ userId, aircraftId }) {
    const actorUserId = uuid(userId, "userId");
    const selectedAircraftId = uuid(aircraftId, "aircraftId");
    const access = await getAccess(actorUserId, selectedAircraftId);
    const role = roleOf(access);
    const { rows: roots } = await query(
      `SELECT s.*, COALESCE(person.full_name, creator.email) AS reporter_name,
              revision.flight_date, revision.departure_location, revision.arrival_location,
              flight.status AS flight_status
         FROM app.squawks s
         JOIN app.users creator ON creator.user_id = s.created_by_user_id
         LEFT JOIN app.user_person_links link ON link.user_id = creator.user_id
         LEFT JOIN app.persons person ON person.person_id = link.person_id
         LEFT JOIN app.flight_records flight ON flight.flight_id = s.flight_id
         LEFT JOIN app.flight_record_revisions revision
           ON revision.flight_revision_id = flight.current_revision_id
        WHERE s.aircraft_id = $1::uuid
        ORDER BY s.reported_at DESC, s.squawk_id`,
      [selectedAircraftId]
    );
    const ids = roots.map((row) => row.squawk_id);
    const { rows: eventRows } = ids.length ? await query(
      `SELECT event.*, COALESCE(person.full_name, actor.email) AS actor_name,
              event.changed_at AS occurred_at
         FROM app.squawk_status_events event
         JOIN app.users actor ON actor.user_id = event.changed_by_user_id
         LEFT JOIN app.user_person_links link ON link.user_id = actor.user_id
         LEFT JOIN app.persons person ON person.person_id = link.person_id
        WHERE event.squawk_id = ANY($1::uuid[])
        ORDER BY event.changed_at, event.squawk_status_event_id`, [ids]
    ) : { rows: [] };
    const { rows: commentRows } = ids.length ? await query(
      `SELECT comment.*, COALESCE(person.full_name, actor.email) AS actor_name
         FROM app.squawk_comments comment
         JOIN app.users actor ON actor.user_id = comment.actor_user_id
         LEFT JOIN app.user_person_links link ON link.user_id = actor.user_id
         LEFT JOIN app.persons person ON person.person_id = link.person_id
        WHERE comment.squawk_id = ANY($1::uuid[])
        ORDER BY comment.created_at, comment.comment_id`, [ids]
    ) : { rows: [] };
    const { rows: flights } = await query(
      `SELECT flight.flight_id, flight.status, revision.flight_date,
              revision.departure_location, revision.arrival_location
         FROM app.flight_records flight
         JOIN app.flight_record_revisions revision
           ON revision.flight_revision_id = flight.current_revision_id
        WHERE flight.aircraft_id = $1::uuid
        ORDER BY revision.flight_date DESC, flight.flight_id`, [selectedAircraftId]
    );
    const items = roots.map((row) => {
      const own = String(row.created_by_user_id) === actorUserId;
      const canEdit = row.status === "OPEN" && (role === "OWNER" || (role === "PILOT" && own));
      const canComment = role === "OWNER"
        ? row.status !== "RESOLVED"
        : role === "PILOT" && own && row.status === "OPEN";
      const events = eventRows.filter((event) => String(event.squawk_id) === String(row.squawk_id));
      const comments = commentRows.filter((comment) => String(comment.squawk_id) === String(row.squawk_id));
      return {
        ...row,
        reporter_name: actorName(row, "reporter"),
        permissions: { can_edit: canEdit, can_comment: canComment, can_change_status: role === "OWNER" },
        timeline: composeSquawkTimeline({ ...row, reporter_name: actorName(row, "reporter") }, events, comments),
      };
    });
    return {
      role,
      capabilities: { can_create: canCreate(role), can_change_status: role === "OWNER" },
      items,
      flights,
    };
  }

  async function mutate(userId, aircraftId, work) {
    const actorUserId = uuid(userId, "userId");
    const selectedAircraftId = uuid(aircraftId, "aircraftId");
    return transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`app-horas:squawk:${selectedAircraftId}`]);
      const role = await lockMembership(client, actorUserId, selectedAircraftId);
      return work(client, { actorUserId, selectedAircraftId, role });
    }, { isolationLevel: "SERIALIZABLE" });
  }

  async function createSquawk({ userId, aircraftId, squawk }) {
    const input = coreInput(squawk);
    return mutate(userId, aircraftId, async (client, context) => {
      if (!canCreate(context.role)) throw repositoryError("No tenes permiso para reportar novedades.", "SQUAWK_ACCESS_DENIED", 403);
      await assertFlight(client, context.selectedAircraftId, input.flight_id);
      const squawkId = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO app.squawks (squawk_id, aircraft_id, reported_at, created_by_user_id,
          title, description, category, flight_id, status, updated_at)
         VALUES ($1::uuid,$2::uuid,$3::timestamptz,$4::uuid,$5,$6,$7,$8::uuid,'OPEN',now()) RETURNING *`,
        [squawkId, context.selectedAircraftId, input.reported_at, context.actorUserId,
          input.title, input.description, input.category, input.flight_id]
      );
      await audit(client, randomUUID, { userId: context.actorUserId, aircraftId: context.selectedAircraftId,
        squawkId, actionCode: "SQUAWK_CREATED", beforeState: null, afterState: rows[0] });
      return rows[0];
    });
  }

  async function updateSquawk({ userId, aircraftId, squawkId, squawk }) {
    const normalizedSquawkId = uuid(squawkId, "squawk_id");
    const input = coreInput(squawk);
    return mutate(userId, aircraftId, async (client, context) => {
      const existing = await lockSquawk(client, context.selectedAircraftId, normalizedSquawkId);
      const ownPilot = context.role === "PILOT" && String(existing.created_by_user_id) === context.actorUserId;
      if (existing.status !== "OPEN" || (context.role !== "OWNER" && !ownPilot)) {
        throw repositoryError("La novedad no puede editarse en su estado actual.", "SQUAWK_EDIT_DENIED", 403);
      }
      await assertFlight(client, context.selectedAircraftId, input.flight_id);
      const { rows } = await client.query(
        `UPDATE app.squawks SET reported_at=$3::timestamptz,title=$4,description=$5,
          category=$6,flight_id=$7::uuid,updated_at=now()
         WHERE squawk_id=$1::uuid AND aircraft_id=$2::uuid RETURNING *`,
        [normalizedSquawkId, context.selectedAircraftId, input.reported_at, input.title,
          input.description, input.category, input.flight_id]
      );
      await audit(client, randomUUID, { userId: context.actorUserId, aircraftId: context.selectedAircraftId,
        squawkId: normalizedSquawkId, actionCode: "SQUAWK_UPDATED", beforeState: existing, afterState: rows[0] });
      return rows[0];
    });
  }

  async function addSquawkComment({ userId, aircraftId, squawkId, body }) {
    const normalizedSquawkId = uuid(squawkId, "squawk_id");
    const normalizedBody = text(body, "comentario", 4000, true);
    return mutate(userId, aircraftId, async (client, context) => {
      const existing = await lockSquawk(client, context.selectedAircraftId, normalizedSquawkId);
      const allowed = context.role === "OWNER"
        ? existing.status !== "RESOLVED"
        : context.role === "PILOT" && existing.status === "OPEN"
          && String(existing.created_by_user_id) === context.actorUserId;
      if (!allowed) throw repositoryError("No tenes permiso para comentar esta novedad.", "SQUAWK_COMMENT_DENIED", 403);
      const commentId = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO app.squawk_comments (comment_id,squawk_id,body,actor_user_id)
         VALUES ($1::uuid,$2::uuid,$3,$4::uuid) RETURNING *`,
        [commentId, normalizedSquawkId, normalizedBody, context.actorUserId]
      );
      await audit(client, randomUUID, { userId: context.actorUserId, aircraftId: context.selectedAircraftId,
        squawkId: normalizedSquawkId, actionCode: "SQUAWK_COMMENTED", beforeState: null,
        afterState: { comment_id: commentId }, metadata: { comment_id: commentId } });
      return rows[0];
    });
  }

  async function changeSquawkStatus({ userId, aircraftId, squawkId, fromStatus, toStatus, transition = {} }) {
    const normalizedSquawkId = uuid(squawkId, "squawk_id");
    const expected = status(fromStatus, "from_status");
    const next = status(toStatus, "to_status");
    return mutate(userId, aircraftId, async (client, context) => {
      if (context.role !== "OWNER") throw repositoryError("Solo el Owner puede cambiar el estado.", "SQUAWK_ACCESS_DENIED", 403);
      const existing = await lockSquawk(client, context.selectedAircraftId, normalizedSquawkId);
      if (existing.status !== expected) throw repositoryError("La novedad cambio de estado. Recarga antes de continuar.", "SQUAWK_STALE_STATUS", 409);
      if (expected === next || !TRANSITIONS[expected]?.has(next)) {
        throw repositoryError("La transicion de estado no es valida.", "SQUAWK_INVALID_TRANSITION", 409);
      }
      const resolutionNote = text(transition.resolution_note, "nota de resolucion", 4000, next === "RESOLVED");
      const eventId = randomUUID();
      const metadata = {
        transition_note: text(transition.transition_note, "nota de transicion", 4000),
        workshop_name: next === "SENT_TO_WORKSHOP" ? text(transition.workshop_name, "taller", 240) : null,
        workshop_contact: next === "SENT_TO_WORKSHOP" ? text(transition.workshop_contact, "contacto", 500) : null,
        resolution_note: resolutionNote,
      };
      await client.query(
        `INSERT INTO app.squawk_status_events (squawk_status_event_id,squawk_id,from_status,to_status,
          changed_by_user_id,transition_note,workshop_name,workshop_contact,resolution_note)
         VALUES ($1::uuid,$2::uuid,$3,$4,$5::uuid,$6,$7,$8,$9)`,
        [eventId, normalizedSquawkId, expected, next, context.actorUserId,
          metadata.transition_note, metadata.workshop_name, metadata.workshop_contact, metadata.resolution_note]
      );
      const { rows } = await client.query(
        `UPDATE app.squawks SET status=$3,updated_at=now()
          WHERE squawk_id=$1::uuid AND aircraft_id=$2::uuid AND status=$4 RETURNING *`,
        [normalizedSquawkId, context.selectedAircraftId, next, expected]
      );
      if (rows.length !== 1) throw repositoryError("La novedad cambio de estado. Recarga antes de continuar.", "SQUAWK_STALE_STATUS", 409);
      await audit(client, randomUUID, { userId: context.actorUserId, aircraftId: context.selectedAircraftId,
        squawkId: normalizedSquawkId, actionCode: "SQUAWK_STATUS_CHANGED",
        beforeState: { status: expected }, afterState: { status: next, ...metadata },
        metadata: { squawk_status_event_id: eventId } });
      return rows[0];
    });
  }

  return { listSquawks, createSquawk, updateSquawk, addSquawkComment, changeSquawkStatus };
}

const repository = createPostgresSquawkRepository();
export const getSquawksFromPostgres = repository.listSquawks;
export const createSquawkInPostgres = repository.createSquawk;
export const updateSquawkInPostgres = repository.updateSquawk;
export const addSquawkCommentInPostgres = repository.addSquawkComment;
export const changeSquawkStatusInPostgres = repository.changeSquawkStatus;
