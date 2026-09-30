export const MAIN_TABS = [
  { id: "registro", label: "Registro" },
  { id: "historiales", label: "Historiales" },
  { id: "dashboards", label: "Dashboard" },
  { id: "seguimiento", label: "Seguimiento" },
  { id: "settings", label: "Settings" },
];

const BASE_MAIN_TAB_IDS = MAIN_TABS
  .map((tab) => tab.id)
  .filter((tabId) => tabId !== "seguimiento");

const ROLE_MAIN_TABS = {
  ADMIN: BASE_MAIN_TAB_IDS,
  OWNER: BASE_MAIN_TAB_IDS,
  PILOT: ["registro", "historiales"],
  VIEWER: ["historiales", "dashboards"],
};

export function getAllowedMainTabIds({ isAdmin, aircraftRole, trackingAvailable = false }) {
  const normalizedRole = String(aircraftRole || "").trim().toUpperCase();
  const baseTabs = isAdmin
    ? BASE_MAIN_TAB_IDS
    : ROLE_MAIN_TABS[normalizedRole] ?? ["historiales"];

  if (!trackingAvailable || !["ADMIN", "OWNER", "PILOT", "VIEWER"].includes(normalizedRole)) {
    return baseTabs;
  }

  return [...baseTabs, "seguimiento"];
}

export function getPreferredMainTab({ isAdmin, aircraftRole }) {
  const normalizedRole = String(aircraftRole || "").trim().toUpperCase();
  return isAdmin || ["ADMIN", "OWNER", "PILOT"].includes(normalizedRole)
    ? "registro"
    : "historiales";
}
