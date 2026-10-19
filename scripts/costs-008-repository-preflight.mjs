// Explicit temporary-target runner: credentials are supplied via stdin, never
// argv, logs, checked-in files or environment changes. All DDL/data roll back.
import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createPostgresCostsRepository } from '../api/_postgresCostsRepository.js';
import { createCostsHttpHandler } from '../api/_costsHttp.js';
import { readCostsV1PrivilegeEvidence } from './lib/costs-v1-privilege-contract.mjs';
import { buildCosts008Preflight, COSTS_PREFLIGHT_TARGET, COSTS_FINGERPRINT_SQL } from './lib/costs-008-preflight.mjs';

export async function repositoryPreflight(connectionString) {
  const url = new URL(connectionString);
  url.hostname = url.hostname.replace('-pooler.', '.');
  if (url.hostname !== 'ep-ancient-recipe-b6cjj1qz.c-2.sa-east-1.aws.neon.tech'
    || url.pathname !== '/app_horas' || url.username !== 'app_horas_migration') throw new Error('Unauthorized temporary target.');
  url.searchParams.set('sslmode', 'verify-full');
  const connection = { connectionString: url.toString(), connectionTimeoutMillis: 10000, statement_timeout: 15000, query_timeout: 20000 };
  const client = new Client(connection); await client.connect();
  const tests = []; let before; let rolledBack = false; let originalError;
  const sql = readFileSync(new URL('../db/migrations/008_costs_financial_scopes_and_open_corrections.sql', import.meta.url), 'utf8');
  const plan = buildCosts008Preflight(sql, COSTS_PREFLIGHT_TARGET);
  try {
    before = (await client.query(COSTS_FINGERPRINT_SQL)).rows;
    assert.equal(before[0].scope_table, null);
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    for (const statement of plan.sql_statements.slice(0, -1)) await client.query(statement);
    await readCostsV1PrivilegeEvidence(client.query.bind(client));
    tests.push('schema, effective privileges, lifecycle triggers');
    const user='c0080000-0000-4000-8000-000000000001', aircraft='c0080000-0000-4000-8000-000000000002', scope='c0080000-0000-4000-8000-000000000005';
    const a='c0080000-0000-4000-8000-000000000003', b='c0080000-0000-4000-8000-000000000004', concept='c0080000-0000-4000-8000-000000000006';
    await client.query(`INSERT INTO app.cost_financial_authorities(financial_scope_id,user_id,approval_reference,authorized_by_user_id)
      VALUES($1,$2,'SYNTHETIC ROLLBACK FIXTURE',$2)`,[scope,user]);
    await client.query(`INSERT INTO app.aircraft_memberships(aircraft_id,user_id,role,status,activated_at,updated_at) VALUES($1,$2,'OWNER','ACTIVE',now(),now())`,[aircraft,user]);
    for (const party of [a,b]) await client.query(`INSERT INTO app.aircraft_ownership_interests(aircraft_id,party_id,ownership_share,effective_from_at,created_by_user_id) VALUES($1,$2,50,'2026-01-01',$3)`,[aircraft,party,user]);
    await client.query(`INSERT INTO app.cost_financial_records(financial_scope_id,aircraft_id,cost_concept_id,registered_by_user_id,provenance_reference) VALUES($1,$2,$3,$4,'SYNTHETIC ROLLBACK FIXTURE')`,[scope,aircraft,concept,user]);
    let savepoint=0;
    const transaction = async work => {
      const name=`costs_test_${++savepoint}`; await client.query(`SAVEPOINT ${name}`);
      try { const value=await work(client); await client.query(`RELEASE SAVEPOINT ${name}`); return value; }
      catch(error) { await client.query(`ROLLBACK TO SAVEPOINT ${name}`); throw error; }
    };
    const repository=createPostgresCostsRepository({transaction,capability:()=>({enabled:true})});
    const ctx={userId:user,aircraftId:aircraft,scopeId:scope};
    const command=(action,data,requestId=crypto.randomUUID())=>repository.command({...ctx,action,data,requestId,reason:'SYNTHETIC ROLLBACK TEST'});
    assert.equal((await repository.listArchives({userId:user})).length,1);
    const otherUser='c0080000-0000-4000-8000-000000000014',otherScope='c0080000-0000-4000-8000-000000000015';
    await client.query(`INSERT INTO app.users(user_id,email,status,preferred_locale,updated_at) VALUES($1,'costs-other@example.invalid','ACTIVE','es',now())`,[otherUser]);
    await client.query(`INSERT INTO app.aircraft_memberships(aircraft_id,user_id,role,status,activated_at,updated_at) VALUES($1,$2,'OWNER','ACTIVE',now(),now())`,[aircraft,otherUser]);
    assert.equal((await repository.listArchives({userId:otherUser})).length,0);
    await assert.rejects(repository.read({...ctx,userId:otherUser}),{code:'COST_FINANCIAL_AUTHORITY_UNRESOLVED'});
    await client.query(`INSERT INTO app.cost_financial_scopes(financial_scope_id,aircraft_id,label,approval_reference,created_by_user_id) VALUES($1,$2,'SYNTHETIC NEXT ADMIN','SYNTHETIC EXPLICIT APPROVAL',$3)`,[otherScope,aircraft,user]);
    await client.query(`INSERT INTO app.cost_financial_authorities(financial_scope_id,user_id,approval_reference,authorized_by_user_id) VALUES($1,$2,'SYNTHETIC EXPLICIT APPROVAL',$3)`,[otherScope,otherUser,user]);
    await assert.rejects(repository.read({...ctx,scopeId:otherScope}),{code:'COST_FINANCIAL_AUTHORITY_UNRESOLVED'});
    assert.equal((await repository.listArchives({userId:otherUser}))[0].financial_scope_id,otherScope);
    tests.push('two administrations, explicit mandates and duplicate private concept names');
    const locker=new Client(connection);await locker.connect();
    try {
      assert.equal((await locker.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',[`app-horas:costs:${aircraft}`])).rows[0].locked,true);
      await assert.rejects(command('create_concept',{name:'CONTENDED',cost_class:'FIXED',default_allocation_method:'DIRECT'}),{code:'COST_CONFLICT'});
    } finally {await locker.query('SELECT pg_advisory_unlock_all()');await locker.end();}
    tests.push('two-connection lock contention rejects before mutation');
    await repository.command({userId:otherUser,aircraftId:aircraft,scopeId:otherScope,action:'create_concept',requestId:crypto.randomUUID(),data:{name:'TEST',cost_class:'FIXED',default_allocation_method:'OWNERSHIP'}});
    const basic={cost_concept_id:concept,expense_date:'2026-11-01',description:'SYNTHETIC ROLLBACK',amount:'100.00',currency_code:'USD',allocation_method:'DIRECT',direct_party_id:a,payments:[{payer_party_id:b,amount:'100.00'}]};
    const request=crypto.randomUUID(); const first=await command('create_expense',basic,request);
    assert.deepEqual(await command('create_expense',basic,request),first);
    await assert.rejects(command('create_expense',{...basic,amount:'99.00'},request),{code:'COST_CONFLICT'});
    tests.push('real repository expense + idempotency');
    await command('correct_expense',{...basic,expense_id:first.expense_id,expected_details_version:'1',allocation_method:'CUSTOM',allocations:[{party_id:a,allocation_percent:'25'},{party_id:b,allocation_percent:'75'}]});
    await assert.rejects(command('correct_expense',{...basic,expense_id:first.expense_id,expected_details_version:'1'}),{code:'COST_CONFLICT'});
    await command('create_expense',{...basic,currency_code:'EUR',allocation_method:'OWNERSHIP'});
    let view=await repository.read(ctx);
    assert.equal(view.expenses.length,2); assert(view.expenses.every(e=>!e.calculation_error));
    tests.push('real corrections, historical ownership and authorized read');
    const countBefore=(await client.query('SELECT count(*)::int AS count FROM app.expenses')).rows[0].count;
    const failing=createPostgresCostsRepository({capability:()=>({enabled:true}),transaction:work=>transaction(c=>work({query:(text,params)=>{
      if(text.startsWith('INSERT INTO audit.audit_events'))throw new Error('SYNTHETIC AUDIT FAILURE');return c.query(text,params);
    }}))});
    await assert.rejects(failing.command({...ctx,action:'create_expense',data:basic,requestId:crypto.randomUUID()}),/SYNTHETIC AUDIT FAILURE/);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM app.expenses')).rows[0].count,countBefore);
    tests.push('real database rollback when Audit insertion fails');
    const http=createCostsHttpHandler(repository);const response={status(n){this.code=n;return this;},json(body){this.body=body;return this;},setHeader(){}};
    await http({method:'GET',query:{aircraft_id:aircraft,financial_scope_id:scope}},response,{userId:user});assert.equal(response.code,200);assert.equal(response.body.costs.expenses.length,2);
    tests.push('API handler to real repository to PostgreSQL response');
    const type=await command('create_event_type',{name:'SYNTHETIC ANNUAL',boundary_basis:'NONE'});
    const previous=await command('create_event',{cost_event_type_id:type.cost_event_type_id,title:'SYNTHETIC START',event_date:'2026-09-30'});
    await command('settle_event',{cost_event_id:previous.cost_event_id});
    const end=await command('create_event',{cost_event_type_id:type.cost_event_type_id,title:'SYNTHETIC END',event_date:'2026-11-30',previous_cost_event_id:previous.cost_event_id});
    const flight=crypto.randomUUID(), revision=crypto.randomUUID();
    await client.query(`INSERT INTO app.flight_records(flight_id,aircraft_id,current_revision_id,status,record_source,created_by_user_id) VALUES($1,$2,$3,'ACTIVE','MANUAL',$4)`,[flight,aircraft,revision,user]);
    await client.query(`INSERT INTO app.flight_record_revisions(flight_revision_id,flight_id,revision_number,flight_date,utilization_owner_party_id,capture_method,flight_time_hours,time_in_service_hours,created_by_user_id) VALUES($1,$2,1,'2026-10-15',$3,'DIRECT',1.2,1.2,$4)`,[revision,flight,a,user]);
    await client.query(`INSERT INTO app.flight_counters(flight_revision_id,counter_code,counter_value) VALUES($1,'LANDINGS',3)`,[revision]);
    const component=crypto.randomUUID(),installation=crypto.randomUUID();
    await client.query(`INSERT INTO app.components(component_id,component_type,status,updated_at) VALUES($1,'ENGINE','ACTIVE',now())`,[component]);
    await client.query(`INSERT INTO app.component_installations(component_installation_id,component_id,aircraft_id,position_index,installed_on,updated_at) VALUES($1,$2,$3,3,'2026-09-01',now())`,[installation,component,aircraft]);
    await client.query(`INSERT INTO app.flight_component_counters(flight_revision_id,component_installation_id,counter_code,counter_value) VALUES($1,$2,'ENGINE_CYCLES',2)`,[revision,installation]);
    for(const metric of ['FLIGHT_TIME','LANDINGS','ENGINE_CYCLES']) await command('create_expense',{...basic,cost_event_id:end.cost_event_id,allocation_method:'UTILIZATION',utilization_metric:metric,utilization_component_position:metric==='ENGINE_CYCLES'?3:null});
    await command('settle_event',{cost_event_id:end.cost_event_id});
    const usage=(await client.query(`SELECT utilization_metric,flight_revision_id FROM app.cost_settlement_utilization_lines WHERE flight_id=$1`,[flight])).rows;
    assert.deepEqual(usage.map(r=>r.utilization_metric).sort(),['ENGINE_CYCLES','FLIGHT_TIME','LANDINGS']); assert(usage.every(r=>r.flight_revision_id===revision));
    tests.push('three metrics per expense including engine position 3 and exact installation/revision');
    const settled=await command('settle_period',{period_start_date:'2026-11-01',period_end_date:'2026-11-30'});
    assert.equal(settled.settlement_ids.length,2);
    await assert.rejects(command('correct_expense',{...basic,expense_id:first.expense_id,expected_details_version:'2'}),{code:'COST_CONFLICT'});
    view=await repository.read(ctx);assert.equal(view.settlements.length,3);assert(view.settlements.every(s=>!('source_snapshot' in s)));
    tests.push('real immutable event/period snapshots, currencies and party lines');
    await client.query(`UPDATE app.aircraft_memberships SET status='REVOKED',revoked_at=now(),revoked_by_user_id=$1 WHERE user_id=$1 AND aircraft_id=$2`,[user,aircraft]);
    assert.equal((await repository.read(ctx)).scope.owner,false);
    await assert.rejects(command('create_expense',basic),{code:'COST_WRITE_DENIED'});
    await client.query("UPDATE app.users SET status='DISABLED' WHERE user_id=$1",[user]);
    await assert.rejects(repository.read(ctx),{code:'COST_FINANCIAL_AUTHORITY_UNRESOLVED'});
    await client.query("UPDATE app.users SET status='ACTIVE' WHERE user_id=$1",[user]);
    await client.query(`INSERT INTO app.cost_financial_authority_revocations(financial_authority_id,revoked_by_user_id,reason) SELECT financial_authority_id,$1,'SYNTHETIC REVOKE' FROM app.cost_financial_authorities WHERE user_id=$1`,[user]);
    await assert.rejects(repository.read(ctx),{code:'COST_FINANCIAL_AUTHORITY_UNRESOLVED'});
    tests.push('former holder reads without membership; revocation denies');
    // Mandatory terminal SQL error, not a successful COMMIT path.
    try { await client.query(plan.sql_statements.at(-1)); }
    catch(error) { if(!error.message.includes('COSTS_008_PREFLIGHT_VALIDATED_ROLLBACK'))throw error;rolledBack=true; }
    assert(rolledBack);
  } catch(error) { originalError=error; }
  finally { await client.query('ROLLBACK'); await client.end(); }
  const independent=new Client(connection); await independent.connect();
  try { assert.deepEqual((await independent.query(COSTS_FINGERPRINT_SQL)).rows,before); }
  finally { await independent.end(); }
  if(originalError) throw originalError;
  return {ok:true,target:COSTS_PREFLIGHT_TARGET,sha256:plan.sha256,tests,forcedRollback:rolledBack,
    fingerprint:before[0].schema_fingerprint,persistentWrites:0,executionRole:'app_horas_migration',runtimeLoginDml:false};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!process.argv.includes('--stdin-temporary-target')) throw new Error('Explicit temporary-target stdin mode required.');
  const reader=createInterface({input:process.stdin});
  reader.once('line',async line=>{
    reader.close();
    try { console.log(JSON.stringify(await repositoryPreflight(JSON.parse(line).connectionString))); }
    catch(error) { console.error(JSON.stringify({ok:false,code:error.code||'PREFLIGHT_FAILED',error:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[REDACTED]')})); process.exitCode=1; }
  });
}
