import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canCorrectIdentity,loadIdentityReview,correctIdentityAndReadback,SIM_ID } from '../src/services/aircraftIdentityService.js';
import { requireFunctionalCanaryIfConfigured,functionalPilotWritesEnabled } from '../api/_functionalCanary.js';
import { buildInstallationHistories } from '../api/_postgresHistorialesParityAdapter.js';
const snapshot={manufacturer:'Cessna',model:'C182',serialNumber:'FIXTURE',updatedAt:'2026-10-20T12:00:00.123456Z'};
const aircraft={aircraft_id:SIM_ID,rol:'OWNER',identityCorrectionAvailable:true,identityCorrectionSnapshot:snapshot};
test('identity UI review loads fresh authenticated data without mutating or filling configuration',async()=>{
  let calls=0;const result=await loadIdentityReview(SIM_ID,{load:async()=>{calls++;return [aircraft];}});
  assert.equal(calls,1);assert.deepEqual(result.snapshot,snapshot);
  for(const patch of [{rol:'VIEWER'},{aircraft_id:'other'},{identityCorrectionAvailable:false}])assert.equal(canCorrectIdentity({...aircraft,...patch}),false);
});
test('identity confirmation preserves exact version, sends explicit NULL and verifies separate GET',async()=>{
  const order=[];const after={...aircraft,fabricante:'Piper',modelo:'PA-34 Seneca',identityCorrectionSnapshot:{...snapshot,serialNumber:null}};
  const result=await correctIdentityAndReadback(SIM_ID,snapshot,{request:async(url,options)=>{
    order.push('PATCH');assert.equal(url,'/api/aircraft');assert.equal(options.credentials,'include');
    const body=JSON.parse(options.body);assert.deepEqual(body.expected,snapshot);assert.equal(body.serialNumber,null);
    return {ok:true,status:200,json:async()=>({ok:true})};
  },load:async()=>{order.push('GET');return [after];}});
  assert.deepEqual(order,['PATCH','GET']);assert.equal(result.aircraft.modelo,'PA-34 Seneca');
});
test('identity failure or failed readback cannot produce successful result',async()=>{
  await assert.rejects(correctIdentityAndReadback(SIM_ID,snapshot,{request:async()=>({status:409,ok:false,json:async()=>({error:'Conflict'})})}),/Conflict/);
  await assert.rejects(correctIdentityAndReadback(SIM_ID,snapshot,{request:async()=>({status:200,ok:true,json:async()=>({ok:true})}),load:async()=>[aircraft]}),/verificar/);
});
function scoped(t){
  const values={POSTGRES_V1_FUNCTIONAL_CANARY_AIRCRAFT_ID:SIM_ID,VERCEL_GIT_COMMIT_REF:'codex/lv-sim-v1-functional',VERCEL_ENV:'preview',POSTGRES_FLIGHT_WRITES_ENABLED:'true',DATABASE_URL:'postgresql://app_horas_runtime:fixture@ep-jolly-sun-b6a3ayw9.c-2.sa-east-1.aws.neon.tech/app_horas'};
  const old=Object.fromEntries(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);
  t.after(()=>{for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
  return {source:'POSTGRES',session:{version:2,userId:'11111111-1111-4111-8111-111111111111'},aircraftId:SIM_ID};
}
test('functional scope guards flights ownership and pilot creation against other UUID or Production',t=>{
  const context=scoped(t);assert.doesNotThrow(()=>requireFunctionalCanaryIfConfigured(context));assert.equal(functionalPilotWritesEnabled(context),true);
  assert.throws(()=>requireFunctionalCanaryIfConfigured({...context,aircraftId:'33333333-3333-4333-8333-333333333333'}));
  assert.throws(()=>requireFunctionalCanaryIfConfigured({...context,source:'SHEETS'}));
  process.env.VERCEL_ENV='production';assert.throws(()=>requireFunctionalCanaryIfConfigured(context));
});
test('functional branch cannot lose its UUID pin and inherit broad writes',t=>{
  const context=scoped(t);delete process.env.POSTGRES_V1_FUNCTIONAL_CANARY_AIRCRAFT_ID;
  assert.throws(()=>requireFunctionalCanaryIfConfigured(context));
});
test('2+2 histories preserve unknown absolute counters and keep Flight Time distinct from TIS',()=>{
  const flights=[{flight_id:'one',flight_date:'2026-10-26',time_in_service_hours:0.8,flight_time_hours:1.2}];
  const installs=['ENGINE','PROPELLER'].flatMap(type=>[1,2].map(pos=>({component_installation_id:`${type}-${pos}`,component_type:type,position_index:pos,installed_on:'2026-10-20',opening_tis_hours:null,adjustments:[]})));
  const result=buildInstallationHistories(flights,installs,new Map([['one',0.8]]));
  assert.equal(result.length,4);assert.ok(result.every(r=>r.rows.length===1&&r.rows[0].tiempoEnServicio===0.8));
  assert.ok(result.filter(r=>r.componentType==='ENGINE').every(r=>r.rows[0].tiempoTotalEnServicio===''));
  assert.ok(result.filter(r=>r.componentType==='PROPELLER').every(r=>r.rows[0].durg===''));
  assert.equal(flights.length,1);
});
test('replacement boundary attributes a flight only to the new installation',()=>{
  const flights=[{flight_id:'one',flight_date:'2026-10-26',time_in_service_hours:0.8}];
  const result=buildInstallationHistories(flights,[{component_installation_id:'old',component_type:'ENGINE',position_index:1,installed_on:'2020-01-01',removed_on:'2026-10-26',opening_tis_hours:100},{component_installation_id:'new',component_type:'ENGINE',position_index:1,installed_on:'2026-10-26',opening_tis_hours:null}],new Map());
  assert.equal(result[0].rows.length,0);assert.equal(result[1].rows.length,1);
});
test('canary ownership UI requires explicit legal input and acceptance, not inferred OWNER identity',async()=>{
  const source=await readFile(new URL('../src/components/AircraftOwnershipOnboarding.jsx',import.meta.url),'utf8');
  assert.match(source,/explicit \? "PERSON"/);assert.match(source,/explicit && !accepted/);
  const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');assert.match(app,/flightMutationAvailable !== false/);
});
