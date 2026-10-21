export function ownershipStatus(interest, now = Date.now()) {
  if (interest.effectiveTo && new Date(interest.effectiveTo).getTime() <= now) return 'Finalizada';
  if (new Date(interest.effectiveFrom).getTime() > now) return 'Programada';
  if (interest.partyStatus !== 'ACTIVE') return 'Titular inactivo';
  return 'Vigente';
}

export function ownershipDate(value) {
  if (!value) return 'Sin fecha de cierre';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'No disponible' : new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
