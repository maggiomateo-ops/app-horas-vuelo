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
