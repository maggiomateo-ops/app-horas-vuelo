import test from 'node:test';
import assert from 'node:assert/strict';
import { getSettingsNavigation, getSettingsPages, getSettingsSections, resolveSettingsPage, QUICK_FLIGHT_LABELS, isSettingsPageEditable } from '../src/utils/settingsNavigation.js';

const all = getSettingsNavigation({ canViewUsers: true, canViewComponents: true });
test('Settings V2 conserva todas las páginas bajo las cuatro categorías aprobadas', () => {
  assert.deepEqual(all.map((item) => item.label), ['Aeronave', 'Configuración', 'Componentes / Propulsión', 'Usuarios / Acceso']);
  const pages = getSettingsPages(all);
  assert.equal(new Set(pages.map((item) => item.id)).size, 10);
  const path = (id) => resolveSettingsPage(all, id).path.map((part) => part.label);
  assert.deepEqual(path('ownership'), ['Aeronave', 'Propiedad']);
  assert.deepEqual(path('operation'), ['Configuración', 'Formulario']);
  for (const id of ['preferences', 'inspections', 'oil', 'thresholds', 'annual']) {
    assert.deepEqual(path(id).slice(0, 2), ['Configuración', 'Dashboards']);
  }
  assert.deepEqual(path('form'), ['Configuración', 'Formulario']);
  assert.equal(resolveSettingsPage(all, 'ownership').title, 'Propiedad de la aeronave');
  assert.equal(resolveSettingsPage(all, 'operation').title, 'Formulario');
  assert.equal(resolveSettingsPage(all, 'inspections').title, 'Dashboards');
});
test('navegación y rutas directas no revelan páginas sin autorización o sin contenido', () => {
  const restricted = getSettingsNavigation({canViewUsers:false,canViewComponents:false});
  assert.ok(!getSettingsPages(restricted).some((page) => ['users','components'].includes(page.id)));
  for (const stale of ['users', 'components', 'unknown']) assert.equal(resolveSettingsPage(restricted, stale).id, 'app');
});
test('etiquetas de Vuelo rápido se centralizan sin agregar infraestructura de idioma', () => {
  assert.equal(QUICK_FLIGHT_LABELS.es.label, 'Vuelo rápido');
  assert.equal(QUICK_FLIGHT_LABELS.en.label, 'Quick flight');
});

test('guardar se ofrece solo en páginas con campos editables, sin ampliar permisos', () => {
  const partial = { enabled: true, mode: 'CANONICAL_SUBSET', editablePaths: [
    'appConfig.oilUnitLabel', 'kpiParams.annualInspection.nextDueDate',
    'kpiParams.thresholds.annualInspection.warningDays',
  ] };
  for (const id of ['preferences', 'inspections', 'thresholds']) assert.equal(isSettingsPageEditable(id, partial), true);
  for (const id of ['app', 'form', 'operation', 'oil', 'annual', 'ownership', 'users', 'components']) assert.equal(isSettingsPageEditable(id, partial), false);
  for (const page of getSettingsPages(all)) {
    assert.equal(isSettingsPageEditable(page.id, { ...partial, enabled: false }), false);
    assert.equal(isSettingsPageEditable(page.id, { ...partial, mode: 'DISABLED' }), false);
    assert.equal(isSettingsPageEditable(page.id, { ...partial, mode: 'UNKNOWN' }), false);
  }
  assert.equal(isSettingsPageEditable('operation', { enabled: true, mode: 'LEGACY_FULL' }), true);
  assert.equal(isSettingsPageEditable('ownership', { enabled: true, mode: 'LEGACY_FULL' }), false);
});

test('sidebar fijo expone solo secciones y las opciones quedan en el panel', () => {
  const sections = getSettingsSections(all);
  assert.deepEqual(sections.map((item) => item.id), ['app', 'ownership', 'form', 'dashboards', 'components', 'users']);
  const dashboards = resolveSettingsPage(all, 'dashboards');
  assert.equal(dashboards.id, 'preferences');
  assert.deepEqual(dashboards.tabs.map((item) => item.label), ['Preferencias', 'Inspecciones', 'Aceite', 'Umbrales', 'Utilización']);
  assert.deepEqual(resolveSettingsPage(all, 'form').tabs.map((item) => item.label), ['Vuelo rápido']);
  for (const id of ['preferences', 'inspections', 'oil', 'thresholds', 'annual']) {
    const page = resolveSettingsPage(all, id);
    assert.equal(page.sectionId, 'dashboards');
    assert.deepEqual(page.path.map((item) => item.label), ['Configuración', 'Dashboards']);
  }
});
test('Formulario conserva el guardado de opciones legacy sin cambiar la propiedad legal', () => {
  assert.equal(isSettingsPageEditable('operation', {enabled:true,mode:'CANONICAL_SUBSET',editablePaths:['operationalConfig.ownerOptions']}), true);
  assert.equal(isSettingsPageEditable('ownership', {enabled:true,mode:'CANONICAL_SUBSET',editablePaths:['operationalConfig.ownerOptions']}), false);
});
