import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { buildInstallationHistories } from '../api/_postgresHistorialesParityAdapter.js';
import { normalizeAircraftConfigurationInput, createPostgresAircraftConfigurationRepository } from '../api/_postgresAircraftConfigurationRepository.js';
import { syncComponents } from '../src/utils/aircraftConfigurationDraft.js';
import { buildAircraftConfigurationPayload, validateAircraftConfiguration } from '../src/services/aircraftService.js';
const SIM='96d849aa-2827-4aa3-b02b-6671577444a7';
const USER='11111111-1111-4111-8111-111111111111';
const draft=()=>({trackingMode:'CURRENT_REFERENCE',propulsionType:'PISTON',engineCount:2,propellerCount:2,
  components:syncComponents([],2,2).map(c=>({...c,trackingStartedOn:'2026-10-20'}))});
function input(values=draft()){const {action:_action,...body}=buildAircraftConfigurationPayload(SIM,values);return body;}
const install=(extra={})=>({component_installation_id:'fixture',component_type:'ENGINE',position_index:1,installed_on:null,tracking_started_on:'2026-10-20',tracking_reference_tis_hours:null,opening_tis_hours:null,...extra});
const flight=(id,date,tis,ft=0.8)=>({flight_id:id,flight_date:date,time_in_service_hours:tis,flight_time_hours:ft});
test('explicit mode and mandatory tracking date; physical unknown and zero distinct from NULL',()=>{
 const values=draft();assert.equal(validateAircraftConfiguration(values).valid,true);
 const normalized=normalizeAircraftConfigurationInput(input(values));assert.equal(normalized.components.length,4);
 assert.ok(normalized.components.every(c=>c.installedOn===null&&c.trackingReferenceTisHours===null&&c.openingTisHours===null));
 values.components[0].trackingReferenceTisHours='0';assert.equal(normalizeAircraftConfigurationInput(input(values)).components[0].trackingReferenceTisHours,0);
 for(const mode of ['',null,'HISTORICAL_IMPORT']){values.trackingMode=mode;assert.equal(validateAircraftConfiguration(values).valid,false);assert.throws(()=>normalizeAircraftConfigurationInput(input(values)));}
});
test('reject invalid dates, tracking before known installation, extra precision and installation balance substitution',()=>{
 for(const patch of [{trackingStartedOn:''},{installedOn:'2026-02-30'},{trackingStartedOn:'2026-02-29'},
  {installedOn:'2026-10-21'},{trackingReferenceTisHours:'12.34'},{trackingReferenceTisHours:'-1'}]){
  const values=draft();Object.assign(values.components[0],patch);
  assert.equal(validateAircraftConfiguration(values).valid,false);
  // Preserve original textual precision in direct API requests.
  const body=input();Object.assign(body.components[0],patch);assert.throws(()=>normalizeAircraftConfigurationInput(body));
 }
 const body=input();body.components[0].openingTisHours=1;assert.throws(()=>normalizeAircraftConfigurationInput(body));
});
test('2+2 attribution inclusive start, FT independent from TIS, reference separate from relative utilization',()=>{
 const flights=[flight('before','2026-10-19',9),flight('one','2026-10-20',1.2),flight('two','2026-10-21',0.4)];
 const installations=['ENGINE','PROPELLER'].flatMap(type=>[1,2].map(p=>install({component_installation_id:`${type}-${p}`,component_type:type,position_index:p,tracking_reference_tis_hours:p===1?100:null})));
 const result=buildInstallationHistories(flights,installations,new Map());
 for(const h of result){assert.equal(h.rows.length,2);assert.equal(h.trackedUtilizationHours,1.6);assert.equal(h.rows[0].utilizacionDesdeInicio,1.2);assert.equal(h.absoluteTisHours,h.positionIndex===1?101.6:null);}
 assert.equal(flights[1].flight_time_hours,0.8);
 const corrected=buildInstallationHistories([flight('one','2026-10-20',0.7)],installations,new Map());
 assert.equal(corrected[0].trackedUtilizationHours,0.7);
 const voided=buildInstallationHistories([],installations,new Map());assert.equal(voided[0].trackedUtilizationHours,0);assert.equal(voided[1].absoluteTisHours,null);
 // Repository supplies ACTIVE current revisions only; no superseded revision enters projection.
});
test('replacement and missing date/TIS evidence never double count or fabricate utilization',()=>{
 const flights=[flight('one','2026-10-20',1.2),flight('two','2026-10-21',0.4),flight('undated',null,8)];
 const r=buildInstallationHistories(flights,[install({removed_on:'2026-10-21'}),install({component_installation_id:'new',installed_on:'2026-10-21',tracking_started_on:'2026-10-21'})],new Map());
 assert.equal(r[0].trackedUtilizationHours,1.2);assert.equal(r[1].trackedUtilizationHours,0.4);
 const unknown=buildInstallationHistories([flight('x','2026-10-20',null)],[install({tracking_reference_tis_hours:100})],new Map())[0];
 assert.equal(unknown.absoluteTisHours,null);assert.equal(unknown.trackedUtilizationHours,null);
 const legacy=buildInstallationHistories([flight('x','2022-10-26',1.2)],[install({tracking_started_on:null,opening_tis_hours:99.9})],new Map())[0];
 assert.equal(legacy.rows[0].tiempoTotalEnServicio,101.1);assert.equal(legacy.trackedUtilizationHours,null);
});
test('schema gate prevents every INSERT; failures of component/Audit roll back whole repository transaction',async()=>{
 for(const failure of ['schema','component','audit']){
  const sqls=[];let rolledBack=false;let committed=false;
  const setup=createPostgresAircraftConfigurationRepository({transaction:async work=>{
   try{const r=await work({query:async(sql)=>{sqls.push(sql);
    if(sql.includes('FROM app.aircraft aircraft'))return {rows:[{aircraft_id:SIM,manufacturer:'Piper',model:'PA-34 Seneca'}]};
    if(sql.includes('information_schema.columns'))return {rows:[{field_count:failure==='schema'?0:2}]};
    if((failure==='component'&&sql.includes('INSERT INTO app.components'))||(failure==='audit'&&sql.includes('INSERT INTO audit.audit_events')))throw new Error('fixture failure');
    return {rows:[]};}});committed=true;return r;}catch(e){rolledBack=true;throw e;}
  }});
  await assert.rejects(setup({userId:USER,input:input()}));assert.equal(committed,false);assert.equal(rolledBack,true);
  if(failure==='schema')assert.ok(sqls.every(sql=>!sql.includes('INSERT INTO')));
 }
});
test('010 is guarded additive only; official 008 checksum exact; operational histories stay ACTIVE/current revision scoped',async()=>{
 const sql=await readFile(new URL('../db/migrations/010_component_tracking_reference_v1.sql',import.meta.url),'utf8');
 assert.match(sql,/ADD COLUMN tracking_started_on date/);assert.match(sql,/numeric\(10,1\)/);assert.match(sql,/approved_test/);
 assert.doesNotMatch(sql,/UPDATE app\.|INSERT INTO|CREATE TABLE|GRANT /);
 const official=await readFile(new URL('../db/migrations/008_costs_financial_scopes_and_open_corrections.sql',import.meta.url));
 assert.equal(createHash('sha256').update(official).digest('hex'),'30df860f6ba51617e93c55be21e8d2355aba734977dfb3db6bf0776b5c07c160');
 const repository=await readFile(new URL('../api/_postgresHistoriesRepository.js',import.meta.url),'utf8');
 assert.match(repository,/flight.status = 'ACTIVE'/);assert.match(repository,/current_revision_id/);assert.match(repository,/flight.aircraft_id = \$1::uuid/);
});

test('failed fresh GET cannot masquerade as verified persistence or trigger a second PATCH',async()=>{
 const {configureAircraftTopologyAndRefresh,getAircraftConfigurationErrorMessage}=await import('../src/services/aircraftService.js');
 let writes=0;
 await assert.rejects(configureAircraftTopologyAndRefresh(SIM,draft(),{configureRequest:async()=>{writes++;return {ok:true};},loadAircrafts:async()=>{throw Error('offline');}}),{code:'AIRCRAFT_CONFIGURATION_READBACK_REQUIRED'});
 assert.equal(writes,1);
 assert.match(getAircraftConfigurationErrorMessage({code:'AIRCRAFT_TRACKING_SCHEMA_REQUIRED',statusCode:409}),/pendiente/);
});

test('runner accepts the numbering gap and skips the exact applied 008 without executing DDL',async()=>{
 const runner=await readFile(new URL('../db/migrate.js',import.meta.url),'utf8');
 const a=runner.indexOf('async function applyMigration('),b=runner.indexOf('\nasync function main()',a);
 const apply=new Function(`${runner.slice(a,b)}; return applyMigration;`)();
 const filename='008_costs_financial_scopes_and_open_corrections.sql';
 const bytes=await readFile(new URL(`../db/migrations/${filename}`,import.meta.url),'utf8');
 const checksum=createHash('sha256').update(bytes).digest('hex');
 const queries=[];
 const client={query:async sql=>{queries.push(sql);return {rowCount:1,rows:[{filename,checksum_sha256:checksum}]};}};
 await apply(client,{version:'008',filename,checksum,sql:bytes});
 assert.equal(queries.length,1);assert.match(queries[0],/^SELECT/);
 await assert.rejects(apply(client,{version:'008',filename,checksum:'mismatch',sql:bytes}),/different content/);
 assert.match(runner,/\^\(\\d\{3\}\)_/);assert.doesNotMatch(runner,/previousVersion|version\s*\+\s*1/);
});
