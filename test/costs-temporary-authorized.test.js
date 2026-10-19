import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertTemporaryProof, approvedMigration, fixtureStatements, confirmedTransaction,
  classifyFailure, authorizedTemporary, AUTHORIZATION, FIXTURE } from '../scripts/costs-008-temporary-authorized.mjs';

const proof={verifiedAt:1000,branch:{project_id:'red-pine-78283204',id:'br-fancy-hall-b6h6g74f',parent_id:'br-billowing-band-b62jj1ab',
  primary:false,default:false,protected:false,current_state:'ready'},compute:{project_id:'red-pine-78283204',branch_id:'br-fancy-hall-b6h6g74f',
  id:'ep-ancient-recipe-b6cjj1qz',host:'ep-ancient-recipe-b6cjj1qz.c-2.sa-east-1.aws.neon.tech',type:'read_write'}};

test('temporary preparation refuses other projects, branches, parent, primary/default and stale control-plane evidence',()=>{
  assert.equal(assertTemporaryProof(proof,1001).branch_id,'br-fancy-hall-b6h6g74f');
  for(const changed of [{project_id:'other'},{id:'br-billowing-band-b62jj1ab'},{parent_id:'other'},{primary:true},{default:true},{protected:true}]){
    assert.throws(()=>assertTemporaryProof({...proof,branch:{...proof.branch,...changed}},1001));
  }
  assert.throws(()=>assertTemporaryProof({...proof,compute:{...proof.compute,host:'production'}},1001));
  assert.throws(()=>assertTemporaryProof(proof,1000+15*60*1000));
});

test('only exact reviewed 008 may be stripped in memory; official file remains guarded',()=>{
  const path=new URL('../db/migrations/008_costs_financial_scopes_and_open_corrections.sql',import.meta.url);
  const sql=readFileSync(path,'utf8');const statements=approvedMigration(sql);
  assert(statements.length>10);assert(!statements.some(s=>s.includes('MIGRATION_008_DESIGN_ONLY_NOT_APPROVED')));
  assert.throws(()=>approvedMigration(sql+'\n'),/exact reviewed/);
  assert.equal(readFileSync(path,'utf8'),sql);assert(sql.includes('MIGRATION_008_DESIGN_ONLY_NOT_APPROVED'));
});

test('committed fixture plan contains only INSERTs and synthetic UUIDs, separate mandate and Audit',()=>{
  const statements=fixtureStatements();assert(statements.every(s=>s.text.startsWith('INSERT INTO ')));
  assert(statements.some(s=>s.text.includes('cost_financial_authorities')));
  assert(statements.some(s=>s.text.includes('COST_FINANCIAL_AUTHORITY_PROVISIONED')));
  assert(statements.every(s=>s.values.filter(v=>typeof v==='string'&&/^[a-f0-9-]{36}$/.test(v)).every(v=>v.startsWith('c008'))));
  assert.equal(new Set(Object.values(FIXTURE)).size,6);
  assert(!statements.some(s=>/cost_concepts|INSERT INTO app.expenses|INSERT INTO app.cost_settlements|ALTER ROLE|GRANT/.test(s.text)));
});

test('failed preparation confirms rollback before returning; successful preparation commits once',async()=>{
  const commands=[];const client={async query(sql){commands.push(sql);return{command:sql};}};
  const failure=Object.assign(Error('constraint'),{code:'23505'});
  await assert.rejects(confirmedTransaction(client,async()=>{throw failure;}),{code:'23505',rollbackConfirmed:true});
  assert.deepEqual(commands,['BEGIN ISOLATION LEVEL SERIALIZABLE','ROLLBACK','SELECT 1']);
  commands.length=0;assert.equal(await confirmedTransaction(client,async()=>42),42);
  assert.deepEqual(commands,['BEGIN ISOLATION LEVEL SERIALIZABLE','COMMIT']);
});

test('explicit authorization and mode are checked before any connection',async()=>{
  let connected=false;class ForbiddenClient{constructor(){connected=true;}}
  await assert.rejects(authorizedTemporary('prepare',{authorization:'not-authorized'},{ClientClass:ForbiddenClient}));
  await assert.rejects(authorizedTemporary('retarget',{authorization:AUTHORIZATION},{ClientClass:ForbiddenClient}));
  assert.equal(connected,false);
  assert.equal(classifyFailure({code:'42501'}),'code/privilege');
  assert.equal(classifyFailure({code:'23505'}),'data/constraint');
  assert.equal(classifyFailure({code:'ERR_ASSERTION'}),'validator');
  assert.equal(classifyFailure({code:'ETIMEDOUT'}),'tool/infrastructure');
});
