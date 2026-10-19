import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeExpense, allocationRows, decimalUnits, utilizationWeights, selectCostFlights } from '../api/_costsDomain.js';
import { createPostgresCostsRepository } from '../api/_postgresCostsRepository.js';
import { createCostsHttpHandler } from '../api/_costsHttp.js';
import { costsRequest, buildCostExpenseForm } from '../src/services/costsService.js';
import { splitPostgresStatements, buildCosts008Preflight, COSTS_PREFLIGHT_TARGET, runCosts008Preflight } from '../scripts/lib/costs-008-preflight.mjs';
import { readFileSync } from 'node:fs';
import { buildCostsAuthorityPlan } from '../scripts/lib/costs-authority-provisioning.mjs';
import settingsHandler from '../api/settings.js';
import { createSessionCookie } from '../api/_auth.js';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USER=id(1), AIRCRAFT=id(2), SCOPE=id(3), A=id(4), B=id(5), CONCEPT=id(6), EVENT=id(7);
const args = { userId: USER, aircraftId: AIRCRAFT, scopeId: SCOPE };
const expense = (extra={}) => ({ cost_concept_id: CONCEPT, expense_date: '2026-10-01', amount: '100.00', currency_code: 'USD',
  allocation_method:'DIRECT', direct_party_id: A, description:'Seguro', payments:[{payer_party_id:B,amount:'100.00'}], ...extra });

function mock({ role='OWNER', enabled=true, authorized=true, active=true, locked=true, auditFails=false, failCode=null }={}) {
  const state = { cost_concepts:[{cost_concept_id:CONCEPT,aircraft_id:AIRCRAFT,status:'ACTIVE'}], cost_events:[],
    cost_financial_records:[{cost_concept_id:CONCEPT,financial_scope_id:SCOPE,aircraft_id:AIRCRAFT}], expenses:[], expense_payments:[], expense_allocations:[],
    cost_expense_corrections:[], cost_settlements:[], cost_settlement_expense_lines:[],cost_settlement_party_lines:[],cost_settlement_owner_lines:[],cost_settlement_utilization_lines:[], audit_events:[] };
  let seq=100; const calls=[];
  const client={ async query(sql,p=[]) {
    calls.push({sql,p});
    const found = values=>({rows:structuredClone(values)});
    if(sql.startsWith('SELECT user_id FROM app.users'))return found(active?[{user_id:USER}]:[]);
    if(sql.includes('to_regclass'))return found([{ready:'app.cost_financial_scopes'}]);
    if(sql.includes('pg_try_advisory'))return found([{locked}]);
    if(sql.startsWith('SELECT s.financial_scope_id'))return found(authorized && p[1]===SCOPE && p[2]===AIRCRAFT?[{financial_scope_id:SCOPE,aircraft_id:AIRCRAFT,label:'Archivo',owner:role==='OWNER'}]:[]);
    if(sql.startsWith('SELECT DISTINCT s.financial_scope_id'))return found(authorized?[{financial_scope_id:SCOPE,aircraft_id:AIRCRAFT,label:'Archivo'}]:[]);
    if(sql.includes('FROM audit.audit_events WHERE request_id'))return found(state.audit_events.filter(r=>r.request_id===p[0]));
    if(sql.startsWith('INSERT INTO')) {
      const match=sql.match(/INSERT INTO (?:app|audit)\.(\w+) \(([^)]+)\)/);
      assert(match,sql); const table=match[1];
      if(table==='audit_events'&&auditFails)throw new Error('Audit unavailable');
      const row=Object.fromEntries(match[2].split(',').map((key,i)=>[key,p[i]]));
      for(const key of ['metadata','after_state','before_state','source_snapshot','entity_key']) if(typeof row[key]==='string')row[key]=JSON.parse(row[key]);
      if(table==='expenses'){row.status='OPEN';row.details_version=0;}
      if(table==='cost_events')row.status='OPEN';
      if(table==='expense_payments'||table==='expense_allocations')row.retired_at=null;
      state[table]??=[];state[table].push(row);return found([row]);
    }
    if(sql.startsWith('SELECT t.*')) {
      const table=sql.match(/FROM app\.(\w+) t/)[1]; const key=({cost_concepts:'cost_concept_id',cost_event_types:'cost_event_type_id',cost_events:'cost_event_id',expenses:'expense_id',cost_settlements:'cost_settlement_id'})[table];
      return found((state[table]||[]).filter(r=>r[key]===p[0]&&state.cost_financial_records.some(f=>f[key]===p[0]&&f.financial_scope_id===p[1]&&f.aircraft_id===p[2])));
    }
    if(sql.startsWith('SELECT p.party_id'))return found(p[0]===A||p[0]===B?[{party_id:p[0]}]:[]);
    if(sql.startsWith('SELECT ownership_interest_id'))return found([{ownership_interest_id:id(50),party_id:A,ownership_share:'25.00'},{ownership_interest_id:id(51),party_id:B,ownership_share:'75.00'}]);
    if(sql.startsWith('SELECT expense_id FROM app.cost_settlement_expense_lines'))return found(state.cost_settlement_expense_lines.filter(r=>r.expense_id===p[0]));
    if(sql.startsWith('SELECT status FROM app.cost_events'))return found(state.cost_events.filter(r=>r.cost_event_id===p[0]));
    if(sql.startsWith('UPDATE app.expenses SET details_version')) {
      const e=state.expenses.find(r=>r.expense_id===p[0]&&r.details_version===p[1]);if(!e)return found([]);e.details_version++;return found([{details_version:e.details_version}]);
    }
    if(sql.startsWith('UPDATE app.expenses SET ')) {
      const e=state.expenses.find(r=>r.expense_id===p[0]);sql.slice(sql.indexOf('SET ')+4,sql.indexOf(' WHERE')).split(',').forEach((key,i)=>{e[key.split('=')[0]]=p[i+1];});return found([e]);
    }
    if(sql.startsWith('UPDATE app.expense_payments')||sql.startsWith('UPDATE app.expense_allocations')) {
      const table=sql.match(/UPDATE app\.(\w+)/)[1];state[table].filter(r=>r.expense_id===p[0]&&!r.retired_at).forEach(r=>Object.assign(r,{retired_correction_id:p[1],retired_at:'2026-10-19',retired_by_user_id:p[2]}));return found([]);
    }
    if(sql.startsWith('SELECT payer_party_id,amount::text'))return found(state.expense_payments.filter(r=>r.expense_id===p[0]&&!r.retired_at));
    if(sql.startsWith('SELECT party_id,allocation_percent::text'))return found(state.expense_allocations.filter(r=>r.expense_id===p[0]&&!r.retired_at));
    if(sql.startsWith('SELECT e.*'))return found(state.expenses.filter(r=>r.aircraft_id===p[0]&&r.status==='OPEN'&&(sql.includes('e.cost_event_id=$2')?r.cost_event_id===p[1]:!r.cost_event_id&&r.expense_date>=p[1]&&r.expense_date<=p[2])).map(r=>({...r,financial_scope_id:state.cost_financial_records.find(f=>f.expense_id===r.expense_id)?.financial_scope_id})));
    if(sql.startsWith('SELECT cost_settlement_id FROM'))return found(state.cost_settlements.filter(r=>r.currency_code===p[1]&&(r.cost_event_id===p[2]||r.period_start_date===p[2])));
    if(sql.startsWith("UPDATE app.cost_events SET status='SETTLED'")){const e=state.cost_events.find(r=>r.cost_event_id===p[0]);e.status='SETTLED';return found([]);}
    throw new Error(`Unexpected query: ${sql}`);
  }};
  const repository=createPostgresCostsRepository({ randomUUID:()=>id(seq++), capability:()=>({enabled}), transaction:async(work,options)=>{
    assert(['SERIALIZABLE','READ COMMITTED'].includes(options.isolationLevel));
    const before=structuredClone(state);
    try{const result=await work(client);if(failCode)throw Object.assign(new Error('serialization failure'),{code:failCode});return result;}
    catch(e){Object.assign(state,before);throw e;}
  }});
  let request=500;return {state,calls,repository,command:(action,data,requestId=id(request++))=>repository.command({...args,action,data,requestId,reason:'Prueba sintética'})};
}

test('exact decimals, CUSTOM/DIRECT and deterministic cent rounding separate payer and responsibility',()=>{
  const input=normalizeExpense(expense());assert.equal(input.payments[0].payer_party_id,B);assert.equal(input.weights[0].party_id,A);
  const split=allocationRows('0.01',[{party_id:A,weight:1n},{party_id:B,weight:1n}],'CUSTOM');assert.deepEqual(split.map(r=>r.allocated_amount),['0.01','0.00']);
  assert.equal(decimalUnits('999999999999.99'),99999999999999n);
  for(const v of [null,undefined,0,'1.001','-1','NaN'])assert.throws(()=>decimalUnits(v));
  assert.throws(()=>normalizeExpense(expense({payments:[{payer_party_id:B,amount:'99.99'}]})),/sumar/);
  assert.throws(()=>normalizeExpense(expense({allocation_method:'CUSTOM',allocations:[{party_id:A,allocation_percent:'90'}]})),/100/);
});

test('per-expense utilization metrics, N engine positions, missing evidence and exact revisions',()=>{
  const f={flight_id:id(20),aircraft_id:AIRCRAFT,flight_revision_id:id(21),flight_date:'2026-10-01',utilization_owner_party_id:A,flight_time_hours:'1.2',counters:[{counter_code:'LANDINGS',counter_value:3}],
    components:[{position_index:3,counter_code:'ENGINE_CYCLES',counter_value:2,aircraft_id:AIRCRAFT,component_installation_id:id(22),installed_on:'2026-09-01',removed_on:null}]};
  assert.equal(utilizationWeights([f],'FLIGHT_TIME',null).evidence[0].utilization_value,'1.200');
  assert.equal(utilizationWeights([f],'LANDINGS',null).evidence[0].utilization_value,'3.000');
  assert.equal(utilizationWeights([f],'ENGINE_CYCLES',3).evidence[0].component_installation_id,id(22));
  assert.throws(()=>utilizationWeights([f],'ENGINE_CYCLES',1),/evidencia/);
  assert.throws(()=>utilizationWeights([{...f,flight_time_hours:null}],'FLIGHT_TIME'),/contador/);
  assert.throws(()=>utilizationWeights([{...f,components:[{...f.components[0],removed_on:'2026-09-30'}]}],'ENGINE_CYCLES',3));
  assert.throws(()=>utilizationWeights([{...f,utilization_owner_party_id:null}],'LANDINGS'));
});

test('event intervals use explicit boundaries, reject ambiguous same-day evidence',()=>{
  const f={flight_id:id(30),flight_date:'2026-10-01',movement_start_at:'2026-10-01T12:00:00Z'};
  assert.equal(selectCostFlights([f],{event_date:'2026-09-01'},{event_date:'2026-10-01'}).length,1);
  assert.equal(selectCostFlights([f],{event_date:'2026-10-01'},{event_date:'2026-10-02'}).length,0);
  assert.throws(()=>selectCostFlights([{...f,movement_start_at:null}],{event_date:'2026-09-01'},{event_date:'2026-10-01',boundary_after_flight_id:f.flight_id}),/ambiguo/);
});

test('flag OFF does not open database; no authority/revoked, disabled and non-owner cannot mutate',async()=>{
  const off=mock({enabled:false});await assert.rejects(off.command('create_expense',expense()),{code:'COST_WRITES_DISABLED'});assert.equal(off.calls.length,0);
  for(const config of [{authorized:false},{active:false},{role:'PILOT'},{role:'ADMIN'}]) {
    const m=mock(config);await assert.rejects(m.command('create_expense',expense()));assert.equal(m.state.expenses.length,0);
  }
  const archived=mock({role:'VIEWER'});assert.equal((await archived.repository.listArchives({userId:USER})).length,1);
  const hidden=mock({authorized:false});assert.equal((await hidden.repository.listArchives({userId:USER})).length,0);
  await assert.rejects(archived.repository.command({...args,scopeId:id(99),action:'create_expense',data:expense(),requestId:id(999)}));
});

test('DIRECT, CUSTOM, historical OWNERSHIP persist distinct payers, normalized allocations and atomic Audit',async()=>{
  for(const e of [expense(),expense({allocation_method:'CUSTOM',allocations:[{party_id:A,allocation_percent:'10'},{party_id:B,allocation_percent:'90'}]}),expense({allocation_method:'OWNERSHIP'})]) {
    const m=mock();await m.command('create_expense',e);
    assert.equal(m.state.expense_payments[0].payer_party_id,B);assert.equal(m.state.audit_events.length,1);
    assert.equal(m.state.audit_events[0].action_code,'COST_EXPENSE_CREATED');
    assert.equal(m.state.expense_allocations.reduce((s,a)=>s+decimalUnits(a.allocated_amount),0n),10000n);
    if(e.allocation_method==='OWNERSHIP')assert.deepEqual(m.state.expense_allocations.map(a=>a.allocated_amount),['25.00','75.00']);
  }
});

test('OPEN corrections retire evidence, reject stale version and replay idempotently',async()=>{
  const m=mock();const created=await m.command('create_expense',expense(),id(600));
  assert.deepEqual(await m.command('create_expense',expense(),id(600)),created);assert.equal(m.state.audit_events.length,1);
  await assert.rejects(m.command('create_expense',expense({description:'different'}),id(600)),{code:'COST_CONFLICT'});
  await m.command('correct_expense',expense({expense_id:created.expense_id,expected_details_version:'1',payments:[{payer_party_id:A,amount:'100.00'}]}));
  assert.equal(m.state.expense_payments.filter(p=>p.retired_at).length,1);assert.equal(m.state.expense_payments.filter(p=>!p.retired_at)[0].payer_party_id,A);
  await assert.rejects(m.command('correct_expense',expense({expense_id:created.expense_id,expected_details_version:'1'})),{code:'COST_CONFLICT'});
  assert.equal(m.state.expense_corrections,undefined);assert.equal(m.state.cost_expense_corrections.length,2);
});

test('period settlement freezes each currency independently, balanced parties and refuses future correction',async()=>{
  const m=mock();const first=await m.command('create_expense',expense());await m.command('create_expense',expense({currency_code:'EUR'}));
  const settled=await m.command('settle_period',{period_start_date:'2026-10-01',period_end_date:'2026-10-31'});
  assert.equal(settled.settlement_ids.length,2);assert.deepEqual(m.state.cost_settlements.map(s=>s.currency_code),['USD','EUR']);
  assert.equal(m.state.cost_settlement_expense_lines.length,2);assert.equal(m.state.cost_settlement_party_lines.length,4);
  assert.equal(m.state.cost_settlement_owner_lines.filter(l=>l.party_id===B)[0].net_amount,'100.00');
  await assert.rejects(m.command('correct_expense',expense({expense_id:first.expense_id,expected_details_version:'1'})),{code:'COST_CONFLICT'});
  assert.equal(m.state.audit_events.length,3);
});

test('event settlements are atomic; empty event can close a real utilization boundary without fictitious debt',async()=>{
  const m=mock();m.state.cost_events.push({cost_event_id:EVENT,aircraft_id:AIRCRAFT,status:'OPEN',event_date:'2026-09-01'});m.state.cost_financial_records.push({cost_event_id:EVENT,financial_scope_id:SCOPE,aircraft_id:AIRCRAFT});
  await m.command('settle_event',{cost_event_id:EVENT});assert.equal(m.state.cost_events[0].status,'SETTLED');assert.equal(m.state.cost_settlements.length,0);
  await assert.rejects(m.command('create_expense',expense({cost_event_id:EVENT})),{code:'COST_CONFLICT'});
});

test('Audit failure and commit serialization errors rollback business state, version, detail and snapshots',async()=>{
  for(const config of [{auditFails:true},{failCode:'40001'},{locked:false}]) {
    const m=mock(config);await assert.rejects(m.command('create_expense',expense()));assert.equal(m.state.expenses.length,0);assert.equal(m.state.expense_payments.length,0);assert.equal(m.state.audit_events.length,0);
  }
  const m=mock();await assert.rejects(m.command('create_expense',expense({direct_party_id:id(99)})),{code:'COST_PARTY_SCOPE'});assert.equal(m.state.expenses.length,0);
});

test('HTTP contract preserves session identity, archive reads without aircraft membership, safe errors',async()=>{
  let input;const handler=createCostsHttpHandler({listArchives:async a=>{input=a;return[];},command:async a=>{input=a;throw Object.assign(new Error('disabled'),{statusCode:503,code:'COST_WRITES_DISABLED'});}});
  const res={status(n){this.code=n;return this;},json(v){this.body=v;return this;}};
  await handler({method:'GET',query:{action:'archives'}},res,{userId:USER});assert.equal(res.code,200);assert.deepEqual(input,{userId:USER});
  await handler({method:'POST',body:{userId:id(99),action:'create_expense',data:expense()}},res,{userId:USER});assert.equal(input.userId,USER);assert.equal(res.code,503);
});

test('UI service sends exact decimal strings, explicit scope, cookies and stable caller request UUID',async()=>{
  const original=global.fetch;let call;
  try{global.fetch=async(url,options)=>{call={url,options};return{ok:true,status:200,json:async()=>({ok:true,result:{expense_id:id(80)}})};};
    const data=buildCostExpenseForm(expense(),[{party_id:B,value:'100.00'}],[]);
    await costsRequest({archive:{aircraft_id:AIRCRAFT,financial_scope_id:SCOPE},action:'create_expense',data,requestId:id(90)});
    const payload=JSON.parse(call.options.body);assert.equal(payload.data.amount,'100.00');assert.equal(payload.financial_scope_id,SCOPE);assert.equal(payload.request_id,id(90));assert.equal(call.options.credentials,'include');
  }finally{global.fetch=original;}
});

test('sole owner paying the full expense has zero self-debt',async()=>{
  const m=mock();await m.command('create_expense',expense({payments:[{payer_party_id:A,amount:'100.00'}]}));
  await m.command('settle_period',{period_start_date:'2026-10-01',period_end_date:'2026-10-31'});
  assert.equal(m.state.cost_settlement_owner_lines.length,1);assert.equal(m.state.cost_settlement_owner_lines[0].net_amount,'0.00');
});

test('real settings router enforces authentication and keeps mutations closed without opening PostgreSQL',async()=>{
  const keys=['SESSION_SECRET','SETTINGS_DATA_SOURCE','POSTGRES_COST_WRITES_ENABLED'];const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const res={status(n){this.code=n;return this;},json(v){this.body=v;return this;},setHeader(){}};
  try {
    process.env.SESSION_SECRET='local-test-session-only';process.env.SETTINGS_DATA_SOURCE='POSTGRES';delete process.env.POSTGRES_COST_WRITES_ENABLED;
    await settingsHandler({method:'POST',headers:{},body:{resource:'costs',aircraft_id:AIRCRAFT}},res);assert.equal(res.code,401);
    const cookie=createSessionCookie({userId:USER}).split(';')[0];
    await settingsHandler({method:'POST',headers:{cookie},body:{resource:'costs',aircraft_id:AIRCRAFT,financial_scope_id:SCOPE,action:'create_expense',data:expense(),request_id:id(1234)}},res);
    assert.equal(res.code,503);assert.equal(res.body.code,'COST_WRITES_DISABLED');
  } finally {for(const k of keys)if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}
});

test('authority provisioning generates a reviewed plan only, with canonical UUIDs and same-transaction Audit',()=>{
  assert.throws(()=>buildCostsAuthorityPlan({}),/approved/);
  const manifest={approval_verified:true,aircraft_id:AIRCRAFT,financial_scope_id:SCOPE,approved_by_user_id:USER,request_id:id(88),label:'Archivo aprobado',approval_reference:'REVIEW-EXPLICIT',mandates:[{financial_authority_id:id(89),user_id:USER}]};
  const plan=buildCostsAuthorityPlan(manifest);assert.equal(plan.operation,'REVIEW_ONLY_NOT_EXECUTED');
  assert(plan.statements.some(s=>s.text.includes('INSERT INTO audit.audit_events')));
  assert(!plan.statements.some(s=>s.text.includes('aircraft_ownership_interests')));
  assert.throws(()=>buildCostsAuthorityPlan({...manifest,mandates:[{financial_authority_id:id(89),user_id:'Owner'}]}));
});

test('UI keeps archive access outside active-aircraft gate and closed records have no edit action',()=>{
  const app=readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8');const panel=readFileSync(new URL('../src/components/CostsPanel.jsx',import.meta.url),'utf8');
  assert(app.indexOf('activeMainTab === "costos"')<app.indexOf('if (aircraftsLoading)'));
  assert.match(panel,/canWrite && !detail\.frozen && detail\.status === 'OPEN'/);
  assert.match(panel,/requestId: retry\.current\.id/);assert.match(panel,/role="alert"/);assert.match(panel,/No tenés un archivo financiero autorizado/);
});

test('preflight splitter respects dollar bodies and strings; target guard and independent rollback verification',async()=>{
  assert.equal(splitPostgresStatements("DO $x$ BEGIN RAISE NOTICE ';'; END; $x$; SELECT 'a;';").length,2);
  const sql=readFileSync(new URL('../db/migrations/008_costs_financial_scopes_and_open_corrections.sql',import.meta.url),'utf8');
  assert.throws(()=>buildCosts008Preflight(sql,{...COSTS_PREFLIGHT_TARGET,branch_id:'br-billowing-band-b62jj1ab'}),/Unauthorized/);
  const plan=buildCosts008Preflight(sql,COSTS_PREFLIGHT_TARGET);assert(plan.sql_statements.at(-1).includes('COSTS_008_PREFLIGHT_VALIDATED_ROLLBACK'));
  let count=0;const result=await runCosts008Preflight({sql,target:COSTS_PREFLIGHT_TARGET,query:async()=>{count++;return{rows:[{scope_table:null,schema_fingerprint:'same'}]};},transaction:async()=>{throw new Error('COSTS_008_PREFLIGHT_VALIDATED_ROLLBACK');}});
  assert.equal(result.ok,true);assert.equal(count,2);
  await assert.rejects(runCosts008Preflight({sql,target:COSTS_PREFLIGHT_TARGET,query:async()=>({rows:[{scope_table:null}]}),transaction:async()=>{}}),/did not reach/);
});
