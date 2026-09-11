export async function fetchHistoriales(aircraftId, mode, signal) {
  const searchParams = new URLSearchParams({ aircraft_id: aircraftId });

  if (mode) {
    searchParams.set("mode", mode);
  }
  const response = await fetch(`/api/historiales?${searchParams}`, {
    method: "GET",
    signal,
    credentials: "include",
  });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  let data = null;

  try {
    data = await response.json();
  } catch {
    throw new Error("No se pudo leer la respuesta de historiales.");
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "No se pudieron cargar los historiales.");
  }

  return data;
}
