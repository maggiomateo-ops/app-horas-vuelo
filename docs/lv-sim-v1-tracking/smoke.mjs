// Local fixture smoke only; never opens Neon or an authenticated deployment.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.js node docs/lv-sim-v1-tracking/smoke.mjs
import {createRequire} from 'node:module';
import {writeFile,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const html=resolve('_v1-smoke.html'),jsx=resolve('_v1-smoke.jsx');
const created=[];
let browser;
try {
 await writeFile(html,'<html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/_v1-smoke.jsx"></script></html>',{flag:'wx'});created.push(html);
 await writeFile(jsx,`import React,{useState} from 'react';import{createRoot}from'react-dom/client';import './src/index.css';import './src/App.css';
 import Configuration from './src/components/AircraftConfigurationOnboarding.jsx';
 import {configureAircraftTopologyAndRefresh} from './src/services/aircraftService.js';
 function Fixture(){const[a,setA]=useState({aircraft_id:'96d849aa-2827-4aa3-b02b-6671577444a7',configurationConfigured:false});return <main className="app-shell"><h1>LV-SIM · Prueba local</h1><Configuration {...a} onUnauthorized={()=>{throw Error('unexpected unauthorized')}} onComplete={async values=>{const result=await configureAircraftTopologyAndRefresh(a.aircraft_id,values);setA(result.aircrafts[0]);}} /></main>};createRoot(document.getElementById('root')).render(<Fixture/>);`,{flag:'wx'});created.push(jsx);
 browser=await chromium.launch({headless:true,channel:"chrome"});
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let saved=null,patches=0;
 await page.route('**/api/**',async route=>{
  if(!route.request().url().includes('/api/aircraft'))throw Error('Unexpected API');
  if(route.request().method()==='PATCH'){
   patches++;const p=route.request().postDataJSON();assert.equal(p.trackingMode,'CURRENT_REFERENCE');assert.equal(p.components.length,4);
   assert.ok(p.components.every(c=>c.installedOn===null&&c.openingTisHours===null));
   saved={aircraft_id:p.aircraftId,configurationConfigured:true,configuration:{propulsionType:p.propulsionType,engineCount:p.engineCount,propellerCount:p.propellerCount},componentInstallations:p.components.map((c,i)=>({...c,componentInstallationId:'fixture-'+i}))};
   await route.fulfill({json:{ok:true}});
  }else await route.fulfill({json:{ok:true,aircrafts:[saved]}});
 });
 await page.goto('http://127.0.0.1:5173/_v1-smoke.html');
 await page.getByRole('button',{name:'Configurar aeronave',exact:true}).click();
 await page.getByLabel('Tipo de propulsión').selectOption('PISTON');
 await page.getByLabel('Cantidad de motores').fill('2');await page.getByLabel('Cantidad de hélices').fill('2');
 await page.getByRole('radio').check();
 const cards=page.locator('fieldset.aircraft-component-card').filter({has:page.locator('input[type="date"]')});assert.equal(await cards.count(),4);
 for(let i=0;i<4;i++)await cards.nth(i).getByLabel('Fecha de inicio').fill('2026-10-20');
 await cards.nth(0).getByLabel('Referencia TIS').fill('100.1');
 await page.getByRole('button',{name:'Revisar configuración',exact:true}).click();
 assert.equal(patches,0);
 await page.screenshot({path:'docs/lv-sim-v1-tracking/desktop-review.png',fullPage:true});
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.getByRole('button',{name:'Configurar aeronave',exact:true}).click();
 assert.equal(await cards.nth(0).getByLabel('Referencia TIS').inputValue(),'100.1');
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'dark'});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 await page.getByRole('button',{name:'Revisar configuración',exact:true}).click();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 await page.screenshot({path:'docs/lv-sim-v1-tracking/mobile-review.png',fullPage:true});
 await page.getByRole('button',{name:'Confirmar y guardar',exact:true}).click();
 await page.getByRole('heading',{name:'Topología configurada'}).waitFor();
 assert.equal(patches,1);assert.equal(saved.componentInstallations[0].trackingReferenceTisHours,100.1);
 assert.equal(saved.componentInstallations[1].trackingReferenceTisHours,null);
 assert.equal(await page.locator('.aircraft-installation-summary article').count(),4);
 await page.screenshot({path:'docs/lv-sim-v1-tracking/mobile-readback.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS local UI: 2+2, explicit reference, NULL, cancel preservation, mocked PATCH + fresh GET, mobile overflow and console. No real persistence.');
}finally{await browser?.close();for(const file of created)await unlink(file);}
