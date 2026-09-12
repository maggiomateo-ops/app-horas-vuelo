async function readJson(response) {
  return response.json().catch(() => null);
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

  return result.users;
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
  };
}
