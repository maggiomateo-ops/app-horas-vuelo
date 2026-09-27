import crypto from "node:crypto";
import { postgresQuery, withPostgresTransaction } from "./_postgres.js";
import { getValidatedAircraftAccessFromPostgres } from "./_postgresAircraftRepository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function repositoryError(message, code, statusCode = 500) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function normalizeUuid(value, label) {
  const normalized = String(value || "").trim();

  if (!UUID_PATTERN.test(normalized)) {
    throw repositoryError(`${label} no es un UUID valido.`, "INVALID_CANONICAL_ID", 400);
  }

  return normalized;
}

async function loadFlightRootAndCurrentRevision({ aircraftId, flightId, includeVoided }) {
  const { rows } = await postgresQuery(
    `
      SELECT
        flight.flight_id,
        flight.aircraft_id,
        flight.current_revision_id,
        flight.status,
        flight.record_source,
        flight.created_by_user_id AS flight_created_by_user_id,
        flight.created_at AS flight_created_at,
        flight.voided_at,
        flight.voided_by_user_id,
        flight.void_reason,
        flight.import_batch_id,
        flight.import_row_number,
        revision.flight_revision_id,
        revision.revision_number,
        revision.flight_date,
        revision.departure_location,
        revision.arrival_location,
        revision.pilot_person_id,
        pilot.full_name AS pilot_name,
        revision.utilization_owner_party_id,
        CASE
          WHEN owner_party.party_type = 'PERSON' THEN owner_person.full_name
          WHEN owner_party.party_type = 'ORGANIZATION' THEN owner_party.organization_name
          ELSE NULL
        END AS utilization_owner_name,
        revision.flight_purpose_id,
        purpose.name AS flight_purpose_name,
        revision.capture_method,
        revision.flight_time_hours,
        revision.time_in_service_hours,
        revision.tach_start,
        revision.tach_end,
        revision.movement_start_at,
        revision.takeoff_at,
        revision.landing_at,
        revision.final_stop_at,
        revision.remarks,
        revision.created_by_user_id AS revision_created_by_user_id,
        revision.created_at AS revision_created_at,
        revision.correction_reason
      FROM app.flight_records flight
      JOIN app.flight_record_revisions revision
        ON revision.flight_id = flight.flight_id
       AND revision.flight_revision_id = flight.current_revision_id
      LEFT JOIN app.persons pilot
        ON pilot.person_id = revision.pilot_person_id
      LEFT JOIN app.parties owner_party
        ON owner_party.party_id = revision.utilization_owner_party_id
      LEFT JOIN app.persons owner_person
        ON owner_person.person_id = owner_party.person_id
      LEFT JOIN app.aircraft_flight_purposes purpose
        ON purpose.flight_purpose_id = revision.flight_purpose_id
      WHERE flight.aircraft_id = $1::uuid
        AND flight.flight_id = $2::uuid
        AND ($3::boolean OR flight.status = 'ACTIVE')
      LIMIT 1
    `,
    [aircraftId, flightId, includeVoided]
  );

  return rows[0] || null;
}

async function loadFlightCounters(flightRevisionId) {
  const { rows } = await postgresQuery(
    `SELECT counter_code, counter_value FROM app.flight_counters
      WHERE flight_revision_id = $1::uuid ORDER BY counter_code`,
    [flightRevisionId]
  );
  return rows;
}

async function loadComponentCounters(flightRevisionId) {
  const { rows } = await postgresQuery(
    `SELECT counter.component_installation_id, installation.component_id,
        component.component_type, installation.position_index,
        counter.counter_code, counter.counter_value
      FROM app.flight_component_counters counter
      JOIN app.component_installations installation
        ON installation.component_installation_id = counter.component_installation_id
      JOIN app.components component ON component.component_id = installation.component_id
      WHERE counter.flight_revision_id = $1::uuid
      ORDER BY component.component_type, installation.position_index, counter.counter_code`,
    [flightRevisionId]
  );
  return rows;
}

async function loadTankReadings(flightRevisionId) {
  const { rows } = await postgresQuery(
    `SELECT reading.tank_id, tank.name, tank.position_code, tank.display_order,
        reading.entered_value, reading.entered_unit, reading.canonical_liters
      FROM app.flight_tank_readings reading
      JOIN app.aircraft_tanks tank ON tank.tank_id = reading.tank_id
      WHERE reading.flight_revision_id = $1::uuid
      ORDER BY tank.display_order, tank.tank_id`,
    [flightRevisionId]
  );
  return rows;
}

async function loadComponentConsumables(flightRevisionId) {
  const { rows } = await postgresQuery(
    `SELECT consumable.component_installation_id, installation.component_id,
        component.component_type, installation.position_index,
        consumable.consumable_code, consumable.entered_value,
        consumable.entered_unit, consumable.canonical_liters
      FROM app.flight_component_consumables consumable
      JOIN app.component_installations installation
        ON installation.component_installation_id = consumable.component_installation_id
      JOIN app.components component ON component.component_id = installation.component_id
      WHERE consumable.flight_revision_id = $1::uuid
      ORDER BY component.component_type, installation.position_index, consumable.consumable_code`,
    [flightRevisionId]
  );
  return rows;
}

async function loadComponentRuntime(flightRevisionId) {
  const { rows } = await postgresQuery(
    `SELECT runtime.component_installation_id, installation.component_id,
        component.component_type, installation.position_index,
        runtime.engine_start_at, runtime.engine_stop_at, runtime.engine_running_hours
      FROM app.flight_component_runtime runtime
      JOIN app.component_installations installation
        ON installation.component_installation_id = runtime.component_installation_id
      JOIN app.components component ON component.component_id = installation.component_id
      WHERE runtime.flight_revision_id = $1::uuid
      ORDER BY component.component_type, installation.position_index`,
    [flightRevisionId]
  );
  return rows;
}

export async function getCanonicalOwnershipReadinessFromPostgres({ userId, aircraftId }) {
  const access = await getValidatedAircraftAccessFromPostgres(userId, aircraftId);
  const canonicalAircraftId = access.aircraft.aircraft_id;
  const { rows } = await postgresQuery(
    `
      SELECT
        ownership.ownership_interest_id,
        ownership.party_id,
        ownership.ownership_share,
        ownership.effective_from_at,
        ownership.effective_to_at,
        party.party_type,
        CASE
          WHEN party.party_type = 'PERSON' THEN person.full_name
          WHEN party.party_type = 'ORGANIZATION' THEN party.organization_name
          ELSE NULL
        END AS party_name
      FROM app.aircraft_ownership_interests ownership
      JOIN app.parties party ON party.party_id = ownership.party_id
      LEFT JOIN app.persons person ON person.person_id = party.person_id
      WHERE ownership.aircraft_id = $1::uuid
        AND ownership.effective_from_at <= now()
        AND (ownership.effective_to_at IS NULL OR ownership.effective_to_at > now())
        AND party.status = 'ACTIVE'
      ORDER BY lower(COALESCE(person.full_name, party.organization_name, '')), ownership.party_id
    `,
    [canonicalAircraftId]
  );

  const totalShare = rows.reduce((sum, row) => sum + Number(row.ownership_share || 0), 0);
  const ready = rows.length > 0 && Math.abs(totalShare - 100) < 0.000001;

  return {
    aircraft: access.aircraft,
    membership: access.membership,
    ready,
    total_share: totalShare,
    owners: rows.map((row) => ({
      ownership_interest_id: row.ownership_interest_id,
      party_id: row.party_id,
      name: row.party_name,
      party_type: row.party_type,
      ownership_share: Number(row.ownership_share),
      effective_from_at: row.effective_from_at,
      effective_to_at: row.effective_to_at,
    })),
  };
}

export async function requireCanonicalOwnershipReadyForFlightFromPostgres(args) {
  const readiness = await getCanonicalOwnershipReadinessFromPostgres(args);

  if (!readiness.ready) {
    throw repositoryError(
      "Las mutaciones de vuelos siguen bloqueadas hasta configurar ownership canonico activo al 100%.",
      "FLIGHT_OWNERSHIP_NOT_READY",
      409
    );
  }

  return readiness;
}

export async function getCurrentFlightRecordFromPostgres({
  userId,
  aircraftId,
  flightId,
  includeVoided = false,
}) {
  const access = await getValidatedAircraftAccessFromPostgres(userId, aircraftId);
  const canonicalFlightId = normalizeUuid(flightId, "flightId");
  const flight = await loadFlightRootAndCurrentRevision({
    aircraftId: access.aircraft.aircraft_id,
    flightId: canonicalFlightId,
    includeVoided: includeVoided === true,
  });

  if (!flight) {
    throw repositoryError(
      "No se encontro el Flight Record solicitado para esta aeronave.",
      "FLIGHT_NOT_FOUND",
      404
    );
  }

  const revisionId = flight.flight_revision_id;
  const [counters, componentCounters, tankReadings, componentConsumables, componentRuntime] =
    await Promise.all([
      loadFlightCounters(revisionId),
      loadComponentCounters(revisionId),
      loadTankReadings(revisionId),
      loadComponentConsumables(revisionId),
      loadComponentRuntime(revisionId),
    ]);

  return {
    aircraft: access.aircraft,
    membership: access.membership,
    flight: {
      flight_id: flight.flight_id, aircraft_id: flight.aircraft_id,
      current_revision_id: flight.current_revision_id, status: flight.status,
      record_source: flight.record_source, created_by_user_id: flight.flight_created_by_user_id,
      created_at: flight.flight_created_at, voided_at: flight.voided_at,
      voided_by_user_id: flight.voided_by_user_id, void_reason: flight.void_reason,
      import_batch_id: flight.import_batch_id, import_row_number: flight.import_row_number,
    },
    revision: {
      flight_revision_id: flight.flight_revision_id, revision_number: flight.revision_number,
      flight_date: flight.flight_date, departure_location: flight.departure_location,
      arrival_location: flight.arrival_location, pilot_person_id: flight.pilot_person_id,
      pilot_name: flight.pilot_name, utilization_owner_party_id: flight.utilization_owner_party_id,
      utilization_owner_name: flight.utilization_owner_name, flight_purpose_id: flight.flight_purpose_id,
      flight_purpose_name: flight.flight_purpose_name, capture_method: flight.capture_method,
      flight_time_hours: flight.flight_time_hours, time_in_service_hours: flight.time_in_service_hours,
      tach_start: flight.tach_start, tach_end: flight.tach_end,
      movement_start_at: flight.movement_start_at, takeoff_at: flight.takeoff_at,
      landing_at: flight.landing_at, final_stop_at: flight.final_stop_at,
      remarks: flight.remarks, created_by_user_id: flight.revision_created_by_user_id,
      created_at: flight.revision_created_at, correction_reason: flight.correction_reason,
    },
    snapshots: {
      counters, component_counters: componentCounters, tank_readings: tankReadings,
      component_consumables: componentConsumables, component_runtime: componentRuntime,
    },
  };
}


function decimal(value, label, required = false) {
  if (value === "" || value === null || value === undefined) {
    if (required) throw repositoryError(`${label} es obligatorio.`, "FLIGHT_INVALID_PAYLOAD", 422);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw repositoryError(`${label} no es valido.`, "FLIGHT_INVALID_PAYLOAD", 422);
  return Math.round(n * 10) / 10;
}

function legacyFlightDate(payload) {
  const iso = [payload.anio, String(payload.mes || "").padStart(2, "0"), String(payload.dia || "").padStart(2, "0")].join("-");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || Number.isNaN(Date.parse(`${iso}T00:00:00Z`))) {
    throw repositoryError("La fecha del vuelo no es valida.", "FLIGHT_INVALID_PAYLOAD", 422);
  }
  return iso;
}

async function requireFlightOwnerInTransaction(client, userId, aircraftId) {
  const { rows } = await client.query(
    `SELECT m.membership_id,m.role,m.status
       FROM app.aircraft_memberships m
       JOIN app.users u ON u.user_id=m.user_id
       JOIN app.aircraft a ON a.aircraft_id=m.aircraft_id
      WHERE m.user_id=$1::uuid AND m.aircraft_id=$2::uuid
        AND u.status='ACTIVE' AND a.status='ACTIVE' AND m.status='ACTIVE'
      FOR UPDATE OF m`,
    [userId, aircraftId]
  );
  if (!rows[0] || rows[0].role !== "OWNER") {
    throw repositoryError("El usuario no tiene permiso OWNER activo para modificar vuelos.", "FLIGHT_WRITE_FORBIDDEN", 403);
  }
}

async function resolveManualReferences(client, aircraftId, payload, flightDate) {
  const pilotName = String(payload.piloto || "").trim();
  const ownerName = String(payload.propietario || "").trim();
  if (!pilotName || !ownerName) throw repositoryError("Piloto y propietario son obligatorios.", "FLIGHT_INVALID_PAYLOAD", 422);

  const { rows: pilots } = await client.query(
    `SELECT p.person_id FROM app.aircraft_persons ap JOIN app.persons p ON p.person_id=ap.person_id
      WHERE ap.aircraft_id=$1::uuid AND ap.status='ACTIVE' AND p.status='ACTIVE' AND lower(p.full_name)=lower($2)`,
    [aircraftId, pilotName]
  );
  if (pilots.length !== 1) throw repositoryError("El piloto debe coincidir con una persona canonica activa de la aeronave.", "FLIGHT_PILOT_NOT_RESOLVED", 409);

  const { rows: owners } = await client.query(
    `SELECT oi.party_id FROM app.aircraft_ownership_interests oi
      JOIN app.parties party ON party.party_id=oi.party_id
      LEFT JOIN app.persons p ON p.person_id=party.person_id
      WHERE oi.aircraft_id=$1::uuid AND party.status='ACTIVE'
        AND oi.effective_from_at::date <= $3::date AND (oi.effective_to_at IS NULL OR oi.effective_to_at::date > $3::date)
        AND lower(CASE WHEN party.party_type='PERSON' THEN p.full_name ELSE party.organization_name END)=lower($2)`,
    [aircraftId, ownerName]
  );
  if (owners.length !== 1) throw repositoryError("El propietario seleccionado no coincide con ownership canonico vigente.", "FLIGHT_OWNER_NOT_RESOLVED", 409);

  const { rows: shares } = await client.query(
    `SELECT count(*)::int AS owner_count,COALESCE(sum(ownership_share),0)::numeric AS total_share
       FROM app.aircraft_ownership_interests oi JOIN app.parties p ON p.party_id=oi.party_id
      WHERE oi.aircraft_id=$1::uuid AND p.status='ACTIVE' AND oi.effective_from_at::date <= $2::date
        AND (oi.effective_to_at IS NULL OR oi.effective_to_at::date > $2::date)`,
    [aircraftId, flightDate]
  );
  if (!shares[0] || Number(shares[0].total_share) !== 100 || Number(shares[0].owner_count) < 1) {
    throw repositoryError("Ownership canonico no esta configurado al 100%.", "FLIGHT_OWNERSHIP_NOT_READY", 409);
  }
  return { pilotPersonId: pilots[0].person_id, ownerPartyId: owners[0].party_id };
}

async function insertLegacyChildSnapshots(client, aircraftId, revisionId, payload) {
  const fuel = [
    ["LEFT", payload.combustibleTanqueIzquierdo],
    ["RIGHT", payload.combustibleTanqueDerecho],
  ];
  for (const [position, raw] of fuel) {
    if (raw === "" || raw === null || raw === undefined) continue;
    const value = decimal(raw, `Combustible ${position}`);
    const { rows } = await client.query(
      `SELECT tank_id,display_unit FROM app.aircraft_tanks
        WHERE aircraft_id=$1::uuid AND position_code=$2 AND status='ACTIVE' LIMIT 1`,
      [aircraftId, position]
    );
    if (!rows[0]) throw repositoryError(`No existe tanque canonico activo ${position}.`, "FLIGHT_TANK_NOT_READY", 409);
    if (rows[0].display_unit !== "LITER") throw repositoryError("El adapter legacy requiere tanques configurados en LITER.", "FLIGHT_UNIT_NOT_READY", 409);
    await client.query(
      `INSERT INTO app.flight_tank_readings(flight_revision_id,tank_id,entered_value,entered_unit,canonical_liters)
       VALUES($1::uuid,$2::uuid,$3,'LITER',$3)`,
      [revisionId, rows[0].tank_id, value]
    );
  }

  if (payload.aceiteAgregado !== "" && payload.aceiteAgregado !== null && payload.aceiteAgregado !== undefined) {
    const value = decimal(payload.aceiteAgregado, "Aceite agregado");
    const { rows } = await client.query(
      `SELECT ci.component_installation_id,s.default_oil_unit
         FROM app.component_installations ci
         JOIN app.components c ON c.component_id=ci.component_id
         JOIN app.aircraft_settings s ON s.aircraft_id=ci.aircraft_id
        WHERE ci.aircraft_id=$1::uuid AND c.component_type='ENGINE' AND c.status='ACTIVE'
          AND ci.removed_on IS NULL ORDER BY ci.position_index LIMIT 1`,
      [aircraftId]
    );
    if (!rows[0]) throw repositoryError("No existe motor canonico activo para registrar aceite.", "FLIGHT_ENGINE_NOT_READY", 409);
    const unit = rows[0].default_oil_unit;
    const liters = unit === "US_QUART" ? value * 0.946352946 : value;
    await client.query(
      `INSERT INTO app.flight_component_consumables
       (flight_revision_id,component_installation_id,consumable_code,entered_value,entered_unit,canonical_liters)
       VALUES($1::uuid,$2::uuid,'OIL_ADDED',$3,$4,$5)`,
      [revisionId, rows[0].component_installation_id, value, unit, liters]
    );
  }
}

function revisionState(payload, refs) {
  return {
    flight_date: legacyFlightDate(payload),
    departure_location: String(payload.desde || "").trim().toUpperCase(),
    arrival_location: String(payload.hasta || "").trim().toUpperCase(),
    pilot_person_id: refs.pilotPersonId,
    utilization_owner_party_id: refs.ownerPartyId,
    capture_method: "DIRECT",
    flight_time_hours: decimal(payload.tiempoVueloJPI, "Tiempo de vuelo", true),
    time_in_service_hours: decimal(payload.tiempoEnServicioGarmin, "Tiempo en servicio", true),
    remarks: String(payload.observaciones || "").trim() || null,
  };
}

async function insertRevision(client, flightId, revisionNumber, userId, state, correctionReason = null) {
  const revisionId = crypto.randomUUID();
  await client.query(
    `INSERT INTO app.flight_record_revisions(
       flight_revision_id,flight_id,revision_number,flight_date,departure_location,arrival_location,
       pilot_person_id,utilization_owner_party_id,capture_method,flight_time_hours,time_in_service_hours,
       remarks,created_by_user_id,correction_reason)
     VALUES($1::uuid,$2::uuid,$3,$4::date,$5,$6,$7::uuid,$8::uuid,$9,$10,$11,$12,$13::uuid,$14)`,
    [revisionId,flightId,revisionNumber,state.flight_date,state.departure_location,state.arrival_location,
     state.pilot_person_id,state.utilization_owner_party_id,state.capture_method,state.flight_time_hours,
     state.time_in_service_hours,state.remarks,userId,correctionReason]
  );
  return revisionId;
}

export async function saveLegacyFlightToPostgres({ userId, aircraftId, payload }) {
  const normalizedUserId=normalizeUuid(userId,"userId");
  const normalizedAircraftId=normalizeUuid(aircraftId,"aircraftId");
  const mode=String(payload?.modo || "create").trim().toLowerCase();
  if (!["create","update","delete"].includes(mode)) throw repositoryError("Modo de vuelo no valido.","FLIGHT_INVALID_MODE",400);

  return withPostgresTransaction(async(client)=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`app-horas:flight:${normalizedAircraftId}`]);
    await requireFlightOwnerInTransaction(client,normalizedUserId,normalizedAircraftId);

    if(mode==="delete"){
      const flightId=normalizeUuid(payload.id,"flightId");
      const reason=String(payload.voidReason || payload.motivo || "Anulado desde interfaz de vuelos").trim();
      const {rows}=await client.query(
        `SELECT status,current_revision_id FROM app.flight_records WHERE flight_id=$1::uuid AND aircraft_id=$2::uuid FOR UPDATE`,
        [flightId,normalizedAircraftId]
      );
      if(!rows[0]) throw repositoryError("No se encontro el vuelo.","FLIGHT_NOT_FOUND",404);
      if(rows[0].status==="VOIDED") return {ok:true,modo:"delete",id:flightId,changed:false,message:"El vuelo ya estaba anulado"};
      await client.query(
        `UPDATE app.flight_records SET status='VOIDED',voided_at=now(),voided_by_user_id=$2::uuid,void_reason=$3 WHERE flight_id=$1::uuid`,
        [flightId,normalizedUserId,reason]
      );
      await client.query(
        `INSERT INTO audit.audit_events(request_id,actor_type,actor_user_id,operation_source,aircraft_id,entity_type,entity_id,entity_key,action_code,before_state,after_state,reason,metadata,payload_version)
         VALUES($1::uuid,'USER',$2::uuid,'MANUAL',$3::uuid,'FLIGHT_RECORD',$4::uuid,$5::jsonb,'FLIGHT_VOIDED',$6::jsonb,$7::jsonb,$8,$9::jsonb,1)`,
        [crypto.randomUUID(),normalizedUserId,normalizedAircraftId,flightId,JSON.stringify({flight_id:flightId}),
         JSON.stringify({status:"ACTIVE",current_revision_id:rows[0].current_revision_id}),
         JSON.stringify({status:"VOIDED",current_revision_id:rows[0].current_revision_id}),reason,JSON.stringify({contract:"D-237"})]
      );
      return {ok:true,modo:"delete",id:flightId,changed:true,message:"Vuelo anulado correctamente"};
    }

    const refs=await resolveManualReferences(client,normalizedAircraftId,payload);
    const state=revisionState(payload,refs);

    if(mode==="create"){
      const flightId=crypto.randomUUID();
      const revisionId=crypto.randomUUID();
      await client.query(
        `INSERT INTO app.flight_records(flight_id,aircraft_id,current_revision_id,status,record_source,created_by_user_id)
         VALUES($1::uuid,$2::uuid,$3::uuid,'ACTIVE','MANUAL',$4::uuid)`,
        [flightId,normalizedAircraftId,revisionId,normalizedUserId]
      );
      await client.query(
        `INSERT INTO app.flight_record_revisions(
         flight_revision_id,flight_id,revision_number,flight_date,departure_location,arrival_location,pilot_person_id,
         utilization_owner_party_id,capture_method,flight_time_hours,time_in_service_hours,remarks,created_by_user_id)
         VALUES($1::uuid,$2::uuid,1,$3::date,$4,$5,$6::uuid,$7::uuid,'DIRECT',$8,$9,$10,$11::uuid)`,
        [revisionId,flightId,state.flight_date,state.departure_location,state.arrival_location,state.pilot_person_id,
         state.utilization_owner_party_id,state.flight_time_hours,state.time_in_service_hours,state.remarks,normalizedUserId]
      );
      await insertLegacyChildSnapshots(client,normalizedAircraftId,revisionId,payload);
      await client.query(
        `INSERT INTO audit.audit_events(request_id,actor_type,actor_user_id,operation_source,aircraft_id,entity_type,entity_id,entity_key,action_code,before_state,after_state,reason,metadata,payload_version)
         VALUES($1::uuid,'USER',$2::uuid,'MANUAL',$3::uuid,'FLIGHT_RECORD',$4::uuid,$5::jsonb,'FLIGHT_CREATED',NULL,$6::jsonb,'Manual Flight Record create',$7::jsonb,1)`,
        [crypto.randomUUID(),normalizedUserId,normalizedAircraftId,flightId,JSON.stringify({flight_id:flightId}),JSON.stringify({...state,revision_number:1}),JSON.stringify({contract:"D-237"})]
      );
      return {ok:true,modo:"create",id:flightId,flight_revision_id:revisionId,message:"Vuelo guardado correctamente"};
    }

    const flightId=normalizeUuid(payload.id,"flightId");
    const correctionReason=String(payload.correctionReason || payload.motivo || "Correccion desde interfaz de vuelos").trim();
    const {rows}=await client.query(
      `SELECT f.status,f.current_revision_id,r.revision_number,r.flight_date,r.departure_location,r.arrival_location,
              r.pilot_person_id,r.utilization_owner_party_id,r.capture_method,r.flight_time_hours,r.time_in_service_hours,r.remarks
       FROM app.flight_records f JOIN app.flight_record_revisions r ON r.flight_revision_id=f.current_revision_id
       WHERE f.flight_id=$1::uuid AND f.aircraft_id=$2::uuid FOR UPDATE OF f`,
      [flightId,normalizedAircraftId]
    );
    if(!rows[0]) throw repositoryError("No se encontro el vuelo.","FLIGHT_NOT_FOUND",404);
    if(rows[0].status!=="ACTIVE") throw repositoryError("Solo se puede corregir un vuelo ACTIVE.","FLIGHT_NOT_ACTIVE",409);
    const revisionId=await insertRevision(client,flightId,Number(rows[0].revision_number)+1,normalizedUserId,state,correctionReason);
    await insertLegacyChildSnapshots(client,normalizedAircraftId,revisionId,payload);
    await client.query("UPDATE app.flight_records SET current_revision_id=$2::uuid WHERE flight_id=$1::uuid",[flightId,revisionId]);
    await client.query(
      `INSERT INTO audit.audit_events(request_id,actor_type,actor_user_id,operation_source,aircraft_id,entity_type,entity_id,entity_key,action_code,before_state,after_state,reason,metadata,payload_version)
       VALUES($1::uuid,'USER',$2::uuid,'MANUAL',$3::uuid,'FLIGHT_RECORD',$4::uuid,$5::jsonb,'FLIGHT_CORRECTED',$6::jsonb,$7::jsonb,$8,$9::jsonb,1)`,
      [crypto.randomUUID(),normalizedUserId,normalizedAircraftId,flightId,JSON.stringify({flight_id:flightId}),
       JSON.stringify(rows[0]),JSON.stringify({...state,revision_number:Number(rows[0].revision_number)+1,flight_revision_id:revisionId}),
       correctionReason,JSON.stringify({contract:"D-237",previous_revision_id:rows[0].current_revision_id})]
    );
    return {ok:true,modo:"update",id:flightId,flight_revision_id:revisionId,message:"Vuelo actualizado correctamente"};
  },{isolationLevel:"SERIALIZABLE"});
}
