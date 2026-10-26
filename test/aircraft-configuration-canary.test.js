import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSessionCookie } from '../api/_auth.js';
import handler from '../api/aircraft.js';
import { requireAircraftConfigurationCanary, aircraftConfigurationSetupAvailable } from '../api/_aircraftConfigurationCanary.js';

const SIM = '22222222-2222-4222-8222-222222222222';
const MHZ = '33333333-3333-4333-8333-333333333333';
const session = { version:2, userId:'11111111-1111-4111-8111-111111111111' };
const FLAG = 'POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED';
const TARGET = 'POSTGRES_AIRCRAFT_CONFIGURATION_CANARY_AIRCRAFT_ID';
function environment(t, extra={}) {
  const values={ [FLAG]:'true', [TARGET]:SIM, VERCEL_ENV:'preview', AIRCRAFT_DATA_SOURCE:'POSTGRES', SESSION_SECRET:'canary-test-only-secret-not-a-real-credential', ...extra };
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  for(const [key,value] of Object.entries(values)) { if(value===undefined) delete process.env[key]; else process.env[key]=value; }
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined) delete process.env[key]; else process.env[key]=value;}});
}
const authorize = (aircraftId=SIM, currentSession=session, source='POSTGRES') => requireAircraftConfigurationCanary({source,session:currentSession,aircraftId});
const available = (overrides={}) => aircraftConfigurationSetupAvailable({source:'POSTGRES',session,aircraft:{aircraft_id:SIM,rol:'OWNER',configurationConfigured:false,...overrides}});

test('canary autoriza solo UUID explícito, sesión canónica y capacidad OWNER pendiente',t=>{
  environment(t);
  assert.doesNotThrow(()=>authorize());
  assert.doesNotThrow(()=>authorize(SIM.toUpperCase()));
  assert.equal(available(),true);
  assert.equal(available({aircraft_id:MHZ}),false);
  assert.throws(()=>authorize(MHZ),{code:'AIRCRAFT_CONFIGURATION_CANARY_DENIED'});
});
for(const target of [undefined,'','LV-SIM','*',`${SIM},${MHZ}`,'not-a-uuid',JSON.stringify([SIM])]) {
  test(`target inválido/ausente ${String(target)} bloquea y no rompe capacidad de lectura`,t=>{
    environment(t,{[TARGET]:target});
    assert.throws(()=>authorize(),{code:'AIRCRAFT_CONFIGURATION_CANARY_NOT_CONFIGURED'});
    assert.equal(available(),false);
  });
}
for(const value of [undefined,'false','yes']) {
  test(`flag global ${String(value)} no puede omitirse mediante canary`,t=>{
    environment(t,{[FLAG]:value});
    assert.throws(()=>authorize());
    assert.equal(available(),false);
  });
}
test('Production, SHEETS y sesión no canónica no obtienen permiso',t=>{
  environment(t,{VERCEL_ENV:'production'});
  assert.throws(()=>authorize(),{code:'AIRCRAFT_CONFIGURATION_CANARY_NOT_CONFIGURED'});
  assert.equal(available(),false);
  process.env.VERCEL_ENV='preview';
  assert.throws(()=>authorize(SIM,session,'SHEETS'));
  for(const invalid of [{version:1,userId:session.userId},{version:2,userId:'OWNER'},null]) {
    assert.throws(()=>authorize(SIM,invalid),{code:'AIRCRAFT_CONFIGURATION_CANONICAL_SESSION_REQUIRED'});
  }
});
test('capacidad UI no habilita roles ajenos ni aeronaves configuradas o estado desconocido',t=>{
  environment(t);
  for(const rol of ['PILOT','VIEWER','ADMIN','']) assert.equal(available({rol}),false);
  for(const configured of [true,undefined,null]) assert.equal(available({configurationConfigured:configured}),false);
});
function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}};}
for(const payload of [
  {aircraftId:MHZ,matricula:'LV-SIM'},
  {aircraftId:MHZ,authorizedAircraftId:SIM},
  {aircraftId:MHZ,canaryAircraftId:SIM},
  {aircraftId:MHZ,configurationSetupAvailable:true},
  {aircraftId:[SIM]},
  {aircraftId:undefined,aircraft_id:SIM},
]) {
  test(`PATCH rechaza payload manipulado ${JSON.stringify(payload)} antes de repositorio`,async t=>{
    environment(t);
    const res=response();
    await handler({method:'PATCH',headers:{cookie:createSessionCookie(session).split(';')[0]},body:{action:'setup-configuration',propulsionType:'PISTON',engineCount:1,propellerCount:1,components:[],...payload}},res);
    assert.equal(res.statusCode,403);
    assert.equal(res.data.code,'AIRCRAFT_CONFIGURATION_CANARY_DENIED');
  });
}
test('sin sesión HTTP no hay acceso al setup aun con flags y target correctos',async t=>{
  environment(t);
  const res=response();
  await handler({method:'PATCH',headers:{},body:{action:'setup-configuration',aircraftId:SIM}},res);
  assert.equal(res.statusCode,401);
});
test('guard verifica el mismo aircraftId enviado al repositorio y conserva controles transaccionales',async()=>{
  const api=await readFile(new URL('../api/aircraft.js',import.meta.url),'utf8');
  assert.match(api,/requireAircraftConfigurationCanary\(\{ source, session, aircraftId: req.body\?\.aircraftId \}\)/);
  const repo=await readFile(new URL('../api/_postgresAircraftConfigurationRepository.js',import.meta.url),'utf8');
  assert.match(repo,/membership.role = 'OWNER'/);
  assert.match(repo,/membership.status = 'ACTIVE'/);
  assert.match(repo,/user_account.status = 'ACTIVE'/);
  assert.match(repo,/AIRCRAFT_CONFIGURATION_ALREADY_EXISTS/);
});
test('Propiedad conserva tarjetas y elimina explicación técnica sin inferir titularidad',async()=>{
  const ui=await readFile(new URL('../src/components/AircraftOwnershipSummary.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/La titularidad legal es independiente/);
  assert.match(ui,/Todavía no se configuraron propietarios para esta aeronave\./);
  assert.match(ui,/interests.map/);
});
