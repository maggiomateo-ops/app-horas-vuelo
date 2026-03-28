const HISTORIALES_URL =
  "https://script.google.com/macros/s/AKfycbxxLAVrji2H6yFwFIzECtnr_zIAjZAvPfOKkVRHSTvfSmOrozOluoAj1DBJr8Sbp1Ep/exec?action=historiales";

export async function fetchHistoriales(signal) {
  const response = await fetch(HISTORIALES_URL, {
    method: "GET",
    signal,
  });

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

