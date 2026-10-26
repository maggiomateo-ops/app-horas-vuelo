import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { HOURS_START_MODES, isHoursStartMode, proposedHoursReadiness, rejectUnsupportedHoursPlan } from '../src/utils/hoursStart.js';
import { buildAircraftConfigurationPayload, createAircraft, configureAircraftTopology, validateAircraftConfiguration } from '../src/services/aircraftService.js';
import { normalizeAircraftConfigurationInput } from '../api/_postgresAircraftConfigurationRepository.js';
import { syncComponents } from '../src/utils/aircraftConfigurationDraft.js';
const AIRCRAFT='22222222-2222-4222-8222-222222222222';

test('elección de inicio explícita; vacío/null y contador cero no implican modo',()=>{
  assert.deepEqual(HOURS_START_MODES.map(m=>m.id),['CURRENT_REFERENCE','HISTORICAL_IMPORT']);
  for(const value of ['',null,undefined,0,'0','IMPORT','OWNER_ENTRY'])assert.equal(isHoursStartMode(value),false);
  for(const {id} of HOURS_START_MODES)assert.equal(isHoursStartMode(id),true);
});
for(const {id} of HOURS_START_MODES){
  test(`modo ${id} no se filtra ni se envía como payload legacy`,async t=>{
    let writes=0;
    t.mock.method(globalThis,'fetch',async()=>{writes++;throw new Error('Request unexpected');});
    await assert.rejects(()=>createAircraft({registration:'LV-SIM',hoursStartMode:id}),{code:'HOURS_START_CONTRACT_PENDING'});
    await assert.rejects(()=>configureAircraftTopology(AIRCRAFT,{hoursStartMode:id}),{code:'HOURS_START_CONTRACT_PENDING'});
    assert.equal(writes,0);
  });
}
test('TSN/TSO no se convierten en opening_tis_hours ni se descartan silenciosamente',()=>{
  for(const field of ['installationTsnHours','installationTsoHours','referenceTsnHours','referenceTsoHours']){
    assert.throws(()=>rejectUnsupportedHoursPlan({components:[{[field]:''}]}),{code:'HOURS_START_CONTRACT_PENDING'});
    assert.throws(()=>rejectUnsupportedHoursPlan({[field]:0}),{code:'HOURS_START_CONTRACT_PENDING'});
  }
});
test('fecha propia por motor/hélice llega intacta al contrato legacy soportado',()=>{
  const values={propulsionType:'PISTON',engineCount:1,propellerCount:1,components:[
    {componentType:'ENGINE',positionIndex:1,installedOn:'2020-01-02',openingTisHours:''},
    {componentType:'PROPELLER',positionIndex:1,installedOn:'2023-04-05',openingTisHours:''},
  ]};
  assert.equal(validateAircraftConfiguration(values).valid,true);
  const payload=buildAircraftConfigurationPayload(AIRCRAFT,values);
  const {action,...input}=payload;
  assert.equal(action,'setup-configuration');
  const normalized=normalizeAircraftConfigurationInput(input);
  assert.deepEqual(normalized.components.map(c=>c.installedOn),['2020-01-02','2023-04-05']);
  assert.ok(normalized.components.every(c=>c.openingTisHours===null));
  values.components[1].installedOn='2023-02-31';
  assert.equal(validateAircraftConfiguration(values).valid,false);
  values.components[1].installedOn='';
  assert.equal(validateAircraftConfiguration(values).valid,false);
});
test('N componentes inician con fechas y TSN/TSO desconocidos, no ceros; aislamiento de borrador',()=>{
  const first=syncComponents([],2,2);
  first[0].installedOn='2026-01-01'; first[0].installationTsnHours='42.1';
  const fresh=syncComponents([],2,2);
  assert.ok(fresh.every(c=>c.installedOn===''&&c.installationTsnHours===''&&c.installationTsoHours===''));
  const next=syncComponents(first,3,2);
  assert.equal(next[0].installedOn,'2026-01-01');
  assert.equal(next[0].installationTsnHours,'42.1');
  assert.equal(next[2].installationTsnHours,'');
});
test('política PROPUESTA no declara acumulados ni avisos por horas antes de conciliar',()=>{
  for(const state of [{},{technicalComplete:true,ownershipReady:true},{reconciliationComplete:true}]){
    assert.equal(proposedHoursReadiness(state).canShowHourAlerts,false);
    assert.equal(proposedHoursReadiness(state).canShowAbsoluteHours,false);
  }
  assert.equal(proposedHoursReadiness({technicalComplete:true,ownershipReady:true,reconciliationComplete:true,referenceKnown:true}).canRecord,true);
  assert.equal(proposedHoursReadiness({reconciliationComplete:true,referenceKnown:true}).canShowHourAlerts,true);
  assert.equal(proposedHoursReadiness({reconciliationComplete:true,referenceKnown:false,relativeWindowKnown:true}).canShowRelativeHourAlerts,true);
});
test('prototipo de onboarding no invoca callbacks de escritura ni pide fecha base arbitraria',async()=>{
  const source=await readFile(new URL('../src/components/FirstAircraftOnboarding.jsx',import.meta.url),'utf8');
  assert.match(source,/HoursStartChoice/);
  assert.doesNotMatch(source,/onCreate\(|fetch\(|baselineEffectiveDate|Fecha base/);
  const config=await readFile(new URL('../src/components/AircraftConfigurationOnboarding.jsx',import.meta.url),'utf8');
  assert.match(config,/component.installedOn/);
  assert.doesNotMatch(config,/onComplete\(|onClick=\{handleConfirm\}/);
  assert.match(config,/Guardado pendiente de habilitación/);
});
test('schema propuesto fuera del runner, sin grants/backfill ni UPDATE de revisiones',async()=>{
  const files=await readdir(new URL('../db/migrations/',import.meta.url));
  assert.ok(!files.some(f=>/hours_start|reconciliation/.test(f)));
  const sql=await readFile(new URL('../docs/proposals/hours-start/schema.sql',import.meta.url),'utf8');
  assert.match(sql,/PROPOSAL ONLY/);
  assert.match(sql,/aircraft_hours_plan_revisions/);
  assert.match(sql,/hours_reconciliation_confirmations/);
  assert.doesNotMatch(sql,/\bGRANT\b|\bUPDATE app\.|\bINSERT INTO app\./);
});
test('TSN/TSO locales conservan desconocidos y rechazan negativos/precisión no soportada',()=>{
  const values={propulsionType:'PISTON',engineCount:1,propellerCount:1,components:syncComponents([],1,1).map(c=>({...c,installedOn:'2026-01-01'}))};
  assert.equal(validateAircraftConfiguration(values).valid,true);
  values.components[0].installationTsnHours='-1';
  assert.equal(validateAircraftConfiguration(values).valid,false);
  values.components[0].installationTsnHours='2.12';
  assert.equal(validateAircraftConfiguration(values).valid,false);
  values.components[0].installationTsnHours='0';
  assert.equal(validateAircraftConfiguration(values).valid,true);
});
