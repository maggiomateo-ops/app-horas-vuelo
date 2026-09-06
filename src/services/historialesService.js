export async function fetchHistoriales(signal) {
  const response = await fetch("/api/historiales", {
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
