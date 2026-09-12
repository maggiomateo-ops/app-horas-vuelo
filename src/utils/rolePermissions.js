export const MAIN_TABS = [
  { id: "registro", label: "Registro" },
  { id: "historiales", label: "Historiales" },
  { id: "dashboards", label: "Dashboard" },
  { id: "settings", label: "Settings" },
];

const ALL_MAIN_TAB_IDS = MAIN_TABS.map((tab) => tab.id);

const ROLE_MAIN_TABS = {
  ADMIN: ALL_MAIN_TAB_IDS,
  OWNER: ALL_MAIN_TAB_IDS,
  PILOT: ["registro", "historiales"],
  VIEWER: ["historiales", "dashboards"],
};

export function getAllowedMainTabIds({ isAdmin, aircraftRole }) {
  if (isAdmin) {
    return ALL_MAIN_TAB_IDS;
  }

  const normalizedRole = String(aircraftRole || "").trim().toUpperCase();
  return ROLE_MAIN_TABS[normalizedRole] ?? ["historiales"];
}

export function getPreferredMainTab({ isAdmin, aircraftRole }) {
  const normalizedRole = String(aircraftRole || "").trim().toUpperCase();
  return isAdmin || ["ADMIN", "OWNER", "PILOT"].includes(normalizedRole)
    ? "registro"
    : "historiales";
}
