function numericValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function hoursLabel(value) {
  const numeric = numericValue(value);
  return numeric === null ? null : `${numeric.toFixed(1)} h`;
}

function absoluteDueHours(snapshot) {
  const reference = numericValue(snapshot?.reference_tis_hours);
  const interval = numericValue(snapshot?.interval_hours);
  return reference === null || interval === null ? null : reference + interval;
}

export function buildTrackingEventPresentation(item, event) {
  const snapshot = event?.cycle_snapshot || {};
  const dueBasis = String(snapshot.due_basis || item?.due_basis || "").toUpperCase();
  const recurrence = String(snapshot.recurrence || item?.recurrence || "").toUpperCase();
  const referenceMode = String(snapshot.reference_mode || item?.reference_mode || "").toUpperCase();
  const intervalLabel = hoursLabel(snapshot.interval_hours ?? item?.interval_hours);
  let closedCycleContext = "Ciclo cerrado";
  let attendedContext = null;
  let nextCycleContext = null;

  if (dueBasis === "DATE") {
    closedCycleContext = snapshot.due_date
      ? `Ciclo cerrado · Fecha objetivo: ${snapshot.due_date}`
      : "Ciclo cerrado · Fecha objetivo no disponible";
  } else if (referenceMode === "ABSOLUTE_TIS") {
    const dueHours = absoluteDueHours(snapshot);
    closedCycleContext = dueHours === null
      ? "Ciclo cerrado · Objetivo TIS no disponible"
      : `Ciclo cerrado · Objetivo: ${dueHours.toFixed(1)} h TIS`;
    const completedTis = hoursLabel(event?.completed_at_tis);
    attendedContext = completedTis
      ? `TIS al atender: ${completedTis}`
      : "TIS absoluto no disponible";
  } else if (referenceMode === "TRACKED_FROM_NOW") {
    const startDate = snapshot.tracking_start_date
      ? ` desde ${snapshot.tracking_start_date}`
      : "";
    closedCycleContext = intervalLabel
      ? `Ciclo cerrado · Objetivo: ${intervalLabel}${startDate}`
      : `Ciclo cerrado${startDate}`;
    const elapsedLabel = hoursLabel(event?.cycle_elapsed_hours);
    attendedContext = elapsedLabel
      ? `Horas acumuladas del ciclo: ${elapsedLabel}`
      : null;
  }

  if (recurrence === "ONE_TIME") {
    nextCycleContext = "Recordatorio finalizado y archivado";
  } else if (dueBasis === "DATE") {
    nextCycleContext = event?.next_due_date
      ? `Nuevo ciclo: ${event.next_due_date}`
      : "Nuevo ciclo: próxima fecha no disponible";
  } else if (referenceMode === "ABSOLUTE_TIS") {
    const completedTis = numericValue(event?.completed_at_tis);
    const interval = numericValue(snapshot.interval_hours ?? item?.interval_hours);
    nextCycleContext = completedTis === null || interval === null
      ? "Nuevo ciclo: TIS absoluto no disponible"
      : `Nuevo ciclo: ${(completedTis + interval).toFixed(1)} h TIS`;
  } else {
    nextCycleContext = intervalLabel
      ? `Nuevo ciclo: ${intervalLabel}`
      : "Nuevo ciclo iniciado";
  }

  return {
    title: "Ciclo atendido",
    closedCycleContext,
    attendedContext,
    nextCycleContext,
  };
}

export function buildActiveCycleLabel(item) {
  if (
    item?.status !== "ACTIVE"
    || item?.recurrence !== "RECURRING"
    || !Array.isArray(item?.events)
    || item.events.length === 0
  ) {
    return null;
  }

  if (item.due_basis === "DATE") {
    return item.due_date
      ? `Nuevo ciclo · Próxima fecha ${item.due_date}`
      : "Nuevo ciclo";
  }

  if (item.reference_mode === "ABSOLUTE_TIS") {
    const due = numericValue(item.derived?.due_value);
    return due === null
      ? "Nuevo ciclo · TIS absoluto no disponible"
      : `Nuevo ciclo · Objetivo ${due.toFixed(1)} h TIS`;
  }

  const elapsed = numericValue(item.derived?.elapsed_hours);
  const interval = numericValue(item.interval_hours);
  if (elapsed === null || interval === null) return "Nuevo ciclo";
  return `Nuevo ciclo · ${elapsed.toFixed(1)} / ${interval.toFixed(1)} h`;
}
