import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { evaluateCounter, reviewImportRows, assessAcceptance, acceptanceIsCurrent, proposeSuccessor, confirmationReplay } from '../docs/proposals/hours-start/accounting-examples.mjs';
const A='aircraft-a', B='aircraft-b';
const segment=(hours, overrides={})=>({aircraftId:A,subjectId:'engine-old',installationId:'install-old',flightRevisionId:'r1',basis:'ENGINE_RUNTIME',hours,datePrecision:'DATE',applicable:true,current:true,status:'ACTIVE',overhaulEpisodeId:'overhaul-1',...overrides});
const counter=(reference,segments,overrides={})=>evaluateCounter({reference,segments,metric:'TSN',basis:'ENGINE_RUNTIME',aircraftId:A,subjectId:'engine-old',...overrides});

test('lecturas al instalar vs referencia: 1200/100 → 1230/130 → 1232/132',()=>{
  assert.equal(counter('1200.0',[segment('30.0')]).value,'1230.0');
  assert.equal(counter('100.0',[segment('30.0')],{metric:'TSO',overhaulEpisodeId:'overhaul-1'}).value,'130.0');
  assert.equal(counter('1230.0',[segment('2.0')]).value,'1232.0');
  assert.equal(counter('130.0',[segment('2.0')],{metric:'TSO',overhaulEpisodeId:'overhaul-1'}).value,'132.0');
  // Missing install→reference period cannot be manufactured.
  assert.equal(counter('1200.0',[segment('2.0')],{coverageKnown:false}).value,null);
});
test('casco TIS 2000+1.0 y motor runtime 1230+1.3 son 2001 y 1231.3, no intercambiables',()=>{
  assert.equal(counter('2000.0',[segment('1.0',{basis:'TIS',subjectId:'airframe'})],{basis:'TIS',subjectId:'airframe',metric:'AIRFRAME_TIS'}).value,'2001.0');
  assert.equal(counter('1230.0',[segment('1.3')]).value,'1231.3');
  assert.equal(counter('1230.0',[segment('1.0',{basis:'TIS'})]).issue,'INCOMPATIBLE_BASIS');
});
test('reemplazo motor/hélice conserva historia física y no hereda contador anterior',()=>{
  assert.equal(counter('500.0',[segment('2.0')]).value,'502.0');
  assert.equal(counter('10.0',[segment('3.0',{subjectId:'engine-new',installationId:'install-new'})],{subjectId:'engine-new'}).value,'13.0');
  assert.equal(counter('500.0',[segment('3.0',{subjectId:'engine-new'})]).issue,'SCOPE_MISMATCH');
  assert.equal(counter('800.0',[segment('2.0',{subjectId:'prop-old',basis:'TIS'})],{subjectId:'prop-old',basis:'TIS'}).value,'802.0');
  assert.equal(counter('20.0',[segment('3.0',{subjectId:'prop-new',basis:'TIS'})],{subjectId:'prop-new',basis:'TIS'}).value,'23.0');
});
test('overhaul no reinicia TSN; TSO necesita nueva lectura y episodio explícitos',()=>{
  assert.equal(counter('1000.0',[segment('10.0'),segment('5.0',{flightRevisionId:'r2',overhaulEpisodeId:'overhaul-2'})]).value,'1015.0');
  assert.equal(counter('100.0',[segment('10.0'),segment('5.0',{flightRevisionId:'r2',overhaulEpisodeId:'overhaul-2'})],{metric:'TSO',overhaulEpisodeId:'overhaul-1'}).issue,'OVERHAUL_EPISODE_MISMATCH');
  assert.equal(counter('0.0',[segment('5.0',{overhaulEpisodeId:'overhaul-2'})],{metric:'TSO',overhaulEpisodeId:'overhaul-2'}).value,'5.0');
  assert.equal(counter('0.0',[segment('5.0')],{metric:'TSO'}).value,null);
});
test('superposición: duplicado verificado excluido; similitud ambigua no se incorpora automáticamente',()=>{
  const rows=reviewImportRows([
    {aircraftId:A,verifiedIdentity:'known-1',datePrecision:'DATE'},
    {aircraftId:A,verifiedIdentity:'new-2',datePrecision:'DATE'},
    {aircraftId:A,datePrecision:'DATE',possibleDuplicate:true},
  ],{aircraftId:A,accountedIdentities:new Set(['known-1'])});
  assert.deepEqual(rows.map(r=>r.disposition),['EXCLUDE_VERIFIED_DUPLICATE','INCLUDE','REQUIRES_REVIEW']);
  // Accepted reading already covers the excluded flight. Only new delta is eligible.
  assert.equal(counter('100.0',[segment('2.0')]).value,'102.0');
  assert.equal(counter('100.0',[segment('2.0'),segment('2.0')]).issue,'DUPLICATE_ATTRIBUTION');
});
test('fechas MONTH/YEAR/UNKNOWN y atribuciones ambiguas permanecen pendientes, sin fecha inventada',()=>{
  for(const precision of ['MONTH','YEAR','UNKNOWN']){
    const [row]=reviewImportRows([{aircraftId:A,datePrecision:precision}],{aircraftId:A});
    assert.equal(row.issue,'INCOMPLETE_DATE');
    assert.equal(counter('100.0',[segment('2.0',{datePrecision:precision})]).value,null);
  }
  assert.equal(counter('100.0',[segment('2.0',{applicable:false})]).issue,'AMBIGUOUS_PERIOD');
});
test('NULL nunca es cero; cero declarado sí es dato; deltas desconocidos no se suman',()=>{
  assert.equal(counter(null,[segment('2.0')]).value,null);
  assert.equal(counter('0.0',[segment('2.0')]).value,'2.0');
  assert.equal(counter('100.0',[segment(null)]).value,null);
  assert.equal(counter('100.0',[],{basis:'DECLARED_ONLY'}).value,null);
});
const snapshot={aircraftId:A,revisionStatusPairs:['r1:ACTIVE'],installationHash:'i1',referenceHash:'b1',mappingHash:'m1',episodeHash:'o1',adjustmentHash:'j1',sourceHash:'s1',algorithmVersion:'v1',policyVersion:'p1'};
test('corrección/VOID/retroactivo invalidan aceptación sin modificar snapshot anterior',()=>{
  assert.equal(acceptanceIsCurrent(snapshot,{...snapshot}),true);
  for(const pairs of [['r2:ACTIVE'],['r1:VOIDED'],['r1:ACTIVE','r3:ACTIVE']])assert.equal(acceptanceIsCurrent(snapshot,{...snapshot,revisionStatusPairs:pairs}),false);
  assert.deepEqual(snapshot.revisionStatusPairs,['r1:ACTIVE']);
  assert.equal(counter('100.0',[segment('2.0',{current:false})]).issue,'STALE_INPUT');
  assert.equal(counter('100.0',[segment('2.0',{status:'VOIDED'})]).issue,'STALE_INPUT');
});
test('cambios de instalación, referencia, mapeo o algoritmo requieren otra validación',()=>{
  for(const key of ['installationHash','referenceHash','mappingHash','episodeHash','adjustmentHash','sourceHash','algorithmVersion','policyVersion'])assert.equal(acceptanceIsCurrent(snapshot,{...snapshot,[key]:'changed'}),false);
});
const fixturePolicy={version:'fixture-exact-v1',toleranceHours:'0.0',approvalReference:'TEST FIXTURE ONLY - NO FUNCTIONAL APPROVAL'};
test('ni diferencia cero confirma sin política aprobada y revisión explícita',()=>{
  assert.equal(assessAcceptance({derived:'100.0',observed:'100.0'}).issue,'POLICY_NOT_APPROVED');
  assert.equal(assessAcceptance({derived:'100.0',observed:'100.0',policy:fixturePolicy}).issue,'EXPLICIT_REVIEW_REQUIRED');
  assert.equal(assessAcceptance({derived:'100.0',observed:'100.0',policy:fixturePolicy,explicitlyReviewed:true}).confirmable,true);
});
test('discrepancia 0.1 no se redondea ni acepta con tolerancia exacta propuesta',()=>{
  assert.deepEqual(assessAcceptance({derived:'100.1',observed:'100.0',policy:fixturePolicy,explicitlyReviewed:true}),{confirmable:false,difference:'0.1',issue:'DISCREPANCY'});
  assert.equal(assessAcceptance({derived:'99.9',observed:'100.0',policy:fixturePolicy,explicitlyReviewed:true}).difference,'-0.1');
});
test('gaps/desconocidos/ambigüedad bloquean aun si el total numérico coincide',()=>{
  for(const issue of ['GAP','UNKNOWN','AMBIGUOUS'])assert.equal(assessAcceptance({derived:'100.0',observed:'100.0',issues:[issue],policy:fixturePolicy,explicitlyReviewed:true}).confirmable,false);
  assert.equal(assessAcceptance({derived:null,observed:'0.0',policy:fixturePolicy,explicitlyReviewed:true}).difference,null);
});
test('scope de aeronave se verifica en datos candidatos y cálculos',()=>{
  assert.equal(counter('100.0',[segment('2.0',{aircraftId:B})]).issue,'SCOPE_MISMATCH');
  assert.equal(reviewImportRows([{aircraftId:B,datePrecision:'DATE'}],{aircraftId:A})[0].issue,'SCOPE_MISMATCH');
});
test('sucesora requiere head exacto, misma aeronave y secuencia consecutiva',()=>{
  const head={id:'a1',aircraftId:A,sequence:1};
  assert.equal(proposeSuccessor({aircraftId:A,head,predecessorId:'a1',sequence:2,runId:'run2'}).sequence,2);
  for(const args of [{aircraftId:B,head,predecessorId:'a1',sequence:2},{aircraftId:A,head,predecessorId:'a1',sequence:3},{aircraftId:A,head:{...head,id:'a2',sequence:2},predecessorId:'a1',sequence:2}])assert.throws(()=>proposeSuccessor(args));
  assert.throws(()=>proposeSuccessor({aircraftId:A,head:null,predecessorId:null,sequence:2}));
});
test('reintento idempotente devuelve el resultado, otro payload/actor/run no reutiliza clave',()=>{
  const existing={aircraftId:A,actorId:'owner1',runId:'run1',payloadHash:'hash1',result:{acceptanceId:'a1'}};
  assert.equal(confirmationReplay(existing,{...existing}),existing.result);
  for(const key of ['aircraftId','actorId','runId','payloadHash'])assert.throws(()=>confirmationReplay(existing,{...existing,[key]:'other'}),/IDEMPOTENCY_CONFLICT/);
});
test('DDL: PK por run permite snapshots múltiples y FK atan revisión/instalación a aeronave y run',async()=>{
  const sql=await readFile(new URL('../docs/proposals/hours-start/schema.sql',import.meta.url),'utf8');
  assert.match(sql,/PRIMARY KEY\(reconciliation_run_id,flight_revision_id,component_installation_id,usage_basis\)/);
  assert.match(sql,/FOREIGN KEY\(aircraft_id,reconciliation_run_id,flight_id,flight_revision_id\) REFERENCES app.hours_reconciliation_flights/);
  assert.match(sql,/FOREIGN KEY\(aircraft_id,reconciliation_run_id,component_installation_id\) REFERENCES app.hours_reconciliation_installations/);
  assert.match(sql,/FOREIGN KEY\(flight_id,flight_revision_id\) REFERENCES app.flight_record_revisions\(flight_id,flight_revision_id\)/);
  const keys=['run1','run2'].map(run=>`${run}:revision1:installation1:TIS`);
  assert.equal(new Set(keys).size,2);
});
test('DDL: staging independiente sin Flight Record operativo, lineage al confirmar e idempotencia',async()=>{
  const sql=await readFile(new URL('../docs/proposals/hours-start/schema.sql',import.meta.url),'utf8');
  const staging=sql.slice(sql.indexOf('CREATE TABLE app.hours_import_staged_rows'),sql.indexOf('CREATE TABLE app.hours_counter_references'));
  assert.doesNotMatch(staging,/REFERENCES app.flight_records|INSERT INTO/);
  assert.match(staging,/source_row_sha256/);
  assert.match(sql,/CREATE TABLE app.hours_import_committed_rows/);
  assert.match(sql,/request_payload_sha256/);
  assert.match(sql,/UNIQUE\(supersedes_acceptance_id\)/);
  assert.match(sql,/acceptance_sequence=predecessor_sequence\+1/);
});
test('rollback lista toda tabla propuesta en orden inverso, sin CASCADE; no SQL ejecutado',async()=>{
  const sql=await readFile(new URL('../docs/proposals/hours-start/schema.sql',import.meta.url),'utf8');
  const rollback=await readFile(new URL('../docs/proposals/hours-start/rollback.sql',import.meta.url),'utf8');
  const created=[...sql.matchAll(/CREATE TABLE app\.(\w+)/g)].map(m=>m[1]);
  const dropped=[...rollback.matchAll(/^DROP TABLE app\.(\w+)/gm)].map(m=>m[1]);
  assert.deepEqual(dropped,[...created].reverse());
  assert.doesNotMatch(rollback,/^DROP .*CASCADE/gm);
  assert.equal([...sql.matchAll(/ADD CONSTRAINT uq_hours_/g)].length,3);
  assert.equal([...rollback.matchAll(/DROP CONSTRAINT uq_hours_/g)].length,3);
});
test('F4 rechaza tolerancias positivas incluso con reconocimiento individual',()=>{
  const hypotheticalPolicy={...fixturePolicy,toleranceHours:'0.1'}; // conditional fixture, never an approved tolerance
  assert.equal(assessAcceptance({derived:'100.1',observed:'100.0',policy:hypotheticalPolicy,explicitlyReviewed:true}).issue,'UNAPPROVED_TOLERANCE');
  assert.equal(assessAcceptance({derived:'100.1',observed:'100.0',policy:hypotheticalPolicy,explicitlyReviewed:true,discrepancyAcknowledged:true}).confirmable,false);
});
test('DDL exige episodio TSO conocido y FK al mismo componente físico/aeronave',async()=>{
  const sql=await readFile(new URL('../docs/proposals/hours-start/schema.sql',import.meta.url),'utf8');
  assert.match(sql,/CREATE TABLE app.hours_component_overhaul_episodes/);
  assert.match(sql,/FOREIGN KEY\(aircraft_id,component_id,overhaul_episode_id\) REFERENCES app.hours_component_overhaul_episodes/);
  assert.match(sql,/metric<>'TSO' OR value_seconds IS NULL OR overhaul_episode_id IS NOT NULL/);
  assert.match(sql,/CREATE TABLE app.hours_reconciliation_issues/);
});
test('fingerprint incompleto nunca equivale a aceptación vigente',()=>{
  assert.equal(acceptanceIsCurrent({...snapshot,sourceHash:undefined},{...snapshot,sourceHash:undefined}),false);
});
test('casco no usa runtime y TSO requiere episodio aun sin deltas',()=>{
  assert.equal(counter('100.0',[],{metric:'AIRFRAME_TIS'}).issue,'INCOMPATIBLE_BASIS');
  assert.equal(counter('100.0',[],{metric:'TSO'}).issue,'OVERHAUL_EPISODE_MISMATCH');
});
