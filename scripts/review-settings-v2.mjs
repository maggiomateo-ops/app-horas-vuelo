// Local visual review only. All app API calls are intercepted; mutations never leave the page.
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
          res.end(`<!doctype html><html lang="es"><head><title>Settings V2 · ${width}px fixture</title></head><body style="margin:0;background:#dce4ef"><iframe title="Settings V2 ${width}px" width="${width}" height="1000" style="border:0;display:block" src="/__settings-review?${query}"></iframe></body></html>`);
          return;
        }
        const html = `<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settings V2 · Fictional review</title></head><body><div id="root"></div><script>
const params = new URLSearchParams(location.search);
if(['light','dark'].includes(params.get('theme'))) localStorage.setItem('theme-mode',params.get('theme'));
const editable = params.get('edit') === '1';
const canonical = params.get('canonical') === '1';
const role = params.get('role') || 'OWNER';
const aircraft = (id,matricula) => ({aircraft_id:id,matricula,modelo:'PA-28 Demo',rol:role,ownershipConfigured:true,configurationConfigured:true,flightWritesReady:true,trackingAvailable:true,configuration:{propulsionType:'PISTON',engineCount:1,propellerCount:1},componentInstallations:[],componentInstallationHistory:[]});
window.fetch = async (url,options={}) => {
  if(options.method && options.method !== 'GET') throw new Error('Local fixture: mutations blocked');
  let data;
  if(url.includes('/api/session')) data={ok:true,authenticated:true,user:{userId:'fixture-user',isAdmin:false,legacyUserManagementEnabled:!canonical,settingsWritesEnabled:editable,settingsWriteMode:canonical?'CANONICAL_SUBSET':'LEGACY_FULL',settingsEditablePaths:canonical?['appConfig.oilUnitLabel']:null}};
  else if(url.includes('/api/aircraft-pilots')) data={ok:true,pilots:[],management_mode:'POSTGRES_CANONICAL',capabilities:{can_create_pilot:false}};
  else if(url.includes('/api/aircraft')) data={ok:true,aircrafts:[aircraft('fixture-one','LV-DEMO'),aircraft('fixture-two','LV-SIM')]};
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
