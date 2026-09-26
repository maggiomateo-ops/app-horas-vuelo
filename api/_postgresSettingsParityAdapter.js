import { DEFAULT_SETTINGS, normalizeSettings } from "../src/services/settingsService.js";
import { postgresQuery } from "./_postgres.js";
import { getAircraftSettingsProjectionFromPostgres } from "./_postgresSettingsRepository.js";

const OIL_UNIT_LABEL = Object.freeze({
  US_QUART: "Qrt",
  LITER: "L",
});

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
      annualThresholds.warningDays,
      annual?.alert_before_value,
      DEFAULT_SETTINGS.kpiParams.thresholds.annualInspection.warningDays
    );

  settings.kpiParams.thresholds.inspection50.dangerHours =
    chooseNumber(
      inspection50Thresholds.dangerHours,
      DEFAULT_SETTINGS.kpiParams.thresholds.inspection50.dangerHours
    );
  settings.kpiParams.thresholds.inspection50.warningHours =
    chooseNumber(
      inspection50Thresholds.warningHours,
      inspection50?.alert_before_value,
      DEFAULT_SETTINGS.kpiParams.thresholds.inspection50.warningHours
    );

  settings.kpiParams.thresholds.inspection100.dangerHours =
    chooseNumber(
      inspection100Thresholds.dangerHours,
      DEFAULT_SETTINGS.kpiParams.thresholds.inspection100.dangerHours
    );
  settings.kpiParams.thresholds.inspection100.warningHours =
    chooseNumber(
      inspection100Thresholds.warningHours,
      inspection100?.alert_before_value,
      DEFAULT_SETTINGS.kpiParams.thresholds.inspection100.warningHours
    );

  // D-210 intentionally excluded oil price, analysis-window state and the legacy
  // annual-utilization override from canonical storage. Their UI defaults remain
  // presentation defaults rather than a shadow settings truth in Postgres.
  settings.kpiParams.oil.currentPrice = "";
  settings.kpiParams.annualUtilizationLegacy["2022"] = "";

  return normalizeSettings(settings);
}
