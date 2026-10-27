import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateAircraftConfiguration, buildAircraftConfigurationPayload } from '../src/services/aircraftService.js';
import { normalizeAircraftConfigurationInput } from '../api/_postgresAircraftConfigurationRepository.js';
import { aircraftConfigurationSetupAvailable, requireAircraftConfigurationCanary } from '../api/_aircraftConfigurationCanary.js';
import { resolveDataSource } from '../api/_dataSource.js';
import { resolvePostgresFlightWriteCapability, resolvePostgresOwnershipWriteCapability } from '../api/_settingsWriteCapability.js';
const root=new URL('../docs/lv-sim-v1-canary/',import.meta.url);
const plan=JSON.parse(await readFile(new URL('plan.json',root),'utf8'));
function proposedEnvironment(t){
  const values={...plan.environmentProposal.nonSecretOverrides,VERCEL_ENV:'preview'};
  const previous=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));
  Object.assign(process.env,values);
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
}
test('canary preparation is non-executable and contains no secret values or automatic dates/hours',()=>{
  assert.equal(plan.executionAuthorization,false);assert.equal(plan.environmentProposal.apply,false);
  assert.equal(plan.identity.writeOperation,'IMPLEMENTED_FLAG_OFF');
  assert.deepEqual(plan.identity.proposed,{manufacturer:'Piper',model:'PA-34 Seneca'});
  assert.equal(plan.configuration.components.length,4);
  assert.deepEqual(plan.configuration.components.map(c=>`${c.componentType}:${c.positionIndex}`),['ENGINE:1','ENGINE:2','PROPELLER:1','PROPELLER:2']);
  for(const c of plan.configuration.components){
    for(const field of ['manufacturer','model','serialNumber','openingTisHours','installedOn'])assert.equal(c[field],null);
  }
  for(const key of ['DATABASE_URL','SESSION_SECRET','GOOGLE_CLIENT_ID','VITE_GOOGLE_CLIENT_ID','DATABASE_MIGRATION_URL']){
    assert.equal(Object.hasOwn(plan.environmentProposal.nonSecretOverrides,key),false);
  }
});
test('incomplete four-date input matrix cannot pass V1 review or server normalization',()=>{
  const values=plan.configuration;
  const validation=validateAircraftConfiguration(values);
  assert.equal(validation.valid,false);
  assert.deepEqual(Object.keys(validation.errors).sort(),[...plan.missingInputs].sort());
  const {action:_action,...input}=buildAircraftConfigurationPayload(plan.aircraftId,values);
  assert.throws(()=>normalizeAircraftConfigurationInput(input),{code:'INVALID_AIRCRAFT_CONFIGURATION'});
});
test('explicit synthetic test dates permit four V1 positions without manufacturing identity or counters',()=>{
  const dates=['2024-02-29','2025-02-28','2023-01-01','2026-01-02'];
  const values={...plan.configuration,components:plan.configuration.components.map((c,i)=>({...c,installedOn:dates[i]}))};
  assert.equal(validateAircraftConfiguration(values).valid,true);
  const {action:_action,...input}=buildAircraftConfigurationPayload(plan.aircraftId,values);
  const normalized=normalizeAircraftConfigurationInput(input);
  assert.deepEqual(normalized.components.map(c=>c.installedOn),dates);
  assert.ok(normalized.components.every(c=>c.manufacturer===null&&c.model===null&&c.serialNumber===null&&c.openingTisHours===null));
  assert.ok(plan.configuration.components.every(c=>c.installedOn===null));
});
test('proposed environment uses canonical UUID/Preview, blocks other aircraft, roles and repeat UI',t=>{
  proposedEnvironment(t);
  const session={version:2,userId:'11111111-1111-4111-8111-111111111111'};
  const aircraft={aircraft_id:plan.aircraftId,rol:'OWNER',configurationConfigured:false};
  const available=a=>aircraftConfigurationSetupAvailable({source:resolveDataSource('AIRCRAFT_DATA_SOURCE'),session,aircraft:a});
  assert.equal(available(aircraft),true);
  for(const rol of ['ADMIN','PILOT','VIEWER'])assert.equal(available({...aircraft,rol}),false);
  assert.equal(available({...aircraft,configurationConfigured:true}),false);
  assert.throws(()=>requireAircraftConfigurationCanary({source:'POSTGRES',session,aircraftId:'33333333-3333-4333-8333-333333333333'}),{code:'AIRCRAFT_CONFIGURATION_CANARY_DENIED'});
  process.env.VERCEL_ENV='production';assert.equal(available(aircraft),false);
});
test('proposed routing avoids Sheets write fallback and keeps Flights/Ownership off',t=>{
  proposedEnvironment(t);
  for(const key of ['GOOGLE_USER_RESOLUTION_SOURCE','AIRCRAFT_DATA_SOURCE','SETTINGS_DATA_SOURCE','HISTORIALES_DATA_SOURCE','FLIGHT_DATA_SOURCE'])assert.equal(resolveDataSource(key),'POSTGRES');
  assert.equal(resolvePostgresFlightWriteCapability(resolveDataSource('FLIGHT_DATA_SOURCE')).enabled,false);
  assert.equal(resolvePostgresOwnershipWriteCapability(resolveDataSource('AIRCRAFT_DATA_SOURCE')).enabled,false);
  assert.ok(!Object.keys(plan.environmentProposal.nonSecretOverrides).some(k=>/COST/.test(k)));
});
test('prepared verification artifacts contain SELECT only and exact input/Audit verification scope',async()=>{
  for(const name of ['preflight-readonly.sql','postflight-readonly.sql']){
    const sql=(await readFile(new URL(name,root),'utf8')).replace(/--[^\n]*/g,'');
    assert.doesNotMatch(sql,/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|CALL|DO)\b/i);
    assert.match(sql,new RegExp(plan.aircraftId));
  }
  const post=await readFile(new URL('postflight-readonly.sql',root),'utf8');
  assert.match(post,/jsonb_to_recordset\(\$1::jsonb\)/);
  assert.match(post,/EXCEPT ALL/);
  assert.match(post,/actor_user_id=\$2::uuid/);
  assert.match(post,/AIRCRAFT_CONFIGURATION_CREATED/);
});
