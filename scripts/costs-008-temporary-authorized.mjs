// One-off authorization: prepare committed 008 + synthetic fixture ONLY on the
// named disposable branch. Runtime smoke remains rollback-only. No deletion API,
// role changes, application flags or arbitrary targets are accepted here.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { temporaryConnection, runtimePreflight } from './costs-008-runtime-preflight.mjs';
import { buildCosts008Preflight, splitPostgresStatements, COSTS_FINGERPRINT_SQL, COSTS_PREFLIGHT_TARGET } from './lib/costs-008-preflight.mjs';
import { COST_ROLE_QUERY, COST_RUNTIME_ROLES, readCostsV1PrivilegeEvidence } from './lib/costs-v1-privilege-contract.mjs';

export const AUTHORIZATION = 'ISSUE_8_TEMPORARY_008_SYNTHETIC_COMMIT_AND_DELETE';
export const MIGRATION_SHA256 = '30df860f6ba51617e93c55be21e8d2355aba734977dfb3db6bf0776b5c07c160';
const MIGRATION_FILE = '008_costs_financial_scopes_and_open_corrections.sql';
const id=n=>`c0080000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
export const FIXTURE = Object.freeze({userId:id(1),aircraftId:id(2),responsiblePartyId:id(3),payerPartyId:id(4),scopeId:id(5),deniedUserId:id(20)});
const AUTHORITY=id(22), AUDIT=id(23), REQUEST=id(24);
const IDENTITY_SQL='SELECT session_user,current_user,current_database() AS database,pg_backend_pid() AS pid';
const quote=s=>`"${s.replaceAll('"','""')}"`;
const hash=s=>createHash('sha256').update(s).digest('hex');

export function assertTemporaryProof({branch,compute,verifiedAt}, now=Date.now()) {
  assert(branch?.project_id===COSTS_PREFLIGHT_TARGET.project_id && branch.id===COSTS_PREFLIGHT_TARGET.branch_id
    && branch.parent_id==='br-billowing-band-b62jj1ab' && branch.primary===false && branch.default===false
    && branch.protected===false && branch.current_state==='ready','Unauthorized Neon branch');
  assert(compute?.project_id===branch.project_id && compute.branch_id===branch.id && compute.id==='ep-ancient-recipe-b6cjj1qz'
    && compute.host==='ep-ancient-recipe-b6cjj1qz.c-2.sa-east-1.aws.neon.tech' && compute.type==='read_write','Unauthorized Neon endpoint');
  assert(Number.isFinite(verifiedAt) && now>=verifiedAt && now-verifiedAt<15*60*1000,'Fresh Neon control-plane verification required');
  return COSTS_PREFLIGHT_TARGET;
}

export function approvedMigration(sql) {
  assert.equal(hash(sql),MIGRATION_SHA256,'Only exact reviewed 008 is authorized');
  buildCosts008Preflight(sql,COSTS_PREFLIGHT_TARGET); // verifies the exact design guard
  return splitPostgresStatements(sql).slice(1); // remove guard ONLY in memory
}

export function classifyFailure(error) {
  if(error.code==='42501')return 'code/privilege';
  if(/^23/.test(error.code||''))return 'data/constraint';
  if(/^08|^57|ETIMEDOUT|ECONN|ENOTFOUND/.test(error.code||'')||/timeout/i.test(error.message))return 'tool/infrastructure';
  return error.code==='ERR_ASSERTION'?'validator':'code';
}

async function identity(client,role) {
  const value=(await client.query(IDENTITY_SQL)).rows[0];
  assert.equal(value.session_user,role);assert.equal(value.current_user,role);assert.equal(value.database,'app_horas');return value;
}

// Canonical data never leaves PostgreSQL: compare hashes/counts, not actual rows.
// Includes all app/audit tables and the ledger; detects any c008 UUID reference.
export async function snapshot(client) {
  const catalog=(await client.query(COSTS_FINGERPRINT_SQL)).rows[0];
  const roles=(await client.query(COST_ROLE_QUERY,[COST_RUNTIME_ROLES])).rows.sort((a,b)=>a.role.localeCompare(b.role));
  const relations=(await client.query(`SELECT n.nspname AS schema,c.relname AS table,
    ARRAY(SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.atttypid='uuid'::regtype
      AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum) AS uuids
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind='r' AND (n.nspname IN ('app','audit') OR (n.nspname='public' AND c.relname='schema_migrations'))
    ORDER BY n.nspname,c.relname`)).rows;
  const tables={};
  for(const relation of relations){
    const name=`${quote(relation.schema)}.${quote(relation.table)}`;
    const synthetic=relation.uuids.length?relation.uuids.map(c=>`COALESCE(${quote(c)}::text LIKE 'c008%',false)`).join(' OR '):'false';
    tables[`${relation.schema}.${relation.table}`]=(await client.query(`SELECT count(*)::int AS count,
      count(*) FILTER(WHERE ${synthetic})::int AS synthetic,
      md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS hash,
      md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FILTER(WHERE NOT (${synthetic}))::text,'[]')) AS real_hash
      FROM ${name} t`)).rows[0];
  }
  const ledger=(await client.query('SELECT version,filename,checksum_sha256 FROM public.schema_migrations ORDER BY version')).rows;
  return {catalog,roles,tables,ledger};
}

function assertClean(state) {
  assert.equal(state.catalog.scope_table,null,'008 already exists; do not retry preparation');
  assert.deepEqual(state.ledger.map(r=>r.version),['001','002','003','004','005','006','007']);
  for(const row of state.ledger){
    const local=readFileSync(new URL(`../db/migrations/${row.filename}`,import.meta.url),'utf8');
    assert.equal(hash(local),row.checksum_sha256,'Existing ledger differs from repository');
  }
  for(const [table,value] of Object.entries(state.tables)){
    assert.equal(value.synthetic,0,`Previous synthetic data found: ${table}`);
    if(/^app\.(cost_|expense)/.test(table))assert.equal(value.count,0,`Costs not empty: ${table}`);
  }
}

// Exact synthetic UUIDs, no lookups of real identities, no inferred authority.
export function fixtureStatements() {
  const f=FIXTURE;
  return [
    {text:`INSERT INTO app.users(user_id,email,status,preferred_locale,updated_at) VALUES
      ($1,'costs-runtime-owner@example.invalid','ACTIVE','es',now()),($2,'costs-runtime-denied@example.invalid','ACTIVE','es',now())`,values:[f.userId,f.deniedUserId]},
    {text:`INSERT INTO app.aircraft(aircraft_id,manufacturer,model,status,created_by_user_id,updated_at)
      VALUES($1,'SYNTHETIC RUNTIME ONLY','DISPOSABLE FIXTURE','ACTIVE',$2,now())`,values:[f.aircraftId,f.userId]},
    {text:`INSERT INTO app.parties(party_id,party_type,organization_name,status,updated_at) VALUES
      ($1,'ORGANIZATION','SYNTHETIC RESPONSIBLE','ACTIVE',now()),($2,'ORGANIZATION','SYNTHETIC PAYER','ACTIVE',now())`,values:[f.responsiblePartyId,f.payerPartyId]},
    ...[f.userId,f.deniedUserId].map((user,i)=>({text:`INSERT INTO app.aircraft_memberships(membership_id,aircraft_id,user_id,role,status,activated_at,updated_at)
      VALUES($1,$2,$3,'OWNER','ACTIVE',now(),now())`,values:[id(30+i),f.aircraftId,user]})),
    ...[f.responsiblePartyId,f.payerPartyId].map((party,i)=>({text:`INSERT INTO app.aircraft_ownership_interests(ownership_interest_id,aircraft_id,party_id,ownership_share,effective_from_at,created_by_user_id)
      VALUES($1,$2,$3,50,'2026-01-01T00:00:00Z',$4)`,values:[id(32+i),f.aircraftId,party,f.userId]})),
    {text:`INSERT INTO app.cost_financial_scopes(financial_scope_id,aircraft_id,label,approval_reference,created_by_user_id)
      VALUES($1,$2,'SYNTHETIC RUNTIME ROLLBACK ONLY','ISOLATED_RUNTIME_ROLLBACK_TEST_ONLY',$3)`,values:[f.scopeId,f.aircraftId,f.userId]},
    {text:`INSERT INTO app.cost_financial_authorities(financial_authority_id,financial_scope_id,user_id,approval_reference,authorized_by_user_id)
      VALUES($1,$2,$3,'ISOLATED_RUNTIME_ROLLBACK_TEST_ONLY',$3)`,values:[AUTHORITY,f.scopeId,f.userId]},
    {text:`INSERT INTO audit.audit_events(audit_event_id,request_id,actor_type,actor_user_id,operation_source,aircraft_id,entity_type,entity_id,entity_key,action_code,after_state,metadata,payload_version)
      VALUES($1,$2,'USER',$3,'MANUAL',$4,'COST',$5,$6::jsonb,'COST_FINANCIAL_AUTHORITY_PROVISIONED',$7::jsonb,$8::jsonb,1)`,
    values:[AUDIT,REQUEST,f.userId,f.aircraftId,f.scopeId,JSON.stringify({financial_scope_id:f.scopeId}),JSON.stringify({financial_authority_id:AUTHORITY,user_id:f.userId}),
      JSON.stringify({synthetic_only:true,authorization:AUTHORIZATION,approval_reference:'ISOLATED_RUNTIME_ROLLBACK_TEST_ONLY'})]},
  ];
}

export async function confirmedTransaction(client,work) {
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try{const result=await work();await client.query('COMMIT');return result;}
  catch(error){
    const rollback=await client.query('ROLLBACK');assert.equal(rollback.command,'ROLLBACK','Rollback not acknowledged');
    await client.query('SELECT 1');error.rollbackConfirmed=true;throw error;
  }
}

async function assertPrepared(client,state,before) {
  assert.equal(state.catalog.scope_table,'app.cost_financial_scopes');
  assert.deepEqual(state.ledger.map(r=>r.version),['001','002','003','004','005','006','007','008']);
  assert.deepEqual(state.ledger.at(-1),{version:'008',filename:MIGRATION_FILE,checksum_sha256:MIGRATION_SHA256});
  await readCostsV1PrivilegeEvidence(client.query.bind(client));
  const expected={'app.users':2,'app.aircraft':1,'app.parties':2,'app.aircraft_memberships':2,
    'app.aircraft_ownership_interests':2,'app.cost_financial_scopes':1,'app.cost_financial_authorities':1,'audit.audit_events':1};
  for(const [table,value] of Object.entries(state.tables)){
    assert.equal(value.synthetic,expected[table]||0,`Unexpected fixture rows: ${table}`);
    if(before&&table!=='public.schema_migrations'&&before.tables[table]){
      assert.equal(value.real_hash,before.tables[table].real_hash,`Real rows changed: ${table}`);
      assert.equal(value.count,before.tables[table].count+(expected[table]||0),`Unexpected count: ${table}`);
    }
    if(/^app\.(cost_|expense)/.test(table)&&!expected[table])assert.equal(value.count,0,`Economic smoke persisted: ${table}`);
  }
  if(before)assert.deepEqual(state.roles,before.roles,'Role attributes/memberships changed');
  const audit=(await client.query('SELECT action_code,metadata FROM audit.audit_events WHERE audit_event_id=$1',[AUDIT])).rows;
  assert.equal(audit.length,1);assert.equal(audit[0].action_code,'COST_FINANCIAL_AUTHORITY_PROVISIONED');assert.equal(audit[0].metadata.synthetic_only,true);
}

export async function authorizedTemporary(mode,input,{ClientClass=Client}={}) {
  assert(['inspect','prepare','smoke'].includes(mode),'Unsupported mode');
  assert.equal(input.authorization,AUTHORIZATION);assertTemporaryProof(input.proof);
  const config=temporaryConnection(input.verifierConnectionString,'app_horas_migration');
  const runtimeConfig=temporaryConnection(input.runtimeConnectionString,'app_horas_runtime');
  const sql=readFileSync(new URL(`../db/migrations/${MIGRATION_FILE}`,import.meta.url),'utf8');
  const ddl=approvedMigration(sql);
  const admin=new ClientClass(config);await admin.connect();
  let before,after,commitAcknowledged=false,originalError,smokeResult;
  try{
    await identity(admin,'app_horas_migration');
    // Verify real runtime LOGIN before any preparation writes.
    const login=new ClientClass(runtimeConfig);try{await login.connect();await identity(login,'app_horas_runtime');}finally{await login.end();}
    before=await snapshot(admin);
    if(mode==='inspect'){assertClean(before);return {ok:true,mode,target:COSTS_PREFLIGHT_TARGET,initial:before,syntheticResidues:0};}
    if(mode==='prepare'){
      assertClean(before);
      await confirmedTransaction(admin,async()=>{
        assert.equal((await admin.query("SELECT pg_try_advisory_xact_lock(hashtext('app_horas_schema_migrations')) AS locked")).rows[0].locked,true);
        assertClean(await snapshot(admin));
        for(const statement of ddl)await admin.query(statement);
        await readCostsV1PrivilegeEvidence(admin.query.bind(admin));
        for(const statement of fixtureStatements())await admin.query(statement.text,statement.values);
        await admin.query('INSERT INTO public.schema_migrations(version,filename,checksum_sha256) VALUES($1,$2,$3)',['008',MIGRATION_FILE,MIGRATION_SHA256]);
        await assertPrepared(admin,await snapshot(admin),before);
      });commitAcknowledged=true;
    }else{
      await assertPrepared(admin,before);
      smokeResult=await runtimePreflight({runtimeConnectionString:input.runtimeConnectionString,
        verifierConnectionString:input.verifierConnectionString,fixture:FIXTURE},{ClientClass});
      assert.equal(smokeResult.runtimeLoginDml,true);assert.equal(smokeResult.rollbackVerified,true);
    }
  }catch(error){originalError=error;}
  finally{await admin.end();}
  // Readback always uses a new connection, including after failures. No retries.
  const independent=new ClientClass(config);try{
    await independent.connect();await identity(independent,'app_horas_migration');after=await snapshot(independent);
    if(!originalError&&mode==='prepare')await assertPrepared(independent,after,before);
    if(mode==='smoke')assert.deepEqual(after,before,'Runtime smoke changed committed state');
    if(originalError&&mode==='prepare'&&originalError.rollbackConfirmed)assert.deepEqual(after,before,'Failed preparation did not restore baseline');
  }finally{await independent.end();}
  if(originalError)return {ok:false,mode,classification:classifyFailure(originalError),code:originalError.code||'TEMPORARY_GATE_FAILED',
    error:String(originalError.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[REDACTED]'),rollbackConfirmed:originalError.rollbackConfirmed||mode==='smoke',commitAcknowledged,
    independentUnchanged:JSON.stringify(after)===JSON.stringify(before),after};
  return {ok:true,mode,target:COSTS_PREFLIGHT_TARGET,sha256:MIGRATION_SHA256,commitAcknowledged,
    persistentPreparation:mode==='prepare',fixture:FIXTURE,initial:before,after,smoke:smokeResult,
    independentUnchanged:mode==='smoke'?true:undefined};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const mode=process.argv[2]?.replace(/^--/,'');
  assert(process.argv.length===3&&['inspect','prepare','smoke'].includes(mode),'Explicit inspect/prepare/smoke mode required');
  const reader=createInterface({input:process.stdin});reader.once('line',async line=>{reader.close();
    try{const result=await authorizedTemporary(mode,JSON.parse(line));console.log(JSON.stringify(result));process.exitCode=result.ok?0:2;}
    catch(error){console.error(JSON.stringify({ok:false,classification:classifyFailure(error),code:error.code||'TEMPORARY_GATE_FAILED',
      error:String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g,'[REDACTED]')}));process.exitCode=1;}
  });
}
