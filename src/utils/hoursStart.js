export const HOURS_START_MODES = [
  { id: 'CURRENT_REFERENCE', title: 'Comenzar con las horas actuales', description: 'Preparar los contadores de referencia para registrar vuelos nuevos.' },
  { id: 'HISTORICAL_IMPORT', title: 'Importar vuelos históricos', description: 'Revisar y conciliar registros anteriores antes de establecer acumulados.' },
];
export function isHoursStartMode(value) { return HOURS_START_MODES.some((mode) => mode.id === value); }
export function hoursStartNextAction(mode) {
  if (mode === 'CURRENT_REFERENCE') return 'Preparar las horas del casco y las referencias de cada componente.';
  if (mode === 'HISTORICAL_IMPORT') return 'Preparar el archivo y revisar períodos, instalaciones y referencias conocidas.';
  return 'Elegí cómo vas a comenzar a registrar las horas.';
}
export function rejectUnsupportedHoursPlan(values) {
  const planFields = ['hoursStartMode', 'installationTsnHours', 'installationTsoHours', 'referenceTsnHours', 'referenceTsoHours'];
  const carriesPlan = (object) => object && planFields.some((field) => Object.hasOwn(object, field));
  if (carriesPlan(values) || values?.components?.some(carriesPlan)) {
    throw Object.assign(new Error('El inicio de seguimiento y TSN/TSO están pendientes de aprobación. No se guardaron datos.'), { code: 'HOURS_START_CONTRACT_PENDING' });
  }
}
// Proposed policy only. Not connected to runtime permissions or operational totals.
export function proposedHoursReadiness({ reconciliationComplete, referenceKnown, technicalComplete, ownershipReady, relativeWindowKnown }) {
  return {
    canRecord: technicalComplete === true && ownershipReady === true && reconciliationComplete === true && referenceKnown === true,
    canShowAbsoluteHours: reconciliationComplete === true && referenceKnown === true,
    canShowHourAlerts: reconciliationComplete === true && referenceKnown === true,
    canShowRelativeHourAlerts: reconciliationComplete === true && relativeWindowKnown === true,
  };
}
