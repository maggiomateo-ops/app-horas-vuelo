import test from 'node:test';
import assert from 'node:assert/strict';
import { getAllowedMainTabIds, getPreferredMainTab } from '../src/utils/rolePermissions.js';
import { fetchAircrafts } from '../src/services/aircraftService.js';
import { fetchTrackingItems } from '../src/services/trackingService.js';
import { fetchSquawks } from '../src/services/squawkService.js';

for (const [role, expected] of Object.entries({
  OWNER: ['registro', 'historiales', 'dashboards', 'settings'],
  ADMIN: ['registro', 'historiales', 'dashboards', 'settings'],
  PILOT: ['registro', 'historiales'],
  VIEWER: ['historiales', 'dashboards'],
})) {
  test(`navegación ${role} conserva permisos y Costs en standby`, () => {
    for (const trackingAvailable of [false, true]) {
      const tabs = getAllowedMainTabIds({ isAdmin: false, aircraftRole: role, trackingAvailable });
      assert.deepEqual(tabs, trackingAvailable ? [...expected, 'seguimiento'] : expected);
      assert.ok(tabs.includes(getPreferredMainTab({ isAdmin: false, aircraftRole: role })));
      assert.ok(!tabs.includes('costos'));
    }
  });
}

test('rol desconocido no obtiene Seguimiento incluso con capacidad disponible', () => {
  assert.deepEqual(getAllowedMainTabIds({ isAdmin: false, aircraftRole: '', trackingAvailable: true }), ['historiales']);
  assert.ok(!getAllowedMainTabIds({ isAdmin: true, aircraftRole: '', trackingAvailable: true }).includes('seguimiento'));
});

test('la respuesta de aeronaves controla Seguimiento sin inferir capacidad por rol', async (t) => {
  for (const capability of [undefined, false, true]) {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ok:true,aircrafts:[{aircraft_id:'demo',rol:'OWNER',trackingAvailable:capability}]}));
    const [aircraft] = await fetchAircrafts();
    assert.equal(getAllowedMainTabIds({aircraftRole:aircraft.rol, trackingAvailable:aircraft.trackingAvailable === true}).includes('seguimiento'), capability === true);
    t.mock.restoreAll();
  }
});

for (const [name, load] of [['Recordatorios', fetchTrackingItems], ['Novedades', fetchSquawks]]) {
  test(`${name}: sesión expirada y recurso no disponible no se presentan como datos vacíos`, async (t) => {
    t.mock.method(globalThis, 'fetch', async () => Response.json({ok:false}, {status:401}));
    await assert.rejects(load('demo'), {code:'UNAUTHORIZED'});
    t.mock.restoreAll();
    t.mock.method(globalThis, 'fetch', async () => Response.json({ok:false,error:'Recurso no disponible.'}, {status:404}));
    await assert.rejects(load('demo'), /Recurso no disponible/);
  });
}
