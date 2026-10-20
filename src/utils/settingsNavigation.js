export const QUICK_FLIGHT_LABELS = Object.freeze({
  es: Object.freeze({ label: 'Vuelo rápido', action: 'Vuelo rápido: completar campos vacíos sin guardar' }),
  en: Object.freeze({ label: 'Quick flight', action: 'Quick flight: fill empty fields without saving' }),
});

// Presentation only: authority remains in the existing role and API capabilities.
export const SETTINGS_NAVIGATION = [
  { id: 'aircraft', label: 'Aeronave', children: [
    { id: 'app', label: 'Datos generales' },
    { id: 'ownership', label: 'Propiedad', title: 'Propiedad de la aeronave' },
  ] },
  { id: 'configuration', label: 'Configuración', children: [
    { id: 'form', label: 'Formulario', tabs: [
      { id: 'operation', label: QUICK_FLIGHT_LABELS.es.label },
    ] },
    { id: 'dashboards', label: 'Dashboards', tabs: [
      { id: 'preferences', label: 'Preferencias' },
      { id: 'inspections', label: 'Inspecciones' },
      { id: 'oil', label: 'Aceite' },
      { id: 'thresholds', label: 'Umbrales' },
      { id: 'annual', label: 'Utilización' },
    ] },
  ] },
  { id: 'components', label: 'Componentes / Propulsión' },
  { id: 'users', label: 'Usuarios / Acceso' },
];

export function getSettingsNavigation({ canViewUsers, canViewComponents }) {
  return SETTINGS_NAVIGATION.filter((item) =>
    (item.id !== 'users' || canViewUsers) && (item.id !== 'components' || canViewComponents));
}

export function getSettingsSections(items) {
  return items.flatMap((item) => (item.children || [item]).map((section) => ({
    ...section,
    path: item.children ? [{ id: item.id, label: item.label }, { id: section.id, label: section.label }] : [{ id: item.id, label: item.label }],
  })));
}

export function getSettingsPages(items) {
  return getSettingsSections(items).flatMap((section) => (section.tabs || [section]).map((tab) => ({
    id: tab.id,
    label: tab.label,
    sectionId: section.id,
    title: section.title || section.label,
    path: section.path,
    tabs: section.tabs || [],
  })));
}

export function resolveSettingsPage(items, requestedId) {
  const pages = getSettingsPages(items);
  return pages.find((page) => page.id === requestedId)
    || pages.find((page) => page.sectionId === requestedId)
    || pages[0];
}

const PAGE_FIELD_PREFIXES = {
  app: ['appConfig.aircraftName', 'appConfig.aircraftRegistration'],
  operation: ['operationalConfig.default', 'operationalConfig.ownerOptions'],
  preferences: ['appConfig.oilUnitLabel', 'appConfig.currency'],
  inspections: ['kpiParams.annualInspection.', 'kpiParams.inspection50.', 'kpiParams.inspection100.'],
  oil: ['kpiParams.oil.'],
  thresholds: ['kpiParams.thresholds.'],
  annual: ['kpiParams.annualUtilizationLegacy.'],
};

// Controls the Save affordance only; field-level and server authorization still apply.
export function isSettingsPageEditable(pageId, { enabled, mode, editablePaths = [] }) {
  const prefixes = PAGE_FIELD_PREFIXES[pageId];
  if (!enabled || !prefixes) return false;
  if (mode === 'LEGACY_FULL') return true;
  return mode === 'CANONICAL_SUBSET' && (editablePaths || []).some((path) =>
    prefixes.some((prefix) => path.startsWith(prefix)));
}
