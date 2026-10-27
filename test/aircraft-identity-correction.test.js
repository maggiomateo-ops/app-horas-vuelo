import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { IDENTITY_CANARY_ID as SIM, IDENTITY_CORRECTION_FLAG as FLAG, IDENTITY_CORRECTION_REASON as REASON, requireIdentityCorrection } from '../api/_aircraftIdentityCorrectionPolicy.js';
import { createPostgresAircraftIdentityRepository, normalizeAircraftIdentityCorrection } from '../api/_postgresAircraftIdentityRepository.js';
import { getPostgresPool } from '../api/_postgres.js';
import { createSessionCookie } from '../api/_auth.js';
import handler from '../api/aircraft.js';
import { mapPostgresAircraftRow } from '../api/_postgresAircraftRepository.js';

const USER='11111111-1111-4111-8111-111111111111';
const OTHER='33333333-3333-4333-8333-333333333333';
const SESSION={version:2,userId:USER};
const BEFORE={manufacturer:'Cessna',model:'C182',serialNumber:'OLD-FIXTURE',updatedAt:'2026-10-20T12:00:00.123456Z'};
function input(extra={}) {return {aircraftId:SIM,manufacturer:'Piper',model:'PA-34 Seneca',serialNumber:null,reason:REASON,expected:{...BEFORE},...extra};}
function env(t,extra={}) {
  const values={[FLAG]:'true',VERCEL_ENV:'preview',AIRCRAFT_DATA_SOURCE:'POSTGRES',SETTINGS_DATA_SOURCE:'POSTGRES',
    DATABASE_URL:'postgresql://app_horas_runtime:fixture-not-a-credential@ep-jolly-sun-b6a3ayw9.c-2.sa-east-1.aws.neon.tech/app_horas?sslmode=require',
    SESSION_SECRET:'identity-unit-test-not-a-real-secret',...extra};
  const previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
  for(const [k,v] of Object.entries(values)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  t.after(()=>{for(const [k,v] of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
}
// Executes the real transaction wrapper with a fake pg client; no sockets or database writes.
function fakePg(t,options={}) {
  const pool=getPostgresPool();const originalConnect=pool.connect,originalQuery=pool.query;
  let state={userActive:true,ownerActive:true,aircraftActive:true,snapshot:{...BEFORE},events:[],
    history:{flights:false,configuration:false,installations:false,imports:false,adjustments:false},...options};
  const queries=[];let saved;
  const query=async(text,params=[])=>{
    queries.push({text,params});
    if(text==='BEGIN'){saved=structuredClone(state);return {rows:[]};}
    if(text==='ROLLBACK'){state=saved;return {rows:[]};}
    if(text==='COMMIT'||text.startsWith('SET TRANSACTION'))return {rows:[]};
    if(text.includes('current_database()'))return {rows:[{database:options.database||'app_horas',role:options.role||'app_horas_runtime'}]};
    if(text.includes('FROM app.users'))return {rows:state.userActive?[{user_id:USER,status:'ACTIVE'}]:[]};
    if(text.includes('FROM app.aircraft_memberships')&&!text.includes('ORDER BY'))return {rows:state.ownerActive?[{membership_id:'fixture-membership'}]:[]};
    if(text.includes('FROM app.aircraft aircraft')&&text.includes('FOR UPDATE'))return {rows:[{aircraft_id:SIM,status:state.aircraftActive?'ACTIVE':'ARCHIVED',snapshot:state.snapshot}]};
    if(text.includes('EXISTS(SELECT 1 FROM app.flight_records'))return {rows:[state.history]};
    if(text.includes('FROM audit.audit_events'))return {rows:state.events};
    if(text.startsWith('UPDATE app.aircraft')){
      if(options.failUpdateCode)throw Object.assign(new Error('synthetic concurrency abort'),{code:options.failUpdateCode});
      if(options.staleAtUpdate)return {rows:[]};
      state.snapshot={manufacturer:params[1],model:params[2],serialNumber:null,updatedAt:'2026-10-26T12:00:00.654321Z'};
      return {rows:[{snapshot:state.snapshot}]};
    }
    if(text.startsWith('INSERT INTO audit.audit_events')){
      if(options.failAudit)throw new Error('synthetic audit failure');
      state.events.push({audit_event_id:params[0],actor_user_id:params[2],before_state:JSON.parse(params[4]),after_state:JSON.parse(params[5]),reason:params[6],metadata:JSON.parse(params[7])});
      return {rows:[]};
    }
    if(text.includes('membership.role AS rol'))return {rows:[{aircraft_id:SIM,fabricante:state.snapshot.manufacturer,modelo:state.snapshot.model,rol:'OWNER',identityCorrectionSnapshot:state.snapshot,configurationConfigured:false}]};
    throw new Error('Unexpected fake query: '+text);
  };
  pool.connect=async()=>({query,release(){queries.push({text:'RELEASE'});}});
  pool.query=query;
  t.after(()=>{pool.connect=originalConnect;pool.query=originalQuery;});
  const correct=createPostgresAircraftIdentityRepository();
  return {queries,state:()=>state,run:(body=input(),session=SESSION)=>correct({source:'POSTGRES',session,input:body})};
}
function response(){return {statusCode:200,status(code){this.statusCode=code;return this;},json(data){this.data=data;return this;}};}
function request(body=input()){return {method:'PATCH',headers:{cookie:createSessionCookie(SESSION).split(';')[0]},body:{action:'correct-pending-aircraft-identity',...body}};}

test('strict correction accepts only explicit target/NULL/reason/full original microsecond snapshot',()=>{
  assert.equal(normalizeAircraftIdentityCorrection(input()).serialNumber,null);
  const invalid=[{manufacturer:'Other'},{model:'Other'},{serialNumber:''},{serialNumber:'NEW'},{reason:''},{reason:'unrelated'},
    {aircraftId:OTHER},{expected:{...BEFORE,model:'PA-34 Seneca'}},{expected:{...BEFORE,updatedAt:'2026-10-20'}},{expected:{...BEFORE,updatedAt:'2026-02-30T12:00:00.123456Z'}},
    {expected:{manufacturer:'Cessna',model:'C182',updatedAt:BEFORE.updatedAt}},{baselineTisHours:0}];
  for(const patch of invalid)assert.throws(()=>normalizeAircraftIdentityCorrection(input(patch)),{code:'INVALID_AIRCRAFT_IDENTITY_CORRECTION'});
  const missing=input();delete missing.serialNumber;
  assert.throws(()=>normalizeAircraftIdentityCorrection(missing));
});
for(const flag of [undefined,'false','yes','1',''])test(`identity flag fail closed: ${String(flag)}`,t=>{
  env(t,{[FLAG]:flag});assert.throws(()=>requireIdentityCorrection({source:'POSTGRES',session:SESSION,aircraftId:SIM}),{code:'AIRCRAFT_IDENTITY_CORRECTION_DISABLED'});
});
test('policy denies other aircraft, legacy sessions, Sheets, Production and non-TEST database binding',t=>{
  env(t);
  for(const params of [{aircraftId:OTHER},{session:{version:1,userId:USER}},{session:{version:2,userId:'OWNER'}},{source:'SHEETS'}]){
    assert.throws(()=>requireIdentityCorrection({source:'POSTGRES',session:SESSION,aircraftId:SIM,...params}));
  }
  process.env.VERCEL_ENV='production';assert.throws(()=>requireIdentityCorrection({source:'POSTGRES',session:SESSION,aircraftId:SIM}));
  process.env.VERCEL_ENV='preview';
  for(const url of ['postgresql://app_horas_runtime:fixture@localhost/app_horas',
    'postgresql://app_horas_migration:fixture@ep-jolly-sun-b6a3ayw9.c-2.sa-east-1.aws.neon.tech/app_horas',
    'postgresql://app_horas_runtime:fixture@ep-jolly-sun-b6a3ayw9.c-2.sa-east-1.aws.neon.tech/other',
    'postgresql://app_horas_runtime:fixture@ep-jolly-sun-b6a3ayw9.c-2.sa-east-1.aws.neon.tech/app_horas?options=endpoint%3Dother']){
    process.env.DATABASE_URL=url;assert.throws(()=>requireIdentityCorrection({source:'POSTGRES',session:SESSION,aircraftId:SIM}));
  }
});
test('correction is atomic, locks ACTIVE identity/access, preserves before and explicit NULL in Audit',async t=>{
  env(t);const pg=fakePg(t);const result=await pg.run();
  assert.equal(result.alreadyApplied,false);assert.equal(result.identity.serialNumber,null);
  assert.deepEqual(pg.state().events[0].before_state,BEFORE);
  assert.deepEqual(pg.state().events[0].after_state,result.identity);
  assert.equal(pg.state().events[0].reason,REASON);
  assert.equal(pg.state().events[0].actor_user_id,USER);
  assert.equal(pg.queries[0].text,'BEGIN');assert.equal(pg.queries[1].text,'SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  assert.ok(pg.queries.some(q=>q.text.includes('FOR UPDATE')));
  assert.equal(pg.queries.filter(q=>q.text.includes('FOR SHARE')).length,2);
  assert.ok(pg.queries.some(q=>q.text==='COMMIT'));
  assert.ok(!pg.queries.some(q=>/UPDATE app\.(aircraft_registrations|aircraft_utilization_baselines|aircraft_memberships|aircraft_ownership_interests|component_installations|aircraft_configuration)/.test(q.text)));
});
test('identical retry returns the same event and readback without UPDATE or duplicate Audit',async t=>{
  env(t);const pg=fakePg(t);const first=await pg.run();const second=await pg.run();
  assert.equal(second.alreadyApplied,true);assert.equal(second.auditEventId,first.auditEventId);
  assert.deepEqual(second.identity,first.identity);assert.equal(pg.state().events.length,1);
  assert.equal(pg.queries.filter(q=>q.text.startsWith('UPDATE app.aircraft')).length,1);
  await assert.rejects(pg.run(input({expected:{...BEFORE,serialNumber:'stale'}})),{statusCode:409});
  assert.equal(pg.state().events.length,1);
});
for(const restriction of ['userActive','ownerActive','aircraftActive'])test(`inactive or non-OWNER access rejected: ${restriction}`,async t=>{
  env(t);const pg=fakePg(t,{[restriction]:false});await assert.rejects(pg.run(),{statusCode:403});
  assert.ok(!pg.queries.some(q=>q.text.startsWith('UPDATE')));assert.equal(pg.state().events.length,0);
});
for(const name of ['flights','configuration','installations','imports','adjustments'])test(`any existing history conflicts: ${name}`,async t=>{
  env(t);const pg=fakePg(t,{history:{flights:false,configuration:false,installations:false,imports:false,adjustments:false,[name]:true}});
  await assert.rejects(pg.run(),{statusCode:409});assert.ok(!pg.queries.some(q=>q.text.startsWith('UPDATE')));
});
test('stale snapshot, including one microsecond, conflicts before update',async t=>{
  env(t);const pg=fakePg(t);
  for(const expected of [{...BEFORE,updatedAt:'2026-10-20T12:00:00.123457Z'},{...BEFORE,serialNumber:null}]){
    await assert.rejects(pg.run(input({expected})),{statusCode:409});
  }
  assert.equal(pg.state().events.length,0);assert.ok(!pg.queries.some(q=>q.text.startsWith('UPDATE')));
});
test('Audit failure rolls back real wrapper, restoring identity; no COMMIT',async t=>{
  env(t);const pg=fakePg(t,{failAudit:true});await assert.rejects(pg.run(),/synthetic audit failure/);
  assert.deepEqual(pg.state().snapshot,BEFORE);assert.equal(pg.state().events.length,0);
  assert.ok(pg.queries.some(q=>q.text==='ROLLBACK'));assert.ok(!pg.queries.some(q=>q.text==='COMMIT'));
});
test('database identity and compare-and-swap are rechecked inside transaction',async t=>{
  env(t);const pg=fakePg(t,{role:'app_horas_migration'});await assert.rejects(pg.run(),{code:'AIRCRAFT_IDENTITY_TEST_DATABASE_REQUIRED'});
  assert.ok(!pg.queries.some(q=>q.text.startsWith('UPDATE')));
});
test('PATCH existing endpoint and GET snapshot read back corrected identity; repeat is idempotent',async t=>{
  env(t);const pg=fakePg(t);let res=response();await handler(request(),res);
  assert.equal(res.statusCode,200);assert.equal(res.data.identity.model,'PA-34 Seneca');
  res=response();await handler(request(),res);assert.equal(res.data.alreadyApplied,true);
  res=response();await handler({method:'GET',headers:request().headers},res);
  assert.equal(res.statusCode,200);assert.equal(res.data.aircrafts[0].fabricante,'Piper');
  assert.equal(res.data.aircrafts[0].identityCorrectionSnapshot.serialNumber,null);
  assert.equal(res.data.aircrafts[0].identityCorrectionSnapshot.updatedAt,'2026-10-26T12:00:00.654321Z');
  assert.equal(pg.state().events.length,1);
});
test('PATCH flag OFF, tampered UUID and unauthenticated call do not connect to pg',async t=>{
  env(t,{[FLAG]:'false'});const pg=fakePg(t);let res=response();await handler(request(),res);assert.equal(res.statusCode,503);
  process.env[FLAG]='true';res=response();await handler(request(input({aircraftId:OTHER})),res);assert.equal(res.statusCode,403);
  res=response();await handler({method:'PATCH',headers:{},body:request().body},res);assert.equal(res.statusCode,401);
  assert.equal(pg.queries.length,0);
});
test('mapping strips identity snapshot from non-OWNER read models',()=>{
  assert.equal(mapPostgresAircraftRow({rol:'VIEWER',identityCorrectionSnapshot:BEFORE}).identityCorrectionSnapshot,undefined);
});
test('new route uses existing endpoint and no schema or generic identity payload is introduced',async()=>{
  const repo=await readFile(new URL('../api/_postgresAircraftIdentityRepository.js',import.meta.url),'utf8');
  assert.match(repo,/isolationLevel:'SERIALIZABLE'/);assert.match(repo,/AIRCRAFT_IDENTITY_CORRECTED/);
  assert.match(repo,/SERIALIZABLE|40001/);assert.doesNotMatch(repo,/\b(?:CREATE TABLE|ALTER TABLE|GRANT)\b/);
});


test('compare-and-swap zero rows returns 409 and rolls back without Audit',async t=>{
  env(t);const pg=fakePg(t,{staleAtUpdate:true});await assert.rejects(pg.run(),{statusCode:409});
  assert.deepEqual(pg.state().snapshot,BEFORE);assert.equal(pg.state().events.length,0);
  assert.ok(pg.queries.some(q=>q.text==='ROLLBACK'));
  const update=pg.queries.find(q=>q.text.startsWith('UPDATE app.aircraft'));
  assert.deepEqual(JSON.parse(update.params[3]),BEFORE);
});
for(const code of ['40001','40P01'])test(`transaction abort ${code} maps to 409 after rollback, never partial retry`,async t=>{
  env(t);const pg=fakePg(t,{failUpdateCode:code});await assert.rejects(pg.run(),{statusCode:409});
  assert.deepEqual(pg.state().snapshot,BEFORE);assert.equal(pg.state().events.length,0);
  assert.equal(pg.queries.filter(q=>q.text==='BEGIN').length,1);assert.ok(pg.queries.some(q=>q.text==='ROLLBACK'));
});
test('changed state after a successful correction prevents treating a different snapshot as identical retry',async t=>{
  env(t);const pg=fakePg(t);await pg.run();pg.state().snapshot={...pg.state().snapshot,updatedAt:'2026-10-26T12:00:00.654322Z'};
  await assert.rejects(pg.run(),{statusCode:409});assert.equal(pg.state().events.length,1);
});
test('identity already corrected without matching Audit is a conflict, not a new correction',async t=>{
  env(t);const pg=fakePg(t,{snapshot:{...BEFORE,manufacturer:'Piper',model:'PA-34 Seneca',serialNumber:null}});
  await assert.rejects(pg.run(),{statusCode:409});assert.equal(pg.state().events.length,0);
});
test('GET never exposes correction snapshot outside TEST scope',async t=>{
  env(t);fakePg(t);process.env.VERCEL_ENV='production';const res=response();
  await handler({method:'GET',headers:request().headers},res);
  assert.equal(res.statusCode,200);assert.equal(res.data.aircrafts[0].identityCorrectionSnapshot,undefined);
});
