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

const PRIORITY_RANK = Object.freeze({
  OVERDUE: 0,
  DUE: 0,
  DUE_SOON: 1,
  OK: 2,
  UNAVAILABLE: 3,
});

export const TRACKING_FILTERS = Object.freeze({
  ACTIVE: "ACTIVE",
  DUE_SOON: "DUE_SOON",
  URGENT: "URGENT",
  OK: "OK",
  DATE: "DATE",
  HOURS: "HOURS",
  ARCHIVED: "ARCHIVED",
});

export const TRACKING_SORTS = Object.freeze({
  PRIORITY: "PRIORITY",
  CONCEPT: "CONCEPT",
  DUE: "DUE",
});

function normalizedSearchText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("es");
}

function dueState(item) {
  return String(item?.derived?.due_state || "UNAVAILABLE").toUpperCase();
}

function remainingValue(item) {
  return numericValue(item?.derived?.remaining_value);
}

function compareConcept(left, right) {
  return String(left?.concept || "").localeCompare(String(right?.concept || ""), "es", {
    sensitivity: "base",
  });
}

function compareComparableRemaining(left, right) {
  if (left?.due_basis !== right?.due_basis) return null;
  const leftRemaining = remainingValue(left);
  const rightRemaining = remainingValue(right);
  if (leftRemaining === null || rightRemaining === null) return null;
  return leftRemaining - rightRemaining;
}

function comparePriority(left, right) {
  const rankDifference = (PRIORITY_RANK[dueState(left)] ?? 4)
    - (PRIORITY_RANK[dueState(right)] ?? 4);
  if (rankDifference !== 0) return rankDifference;
  const remainingDifference = compareComparableRemaining(left, right);
  if (remainingDifference !== null && remainingDifference !== 0) return remainingDifference;
  return compareConcept(left, right);
}

function compareDue(left, right) {
  const rankDifference = (PRIORITY_RANK[dueState(left)] ?? 4)
    - (PRIORITY_RANK[dueState(right)] ?? 4);
  if (rankDifference !== 0) return rankDifference;
  if (left?.due_basis !== right?.due_basis) {
    return String(left?.due_basis || "").localeCompare(String(right?.due_basis || ""));
  }
  const remainingDifference = compareComparableRemaining(left, right);
  if (remainingDifference !== null && remainingDifference !== 0) return remainingDifference;
  return compareConcept(left, right);
}

export function getTrackingSummaryCounts(items) {
  return (Array.isArray(items) ? items : []).reduce((counts, item) => {
    if (item?.status !== "ACTIVE") return counts;
    counts.total += 1;
    const state = dueState(item);
    if (state === "DUE" || state === "OVERDUE") counts.urgent += 1;
    if (state === "DUE_SOON") counts.dueSoon += 1;
    if (state === "OK") counts.ok += 1;
    return counts;
  }, { urgent: 0, dueSoon: 0, ok: 0, total: 0 });
}

export function selectTrackingItems(items, {
  filter = TRACKING_FILTERS.ACTIVE,
  query = "",
  sortBy = TRACKING_SORTS.PRIORITY,
} = {}) {
  const source = Array.isArray(items) ? items : [];
  const archivedScope = filter === TRACKING_FILTERS.ARCHIVED;
  const scopedItems = source.filter((item) => (
    archivedScope ? item?.status === "ARCHIVED" : item?.status === "ACTIVE"
  ));
  const searched = normalizedSearchText(query);
  const visible = scopedItems.filter((item) => {
    const state = dueState(item);
    if (filter === TRACKING_FILTERS.DUE_SOON && state !== "DUE_SOON") return false;
    if (filter === TRACKING_FILTERS.URGENT && !["DUE", "OVERDUE"].includes(state)) return false;
    if (filter === TRACKING_FILTERS.OK && state !== "OK") return false;
    if (filter === TRACKING_FILTERS.DATE && item?.due_basis !== "DATE") return false;
    if (filter === TRACKING_FILTERS.HOURS && item?.due_basis !== "TIME_IN_SERVICE") return false;
    if (!searched) return true;
    return normalizedSearchText(`${item?.concept || ""} ${item?.notes || ""}`).includes(searched);
  });

  const comparator = sortBy === TRACKING_SORTS.CONCEPT
    ? compareConcept
    : sortBy === TRACKING_SORTS.DUE
      ? compareDue
      : comparePriority;

  return {
    items: [...visible].sort(comparator),
    visibleCount: visible.length,
    scopeCount: scopedItems.length,
  };
}

export function toggleTrackingExpansion(expandedIds, trackingItemId) {
  const next = new Set(expandedIds || []);
  if (next.has(trackingItemId)) next.delete(trackingItemId);
  else next.add(trackingItemId);
  return next;
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
