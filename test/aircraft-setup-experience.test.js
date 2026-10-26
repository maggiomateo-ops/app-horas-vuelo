import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { COUNTRIES, searchCountries } from '../src/utils/countries.js';
import { ownershipStatus } from '../src/utils/ownershipPresentation.js';
import { mapPostgresAircraftRow } from '../api/_postgresAircraftRepository.js';
import { syncComponents } from '../src/utils/aircraftConfigurationDraft.js';
import { buildAircraftOnboardingPayload, buildAircraftConfigurationPayload, validateAircraftConfiguration } from '../src/services/aircraftService.js';

test('catálogo ISO-2 completo, único y en español; búsqueda sin acentos y por código', () => {
  assert.equal(COUNTRIES.length,249);
  assert.equal(new Set(COUNTRIES.map(c=>c.code)).size,249);
  assert.ok(COUNTRIES.every(c=>/^[A-Z]{2}$/.test(c.code)&&c.name.length>2));
  assert.equal(searchCountries('espana')[0].code,'ES');
  assert.equal(searchCountries('AR')[0].code,'AR');
  assert.ok(searchCountries('Estados Unidos').some(c=>c.code==='US'));
  assert.deepEqual(searchCountries('nunca-un-país'),[]);
  assert.ok(!COUNTRIES.some(c=>['XK','ZZ','UK'].includes(c.code)));
});
test('selección conserva únicamente ISO-2 y no infiere país por matrícula LV', () => {
  const country=searchCountries('Argentina')[0];
  assert.equal(buildAircraftOnboardingPayload({registration:'LV-SIM',countryCode:country.code}).countryCode,'AR');
  assert.equal(buildAircraftOnboardingPayload({registration:'LV-SIM',countryCode:''}).countryCode,null);
});
test('titularidad canónica no se deriva de OWNER ni del legacy; no se publica detalle a otros roles', () => {
  const interest={ownershipInterestId:'legal',name:'Titular real',share:100};
  for(const rol of ['PILOT','VIEWER','ADMIN',undefined]) {
    assert.equal(mapPostgresAircraftRow({rol,ownershipInterests:[interest],ownerOptions:['LEGACY']}).ownershipInterests,undefined);
  }
  assert.deepEqual(mapPostgresAircraftRow({rol:'OWNER',ownershipInterests:[interest]}).ownershipInterests,[interest]);
  assert.equal(mapPostgresAircraftRow({rol:'OWNER',ownerOptions:['LEGACY']}).ownershipInterests,undefined);
});
test('vigencia legal distingue programada, vigente, finalizada y titular inactivo',()=>{
  const now=Date.parse('2026-10-20T12:00:00Z');
  const interest={effectiveFrom:'2026-01-01T00:00:00Z',effectiveTo:null,partyStatus:'ACTIVE'};
  assert.equal(ownershipStatus(interest,now),'Vigente');
  assert.equal(ownershipStatus({...interest,effectiveTo:'2026-10-20T12:00:00Z'},now),'Finalizada');
  assert.equal(ownershipStatus({...interest,effectiveFrom:'2027-01-01T00:00:00Z'},now),'Programada');
  assert.equal(ownershipStatus({...interest,partyStatus:'INACTIVE'},now),'Titular inactivo');
});
test('N posiciones conserva borradores por tipo/posición y horas desconocidas null',()=>{
  const components=syncComponents([{componentType:'ENGINE',positionIndex:2,serialNumber:'motor-2',openingTisHours:'15.2'}],3,2);
  assert.deepEqual(components.map(c=>`${c.componentType}:${c.positionIndex}`),['ENGINE:1','ENGINE:2','ENGINE:3','PROPELLER:1','PROPELLER:2']);
  const values={propulsionType:'PISTON',engineCount:3,propellerCount:2,components:components.map(c=>({...c,installedOn:'2026-10-20'}))};
  assert.equal(validateAircraftConfiguration(values).valid,true);
  const payload=buildAircraftConfigurationPayload('sim',values);
  assert.equal(payload.components[1].serialNumber,'motor-2');
  assert.equal(payload.components[1].openingTisHours,15.2);
  assert.equal(payload.components[0].openingTisHours,null);
  assert.ok(syncComponents([],3,2).every(c=>c.openingTisHours===''&&c.serialNumber===''));
  assert.equal(validateAircraftConfiguration({...values,engineCount:''}).valid,false);
  assert.equal(validateAircraftConfiguration({...values,engineCount:32768}).valid,false);
});
test('aeronave nueva mantiene configuración pendiente; no hereda instalaciones de otra',()=>{
  const old=mapPostgresAircraftRow({aircraft_id:'mhz',configurationConfigured:true,configuration:{engineCount:1},componentInstallations:[{componentId:'mhz-engine'}]});
  const fresh=mapPostgresAircraftRow({aircraft_id:'sim',configurationConfigured:false});
  assert.equal(old.componentInstallations.length,1);
  assert.equal(fresh.configuration,null);
  assert.deepEqual(fresh.componentInstallations,[]);
  assert.equal(fresh.configurationConfigured,false);
});
test('Settings ofrece configuración pendiente solo mediante permiso/gate existente y conserva opciones legacy',async()=>{
  const app=await readFile(new URL('../src/App.jsx',import.meta.url),'utf8');
  assert.match(app,/configurationConfigured \|\| canConfigureAircraft/);
  assert.match(app,/selectedAircraftRole === "OWNER"\s*&& selectedAircraft\?\.configurationSetupAvailable === true/);
  const settings=await readFile(new URL('../src/components/SettingsPanel.jsx',import.meta.url),'utf8');
  assert.match(settings,/Opciones de propietario del formulario/);
  assert.match(settings,/operationalConfig.ownerOptions/);
  assert.match(settings,/no modifica la propiedad legal/i);
});
test('la lectura legal queda acotada a aeronave y membresía OWNER activa, sin contactos privados',async()=>{
  const repository=await readFile(new URL('../api/_postgresAircraftRepository.js',import.meta.url),'utf8');
  const legal=repository.slice(repository.indexOf('LEFT JOIN LATERAL (\n        SELECT COALESCE(jsonb_agg'),repository.indexOf('WHERE membership.user_id'));
  assert.match(legal,/interest.aircraft_id = aircraft.aircraft_id AND membership.role = 'OWNER'/);
  assert.match(repository,/membership.user_id = \$1::uuid\s*AND membership.status = 'ACTIVE'/);
  assert.doesNotMatch(legal,/email|user_person_links|INSERT|UPDATE|DELETE/);
});
