async function readJson(response) {
  return response.json().catch(() => null);
}

async function requestJson(url, options, fallbackMessage) {
  const response = await fetch(url, {
    credentials: "include",
    ...options,
  });
  const result = await readJson(response);

  if (response.status === 401) {
    const error = new Error("UNAUTHORIZED");
    error.code = "UNAUTHORIZED";
    throw error;
  }
  if (!response.ok || !result?.ok) {
    const error = new Error(result?.error || fallbackMessage);
    error.code = result?.code || "TRACKING_REQUEST_FAILED";
    throw error;
  }
  return result;
}

export function buildTrackingItemPayload(values) {
  const dueBasis = String(values.due_basis || "").toUpperCase();
  const referenceMode = dueBasis === "TIME_IN_SERVICE"
    ? String(values.reference_mode || "").toUpperCase()
    : null;

  return {
    concept: String(values.concept || "").trim(),
    due_basis: dueBasis,
    recurrence: String(values.recurrence || "").toUpperCase(),
    reference_mode: referenceMode,
    due_date: dueBasis === "DATE" ? String(values.due_date || "") : null,
    reference_tis_hours:
      referenceMode === "ABSOLUTE_TIS" && values.reference_tis_hours !== ""
        ? Number(values.reference_tis_hours)
        : null,
    interval_hours:
      dueBasis === "TIME_IN_SERVICE" && values.interval_hours !== ""
        ? Number(values.interval_hours)
        : null,
    alert_before_value:
      values.alert_before_value === "" ? null : Number(values.alert_before_value),
    notes: String(values.notes || "").trim(),
  };
}

export async function fetchTrackingItems(aircraftId, status = "ALL", signal) {
  const params = new URLSearchParams({
    resource: "tracking",
    aircraft_id: aircraftId,
    status,
  });
  const result = await requestJson(
    `/api/settings?${params.toString()}`,
    { method: "GET", signal },
    "No se pudieron cargar los recordatorios."
  );
  if (!result.tracking || !Array.isArray(result.tracking.items)) {
    throw new Error("La respuesta de recordatorios no es valida.");
  }
  return result.tracking;
}

async function mutateTracking(method, body, fallbackMessage) {
  return requestJson("/api/settings", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource: "tracking", ...body }),
  }, fallbackMessage);
}

export function createTrackingItem(aircraftId, values) {
  return mutateTracking("POST", {
    action: "create",
    aircraft_id: aircraftId,
    item: buildTrackingItemPayload(values),
  }, "No se pudo crear el recordatorio.");
}

export function updateTrackingItem(aircraftId, trackingItemId, values) {
  return mutateTracking("PATCH", {
    action: "update",
    aircraft_id: aircraftId,
    tracking_item_id: trackingItemId,
    item: buildTrackingItemPayload(values),
  }, "No se pudo actualizar el recordatorio.");
}

export function archiveTrackingItem(aircraftId, trackingItemId) {
  return mutateTracking("PATCH", {
    action: "archive",
    aircraft_id: aircraftId,
    tracking_item_id: trackingItemId,
  }, "No se pudo archivar el recordatorio.");
}

export function completeTrackingItem(aircraftId, trackingItemId, values) {
  return mutateTracking("POST", {
    action: "complete",
    aircraft_id: aircraftId,
    tracking_item_id: trackingItemId,
    note: String(values.note || "").trim(),
    next_due_date: values.next_due_date || null,
  }, "No se pudo completar el recordatorio.");
}
