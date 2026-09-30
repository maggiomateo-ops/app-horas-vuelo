export const SETTINGS_WRITE_MODE = Object.freeze({
  LEGACY_FULL: "LEGACY_FULL",
  CANONICAL_SUBSET: "CANONICAL_SUBSET",
  DISABLED: "DISABLED",
});

export const POSTGRES_SETTINGS_EDITABLE_PATHS = Object.freeze([
  "appConfig.oilUnitLabel",
  "kpiParams.annualInspection.nextDueDate",
  "kpiParams.thresholds.annualInspection.warningDays",
  "kpiParams.thresholds.inspection50.warningHours",
  "kpiParams.thresholds.inspection100.warningHours",
]);

function capabilityError(message, code = "SETTINGS_WRITE_FLAG_INVALID") {
  const error = new Error(message);
  error.code = code;
  error.statusCode = 500;
  return error;
}

function resolvePostgresSettingsWriteFlag() {
  const rawValue = String(process.env.POSTGRES_SETTINGS_WRITES_ENABLED || "")
    .trim()
    .toLowerCase();

  if (!rawValue || rawValue === "false") {
    return false;
  }

  if (rawValue === "true") {
    return true;
  }

  throw capabilityError(
    "POSTGRES_SETTINGS_WRITES_ENABLED debe ser true, false o estar ausente."
  );
}

export function resolveSettingsWriteCapability(settingsSource) {
  const normalizedSource = String(settingsSource || "").trim().toUpperCase();

  if (normalizedSource !== "POSTGRES") {
    return {
      enabled: true,
      mode: SETTINGS_WRITE_MODE.LEGACY_FULL,
      editablePaths: null,
    };
  }

  const enabled = resolvePostgresSettingsWriteFlag();

  return {
    enabled,
    mode: enabled
      ? SETTINGS_WRITE_MODE.CANONICAL_SUBSET
      : SETTINGS_WRITE_MODE.DISABLED,
    editablePaths: enabled ? [...POSTGRES_SETTINGS_EDITABLE_PATHS] : [],
  };
}


export function resolvePostgresFlightWriteCapability(flightSource) {
  const normalizedSource = String(flightSource || "").trim().toUpperCase();
  if (normalizedSource !== "POSTGRES") return { enabled: true, mode: "LEGACY_FULL" };
  const raw = String(process.env.POSTGRES_FLIGHT_WRITES_ENABLED || "").trim().toLowerCase();
  if (!raw || raw === "false") return { enabled: false, mode: "DISABLED" };
  if (raw === "true") return { enabled: true, mode: "CANONICAL_REVISIONED" };
  throw capabilityError("POSTGRES_FLIGHT_WRITES_ENABLED debe ser true, false o estar ausente.", "FLIGHT_WRITE_FLAG_INVALID");
}


export function resolvePostgresOnboardingWriteCapability(aircraftSource) {
  const normalizedSource = String(aircraftSource || "").trim().toUpperCase();
  if (normalizedSource !== "POSTGRES") return { enabled: false, mode: "DISABLED" };
  const raw = String(process.env.POSTGRES_ONBOARDING_WRITES_ENABLED || "").trim().toLowerCase();
  if (!raw || raw === "false") return { enabled: false, mode: "DISABLED" };
  if (raw === "true") return { enabled: true, mode: "ATOMIC_AIRCRAFT_BOOTSTRAP" };
  throw capabilityError("POSTGRES_ONBOARDING_WRITES_ENABLED debe ser true, false o estar ausente.", "ONBOARDING_WRITE_FLAG_INVALID");
}

export function resolvePostgresOwnershipWriteCapability(aircraftSource) {
  const normalizedSource = String(aircraftSource || "").trim().toUpperCase();
  if (normalizedSource !== "POSTGRES") return { enabled: false, mode: "DISABLED" };
  const raw = String(process.env.POSTGRES_OWNERSHIP_WRITES_ENABLED || "").trim().toLowerCase();
  if (!raw || raw === "false") return { enabled: false, mode: "DISABLED" };
  if (raw === "true") return { enabled: true, mode: "INITIAL_CANONICAL_SETUP" };
  throw capabilityError("POSTGRES_OWNERSHIP_WRITES_ENABLED debe ser true, false o estar ausente.", "OWNERSHIP_WRITE_FLAG_INVALID");
}

export function resolvePostgresAircraftConfigurationWriteCapability(aircraftSource) {
  const normalizedSource = String(aircraftSource || "").trim().toUpperCase();
  if (normalizedSource !== "POSTGRES") return { enabled: false, mode: "DISABLED" };
  const raw = String(
    process.env.POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED || ""
  ).trim().toLowerCase();
  if (!raw || raw === "false") return { enabled: false, mode: "DISABLED" };
  if (raw === "true") return { enabled: true, mode: "INITIAL_TOPOLOGY_SETUP" };
  throw capabilityError(
    "POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED debe ser true, false o estar ausente.",
    "AIRCRAFT_CONFIGURATION_WRITE_FLAG_INVALID"
  );
}

export function resolvePostgresComponentLifecycleWriteCapability(aircraftSource) {
  const normalizedSource = String(aircraftSource || "").trim().toUpperCase();
  if (normalizedSource !== "POSTGRES") return { enabled: false, mode: "DISABLED" };
  const raw = String(
    process.env.POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED || ""
  ).trim().toLowerCase();
  if (!raw || raw === "false") return { enabled: false, mode: "DISABLED" };
  if (raw === "true") return { enabled: true, mode: "OWNER_COMPONENT_LIFECYCLE" };
  throw capabilityError(
    "POSTGRES_COMPONENT_LIFECYCLE_WRITES_ENABLED debe ser true, false o estar ausente.",
    "COMPONENT_LIFECYCLE_WRITE_FLAG_INVALID"
  );
}

export function resolvePostgresTrackingWriteCapability(settingsSource) {
  const normalizedSource = String(settingsSource || "").trim().toUpperCase();
  if (normalizedSource !== "POSTGRES") return { enabled: false, mode: "DISABLED" };
  const raw = String(
    process.env.POSTGRES_TRACKING_WRITES_ENABLED || ""
  ).trim().toLowerCase();
  if (!raw || raw === "false") return { enabled: false, mode: "DISABLED" };
  if (raw === "true") return { enabled: true, mode: "OWNER_TRACKING_REMINDERS" };
  throw capabilityError(
    "POSTGRES_TRACKING_WRITES_ENABLED debe ser true, false o estar ausente.",
    "TRACKING_WRITE_FLAG_INVALID"
  );
}

export function resolvePostgresSquawkWriteCapability(settingsSource) {
  const normalizedSource = String(settingsSource || "").trim().toUpperCase();
  if (normalizedSource !== "POSTGRES") return { enabled: false, mode: "DISABLED" };
  const raw = String(process.env.POSTGRES_SQUAWK_WRITES_ENABLED || "")
    .trim()
    .toLowerCase();
  if (!raw || raw === "false") return { enabled: false, mode: "DISABLED" };
  if (raw === "true") return { enabled: true, mode: "AIRCRAFT_SQUAWKS" };
  throw capabilityError(
    "POSTGRES_SQUAWK_WRITES_ENABLED debe ser true, false o estar ausente.",
    "SQUAWK_WRITE_FLAG_INVALID"
  );
}
