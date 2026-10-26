import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { visibleStaging, purgeDecision, cleanupClaim, cleanupFinish, fencedMutation, confirmationGeneration } from '../docs/proposals/hours-start/retention-model.mjs';
const root=new URL('../docs/proposals/hours-start/',import.meta.url);
const read=(name)=>readFile(new URL(name,root),'utf8');
const batch={aircraftId:'A',state:'OPEN',stageExpiresAt:7000,rawExpiresAt:1000,cancelledAt:null,rawDeletedAt:null,storageKey:'opaque',leaseUntil:null,retryAt:null,attempts:0};

test('F6 expiry/cancellation deny OWNER access immediately, independent of cleanup job',()=>{
  assert.equal(visibleStaging(batch,{owner:true,aircraftId:'A',now:6999}),true);
  for(const overrides of [{owner:false},{aircraftId:'B'},{now:7000}])assert.equal(visibleStaging(batch,{owner:true,aircraftId:'A',now:1000,...overrides}),false);
  for(const state of ['CANCELLED','EXPIRED','PURGED'])assert.equal(visibleStaging({...batch,state},{owner:true,aircraftId:'A',now:1000}),false);
  assert.equal(visibleStaging({...batch,state:'CONFIRMED'},{owner:true,aircraftId:'A',now:9000}),true);
});
test('purge is idempotent, expiry inclusive, any confirmation forbids deletion',()=>{
  assert.equal(purgeDecision(batch,{now:6999}),'DENY_LIVE');
  assert.equal(purgeDecision(batch,{now:7000}),'PURGE_TEMPORARY_GRAPH');
  assert.equal(purgeDecision({...batch,state:'CANCELLED',cancelledAt:1},{now:10}),'PURGE_TEMPORARY_GRAPH');
  assert.equal(purgeDecision({...batch,state:'PURGED'},{now:9000}),'ALREADY_PURGED');
  assert.equal(purgeDecision(batch,{now:9000,hasConfirmation:true}),'DENY_ACCEPTED');
  assert.equal(purgeDecision({...batch,state:'CONFIRMED'},{now:9000}),'DENY_ACCEPTED');
});
test('raw cleanup leases exclude second worker; expired/stale token cannot acknowledge deletion',()=>{
  const first=cleanupClaim(batch,{now:1000,token:'lease1'});
  assert.equal(cleanupClaim(first,{now:1001,token:'lease2'}),null);
  assert.throws(()=>cleanupFinish(first,{now:1001,token:'other',verifiedAbsent:true}),/STALE/);
  assert.throws(()=>cleanupFinish(first,{now:first.leaseUntil,token:'lease1',verifiedAbsent:true}),/STALE/);
  const successor=cleanupClaim(first,{now:first.leaseUntil,token:'lease2'});
  assert.equal(successor.attempts,2);
  assert.throws(()=>cleanupFinish(successor,{now:first.leaseUntil+1,token:'lease1',verifiedAbsent:true}),/STALE/);
});
test('provider error preserves key and retries, success verifies once without touching accepted evidence',()=>{
  const first=cleanupClaim({...batch,state:'CONFIRMED'},{now:10,token:'lease1'});
  const failed=cleanupFinish(first,{now:11,token:'lease1',verifiedAbsent:false});
  assert.equal(failed.storageKey,'opaque');assert.equal(failed.rawDeletedAt,null);
  assert.equal(cleanupClaim(failed,{now:12,token:'lease2'}),null);
  const retry=cleanupClaim(failed,{now:failed.retryAt,token:'lease2'});
  const done=cleanupFinish(retry,{now:failed.retryAt+1,token:'lease2',verifiedAbsent:true});
  assert.equal(done.storageKey,null);assert.equal(done.state,'CONFIRMED');
  assert.equal(cleanupFinish(done,{now:999999,token:'old',verifiedAbsent:true}),done);
});
test('stale snapshot and stale expected generation abort; retry rereads complete state',()=>{
  assert.equal(fencedMutation({actualGeneration:1,expectedGeneration:1,snapshotGeneration:1}),2);
  assert.throws(()=>fencedMutation({actualGeneration:2,expectedGeneration:1,snapshotGeneration:1}),/40001/);
  assert.throws(()=>fencedMutation({actualGeneration:2,expectedGeneration:1,snapshotGeneration:2}),/STALE_PREVIEW/);
  assert.equal(fencedMutation({actualGeneration:2,expectedGeneration:2,snapshotGeneration:2}),3);
});
test('all 20 proposed tables have explicit classification, FORCE RLS and history guard',async()=>{
  const [core,security,policyText]=await Promise.all([read('schema.sql'),read('security.sql'),read('table-policy.json')]);
  const tables=[...core.matchAll(/CREATE TABLE app\.(\w+)/g)].map(m=>m[1]);
  const policy=JSON.parse(policyText);
  assert.equal(tables.length,20);assert.deepEqual(Object.keys(policy),tables);
  for(const t of tables){
    assert.ok(security.includes(`ALTER TABLE app.${t} FORCE ROW LEVEL SECURITY;`));
    assert.ok(security.includes(`BEFORE INSERT OR UPDATE OR DELETE ON app.${t}`));
    assert.ok(security.includes(`REVOKE ALL ON app.${t} FROM PUBLIC, app_runtime;`));
  }
  const deletable=[...security.matchAll(/GRANT DELETE ON app\.(\w+) TO hours_v2_cleanup_owner;/g)].map(m=>m[1]);
  assert.deepEqual(new Set(deletable),new Set(Object.keys(policy).filter(t=>policy[t]==='TEMPORARY_UNTIL_CONFIRMED')));
  assert.equal(deletable.length,12);
});
test('proposed roles have no LOGIN/BYPASS or runtime membership; worker gets functions only',async()=>{
  const security=await read('security.sql');
  const roles=[...security.matchAll(/CREATE ROLE (\w+) ([^;]+);/g)];assert.equal(roles.length,6);
  for(const r of roles)assert.equal(r[2],'NOLOGIN NOINHERIT NOBYPASSRLS');
  assert.doesNotMatch(security,/GRANT hours_v2_\w+ TO (?:app_runtime|app_horas_runtime)/);
  assert.doesNotMatch(security,/GRANT (?:SELECT|INSERT|UPDATE|DELETE)[^;]+ON app\.[^;]+TO hours_v2_maintenance/s);
  assert.match(security,/GRANT EXECUTE ON FUNCTION hours_v2_private.purge_batch\(uuid,uuid\) TO hours_v2_maintenance/);
  const funcs=[...security.matchAll(/CREATE FUNCTION hours_v2_private\.(\w+)\(/g)].map(m=>m[1]);
  for(const fn of funcs)assert.match(security,new RegExp(`REVOKE ALL ON FUNCTION hours_v2_private\\.${fn}\\([^;]* FROM PUBLIC;`));
});
test('scope is explicit across mappings, batches, candidates and canonical promotion',async()=>{
  const core=await read('schema.sql');
  assert.match(core,/FOREIGN KEY\(aircraft_id,mapping_version_id,import_batch_id\) REFERENCES app.hours_import_mapping_versions/);
  assert.match(core,/FOREIGN KEY\(aircraft_id,reconciliation_run_id,import_batch_id\) REFERENCES app.hours_reconciliation_runs/);
  assert.match(core,/FOREIGN KEY\(aircraft_id,staged_row_id,import_batch_id\) REFERENCES app.hours_import_staged_rows/);
  assert.match(core,/FOREIGN KEY\(aircraft_id,reconciliation_run_id,staged_row_id,disposition\)/);
  const security=await read('security.sql');
  assert.match(security,/DEFERRABLE INITIALLY DEFERRED/);
  assert.match(security,/f.import_row_number=row_source.source_ordinal/);
  assert.match(security,/Confirmed snapshot is sealed/);
  assert.match(security,/Accepted lineage is sealed/);
  assert.match(security,/Blocking validation issues remain/);
  assert.match(security,/hours_v2_generation=hours_v2_generation\+1/);
});
test('teardown covers all security functions, roles and retention columns; no CASCADE',async()=>{
  const [security,rollback,retention,rollbackRetention]=await Promise.all([read('security.sql'),read('rollback-security.sql'),read('retention.sql'),read('rollback-retention.sql')]);
  const made=[...security.matchAll(/CREATE FUNCTION hours_v2_private\.(\w+)\(/g)].map(m=>m[1]);
  const dropped=[...rollback.matchAll(/DROP FUNCTION hours_v2_private\.(\w+)\(/g)].map(m=>m[1]);
  assert.deepEqual(new Set(made),new Set(dropped));
  for(const m of retention.matchAll(/ADD COLUMN (\w+)/g))assert.ok(rollbackRetention.includes(`DROP COLUMN ${m[1]}`));
  assert.doesNotMatch(rollback,/\bCASCADE\b/);assert.doesNotMatch(rollbackRetention,/\bCASCADE\b/);
  for(const m of security.matchAll(/CREATE ROLE (\w+)/g))assert.ok(rollback.includes(`DROP ROLE ${m[1]};`));
});
test('ledger manifest is repository evidence only and migrations remain outside proposal runner',async()=>{
  const expected=JSON.parse(await readFile(new URL('../docs/hours-v2-review/expected-ledger.json',import.meta.url),'utf8'));
  assert.match(expected.source,/NOT observed remote ledger/);
  const names=await readdir(new URL('../db/migrations/',import.meta.url));
  assert.deepEqual(names.filter(f=>f.endsWith('.sql')).sort(),Object.keys(expected.migrations).sort());
  for(const [name,hash] of Object.entries(expected.migrations)){
    const bytes=await readFile(new URL(`../db/migrations/${name}`,import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),hash);
  }
  assert.ok(names.every(n=>!n.includes('hours_v2')));
});
test('prepared two-session test cannot reach acceptance after stale fence; DDL forces rollback',async()=>{
  const [a,b,forced]=await Promise.all([read('preflight-session-a.sql'),read('preflight-session-b.sql'),read('forced-rollback.sql')]);
  assert.match(a,/BEGIN ISOLATION LEVEL SERIALIZABLE/);assert.match(b,/BEGIN ISOLATION LEVEL SERIALIZABLE/);
  assert.match(b,/expected_generation/);assert.match(b,/FAIL: stale preview crossed fence/);
  assert.match(forced,/EXPECTED_HOURS_V2_FORCED_ROLLBACK/);
  assert.doesNotMatch(forced,/^COMMIT;/m);
  assert.doesNotMatch(forced,/INSERT INTO public.schema_migrations/);
});

test('stale run cannot bypass expected generation by fencing with NULL',async()=>{
  const oldRun=5;
  assert.equal(confirmationGeneration(oldRun,6),true);
  const bypass=fencedMutation({actualGeneration:6,expectedGeneration:null,snapshotGeneration:6});
  assert.equal(bypass,7);
  assert.equal(confirmationGeneration(oldRun,bypass),false);
  const sql=await read('security.sql');
  assert.match(sql,/r.input_generation=nullif\(current_setting\('hours_v2.fenced_generation',true\),''\)::bigint-1/);
  assert.match(sql,/Stale validation cannot be confirmed/);
});
