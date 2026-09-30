async function requestJson(url, options, fallbackMessage) {
  const response = await fetch(url, { credentials: "include", ...options });
  const result = await response.json().catch(() => null);
  if (response.status === 401) {
    const error = new Error("UNAUTHORIZED");
    error.code = "UNAUTHORIZED";
    throw error;
  }
  if (!response.ok || !result?.ok) {
    const error = new Error(result?.error || fallbackMessage);
    error.code = result?.code || "SQUAWK_REQUEST_FAILED";
    throw error;
  }
  return result;
}

export function buildSquawkPayload(values) {
  const reportedAt = new Date(values.reported_at);
  return {
    reported_at: Number.isFinite(reportedAt.getTime())
      ? reportedAt.toISOString()
      : String(values.reported_at || ""),
    title: String(values.title || "").trim(),
    description: String(values.description || "").trim(),
    category: values.category || null,
    flight_id: values.flight_id || null,
  };
}

export async function fetchSquawks(aircraftId, signal) {
  const params = new URLSearchParams({ resource: "squawks", aircraft_id: aircraftId });
  const result = await requestJson(`/api/settings?${params}`, { method: "GET", signal }, "No se pudieron cargar las novedades.");
  if (!result.squawks || !Array.isArray(result.squawks.items)) {
    throw new Error("La respuesta de novedades no es valida.");
  }
  return result.squawks;
}

async function mutateSquawk(method, body, fallbackMessage) {
  return requestJson("/api/settings", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resource: "squawks", ...body }),
  }, fallbackMessage);
}

export function createSquawk(aircraftId, values) {
  return mutateSquawk("POST", { action: "create", aircraft_id: aircraftId, squawk: buildSquawkPayload(values) }, "No se pudo reportar la novedad.");
}

export function updateSquawk(aircraftId, squawkId, values) {
  return mutateSquawk("PATCH", { action: "update", aircraft_id: aircraftId, squawk_id: squawkId, squawk: buildSquawkPayload(values) }, "No se pudo actualizar la novedad.");
}

export function addSquawkComment(aircraftId, squawkId, comment) {
  return mutateSquawk("POST", { action: "comment", aircraft_id: aircraftId, squawk_id: squawkId, comment: String(comment || "").trim() }, "No se pudo agregar el comentario.");
}

export function changeSquawkStatus(aircraftId, squawkId, fromStatus, toStatus, transition) {
  return mutateSquawk("POST", {
    action: "transition", aircraft_id: aircraftId, squawk_id: squawkId,
    from_status: fromStatus, to_status: toStatus, transition,
  }, "No se pudo cambiar el estado de la novedad.");
}
