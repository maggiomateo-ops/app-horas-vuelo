import { DEFAULT_SETTINGS, normalizeSettings } from "../src/services/settingsService.js";
import { postgresQuery } from "./_postgres.js";
import {
  getAircraftSettingsProjectionFromPostgres,
  saveCanonicalSettingsSubsetToPostgres,
} from "./_postgresSettingsRepository.js";
import { POSTGRES_SETTINGS_EDITABLE_PATHS } from "./_settingsWriteCapability.js";

const OIL_UNIT_LABEL = Object.freeze({
  US_QUART: "Qrt",
  LITER: "L",
});
const OIL_UNIT_CANONICAL = Object.freeze({
  QRT: "US_QUART",
  QUART: "US_QUART",
  US_QUART: "US_QUART",
  L: "LITER",
  LITER: "LITER",
  LITRE: "LITER",
});
const EDITABLE_PATH_SET = new Set(POSTGRES_SETTINGS_EDITABLE_PATHS);

function adapterError(message, code, statusCode = 400, metadata = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  if (metadata) {
    error.metadata = metadata;
  }
  return error;
}

function asNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseJsonObject(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "object") {
    return value && !Array.isArray(value) ? value : {};
  }

  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function loadCurrentOwnershipOptions(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        interest.party_id,
        interest.ownership_share,
        CASE
          WHEN party.party_type = 'PERSON' THEN person.full_name
          WHEN party.party_type = 'ORGANIZATION' THEN party.organization_name
          ELSE NULL
        END AS owner_label
      FROM app.aircraft_ownership_interests interest
      JOIN app.parties party
        ON party.party_id = interest.party_id
      LEFT JOIN app.persons person
        ON person.person_id = party.person_id
      WHERE interest.aircraft_id = $1::uuid
        AND interest.effective_from_at <= now()
        AND (interest.effective_to_at IS NULL OR interest.effective_to_at > now())
        AND party.status = 'ACTIVE'
      ORDER BY interest.ownership_share DESC, lower(
        CASE
          WHEN party.party_type = 'PERSON' THEN person.full_name
          WHEN party.party_type = 'ORGANIZATION' THEN party.organization_name
          ELSE ''
        END
      )
    `,
    [aircraftId]
  );

  return rows
    .map((row) => String(row.owner_label || "").trim())
    .filter(Boolean);
}

async function loadTrackingItems(aircraftId) {
  const { rows } = await postgresQuery(
    `
      SELECT
        tracking_item_id,
        concept,
        due_basis,
        recurrence,
        reference_mode,
        due_date,
        reference_tis_hours,
        interval_hours,
        alert_before_value,
        notes,
        status
      FROM app.tracking_items
      WHERE aircraft_id = $1::uuid
        AND status = 'ACTIVE'
      ORDER BY concept, tracking_item_id
    `,
    [aircraftId]
  );

  return rows;
}

function trackingByInterval(items, intervalHours) {
  return items.find(
    (item) =>
      String(item.due_basis || "").toUpperCase() === "TIME_IN_SERVICE" &&
      asNumber(item.interval_hours) === intervalHours
  ) || null;
}

function annualTrackingItem(items) {
  return items.find(
    (item) => String(item.due_basis || "").toUpperCase() === "DATE"
  ) || null;
}

function legacyKpiProvenance(item) {
  return parseJsonObject(parseJsonObject(item?.notes).legacy_kpi_provenance);
}

function chooseNumber(...values) {
  for (const value of values) {
    const numeric = asNumber(value);
    if (numeric !== null) {
      return numeric;
    }
  }

  return null;
}

function flattenLeafValues(value, prefix = "", result = new Map()) {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    result.set(prefix, value);
    return result;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    flattenLeafValues(nestedValue, path, result);
  }

  return result;
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unsupportedChangedPaths(currentSettings, requestedSettings) {
  const currentLeaves = flattenLeafValues(currentSettings);
  const requestedLeaves = flattenLeafValues(requestedSettings);
  const paths = new Set([...currentLeaves.keys(), ...requestedLeaves.keys()]);

  return [...paths]
    .filter((path) => !EDITABLE_PATH_SET.has(path))
    .filter((path) => !sameValue(currentLeaves.get(path), requestedLeaves.get(path)))
    .sort();
}

function normalizeOilUnit(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const canonical = OIL_UNIT_CANONICAL[normalized];

  if (!canonical) {
    throw adapterError(
      "Unidad de aceite no valida. Usar Qrt o L.",
      "SETTINGS_INVALID_OIL_UNIT",
      422
    );
  }

  return canonical;
}

function normalizeIsoDate(value, label) {
  const normalized = String(value || "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw adapterError(`${label} debe tener formato AAAA-MM-DD.`, "SETTINGS_INVALID_DATE", 422);
  }

  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw adapterError(`${label} no es una fecha valida.`, "SETTINGS_INVALID_DATE", 422);
  }

  return normalized;
}

function normalizeAlert(value, label) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric) || numeric < 0 || Math.abs(numeric * 10 - Math.round(numeric * 10)) > 1e-9) {
    throw adapterError(
      `${label} debe ser un numero mayor o igual a 0 con hasta un decimal.`,
      "SETTINGS_INVALID_ALERT_THRESHOLD",
      422
    );
  }

  return Math.round(numeric * 10) / 10;
}

function desiredCanonicalSubset(settings) {
  return {
    defaultOilUnit: normalizeOilUnit(settings.appConfig.oilUnitLabel),
    annualDueDate: normalizeIsoDate(
      settings.kpiParams.annualInspection.nextDueDate,
      "Proxima fecha de inspeccion anual"
    ),
    annualWarning: normalizeAlert(
      settings.kpiParams.thresholds.annualInspection.warningDays,
      "Umbral amarillo de inspeccion anual"
    ),
    inspection50Warning: normalizeAlert(
      settings.kpiParams.thresholds.inspection50.warningHours,
      "Umbral amarillo de inspeccion 50 hrs"
    ),
    inspection100Warning: normalizeAlert(
      settings.kpiParams.thresholds.inspection100.warningHours,
      "Umbral amarillo de inspeccion 100 hrs"
    ),
  };
}

export async function getLegacySettingsShapeFromPostgres({ userId, aircraftId }) {
  const projection = await getAircraftSettingsProjectionFromPostgres({ userId, aircraftId });
  const canonicalAircraftId = projection.aircraft.aircraft_id;
  const [ownerOptions, trackingItems] = await Promise.all([
    loadCurrentOwnershipOptions(canonicalAircraftId),
    loadTrackingItems(canonicalAircraftId),
  ]);

  const annual = annualTrackingItem(trackingItems);
  const inspection50 = trackingByInterval(trackingItems, 50);
  const inspection100 = trackingByInterval(trackingItems, 100);
  const annualLegacy = legacyKpiProvenance(annual);
  const inspection50Legacy = legacyKpiProvenance(inspection50);
  const inspection100Legacy = legacyKpiProvenance(inspection100);

  const settings = structuredClone(DEFAULT_SETTINGS);

  settings.appConfig.aircraftRegistration = String(projection.aircraft.registration || "");
  settings.appConfig.oilUnitLabel =
    OIL_UNIT_LABEL[String(projection.recording?.default_oil_unit || "").toUpperCase()] ||
    DEFAULT_SETTINGS.appConfig.oilUnitLabel;

  settings.operationalConfig.ownerOptions = ownerOptions;

  settings.kpiParams.annualInspection.nextDueDate = annual?.due_date
    ? String(annual.due_date).slice(0, 10)
    : "";
  settings.kpiParams.inspection50.lastInspectionDate = String(
    inspection50Legacy.lastInspectionDate || ""
  ).slice(0, 10);
  settings.kpiParams.inspection100.lastInspectionDate = String(
    inspection100Legacy.lastInspectionDate || ""
  ).slice(0, 10);

  const annualThresholds = parseJsonObject(annualLegacy.thresholds);
  const inspection50Thresholds = parseJsonObject(inspection50Legacy.thresholds);
  const inspection100Thresholds = parseJsonObject(inspection100Legacy.thresholds);

  settings.kpiParams.thresholds.annualInspection.dangerDays =
    chooseNumber(
      annualThresholds.dangerDays,
      DEFAULT_SETTINGS.kpiParams.thresholds.annualInspection.dangerDays
    );
  settings.kpiParams.thresholds.annualInspection.warningDays =
    chooseNumber(
      annual?.alert_before_value,
      annualThresholds.warningDays,
      DEFAULT_SETTINGS.kpiParams.thresholds.annualInspection.warningDays
    );

  settings.kpiParams.thresholds.inspection50.dangerHours =
    chooseNumber(
      inspection50Thresholds.dangerHours,
      DEFAULT_SETTINGS.kpiParams.thresholds.inspection50.dangerHours
    );
  settings.kpiParams.thresholds.inspection50.warningHours =
    chooseNumber(
      inspection50?.alert_before_value,
      inspection50Thresholds.warningHours,
      DEFAULT_SETTINGS.kpiParams.thresholds.inspection50.warningHours
    );

  settings.kpiParams.thresholds.inspection100.dangerHours =
    chooseNumber(
      inspection100Thresholds.dangerHours,
      DEFAULT_SETTINGS.kpiParams.thresholds.inspection100.dangerHours
    );
  settings.kpiParams.thresholds.inspection100.warningHours =
    chooseNumber(
      inspection100?.alert_before_value,
      inspection100Thresholds.warningHours,
      DEFAULT_SETTINGS.kpiParams.thresholds.inspection100.warningHours
    );

  // D-210 intentionally excluded oil price, analysis-window state and the legacy
  // annual-utilization override from canonical storage. Their UI defaults remain
  // presentation defaults rather than a shadow settings truth in Postgres.
  settings.kpiParams.oil.currentPrice = "";
  settings.kpiParams.annualUtilizationLegacy["2022"] = "";

  return normalizeSettings(settings);
}

export async function saveLegacySettingsShapeToPostgres({
  userId,
  aircraftId,
  settings,
}) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw adapterError(
      "El payload de settings no es valido.",
      "SETTINGS_INVALID_PAYLOAD",
      400
    );
  }

  const currentSettings = await getLegacySettingsShapeFromPostgres({ userId, aircraftId });
  const requestedSettings = normalizeSettings(settings);
  const blockedPaths = unsupportedChangedPaths(currentSettings, requestedSettings);

  if (blockedPaths.length > 0) {
    throw adapterError(
      `Estos campos son de solo lectura en Postgres TEST: ${blockedPaths.join(", ")}.`,
      "SETTINGS_FIELD_NOT_WRITABLE",
      409,
      { blockedPaths }
    );
  }

  const desired = desiredCanonicalSubset(requestedSettings);
  const result = await saveCanonicalSettingsSubsetToPostgres({
    userId,
    aircraftId,
    desired,
  });
  const persistedSettings = await getLegacySettingsShapeFromPostgres({ userId, aircraftId });

  return {
    settings: persistedSettings,
    changed: result.changed,
    changedPaths: result.changedPaths,
  };
}
