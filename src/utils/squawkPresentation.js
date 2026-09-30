export const SQUAWK_STATUS_LABELS = Object.freeze({
  OPEN: "Abierta",
  SENT_TO_WORKSHOP: "En taller",
  RESOLVED: "Resuelta",
});

export const SQUAWK_CATEGORY_LABELS = Object.freeze({
  POWERPLANT: "Planta motriz",
  ELECTRICAL: "Eléctrico",
  AVIONICS_INSTRUMENTS: "Aviónica e instrumentos",
  FUEL: "Combustible",
  FLIGHT_CONTROLS: "Controles de vuelo",
  LANDING_GEAR_BRAKES: "Tren y frenos",
  LIGHTING: "Iluminación",
  STRUCTURE: "Estructura",
  CABIN_INTERIOR: "Cabina e interior",
  OTHER: "Otro",
});

export function getSquawkSummary(items = []) {
  return items.reduce((summary, item) => {
    summary.total += 1;
    if (item.status === "OPEN") summary.open += 1;
    if (item.status === "SENT_TO_WORKSHOP") summary.workshop += 1;
    if (item.status === "RESOLVED") summary.resolved += 1;
    return summary;
  }, { open: 0, workshop: 0, resolved: 0, total: 0 });
}

export function selectSquawks(items = [], { query = "", status = "ALL", category = "ALL", order = "NEWEST" } = {}) {
  const needle = String(query || "").trim().toLocaleLowerCase("es");
  return items
    .filter((item) => status === "ALL" || item.status === status)
    .filter((item) => category === "ALL" || item.category === category)
    .filter((item) => !needle || `${item.title || ""} ${item.description || ""}`.toLocaleLowerCase("es").includes(needle))
    .sort((left, right) => {
      const delta = new Date(right.reported_at) - new Date(left.reported_at);
      return order === "OLDEST" ? -delta : delta;
    });
}
