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
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || fallbackMessage);
  }

  return result;
}

export async function fetchPlatformUsers(signal) {
  const response = await fetch("/api/users", {
    method: "GET",
    credentials: "include",
    signal,
  });
  const result = await readJson(response);

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok || !result?.ok || !Array.isArray(result.users)) {
    throw new Error(result?.error || "No se pudieron cargar los usuarios.");
  }

  return {
    users: result.users,
    writesEnabled: result.writes_enabled === true,
  };
}

export async function fetchAircraftPilots(aircraftId, signal) {
  const params = new URLSearchParams({ aircraft_id: aircraftId });
  const response = await fetch(`/api/aircraft-pilots?${params.toString()}`, {
    method: "GET",
    credentials: "include",
    signal,
  });
  const result = await readJson(response);

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok || !result?.ok || !Array.isArray(result.pilots)) {
    throw new Error(result?.error || "No se pudieron cargar los pilotos autorizados.");
  }

  return {
    aircraft: result.aircraft ?? null,
    pilots: result.pilots,
    writesEnabled: result.writes_enabled === true,
  };
}


export async function createPlatformUser(payload) {
  return requestJson("/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, "No se pudo crear el usuario.");
}

export async function changePlatformUserState(userId, state) {
  return requestJson("/api/users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, estado: state }),
  }, "No se pudo actualizar el usuario.");
}

export async function grantAircraftPermission(userId, aircraftId, role) {
  return requestJson("/api/permissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, aircraft_id: aircraftId, rol: role }),
  }, "No se pudo actualizar el acceso.");
}

export async function revokeAircraftPermission(userId, aircraftId) {
  return requestJson("/api/permissions", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId, aircraft_id: aircraftId, action: "revoke" }),
  }, "No se pudo revocar el acceso.");
}

export async function authorizeAircraftPilot(payload) {
  return requestJson("/api/aircraft-pilots", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, "No se pudo autorizar el piloto.");
}

export async function revokeAircraftPilot(userId, aircraftId) {
  return requestJson("/api/aircraft-pilots", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aircraft_id: aircraftId, user_id: userId, action: "revoke" }),
  }, "No se pudo revocar el piloto.");
}
