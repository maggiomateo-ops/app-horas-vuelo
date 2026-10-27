import crypto from 'node:crypto';
import { withPostgresTransaction } from './_postgres.js';
import { IDENTITY_CANARY_ID, IDENTITY_CORRECTION_REASON, identityCorrectionError, requireIdentityCorrection } from './_aircraftIdentityCorrectionPolicy.js';

const FIELDS = ['aircraftId','manufacturer','model','serialNumber','reason','expected'];
const SNAPSHOT_FIELDS = ['manufacturer','model','serialNumber','updatedAt'];
const VERSION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const SNAPSHOT_SQL = `jsonb_build_object('manufacturer',aircraft.manufacturer,'model',aircraft.model,
  'serialNumber',aircraft.serial_number,'updatedAt',to_char(aircraft.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))`;
function exactKeys(object, fields) {
  return object && typeof object === 'object' && !Array.isArray(object)
    && Object.keys(object).length === fields.length && fields.every(k => Object.hasOwn(object,k));
}
function validVersion(value) {
  if (typeof value !== 'string' || !VERSION.test(value) || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === `${value.slice(0,23)}Z`;
}
export function normalizeAircraftIdentityCorrection(input) {
  if (!exactKeys(input,FIELDS) || !exactKeys(input.expected,SNAPSHOT_FIELDS)
    || String(input.aircraftId).toLowerCase() !== IDENTITY_CANARY_ID
    || input.manufacturer !== 'Piper' || input.model !== 'PA-34 Seneca' || input.serialNumber !== null
    || input.reason !== IDENTITY_CORRECTION_REASON
    || input.expected.manufacturer !== 'Cessna' || input.expected.model !== 'C182'
    || !(input.expected.serialNumber === null || (typeof input.expected.serialNumber === 'string' && input.expected.serialNumber.trim().length > 0 && input.expected.serialNumber.length <= 1000))
    || !validVersion(input.expected.updatedAt)) {
    throw identityCorrectionError('INVALID_AIRCRAFT_IDENTITY_CORRECTION',422);
  }
  // Stable canonical ordering, including the original microsecond version and explicit NULL.
  return {aircraftId:IDENTITY_CANARY_ID,manufacturer:'Piper',model:'PA-34 Seneca',serialNumber:null,
    reason:IDENTITY_CORRECTION_REASON,expected:Object.fromEntries(SNAPSHOT_FIELDS.map(k=>[k,input.expected[k]]))};
}
const equal = (a,b) => SNAPSHOT_FIELDS.every(k => a?.[k] === b?.[k]);
const conflict = () => identityCorrectionError('AIRCRAFT_IDENTITY_CORRECTION_CONFLICT',409);

export function createPostgresAircraftIdentityRepository({transaction=withPostgresTransaction,randomUUID=crypto.randomUUID}={}) {
  return async function correctIdentity({source,session,input}) {
    requireIdentityCorrection({source,session,aircraftId:input?.aircraftId});
    const normalized=normalizeAircraftIdentityCorrection(input);
    const fingerprint=crypto.createHash('sha256').update(JSON.stringify({userId:session.userId.toLowerCase(),...normalized})).digest('hex');
    try {
      return await transaction(async client => {
        // Recheck policy on every attempt; no route may call this repository around the gate.
        requireIdentityCorrection({source,session,aircraftId:normalized.aircraftId});
        const {rows:[database]}=await client.query('SELECT current_database() AS database, current_user AS role');
        if (database?.database!=='app_horas'||database?.role!=='app_horas_runtime') throw identityCorrectionError('AIRCRAFT_IDENTITY_TEST_DATABASE_REQUIRED');
        // User -> aircraft -> membership locks protect concurrent status/revocation changes.
        const {rows:users}=await client.query("SELECT user_id FROM app.users WHERE user_id=$1::uuid AND status='ACTIVE' FOR SHARE",[session.userId]);
        if (!users.length) throw identityCorrectionError('AIRCRAFT_IDENTITY_ACCESS_DENIED');
        const {rows:[aircraft]}=await client.query(`SELECT aircraft.aircraft_id,aircraft.status,${SNAPSHOT_SQL} AS snapshot
          FROM app.aircraft aircraft WHERE aircraft.aircraft_id=$1::uuid FOR UPDATE`,[normalized.aircraftId]);
        if (!aircraft||aircraft.status!=='ACTIVE') throw identityCorrectionError('AIRCRAFT_IDENTITY_ACCESS_DENIED');
        const {rows:memberships}=await client.query(`SELECT membership_id FROM app.aircraft_memberships
          WHERE aircraft_id=$1::uuid AND user_id=$2::uuid AND role='OWNER' AND status='ACTIVE' FOR SHARE`,[normalized.aircraftId,session.userId]);
        if (!memberships.length) throw identityCorrectionError('AIRCRAFT_IDENTITY_ACCESS_DENIED');
        const {rows:[history]}=await client.query(`SELECT
          EXISTS(SELECT 1 FROM app.flight_records WHERE aircraft_id=$1::uuid) AS flights,
          EXISTS(SELECT 1 FROM app.aircraft_configuration WHERE aircraft_id=$1::uuid) AS configuration,
          EXISTS(SELECT 1 FROM app.component_installations WHERE aircraft_id=$1::uuid) AS installations,
          EXISTS(SELECT 1 FROM app.flight_import_batches WHERE aircraft_id=$1::uuid) AS imports,
          EXISTS(SELECT 1 FROM app.utilization_adjustments WHERE aircraft_id=$1::uuid) AS adjustments`,[normalized.aircraftId]);
        if (!history || Object.values(history).some(v=>v!==false)) throw conflict();
        const {rows:events}=await client.query(`SELECT audit_event_id,actor_user_id,before_state,after_state,reason,metadata
          FROM audit.audit_events WHERE aircraft_id=$1::uuid AND action_code='AIRCRAFT_IDENTITY_CORRECTED'
          ORDER BY occurred_at,audit_event_id`,[normalized.aircraftId]);
        if (events.length) {
          const previous=events[0];
          if (events.length!==1||previous.actor_user_id!==session.userId.toLowerCase()
            || previous.metadata?.request_fingerprint!==fingerprint || previous.reason!==normalized.reason
            || !equal(previous.before_state,normalized.expected) || !equal(previous.after_state,aircraft.snapshot)) throw conflict();
          return {ok:true,alreadyApplied:true,aircraftId:normalized.aircraftId,auditEventId:previous.audit_event_id,identity:aircraft.snapshot};
        }
        if (!equal(aircraft.snapshot,normalized.expected)) throw conflict();
        const {rows:[updated]}=await client.query(`UPDATE app.aircraft aircraft
          SET manufacturer=$2::text, model=$3::text, serial_number=NULL, updated_at=clock_timestamp()
          WHERE aircraft.aircraft_id=$1::uuid AND ${SNAPSHOT_SQL}=$4::jsonb
          RETURNING ${SNAPSHOT_SQL} AS snapshot`,[normalized.aircraftId,normalized.manufacturer,normalized.model,JSON.stringify(normalized.expected)]);
        if (!updated) throw conflict();
        const auditEventId=randomUUID();
        await client.query(`INSERT INTO audit.audit_events (
          audit_event_id,occurred_at,request_id,actor_type,actor_user_id,operation_source,
          aircraft_id,entity_type,entity_id,entity_key,action_code,before_state,after_state,reason,metadata,payload_version)
          VALUES ($1::uuid,transaction_timestamp(),$2::uuid,'USER',$3::uuid,'MANUAL',
          $4::uuid,'AIRCRAFT',$4::uuid,jsonb_build_object('aircraft_id',$4::uuid),'AIRCRAFT_IDENTITY_CORRECTED',
          $5::jsonb,$6::jsonb,$7::text,$8::jsonb,1)`,[auditEventId,randomUUID(),session.userId,normalized.aircraftId,
          JSON.stringify(aircraft.snapshot),JSON.stringify(updated.snapshot),normalized.reason,
          JSON.stringify({contract:'lv-sim-identity-v1',request_fingerprint:fingerprint,environment:'TEST_PREVIEW'})]);
        return {ok:true,alreadyApplied:false,aircraftId:normalized.aircraftId,auditEventId,identity:updated.snapshot};
      },{isolationLevel:'SERIALIZABLE'});
    } catch (error) {
      // Caller may retry the entire request. Never retry a partial mutation or hide conflicts.
      if (['40001','40P01'].includes(error.code)) throw conflict();
      throw error;
    }
  };
}
export const correctAircraftIdentityInPostgres=createPostgresAircraftIdentityRepository();
