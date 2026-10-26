import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { compare008Evidence,MIGRATION_008_SHA256 } from '../scripts/lib/migration-008-evidence.mjs';
const load=async name=>JSON.parse(await readFile(new URL(`../docs/hours-v2-review/${name}`,import.meta.url),'utf8'));
async function evidence(){return {
  sql:await readFile(new URL('../db/migrations/008_costs_financial_scopes_and_open_corrections.sql',import.meta.url),'utf8'),
  ledger:await load('migration-008-neon-ledger-readonly.json'),
  schema:(await load('migration-008-neon-schema-readonly.json'))[0].evidence,
  privileges:(await load('migration-008-neon-privileges-readonly.json'))[0].evidence,
  ownership:await load('migration-008-neon-ownership-readonly.json'),
};}
test('008 file reproduces observed ledger SHA including original fail-closed guard',async()=>{
  const e=await evidence();assert.equal(createHash('sha256').update(e.sql).digest('hex'),MIGRATION_008_SHA256);
  assert.match(e.sql,/MIGRATION_008_DESIGN_ONLY_NOT_APPROVED/);
  const bytes=Buffer.from(e.sql);assert.equal(bytes.length,18225);
  assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`),bytes])).digest('hex'),'4363dff38c4abe0c0a64116cc678e1e383c18ff9');
  assert.deepEqual(compare008Evidence(e).failures,[]);
});
test('schema drift is not hidden by an already matching artifact checksum',async()=>{
  const e=await evidence();e.schema.tables.find(c=>c.table==='expenses'&&c.column==='details_version').nullable='YES';
  assert.ok(compare008Evidence(e).failures.includes('column_expenses_details_version'));
  e.schema.constraints.find(c=>c.name==='fk_cost_record_scope').definition='FOREIGN KEY (aircraft_id) REFERENCES app.aircraft(aircraft_id)';
  assert.ok(compare008Evidence(e).failures.includes('constraint_fk_cost_record_scope'));
});
test('broad economic UPDATE or public execution is rejected by offline comparison',async()=>{
  const e=await evidence();e.privileges.privileges.find(r=>r.table==='app.expense_payments').update=true;
  e.privileges.guard_function.public_execute=true;
  const failures=compare008Evidence(e).failures;assert.ok(failures.some(k=>k.startsWith('privilege_')));assert.ok(failures.includes('function_security'));
});
async function exactRunnerFunction(){
  // Execute the EXISTING function body, without importing CLI main, pg, env or connecting.
  const source=await readFile(new URL('../db/migrate.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('async function applyMigration('),source.indexOf('async function main()'));
  assert.ok(body.startsWith('async function applyMigration('));
  const messages=[];
  const fn=new Function('console',`${body}; return applyMigration;`)({log:m=>messages.push(m)});
  return {fn,messages};
}
test('unmodified runner skips exact live ledger 008 with one SELECT and no BEGIN/DDL/ledger mutation',async()=>{
  const {fn,messages}=await exactRunnerFunction(),e=await evidence();const queries=[];
  const row=e.ledger.find(r=>r.version==='008');
  const client={query:async(sql,args)=>{queries.push({sql,args});assert.match(sql,/^\s*SELECT filename, checksum_sha256/);return {rowCount:1,rows:[row]};}};
  await fn(client,{version:'008',filename:row.filename,checksum:MIGRATION_008_SHA256,sql:e.sql});
  assert.equal(queries.length,1);assert.deepEqual(queries[0].args,['008']);assert.equal(messages[0],`skip  ${row.filename}`);
});
test('runner rejects checksum or filename mismatch before any DDL; does not manufacture equivalence',async()=>{
  const e=await evidence(),row=e.ledger.find(r=>r.version==='008');
  for(const override of [{checksum:'bad'},{filename:'008_equivalent.sql'}]){
    const {fn}=await exactRunnerFunction();let queries=0;
    const client={query:async(sql)=>{queries++;assert.match(sql,/^\s*SELECT filename, checksum_sha256/);return {rowCount:1,rows:[row]};}};
    await assert.rejects(fn(client,{version:'008',filename:row.filename,checksum:MIGRATION_008_SHA256,sql:e.sql,...override}),/different content/);
    assert.equal(queries,1);
  }
});
test('observed 001–008 ledger matches each checked-in byte sequence',async()=>{
  for(const row of await load('migration-008-neon-ledger-readonly.json')){
    const bytes=await readFile(new URL(`../db/migrations/${row.filename}`,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),row.checksum_sha256,row.version);
  }
});
