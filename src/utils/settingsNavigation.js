export const QUICK_FLIGHT_LABELS = Object.freeze({
  es: Object.freeze({ label: 'Vuelo rápido', action: 'Vuelo rápido: completar campos vacíos sin guardar' }),
  en: Object.freeze({ label: 'Quick flight', action: 'Quick flight: fill empty fields without saving' }),
});

// Presentation only: authority remains in the existing role and API capabilities.
export const SETTINGS_NAVIGATION = [
  { id: 'aircraft', label: 'Aeronave', children: [
    { id: 'app', label: 'Datos generales' },
    { id: 'ownership', label: 'Propiedad' },
  ] },
  { id: 'configuration', label: 'Configuración', children: [
    { id: 'form', label: 'Formulario', page: true, children: [
      { id: 'operation', label: QUICK_FLIGHT_LABELS.es.label },
    ] },
    { id: 'dashboards', label: 'Dashboards', children: [
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

export function getSettingsPages(items, ancestors = []) {
  return items.flatMap((item) => {
    const path = [...ancestors, { id: item.id, label: item.label }];
    return [
      ...(!item.children || item.page ? [{ id: item.id, label: item.label, path }] : []),
      ...(item.children ? getSettingsPages(item.children, path) : []),
    ];
  });
}

export function resolveSettingsPage(items, requestedId) {
  const pages = getSettingsPages(items);
  return pages.find((page) => page.id === requestedId) || pages[0];
}


const PAGE_FIELD_PREFIXES = {
  app: ['appConfig.aircraftName', 'appConfig.aircraftRegistration'],
  form: ['operationalConfig.ownerOptions'],
  operation: ['operationalConfig.default'],
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
