// Local visual review only. All app API calls are intercepted; simulated mutations never leave the page.
import { createServer } from 'vite';

const server = await createServer({
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  plugins: [{
    name: 'settings-v2-local-review',
    configureServer(server) {
      server.middlewares.use('/__settings-review', async (req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const query = new URL(req.url, 'http://127.0.0.1').searchParams;
        const width = Number(query.get('width'));
        if ([390, 768].includes(width)) {
          query.delete('width');
          res.end(`<!doctype html><html lang="es"><head><title>Settings V2 · ${width}px fixture</title></head><body style="margin:0;background:#dce4ef"><iframe title="Settings V2 ${width}px" width="${width}" height="${width === 390 ? 700 : 1000}" style="border:0;display:block" src="/__settings-review?${query}"></iframe></body></html>`);
          return;
        }
        const html = `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settings V2 · Fictional review</title></head><body><div id="root"></div><script>
const params = new URLSearchParams(location.search);
if(['light','dark'].includes(params.get('theme'))) localStorage.setItem('theme-mode',params.get('theme'));
const editable = params.get('edit') === '1';
const canonical = params.get('canonical') === '1';
const role = params.get('role') || 'OWNER';
const onboardingAvailable = ['enabled','disabled'].includes(params.get('onboarding'));
const onboardingEnabled = params.get('onboarding') === 'enabled';
const aircraft = (id,matricula) => ({aircraft_id:id,matricula,modelo:'PA-28 Demo',rol:role,ownershipConfigured:true,configurationConfigured:true,flightWritesReady:true,trackingAvailable:true,configuration:{propulsionType:'PISTON',engineCount:1,propellerCount:1},componentInstallations:[],componentInstallationHistory:[], ...(params.get('setup') === '1' ? {configurationSetupAvailable:params.get('canary')==='1'?id==='fixture-two'&&role==='OWNER':true,configurationConfigured:params.get('canary')==='1'?false:id==='fixture-one',ownershipConfigured:id==='fixture-one',flightWritesReady:id==='fixture-one',configuration:id==='fixture-one'?{propulsionType:'PISTON',engineCount:1,propellerCount:1}:null,ownershipInterests:role==='OWNER'?(id==='fixture-one'?[{ownershipInterestId:'fictional-legal',partyId:'fictional-party',partyType:'PERSON',name:'Titular ficticio',share:100,effectiveFrom:'2026-01-01T00:00:00Z',effectiveTo:null,partyStatus:'ACTIVE'}]:[]):undefined}: {})});
let reviewAircrafts = params.get('count') === '0' ? [] : [aircraft('fixture-one',params.get('canary')==='1'?'LV-MHZ':'LV-DEMO'), ...(params.get('count') === '1' ? [] : [aircraft('fixture-two',params.get('setup')==='1'?'LV-SIM':'LV-OTHER')])];
if(params.get('simulateSetup')==='1') {
  const saved=JSON.parse(sessionStorage.getItem('lv-sim-v1-fixture')||'null');
  if(saved) reviewAircrafts=reviewAircrafts.map(a=>a.aircraft_id===saved.aircraft_id?saved:a);
}
window.fetch = async (url,options={}) => {
  if(url === '/api/aircraft' && options.method === 'POST') {
    if(!onboardingEnabled) return Response.json({ok:false,code:'POSTGRES_ONBOARDING_WRITES_NOT_ENABLED'},{status:503});
    if(params.get('failure') === '1') return Response.json({ok:false,error:'Simulated failure'},{status:503});
    const input = JSON.parse(options.body);
    const created = {aircraft_id:'fixture-created',matricula:input.registration,fabricante:input.manufacturer,modelo:input.model,rol:'OWNER',ownershipConfigured:false,configurationConfigured:false,flightWritesReady:false,configurationSetupAvailable:false,trackingAvailable:true,componentInstallations:[]};
    reviewAircrafts = [...reviewAircrafts,created];
    return Response.json({ok:true,aircraft:created,onboarding:{ownershipConfigured:false,flightWritesReady:false}},{status:201});
  }
  if(url === '/api/aircraft' && options.method === 'PATCH' && params.get('simulateSetup') === '1') {
    const input=JSON.parse(options.body);
    const selected=reviewAircrafts.find(a=>a.aircraft_id===input.aircraftId);
    if(input.action!=='setup-configuration'||!selected||selected.rol!=='OWNER'||!selected.configurationSetupAvailable) return Response.json({ok:false,code:'AIRCRAFT_CONFIGURATION_CANARY_DENIED'},{status:403});
    if(selected.configurationConfigured) return Response.json({ok:false,code:'AIRCRAFT_CONFIGURATION_ALREADY_EXISTS'},{status:409});
    if(params.get('failure')==='1') return Response.json({ok:false,error:'Fallo ficticio; no se guardó la configuración.'},{status:503});
    const installations=input.components.map((c,i)=>({...c,componentId:'fixture-component-'+i,componentInstallationId:'fixture-installation-'+i}));
    const configuration={propulsionType:input.propulsionType,engineCount:input.engineCount,propellerCount:input.propellerCount};
    Object.assign(selected,{configurationConfigured:true,configurationSetupAvailable:false,configuration,componentInstallations:installations});
    // Browser-local fixture storage only: supports a page reload without any server/business write.
    sessionStorage.setItem('lv-sim-v1-fixture',JSON.stringify(selected));
    return Response.json({ok:true,aircraftId:input.aircraftId,configurationConfigured:true,configuration,componentInstallations:installations},{status:201});
  }
  if(options.method && options.method !== 'GET') throw new Error('Local fixture: mutations blocked');
  let data;
  if(url.includes('/api/session')) data={ok:true,authenticated:true,user:{userId:'11111111-1111-4111-8111-111111111111',isAdmin:false,aircraftOnboardingAvailable:onboardingAvailable,aircraftOnboardingWritesEnabled:onboardingEnabled,legacyUserManagementEnabled:!canonical,settingsWritesEnabled:editable,settingsWriteMode:canonical?'CANONICAL_SUBSET':'LEGACY_FULL',settingsEditablePaths:canonical?['appConfig.oilUnitLabel']:null}};
  else if(url.includes('/api/aircraft-pilots')) data={ok:true,pilots:[],management_mode:'POSTGRES_CANONICAL',capabilities:{can_create_pilot:false}};
  else if(url.includes('/api/aircraft')) data={ok:true,aircrafts:reviewAircrafts};
  else if(url.includes('resource=tracking')) data={ok:true,tracking:{items:[],currentTisHours:1234.5,writes_enabled:false}};
  else if(url.includes('resource=squawks')) data={ok:true,squawks:{items:[],writes_enabled:false}};
  else if(url.includes('/api/settings')) data={ok:true,settings:{appConfig:{aircraftName:url.includes('fixture-two')?'Aeronave simulada':'Aeronave demo',aircraftRegistration:url.includes('fixture-two')?'LV-SIM':'LV-DEMO'},operationalConfig:{ownerOptions:['DEMO']}}};
  else if(url.includes('/api/historiales')) data={ok:true,historialAeronave:[],historialMotor:[],historialHelice:[],computacionHoras:[]};
  else throw new Error('Unknown fixture request blocked: '+url);
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
</script><script type="module" src="/src/main.jsx"></script></body></html>`;
        res.end(await server.transformIndexHtml('/__settings-review', html));
      });
    },
  }],
});
await server.listen();
console.log('Fictional, isolated review: http://127.0.0.1:5173/__settings-review?edit=1&theme=light');
