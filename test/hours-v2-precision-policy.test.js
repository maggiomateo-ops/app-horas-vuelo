import test from 'node:test';
import assert from 'node:assert/strict';
import { observation as o, canonicalFlightTenths as round, compareEvidence, exactAcceptance, sumUniqueUsage, checkXlsxEnvelope } from '../docs/proposals/hours-start/precision-policy.mjs';
const compare=(a,b,extra={})=>compareEvidence(a,b,{basisA:'TIS',basisB:'TIS',...extra});
test('F2 exact decimal/h:mm/minute conversions preserve source and declared resolution',()=>{
  assert.equal(o('1:30','HH_MM').micros,o('1.50','HOURS').micros);
  assert.equal(o('0:01','HH_MM').micros,o('1','MINUTES').micros);
  assert.equal(o('0.01','HOURS').micros,36000000n);
  assert.equal(o('1.230000','HOURS','0.01 h').raw,'1.230000');
  assert.equal(o('1.230000','HOURS','0.01 h').resolution,'0.01 h');
  assert.equal(o('0.000001','HOURS').micros,3600n);
});
test('F2 unsupported precision is held, never rounded; NULL distinct from explicit zero',()=>{
  assert.throws(()=>o('1.0000001','HOURS'),/UNSUPPORTED/);
  assert.throws(()=>o('1:60','HH_MM'));
  assert.throws(()=>o(1.2,'HOURS'),/INVALID_SOURCE/);
  assert.equal(o(null,'HOURS').micros,null);
  assert.equal(o('0','HOURS').micros,0n);
});
test('D024/D098 HALF_UP per record differs from rounding sum, original stays exact',()=>{
  const a=o('0.05','HOURS');
  assert.equal(round(a),1n);
  assert.equal(round(a)+round(a),2n);
  assert.equal(round(o('0.10','HOURS')),1n);
  assert.equal(a.micros,180000000n);
});
test('F4 exact conversion, rounding, real discrepancy and missing evidence remain distinct',()=>{
  assert.equal(compare(o('1:30','HH_MM'),o('1.5','HOURS')).cause,'EXACT_EQUIVALENCE');
  const a=o('0.05','HOURS'), b=o('0.1','HOURS');
  assert.equal(compare(a,b,{roundingEvidence:true}).cause,'DOCUMENTED_ROUNDING');
  assert.equal(compare(a,b).cause,'REAL_DIFFERENCE');
  assert.equal(compare(a,b).differenceMicros,-180000000n);
  assert.equal(compare(a,b,{coverageKnown:false}).differenceMicros,null);
  assert.equal(compare(a,b,{basisB:'ENGINE_RUNTIME'}).cause,'INCOMPATIBLE_BASIS');
  assert.equal(compare(a,b,{basisA:'DECLARED_ONLY',basisB:'DECLARED_ONLY'}).differenceMicros,null);
});
test('F4 no autoacceptance, epsilon or rounding waiver; exact match requires approved policy and review',()=>{
  const exact=compare(o('1','HOURS'),o('60','MINUTES'));
  assert.equal(exactAcceptance(exact),false);
  const approval={approvalReference:'OFFLINE FIXTURE ONLY',reviewed:true};
  assert.equal(exactAcceptance(exact,approval),true);
  assert.equal(exactAcceptance(exact,{...approval,unresolved:['UNKNOWN_PERIOD']}),false);
  assert.equal(exactAcceptance(compare(o('1.01','HOURS'),o('1','HOURS')),approval),false);
  assert.equal(exactAcceptance(compare(o('0.05','HOURS'),o('0.1','HOURS'),{roundingEvidence:true}),approval),false);
});
test('F4 overlap, repeat reconciliation and counter snapshots do not double count deltas',()=>{
  const rows=[{identity:'flight-1:engine-1:runtime',micros:o('1.20','HOURS').micros}];
  assert.equal(sumUniqueUsage(rows),4320000000n);
  assert.equal(sumUniqueUsage(rows),4320000000n); // second run replaces view, never added to first
  assert.throws(()=>sumUniqueUsage([...rows,...rows]),/DUPLICATE/);
  assert.equal(sumUniqueUsage([{identity:'unknown',micros:null}]),null);
});
const envelope={bytes:10485760,sheets:20,rows:10000,cells:200000,expandedBytes:104857600,entries:2000};
test('F6 inclusive global XLSX limits reject each over-limit input and malformed metadata',()=>{
  assert.equal(checkXlsxEnvelope(envelope),true);
  for(const key of Object.keys(envelope))assert.equal(checkXlsxEnvelope({...envelope,[key]:envelope[key]+1}),false,key);
  assert.equal(checkXlsxEnvelope({...envelope,rows:-1}),false);
  assert.equal(checkXlsxEnvelope({...envelope,bytes:NaN}),false);
});
