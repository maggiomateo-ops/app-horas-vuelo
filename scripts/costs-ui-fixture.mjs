// Explicit local-only synthetic UI harness. No database access and no deployed flags.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { normalizeExpense, allocationRows } from '../api/_costsDomain.js';
if (!process.argv.includes('--synthetic-only') || process.env.VERCEL) throw new Error('Local synthetic-only mode is required.');
const root = fileURLToPath(new URL('../', import.meta.url));
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const archive={financial_scope_id:id(1),aircraft_id:id(2),label:'Archivo sintético de prueba'};
let count=10;
const state={scope:{...archive,owner:true},writes_enabled:true,concepts:[{cost_concept_id:id(3),name:'Seguro',status:'ACTIVE',cost_class:'FIXED'}],types:[],events:[],expenses:[],settlements:[],parties:[{party_id:id(4),name:'Responsable de prueba'},{party_id:id(5),name:'Pagador de prueba'}]};
const server=await createServer({root,server:{host:'127.0.0.1',port:4449,strictPort:true},plugins:[{name:'costs-fixture',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
 if(req.url.startsWith('/costs-fixture')){res.setHeader('Content-Type','text/html');res.end(await vite.transformIndexHtml('/costs-fixture',`<html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><p>PRUEBA LOCAL — Datos sintéticos, sin conexión a bases.</p><div id="root"></div><script type="module">import React from '/node_modules/.vite/deps/react.js';import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';const{createRoot}=ReactDOM;import CostsPanel from '/src/components/CostsPanel.jsx';import '/src/App.css';createRoot(document.getElementById('root')).render(React.createElement(CostsPanel));</script></body></html>`));return;}
 if(!req.url.startsWith('/api/settings'))return next();
 res.setHeader('Content-Type','application/json');
 if(req.method==='GET'){res.end(JSON.stringify({ok:true,costs:req.url.includes('action=archives')?{archives:[archive]}:state}));return;}
 let raw='';for await(const b of req)raw+=b;
 try {
 const body=JSON.parse(raw);
 if(body.action==='create_expense'){
  const input=normalizeExpense(body.data);const allocations=allocationRows(input.expense.amount,input.weights.length?input.weights:[{party_id:id(4),weight:100n}],input.expense.allocation_method);
  state.expenses.push({...input.expense,expense_id:id(count++),details_version:'1',status:'OPEN',payments:input.payments,allocations,current_allocations:allocations,corrections:[{cost_expense_correction_id:id(count++),corrected_at:new Date().toISOString(),reason:body.reason}],frozen:false});
 }else if(body.action==='settle_period'){
  state.settlements.push({cost_settlement_id:id(count++),period_start_date:body.data.period_start_date,period_end_date:body.data.period_end_date,currency_code:'USD',lines:[{party_id:id(4),responsibility_amount:'100.00',paid_amount:'0.00',net_amount:'-100.00'},{party_id:id(5),responsibility_amount:'0.00',paid_amount:'100.00',net_amount:'100.00'}]});state.expenses.forEach(e=>{e.frozen=true;});
 }
 res.end(JSON.stringify({ok:true,result:{}}));
 } catch (error) {res.statusCode=error.statusCode||422;res.end(JSON.stringify({ok:false,error:error.message}));}
 });}}]});
await server.listen();console.log('Costs synthetic UI fixture: http://127.0.0.1:4449/costs-fixture');
