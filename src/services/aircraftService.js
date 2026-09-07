export async function fetchAircrafts(signal) {
  const response = await fetch("/api/aircraft", {
    method: "GET",
    signal,
    credentials: "include",
  });

  if (response.status === 401) {
    throw new Error("UNAUTHORIZED");
  }

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok || !Array.isArray(data.aircrafts)) {
    throw new Error(data?.error || "No se pudieron cargar las aeronaves.");
  }

  return data.aircrafts;
}
