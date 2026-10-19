import test from 'node:test';
import assert from 'node:assert/strict';
import { temporaryConnection, runtimePreflight, exerciseRuntime } from '../scripts/costs-008-runtime-preflight.mjs';

// Dummy strings, never used as credentials or sent to a network. The injected
// driver tests executor safety/cleanup; it is NOT PostgreSQL integration evidence.
const url=role=>`postgresql://${role}:dummy@ep-ancient-recipe-b6cjj1qz.c-2.sa-east-1.aws.neon.tech/app_horas?sslmode=require`;
const input={runtimeConnectionString:url('app_horas_runtime'),verifierConnectionString:url('app_horas_migration')};
function driver({mismatch=false,wrongIdentity=false,ddlError=false}={}) {
  const clients=[];let rolledBack=false;
  class FakeClient {
    constructor(config){this.role=new URL(config.connectionString).username;this.number=clients.length;this.calls=[];clients.push(this);}
    async connect(){this.connected=true;}
    async end(){this.closed=true;}
    async query(sql){
      this.calls.push(sql);
      if(sql.startsWith('SELECT session_user'))return {rows:[{session_user:wrongIdentity&&this.role==='app_horas_runtime'?'app_horas_migration':this.role,
        current_user:this.role,database:'app_horas',pid:100+this.number}]};
      if(sql.includes('AS schema_fingerprint'))return {rows:[{database:'app_horas',versions:['001','002','003','004','005','006','007'],
        schema_fingerprint:mismatch&&this.number>1?'changed':'same',scope_table:null}]};
      if(sql.includes('r.rolname AS role'))return {rows:[]};
      if(sql==='SELECT to_regclass($1) AS relation')return {rows:[{relation:null}]};
      if(sql.includes("to_regclass('app.cost_financial_scopes') AS scope_table"))return {rows:[{scope_table:this.role==='app_horas_migration'&&this.ddl?'app.cost_financial_scopes':null}]};
      if(sql.includes('CREATE TABLE app.cost_financial_scopes')){if(ddlError)throw Object.assign(Error('Synthetic DDL error'),{code:'TEST_ERROR'});this.ddl=true;}
      if(sql==='ROLLBACK'){this.ddl=false;rolledBack=true;}
      return {rows:[]};
    }
  }
  return {ClientClass:FakeClient,clients,wasRolledBack:()=>rolledBack};
}

test('runtime gate refuses a migrator shortcut, foreign endpoint and startup role overrides before connecting',async()=>{
  for(const bad of [url('app_horas_migration'),url('app_horas_runtime').replace('ep-ancient-recipe-b6cjj1qz','ep-production'),
    `${url('app_horas_runtime')}&options=-c%20role%3Dapp_horas_migration`]) {
    const d=driver();await assert.rejects(runtimePreflight({...input,runtimeConnectionString:bad},d));assert.equal(d.clients.length,0);
  }
  assert.match(temporaryConnection(url('app_horas_runtime').replace('.c-2.','-pooler.c-2.'),'app_horas_runtime').connectionString,/sslmode=verify-full/);
});

test('uncommitted 008 visibility yields BLOCKED, rolls back both sessions and verifies with a new connection',async()=>{
  const d=driver();const result=await runtimePreflight(input,d);
  assert.equal(result.status,'BLOCKED');assert.equal(result.ok,false);assert.equal(result.runtimeLoginDml,false);
  assert.equal(result.code,'COST_RUNTIME_008_NOT_VISIBLE');assert.equal(result.rollbackVerified,true);
  assert.equal(d.clients.length,3);assert(d.clients.every(c=>c.closed));
  assert(d.clients[0].calls.includes('ROLLBACK'));assert(d.clients[1].calls.includes('ROLLBACK'));
  assert(d.clients[0].calls.some(s=>s.includes('CREATE TABLE app.cost_financial_scopes')));
  assert(d.clients[1].calls.every(s=>!/INSERT|UPDATE|DELETE|SET ROLE|COMMIT/.test(s)));
  assert(d.clients.every(c=>c.calls.every(s=>!/^\s*(COMMIT\b|SET\s+(?:LOCAL\s+)?ROLE\b)/i.test(s))));
});

test('independent rollback mismatch cannot return a successful or safely blocked result',async()=>{
  const d=driver({mismatch:true});await assert.rejects(runtimePreflight(input,d),/changed/);
  assert(d.wasRolledBack());assert(d.clients.every(c=>c.closed));
});

test('wrong session identity and DDL errors close connections and never become PASS',async()=>{
  for(const options of [{wrongIdentity:true},{ddlError:true}]){
    const d=driver(options);await assert.rejects(runtimePreflight(input,d));assert(d.clients.every(c=>c.closed));
    assert.equal(d.clients.length,3);
    if(options.ddlError)assert(d.wasRolledBack());
  }
});

test('DML suite rejects real/unspecified identities before any query or mutation',async()=>{
  let called=false;
  await assert.rejects(exerciseRuntime({query(){called=true;}},{userId:'00000000-0000-4000-8000-000000000001'}),/Synthetic fixture/);
  assert.equal(called,false);
});
