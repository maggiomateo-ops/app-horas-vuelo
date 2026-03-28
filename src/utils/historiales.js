export function formatHistorialDate({ dia, mes, anio }) {
  const day = String(dia ?? "").padStart(2, "0");
  const month = String(mes ?? "").padStart(2, "0");
  const year = String(anio ?? "").padStart(2, "0");

  return `${day}/${month}/${year}`;
}

export function getLatestRecords(records, limit = 10) {
  if (!Array.isArray(records)) {
    return [];
  }

  return [...records].reverse().slice(0, limit);
}

