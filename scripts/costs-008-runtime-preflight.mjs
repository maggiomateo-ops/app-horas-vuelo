// Real LOGIN gate, not SET ROLE. No COMMIT, role changes, flag changes or grants
// beyond exact 008 in an uncommitted diagnostic transaction. Secrets: stdin only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { createPostgresCostsRepository } from '../api/_postgresCostsRepository.js';
import { buildCosts008Preflight, COSTS_FINGERPRINT_SQL, COSTS_PREFLIGHT_TARGET } from './lib/costs-008-preflight.mjs';
import { COSTS_008_FIXTURE_STATEMENTS } from './lib/costs-008-fixture.mjs';
import { COST_ROLE_QUERY, COST_RUNTIME_ROLES, readCostsV1PrivilegeEvidence } from './lib/costs-v1-privilege-contract.mjs';

const HOST = 'ep-ancient-recipe-b6cjj1qz.c-2.sa-east-1.aws.neon.tech';
const IDENTITY_SQL = 'SELECT session_user,current_user,current_database() AS database,pg_backend_pid() AS pid';
const VISIBILITY_SQL = "SELECT to_regclass('app.cost_financial_scopes') AS scope_table";
const TABLES = ['cost_concepts','cost_event_types','cost_events','expenses','expense_payments','expense_allocations',
  'cost_settlements','cost_settlement_expense_lines','cost_settlement_party_lines','cost_settlement_owner_lines',
  'cost_settlement_utilization_lines','cost_financial_scopes','cost_financial_authorities',
  'cost_financial_authority_revocations','cost_financial_records','cost_expense_corrections'];

export function temporaryConnection(connectionString, role) {
  assert(['app_horas_runtime','app_horas_migration'].includes(role), 'Unsupported role');
  const url = new URL(connectionString);
  url.hostname = url.hostname.replace('-pooler.', '.');
  assert(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === HOST
    && url.pathname === '/app_horas' && url.username === role && url.password
    && (!url.port || url.port === '5432') && !url.hash, 'Unauthorized temporary target/role');
  // Reject session startup overrides, secondary hosts or arbitrary pg options.
  assert([...url.searchParams.keys()].every(k => ['sslmode','channel_binding'].includes(k)), 'Unsupported connection options');
  url.searchParams.set('sslmode','verify-full');
  return { connectionString:url.toString(), connectionTimeoutMillis:10000, statement_timeout:15000,
    lock_timeout:3000, query_timeout:20000, application_name:'costs-008-runtime-rollback' };
}

async function state(client) {
  const catalog = (await client.query(COSTS_FINGERPRINT_SQL)).rows;
  const roles = (await client.query(COST_ROLE_QUERY,[COST_RUNTIME_ROLES])).rows.sort((a,b)=>a.role.localeCompare(b.role));
  const counts = {};
  for (const table of TABLES) {
    if ((await client.query('SELECT to_regclass($1) AS relation',[`app.${table}`])).rows[0].relation) {
      counts[table] = (await client.query(`SELECT count(*)::text AS n FROM app.${table}`)).rows[0].n;
    }
  }
  return {catalog,roles,counts};
}

function assertIdentity(identity, role) {
  assert.equal(identity.session_user,role); assert.equal(identity.current_user,role);
  assert.equal(identity.database,'app_horas');
}

// This suite needs an already-visible, independently approved SYNTHETIC fixture.
// It never creates financial mandates or accepts real production identities.
export async function exerciseRuntime(client, fixture) {
  const ids=['userId','aircraftId','scopeId','responsiblePartyId','payerPartyId','deniedUserId'];
  for (const key of ids) assert(/^c0080000-0000-4000-8000-[0-9a-f]{12}$/.test(fixture?.[key]), 'Synthetic fixture UUID required');
  assert.notEqual(fixture.deniedUserId,fixture.userId);
  assert.notEqual(fixture.responsiblePartyId,fixture.payerPartyId);
  const scope=(await client.query('SELECT label,approval_reference FROM app.cost_financial_scopes WHERE financial_scope_id=$1',[fixture.scopeId])).rows;
  assert.equal(scope.length,1);
  assert.equal(scope[0].label,'SYNTHETIC RUNTIME ROLLBACK ONLY');
  assert.equal(scope[0].approval_reference,'ISOLATED_RUNTIME_ROLLBACK_TEST_ONLY');
  const actors=(await client.query("SELECT user_id FROM app.users WHERE user_id=ANY($1::uuid[]) AND status='ACTIVE'",[[fixture.userId,fixture.deniedUserId]])).rows;
  assert.equal(actors.length,2,'Both test actors must exist and be active');
  const owners=(await client.query("SELECT user_id FROM app.aircraft_memberships WHERE aircraft_id=$1 AND user_id=ANY($2::uuid[]) AND status='ACTIVE' AND role='OWNER'",
    [fixture.aircraftId,[fixture.userId,fixture.deniedUserId]])).rows;
  assert.equal(new Set(owners.map(r=>r.user_id)).size,2,'Both actors must be OWNER; financial mandate must decide access');
  assert.equal((await client.query('SELECT financial_record_id FROM app.cost_financial_records WHERE financial_scope_id=$1',[fixture.scopeId])).rows.length,0,'Synthetic scope must start empty');
  let sequence=0;
  const transaction=async work=>{
    const name=`runtime_case_${++sequence}`;
    await client.query(`SAVEPOINT ${name}`);
    try {const result=await work(client);await client.query(`RELEASE SAVEPOINT ${name}`);return result;}
    catch(error){await client.query(`ROLLBACK TO SAVEPOINT ${name}`);await client.query(`RELEASE SAVEPOINT ${name}`);throw error;}
  };
  // Dependency injection enables only this rollback fixture, never environment flags.
  const repo=createPostgresCostsRepository({transaction,capability:()=>({enabled:true})});
  const ctx={userId:fixture.userId,aircraftId:fixture.aircraftId,scopeId:fixture.scopeId};
  const requests=[];
  const command=(action,data)=>{const requestId=crypto.randomUUID();requests.push(requestId);
    return repo.command({...ctx,action,data,requestId,reason:'SYNTHETIC REAL LOGIN ROLLBACK'});};
  await assert.rejects(repo.read({...ctx,userId:fixture.deniedUserId}),{code:'COST_FINANCIAL_AUTHORITY_UNRESOLVED'});
  await assert.rejects(repo.command({...ctx,userId:fixture.deniedUserId,action:'create_concept',requestId:crypto.randomUUID(),
    data:{name:'DENIED',cost_class:'FIXED',default_allocation_method:'DIRECT'}}),{code:'COST_FINANCIAL_AUTHORITY_UNRESOLVED'});
  const off=createPostgresCostsRepository({transaction:()=>{throw Error('Flag OFF reached PostgreSQL');},capability:()=>({enabled:false})});
  await assert.rejects(off.command({...ctx}),{code:'COST_WRITES_DISABLED'});
  const concept=await command('create_concept',{name:`RUNTIME ${crypto.randomUUID()}`,cost_class:'FIXED',default_allocation_method:'DIRECT'});
  const expense={cost_concept_id:concept.cost_concept_id,expense_date:'2026-11-01',amount:'100.00',currency_code:'USD',
    allocation_method:'DIRECT',direct_party_id:fixture.responsiblePartyId,payments:[{payer_party_id:fixture.payerPartyId,amount:'100.00'}]};
  const first=await command('create_expense',expense);
  const corrected=await command('correct_expense',{...expense,expense_id:first.expense_id,expected_details_version:'1',amount:'120.00',
    payments:[{payer_party_id:fixture.payerPartyId,amount:'120.00'}]});
  assert.equal(corrected.details_version,'2');
  const beforeFailure=(await client.query('SELECT count(*)::text AS n FROM app.expenses')).rows;
  const failedRequest=crypto.randomUUID();
  const failing=createPostgresCostsRepository({capability:()=>({enabled:true}),transaction:work=>transaction(c=>work({query:(sql,params)=>
    sql.startsWith('INSERT INTO audit.audit_events')?c.query('SELECT 1/0'):c.query(sql,params)}))});
  await assert.rejects(failing.command({...ctx,action:'create_expense',data:expense,requestId:failedRequest}),{code:'22012'});
  assert.deepEqual((await client.query('SELECT count(*)::text AS n FROM app.expenses')).rows,beforeFailure);
  assert.equal((await client.query('SELECT request_id FROM audit.audit_events WHERE request_id=$1',[failedRequest])).rows.length,0);
  const settled=await command('settle_period',{period_start_date:'2026-11-01',period_end_date:'2026-11-30'});
  assert.equal(settled.settlement_ids.length,1);
  await assert.rejects(command('correct_expense',{...expense,expense_id:first.expense_id,expected_details_version:'2'}),{code:'COST_CONFLICT'});
  const audit=(await client.query('SELECT action_code FROM audit.audit_events WHERE request_id=ANY($1::uuid[])',[requests])).rows;
  assert.deepEqual(audit.map(r=>r.action_code).sort(),['COST_CONCEPT_CREATED','COST_EXPENSE_CREATED','COST_EXPENSE_CORRECTED','COST_PERIOD_SETTLED'].sort());
  const view=await repo.read(ctx);
  const line=view.settlements.find(s=>s.cost_settlement_id===settled.settlement_ids[0]);
  assert(line); assert.equal(line.lines.length,2);
  assert.equal(line.lines.find(l=>l.party_id===fixture.responsiblePartyId).net_amount,'-120.00');
  assert.equal(line.lines.find(l=>l.party_id===fixture.payerPartyId).net_amount,'120.00');
  await assert.rejects(transaction(c=>c.query('UPDATE app.cost_settlements SET source_snapshot=source_snapshot WHERE cost_settlement_id=$1',[line.cost_settlement_id])),{code:'42501'});
  await assert.rejects(transaction(c=>c.query('UPDATE audit.audit_events SET metadata=metadata WHERE request_id=$1',[requests[0]])),{code:'42501'});
  return ['real LOGIN creation/correction/settlement','private access and flag OFF denial','immutable settlement and Audit',
    'real database Audit failure rolls back business DML'];
}

export async function runtimePreflight({runtimeConnectionString,verifierConnectionString,fixture}, {ClientClass=Client}={}) {
  const runtimeConfig=temporaryConnection(runtimeConnectionString,'app_horas_runtime');
  const verifierConfig=temporaryConnection(verifierConnectionString,'app_horas_migration');
  const verifier=new ClientClass(verifierConfig),runtime=new ClientClass(runtimeConfig);
  let before, result, originalError, runtimeIdentity,verifierIdentity; let runtimeConnected=false, verifierConnected=false;
  let runtimeTransaction=false, adminTransaction=false;
  try {
    await verifier.connect();verifierConnected=true;
    verifierIdentity=(await verifier.query(IDENTITY_SQL)).rows[0];assertIdentity(verifierIdentity,'app_horas_migration');
    before=await state(verifier);
    await runtime.connect();runtimeConnected=true;
    runtimeIdentity=(await runtime.query(IDENTITY_SQL)).rows[0];assertIdentity(runtimeIdentity,'app_horas_runtime');
    assert.notEqual(runtimeIdentity.pid,verifierIdentity.pid);
    const sql=readFileSync(new URL('../db/migrations/008_costs_financial_scopes_and_open_corrections.sql',import.meta.url),'utf8');
    const plan=buildCosts008Preflight(sql,COSTS_PREFLIGHT_TARGET);
    await runtime.query('BEGIN ISOLATION LEVEL SERIALIZABLE');runtimeTransaction=true;
    const visibleBefore=(await runtime.query(VISIBILITY_SQL)).rows[0].scope_table;
    if (!visibleBefore) {
      // Prove the blocker: 008 exists in the migrator transaction but remains
      // invisible to the independent real LOGIN. No helper functions/role switch.
      await verifier.query('BEGIN ISOLATION LEVEL SERIALIZABLE');adminTransaction=true;
      for(const statement of plan.sql_statements) {
        if(statement===COSTS_008_FIXTURE_STATEMENTS[0])break;
        await verifier.query(statement);
      }
      const adminSees=(await verifier.query(VISIBILITY_SQL)).rows[0].scope_table;
      const runtimeSees=(await runtime.query(VISIBILITY_SQL)).rows[0].scope_table;
      assert.equal(adminSees,'app.cost_financial_scopes');assert.equal(runtimeSees,null);
      result={ok:false,status:'BLOCKED',code:'COST_RUNTIME_008_NOT_VISIBLE',runtimeLoginConnected:true,runtimeLoginDml:false,
        migration008VisibleToMigrator:true,migration008VisibleToRuntime:false,sha256:plan.sha256,
        tests:['real LOGIN identity','uncommitted 008 invisible to independent runtime connection'],
        reason:'008 and synthetic mandates cannot be shared across PostgreSQL connections before COMMIT. This runner never commits or expands privileges.'};
    } else {
      await readCostsV1PrivilegeEvidence(runtime.query.bind(runtime));
      const tests=await exerciseRuntime(runtime,fixture);
      assertIdentity((await runtime.query(IDENTITY_SQL)).rows[0],'app_horas_runtime');
      try {await runtime.query("DO $proof$ BEGIN RAISE EXCEPTION 'COST_RUNTIME_VALIDATED_ROLLBACK'; END; $proof$;");}
      catch(error){if(!error.message.includes('COST_RUNTIME_VALIDATED_ROLLBACK'))throw error;
        result={ok:true,status:'PASS',runtimeLoginConnected:true,runtimeLoginDml:true,forcedRollback:true,sha256:plan.sha256,tests};}
      assert(result,'Terminal rollback exception was not observed');
    }
  } catch(error){originalError=error;}
  finally {
    try {if(runtimeTransaction)await runtime.query('ROLLBACK');} catch(error){originalError??=error;}
    try {if(adminTransaction)await verifier.query('ROLLBACK');} catch(error){originalError??=error;}
    try {if(runtimeConnected)await runtime.end();} catch(error){originalError??=error;}
    try {if(verifierConnected)await verifier.end();} catch(error){originalError??=error;}
  }
  // Brand-new connection, outside both transactions; failures cannot become PASS.
  let rollbackVerified=false,independentPid;
  if(before){const independent=new ClientClass(verifierConfig);try{await independent.connect();
    const identity=(await independent.query(IDENTITY_SQL)).rows[0];assertIdentity(identity,'app_horas_migration');
    independentPid=identity.pid;assert.notEqual(independentPid,verifierIdentity.pid);assert.notEqual(independentPid,runtimeIdentity?.pid);
    assert.deepEqual(await state(independent),before);rollbackVerified=true;
  }finally{await independent.end();}}
  if(originalError)throw originalError;
  return {...result,target:COSTS_PREFLIGHT_TARGET,identity:runtimeIdentity,rollbackVerified,
    independentPid,versions:before.catalog[0].versions,fingerprint:before.catalog[0].schema_fingerprint,persistentWrites:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv.length!==3||process.argv[2]!=='--stdin-temporary-target')throw Error('Explicit stdin temporary-target mode required');
  const reader=createInterface({input:process.stdin});reader.once('line',async line=>{reader.close();
    try{const result=await runtimePreflight(JSON.parse(line));console.log(JSON.stringify(result));process.exitCode=result.ok?0:2;}
    catch(error){console.error(JSON.stringify({ok:false,status:'ERROR',code:error.code||'RUNTIME_PREFLIGHT_FAILED',
      error:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[REDACTED]')}));process.exitCode=1;}
  });
}
