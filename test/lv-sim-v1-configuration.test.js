import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { syncComponents } from '../src/utils/aircraftConfigurationDraft.js';
import { validateAircraftConfiguration, buildAircraftConfigurationPayload, configureAircraftTopologyAndRefresh } from '../src/services/aircraftService.js';
import { normalizeAircraftConfigurationInput } from '../api/_postgresAircraftConfigurationRepository.js';
import { getPostgresPool, withPostgresTransaction } from '../api/_postgres.js';

const SIM='96d849aa-2827-4aa3-b02b-6671577444a7';
const dates=['2024-02-29','2025-01-02','2023-07-03','2026-09-04'];
function draft(engines=2,propellers=2){
  return {trackingMode:'CURRENT_REFERENCE',propulsionType:'PISTON',engineCount:String(engines),propellerCount:String(propellers),
    components:syncComponents([],engines,propellers).map((c,i)=>({...c,installedOn:dates[i%4],trackingStartedOn:"2026-10-20"}))};
}
function normalized(values){const {action: _action,...input}=buildAircraftConfigurationPayload(SIM,values);return normalizeAircraftConfigurationInput(input);}

test('V1 monomotor y bimotor 2+2 conservan fechas individuales hasta el contrato servidor',()=>{
  for(const [engines,propellers] of [[1,1],[2,2]]){
    const values=draft(engines,propellers);
    assert.equal(validateAircraftConfiguration(values).valid,true);
    const result=normalized(values);
    assert.equal(result.components.length,engines+propellers);
    assert.deepEqual(result.components.map(c=>c.installedOn),dates.slice(0,engines+propellers));
    assert.equal(new Set(result.components.map(c=>`${c.componentType}:${c.positionIndex}`)).size,engines+propellers);
  }
});
test('V1 N posiciones y contadores/identidad desconocidos no se inventan ni heredan',()=>{
  const values=draft(3,3);const result=normalized(values);
  assert.equal(result.components.length,6);
  for(const c of result.components){
    for(const field of ['manufacturer','model','serialNumber','openingTisHours'])assert.equal(c[field],null);
  }
  assert.ok(syncComponents([],2,2).every(c=>c.installedOn===''));
  assert.ok(syncComponents(values.components,4,3).filter(c=>c.positionIndex<=3).every(c=>c.installedOn));
  assert.equal(syncComponents(values.components,4,3).find(c=>c.componentType==='ENGINE'&&c.positionIndex===4).installedOn,'');
});
test('V1 fechas obligatorias e imposibles fallan en cliente y servidor sin fallback global',()=>{
  for(const date of ['',null,'2025-02-29','2026-04-31','2026-13-01','2026-2-03']){
    const values=draft();values.installedOn='2026-01-01';values.components[1].trackingStartedOn=date;
    assert.ok(validateAircraftConfiguration(values).errors['ENGINE:2.trackingStartedOn']);
    assert.throws(()=>normalized(values),{code:'INVALID_AIRCRAFT_CONFIGURATION'});
  }
});
test('V1 décimas conservadas; negativos, precisión extra y campos TSN/TSO no compatibles rechazados',()=>{
  const values=draft();values.components[0].trackingReferenceTisHours='12.3';
  assert.equal(normalized(values).components[0].trackingReferenceTisHours,12.3);
  for(const hours of ['-1','12.34','NaN','1000000000']){
    values.components[0].trackingReferenceTisHours=hours;
    assert.ok(validateAircraftConfiguration(values).errors['ENGINE:1.trackingReferenceTisHours']);
    assert.throws(()=>normalized(values));
  }
  const {action: _action,...input}=buildAircraftConfigurationPayload(SIM,draft());
  input.components[0].tsnHours=123;
  assert.throws(()=>normalizeAircraftConfigurationInput(input),{code:'UNSUPPORTED_AIRCRAFT_CONFIGURATION_FIELDS'});
});
test('V1 posiciones repetidas o faltantes no pasan revisión ni contrato de servidor',()=>{
  const values=draft();values.components[1]={...values.components[0]};
  assert.equal(validateAircraftConfiguration(values).valid,false);
  const input={trackingMode:'CURRENT_REFERENCE',aircraftId:SIM,propulsionType:'PISTON',engineCount:2,propellerCount:2,components:values.components};
  assert.throws(()=>normalizeAircraftConfigurationInput(input),{code:'INVALID_AIRCRAFT_TOPOLOGY'});
  assert.equal(validateAircraftConfiguration({...draft(),components:[]}).valid,false);
});
test('readback usa los valores leídos del servidor y aísla la otra aeronave',async()=>{
  const other={aircraft_id:'other',configurationConfigured:true,componentInstallations:[{serialNumber:'OTHER'}]};
  const stored={aircraft_id:SIM,configurationConfigured:true,configuration:{propulsionType:'PISTON',engineCount:2,propellerCount:2},componentInstallations:normalized(draft()).components};
  const calls=[];
  const result=await configureAircraftTopologyAndRefresh(SIM,draft(),{
    currentAircrafts:[other,{aircraft_id:SIM}],
    configureRequest:async id=>{calls.push(id);return {ok:true};},
    loadAircrafts:async()=>[other,stored],
  });
  assert.deepEqual(calls,[SIM]);assert.strictEqual(result.aircrafts[0],other);
  assert.deepEqual(result.aircrafts[1].componentInstallations.map(c=>c.installedOn),dates);
});
test('cancelar oculta sin borrar el borrador; formulario por aeronave y sin fecha global',async()=>{
  const source=await readFile(new URL('../src/components/AircraftConfigurationOnboarding.jsx',import.meta.url),'utf8');
  assert.match(source,/value={component.installedOn}/);
  assert.doesNotMatch(source,/values.installedOn|Fecha de instalación efectiva/);
  const cancel=source.slice(source.lastIndexOf('onClick={() => { setShowForm(false)'));
  assert.ok(cancel.includes('Cancelar'));assert.doesNotMatch(cancel,/setValues/);
  const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
  assert.match(app,/<AircraftConfigurationOnboarding\s+key={selectedAircraft.aircraft_id}/);
});
test('wrapper transaccional real revierte fallo intermedio y fallo Audit; no COMMIT',async()=>{
  const previous=process.env.DATABASE_URL;
  process.env.DATABASE_URL='postgresql://fixture:fixture@localhost:1/fixture';
  const pool=getPostgresPool();const originalConnect=pool.connect;
  try{
    for(const failure of ['component','audit']){
      const queries=[];let released=false;
      pool.connect=async()=>({query:async sql=>{queries.push(sql);if(sql===failure)throw new Error('synthetic failure');},release:()=>{released=true;}});
      await assert.rejects(withPostgresTransaction(async client=>{
        await client.query('configuration');await client.query('component');await client.query('audit');
      },{isolationLevel:'SERIALIZABLE'}),/synthetic failure/);
      assert.deepEqual(queries.slice(0,2),['BEGIN','SET TRANSACTION ISOLATION LEVEL SERIALIZABLE']);
      assert.equal(queries.at(-1),'ROLLBACK');assert.ok(!queries.includes('COMMIT'));assert.equal(released,true);
    }
  }finally{pool.connect=originalConnect;await pool.end();if(previous===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previous;}
});
