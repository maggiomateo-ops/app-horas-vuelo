import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../docs/proposals/hours-start/',import.meta.url);
const read=name=>readFile(new URL(name,root),'utf8');
const sha=text=>createHash('sha256').update(text).digest('hex');

test('bootstrap is pinned to approved migration actor, explicit transaction marker and PostgreSQL >=16',async()=>{
  const s=await read('security.sql');const pre=s.slice(0,s.indexOf('CREATE ROLE hours_v2_reader'));
  assert.match(pre,/current_user <> 'app_horas_migration'/);
  assert.match(pre,/session_user <> current_user/);
  assert.match(pre,/server_version_num.*< 160000/);
  assert.match(pre,/hours_v2.owner_bootstrap.*approved-disposable-only/);
  assert.match(pre,/rolcreaterole AND NOT rolsuper/);
  assert.match(pre,/pg_has_role\('app_horas_runtime',current_user,'MEMBER'\)/);
  assert.match(pre,/SET LOCAL createrole_self_grant = ''/);
});
test('SET-only bootstrap reaches both owners, ACLs precede transfers and CREATE survives until last transfer',async()=>{
  const s=await read('security.sql');
  assert.match(s,/GRANT hours_v2_security_owner, hours_v2_cleanup_owner TO app_horas_migration\s+WITH INHERIT FALSE, SET TRUE GRANTED BY app_horas_migration/);
  const first=s.indexOf('ALTER FUNCTION'),last=s.lastIndexOf('ALTER FUNCTION');
  assert.ok(s.lastIndexOf('GRANT EXECUTE ON FUNCTION')<first);
  assert.ok(s.indexOf('GRANT CREATE ON SCHEMA hours_v2_private')<first);
  assert.ok(s.indexOf('REVOKE CREATE ON SCHEMA hours_v2_private')>last);
  assert.ok(s.indexOf('REVOKE SET OPTION FOR')>last);
  const transfers=[...s.matchAll(/ALTER FUNCTION hours_v2_private\.([^;]+) OWNER TO (\w+);/g)];
  assert.equal(transfers.length,14);
  assert.equal(transfers.filter(m=>m[2]==='hours_v2_security_owner').length,10);
  assert.equal(transfers.filter(m=>m[2]==='hours_v2_cleanup_owner').length,4);
});
test('business function bodies, SECURITY DEFINER/search_path and RLS policy definitions are byte-preserved',async()=>{
  const s=await read('security.sql');
  const baseline=JSON.parse(await readFile(new URL('../docs/hours-v2-review/security-function-contract.json',import.meta.url),'utf8'));
  const actual=Object.fromEntries([...s.matchAll(/CREATE FUNCTION hours_v2_private\.(\w+)\([\s\S]*?\$\$;/g)].map(m=>[m[1],sha(m[0])]));
  assert.deepEqual(actual,baseline.functionsSha256);
  assert.equal(sha([...s.matchAll(/CREATE POLICY [\s\S]*?;/g)].map(m=>m[0]).join('\n')),baseline.policiesSha256);
});
test('final guards reject remaining SET/INHERIT paths, runtime membership or wrong owner/ACL',async()=>{
  const s=await read('security.sql');const post=s.slice(s.indexOf('DO $owner_bootstrap_closed$'));
  for(const runtime of ['app_runtime','app_horas_runtime'])assert.ok(post.includes(`pg_has_role('${runtime}',r,'MEMBER')`));
  assert.match(post,/m.inherit_option OR m.set_option/);
  assert.match(post,/pg_has_role\(current_user,r,'SET'\)/);
  assert.match(post,/pg_has_role\(current_user,r,'USAGE'\)/);
  assert.match(post,/p.proowner=f.owner_role::regrole AND p.prosecdef=f.is_definer/);
  assert.match(post,/a.grantee=0 AND a.privilege_type='EXECUTE'/);
});
test('prepared teardown reopens only migration SET rights and switches to each owner before DROP',async()=>{
  const rb=await read('rollback-security.sql');
  assert.match(rb,/current_user<>'app_horas_migration'/);
  assert.match(rb,/WITH INHERIT FALSE, SET TRUE GRANTED BY app_horas_migration/);
  const s=await read('security.sql');
  for(const m of s.matchAll(/ALTER FUNCTION hours_v2_private\.([^;]+) OWNER TO (\w+);/g)){
    assert.ok(rb.includes(`SET LOCAL ROLE ${m[2]};\nDROP FUNCTION hours_v2_private.${m[1]};\nRESET ROLE;`));
  }
  for(const role of ['reader','writer','maintenance','invalidator','cleanup_owner','security_owner']){
    assert.ok(rb.includes(`SET LOCAL ROLE hours_v2_${role};\nDROP OWNED BY hours_v2_${role} RESTRICT;\nRESET ROLE;\nDROP ROLE hours_v2_${role};`));
  }
});
test('forced rollback includes local acknowledgement and probes distinguish ADMIN from SET and USAGE',async()=>{
  assert.match(await read('forced-rollback.sql'),/BEGIN;\nSET LOCAL hours_v2.owner_bootstrap='approved-disposable-only';/);
  const probes=await read('preflight-privileges.sql');
  for(const option of ['admin_option','inherit_option','set_option'])assert.ok(probes.includes(option));
  assert.match(probes,/pg_has_role\(actor,owner_role,'SET'\)/);
  assert.match(probes,/pg_has_role\(actor,owner_role,'USAGE'\)/);
});
