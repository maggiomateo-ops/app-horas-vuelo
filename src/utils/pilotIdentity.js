export function normalizePilotName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

export function maskPilotDni(value) {
  const normalized = String(value || "").replace(/\s+/g, "");
  if (!normalized) return "";
  const visible = normalized.slice(-4);
  return `${"•".repeat(Math.max(4, normalized.length - visible.length))}${visible}`;
}

export function getPilotDisplayLabel(pilot) {
  const name = String(pilot?.nombre || "").trim();
  const license = String(pilot?.licencia || "").trim();
  const dni = maskPilotDni(pilot?.dni);
  if (license) return `${name} · ${license}`;
  if (dni) return `${name} · DNI ${dni}`;
  return name;
}

export function buildPilotOptions(pilots) {
  const activePilots = pilots.filter(
    (pilot) => pilot?.estado === "ACTIVO" && pilot?.permiso_estado === "ACTIVO"
  );
  const nameGroups = new Map();
  activePilots.forEach((pilot) => {
    const key = normalizePilotName(pilot.nombre);
    const group = nameGroups.get(key) || [];
    group.push(pilot);
    nameGroups.set(key, group);
  });

  return activePilots.map((pilot) => {
    const label = getPilotDisplayLabel(pilot);
    const group = nameGroups.get(normalizePilotName(pilot.nombre)) || [];
    const ambiguous = group.length > 1 && group.filter(
      (candidate) => getPilotDisplayLabel(candidate) === label
    ).length > 1;
    return {
      personId: String(pilot.person_id || ""),
      name: String(pilot.nombre || "").trim(),
      label,
      ambiguous,
      pilot,
    };
  });
}

export function findSameNamePilotCandidates(pilots, name) {
  const normalized = normalizePilotName(name);
  if (!normalized) return [];
  return pilots.filter((pilot) => normalizePilotName(pilot.nombre) === normalized);
}

export function getPilotCreateAction({ canCreatePilot, query, matchCount }) {
  const name = String(query || "").trim();
  if (!canCreatePilot || !name || matchCount > 0) return null;
  return {
    name,
    label: `+ Agregar “${name}” como piloto`,
  };
}
