import test from 'node:test';
import assert from 'node:assert/strict';
import sessionHandler from '../api/session.js';
import { createSessionCookie } from '../api/_auth.js';
import { getAircraftOnboardingCapability } from '../api/_aircraftOnboardingCapability.js';
import { canCreateAircraft, createAircraftForSession, buildAircraftOnboardingPayload } from '../src/services/aircraftService.js';

function mockEnvironment(t) {
  const previous = new Map();
  t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  return (key, value) => {
    if (!previous.has(key)) previous.set(key, process.env[key]);
    process.env[key] = value;
  };
}

const USER_ID = '11111111-1111-4111-8111-111111111111';
const user = { userId: USER_ID, aircraftOnboardingAvailable: true, aircraftOnboardingWritesEnabled: true };
const input = { registration: 'LV-SIM', manufacturer: 'PIPER', model: 'PA-28', baselineEffectiveDate: '2026-10-20', openingTisHours: '' };
const oldAircraft = { aircraft_id: 'old', matricula: 'LV-OLD', rol: 'PILOT' };
const created = { aircraft: { aircraft_id: 'new', matricula: 'LV-SIM', rol: 'OWNER' }, onboarding: { ownershipConfigured: false, flightWritesReady: false } };

for (const currentAircrafts of [[], [oldAircraft]]) {
  test(`onboarding con ${currentAircrafts.length} aeronaves selecciona la nueva y refresca una vez`, async () => {
    let posts = 0;
    let gets = 0;
    const result = await createAircraftForSession(input, {
      user, currentAircrafts,
      createRequest: async (values) => { posts++; assert.deepEqual(values, input); return structuredClone(created); },
      loadAircrafts: async () => { gets++; return [...currentAircrafts, created.aircraft]; },
    });
    assert.equal(posts, 1);
    assert.equal(gets, 1);
    assert.equal(result.selectedAircraftId, 'new');
    assert.deepEqual(result.aircrafts, [...currentAircrafts, created.aircraft]);
    assert.deepEqual(result.onboarding, {ownershipConfigured:false,flightWritesReady:false});
  });
}

test('sin permiso explícito no se emite POST ni refresh, independientemente del rol actual', async () => {
  for (const candidate of [null, {}, {isAdmin:true}, {rol:'OWNER'}, {...user,aircraftOnboardingWritesEnabled:false}, {...user,aircraftOnboardingWritesEnabled:'true'}, {...user,aircraftOnboardingAvailable:false}]) {
    assert.equal(canCreateAircraft(candidate), false);
    await assert.rejects(createAircraftForSession(input, {user:candidate,createRequest:()=>assert.fail('POST no autorizado'),loadAircrafts:()=>assert.fail('GET inesperado')}), {code:'AIRCRAFT_ONBOARDING_NOT_AVAILABLE'});
  }
});

test('fallo de creación conserva lista y borradores del llamador y no refresca', async () => {
  const state = {aircrafts:[oldAircraft], selectedAircraftId:'old', draft:{desde:'SADF',ownerOptions:['SUGERIDO']}};
  const snapshot = structuredClone(state);
  await assert.rejects(createAircraftForSession(input, {user,currentAircrafts:state.aircrafts,
    createRequest:async()=>{throw new Error('creation failed');}, loadAircrafts:()=>assert.fail('no refrescar al fallar POST')}), /creation failed/);
  assert.deepEqual(state, snapshot);
});

test('fallo de refresh después del alta conserva aeronaves anteriores sin repetir POST', async () => {
  let posts = 0;
  const result = await createAircraftForSession(input, {user,currentAircrafts:[oldAircraft],createRequest:async()=>{posts++;return created;},loadAircrafts:async()=>{throw new Error('offline');}});
  assert.equal(posts, 1);
  assert.deepEqual(result.aircrafts.map((item)=>item.aircraft_id), ['old','new']);
  assert.equal(result.selectedAircraftId, 'new');
});

test('el payload de la segunda aeronave ignora datos de origen y conserva TIS desconocido', () => {
  const payload = buildAircraftOnboardingPayload({...input,aircraft_id:'old',user_id:'other',memberships:[oldAircraft],ownership:{share:100},pilots:[USER_ID],flights:[{hours:900}],openingCounters:{hours:900},components:[{serialNumber:'OLD'}],sourceAircraftId:'old'});
  assert.deepEqual(payload, {registration:'LV-SIM',manufacturer:'PIPER',model:'PA-28',serialNumber:null,countryCode:null,openingTisHours:null,baselineEffectiveDate:'2026-10-20',defaultCaptureMethod:'DIRECT',defaultOilUnit:'US_QUART'});
});

test('capacidad de sesión proyecta el gate canónico y no transforma ADMIN legacy en OWNER', (t) => {
  const env = mockEnvironment(t);
  env('POSTGRES_ONBOARDING_WRITES_ENABLED', 'true');
  const args = {session:{version:2,userId:USER_ID},identitySource:'POSTGRES',aircraftSource:'POSTGRES'};
  assert.deepEqual(getAircraftOnboardingCapability(args), {aircraftOnboardingAvailable:true,aircraftOnboardingWritesEnabled:true});
  for (const override of [{session:{version:1,username:'admin'}},{session:{version:2,userId:'legacy',isAdmin:true}},{identitySource:'SHEETS'},{aircraftSource:'SHEETS'}]) {
    assert.deepEqual(getAircraftOnboardingCapability({...args,...override}), {aircraftOnboardingAvailable:false,aircraftOnboardingWritesEnabled:false});
  }
  env('POSTGRES_ONBOARDING_WRITES_ENABLED', 'false');
  assert.deepEqual(getAircraftOnboardingCapability(args), {aircraftOnboardingAvailable:true,aircraftOnboardingWritesEnabled:false});
  env('POSTGRES_ONBOARDING_WRITES_ENABLED', 'invalid');
  assert.throws(()=>getAircraftOnboardingCapability(args), {code:'ONBOARDING_WRITE_FLAG_INVALID'});
});

test('GET /api/session entrega la capacidad de alta sin agregar funciones serverless', async (t) => {
  const env = mockEnvironment(t);
  env('SESSION_SECRET', 'local-unit-test-only');
  for (const key of ['GOOGLE_USER_RESOLUTION_SOURCE','AIRCRAFT_DATA_SOURCE','SETTINGS_DATA_SOURCE','FLIGHT_DATA_SOURCE']) env(key,'postgres');
  env('POSTGRES_SETTINGS_WRITES_ENABLED','false');
  env('POSTGRES_FLIGHT_WRITES_ENABLED','false');
  env('POSTGRES_ONBOARDING_WRITES_ENABLED','false');
  const response = {status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
  const cookie = createSessionCookie({userId:USER_ID}).split(';')[0];
  await sessionHandler({method:'GET',headers:{cookie}}, response);
  assert.equal(response.code,200);
  assert.equal(response.body.user.aircraftOnboardingAvailable,true);
  assert.equal(response.body.user.aircraftOnboardingWritesEnabled,false);
  assert.equal(response.body.user.isAdmin,false);
});
