import { useEffect, useMemo, useState } from "react";
import SettingsUsersPanel from "./SettingsUsersPanel";

const SETTINGS_TABS = [
  { id: "app", label: "App" },
  { id: "operation", label: "Operacion" },
  { id: "inspections", label: "Inspecciones" },
  { id: "oil", label: "Aceite" },
  { id: "thresholds", label: "Umbrales" },
  { id: "annual", label: "Utilizacion" },
];

const SETTINGS_WRITE_MODE = Object.freeze({
  LEGACY_FULL: "LEGACY_FULL",
  CANONICAL_SUBSET: "CANONICAL_SUBSET",
  DISABLED: "DISABLED",
});

const DISABLED_WRITE_CAPABILITY = Object.freeze({
  enabled: false,
  mode: SETTINGS_WRITE_MODE.DISABLED,
  editablePaths: [],
});

function updateNestedValue(source, path, value) {
  const clone = structuredClone(source);
  let cursor = clone;

  for (let index = 0; index < path.length - 1; index += 1) {
    cursor = cursor[path[index]];
  }

  cursor[path.at(-1)] = value;
  return clone;
}

function SettingsField({
  label,
  type = "text",
  value,
  onChange,
  step,
  placeholder,
  disabled = false,
}) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        step={step}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function OwnerOptionsField({ value, onChange, disabled = false }) {
  const [inputValue, setInputValue] = useState(value.join(", "));

  useEffect(() => {
    setInputValue(value.join(", "));
  }, [value]);

  const commitValue = () => {
    if (disabled) {
      return;
    }

    onChange(
      inputValue
        .split(",")
        .map((option) => option.trim().toUpperCase())
        .filter(Boolean)
    );
  };

  return (
    <label className="settings-field">
      <span>Propietarios (separados por coma)</span>
      <input
        type="text"
        value={inputValue}
        onChange={(event) => setInputValue(event.target.value)}
        onBlur={commitValue}
        disabled={disabled}
      />
    </label>
  );
}

function SettingsPanel({
  aircraftId,
  aircraftRegistration,
  aircraftRole,
  canEdit,
  isGlobalAdmin,
  currentUserId,
  settings,
  loading,
  error,
  onSave,
  onUnauthorized,
}) {
  const [activeSection, setActiveSection] = useState("aircraft");
  const [activeTab, setActiveTab] = useState("app");
  const [draft, setDraft] = useState(settings);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [writeCapability, setWriteCapability] = useState(DISABLED_WRITE_CAPABILITY);
  const [writeCapabilityLoading, setWriteCapabilityLoading] = useState(true);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    const controller = new AbortController();
    let ignore = false;

    async function loadWriteCapability() {
      try {
        setWriteCapabilityLoading(true);
        const response = await fetch("/api/session", {
          method: "GET",
          credentials: "include",
          signal: controller.signal,
        });

        if (response.status === 401) {
          onUnauthorized?.();
          return;
        }

        const result = await response.json().catch(() => null);
        if (!response.ok || !result?.authenticated || !result?.user) {
          throw new Error("No se pudo validar la capacidad de escritura de Settings.");
        }

        if (!ignore) {
          setWriteCapability({
            enabled: result.user.settingsWritesEnabled === true,
            mode: String(result.user.settingsWriteMode || SETTINGS_WRITE_MODE.DISABLED),
            editablePaths: Array.isArray(result.user.settingsEditablePaths)
              ? result.user.settingsEditablePaths
              : null,
          });
        }
      } catch (capabilityError) {
        if (capabilityError.name === "AbortError") {
          return;
        }

        if (!ignore) {
          setWriteCapability(DISABLED_WRITE_CAPABILITY);
        }
      } finally {
        if (!ignore) {
          setWriteCapabilityLoading(false);
        }
      }
    }

    loadWriteCapability();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [onUnauthorized]);

  const editablePathSet = useMemo(
    () => new Set(writeCapability.editablePaths || []),
    [writeCapability.editablePaths]
  );
  const effectiveCanEdit = canEdit && writeCapability.enabled;
  const canonicalSubsetMode =
    writeCapability.mode === SETTINGS_WRITE_MODE.CANONICAL_SUBSET;
  const canEditPath = (path) =>
    effectiveCanEdit &&
    (writeCapability.mode === SETTINGS_WRITE_MODE.LEGACY_FULL || editablePathSet.has(path));

  const canViewUsers =
    isGlobalAdmin || String(aircraftRole || "").trim().toUpperCase() === "OWNER";

  useEffect(() => {
    if (!canViewUsers && activeSection === "users") {
      setActiveSection("aircraft");
    }
  }, [activeSection, canViewUsers]);

  const handleChange = (path) => (value) => {
    setSaveMessage("");
    setSaveError("");
    setDraft((currentDraft) => updateNestedValue(currentDraft, path, value));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!effectiveCanEdit) {
      return;
    }

    try {
      setIsSaving(true);
      setSaveError("");
      await onSave(draft);
      setSaveMessage("Settings guardados correctamente.");
    } catch (submitError) {
      setSaveMessage("");
      setSaveError(submitError.message || "No se pudieron guardar los settings.");
    } finally {
      setIsSaving(false);
    }
  };

  const editStatusText = (() => {
    if (!canEdit) {
      return "Acceso de solo lectura.";
    }
    if (writeCapabilityLoading) {
      return "Validando permisos de escritura...";
    }
    if (!writeCapability.enabled) {
      return "Escritura deshabilitada en este entorno.";
    }
    if (canonicalSubsetMode) {
      return "Edicion parcial habilitada para Settings canonicos.";
    }
    return "Editable para OWNER y ADMIN.";
  })();

  return (
    <section className="settings-panel">
      <div className="dashboard-section-header">
        <div>
          <p className="dashboard-eyebrow">
            {activeSection === "aircraft" ? "Parametros editables" : "Gestion de accesos"}
          </p>
          <h2 className="dashboard-title">Settings</h2>
        </div>
        <p className="dashboard-meta">
          {activeSection === "aircraft" ? editStatusText : "Gestion de usuarios y accesos."}
        </p>
      </div>

      <div className="settings-section-tabs" role="tablist" aria-label="Secciones de Settings">
        <button
          type="button"
          role="tab"
          aria-selected={activeSection === "aircraft"}
          className={`settings-section-tab ${activeSection === "aircraft" ? "is-active" : ""}`}
          onClick={() => setActiveSection("aircraft")}
        >
          Aeronave
        </button>
        {canViewUsers ? (
          <button
            type="button"
            role="tab"
            aria-selected={activeSection === "users"}
            className={`settings-section-tab ${activeSection === "users" ? "is-active" : ""}`}
            onClick={() => setActiveSection("users")}
          >
            Usuarios
          </button>
        ) : null}
      </div>

      {activeSection === "aircraft" ? (
        <>
          <p className="dashboard-inline-note">
            Estos parametros alimentan los calculos del dashboard y deben quedar persistidos para
            todos los ingresos futuros.
          </p>

          {loading ? <p className="dashboard-status">Cargando settings...</p> : null}
          {error ? <p className="dashboard-status dashboard-status-error">{error}</p> : null}
          {!effectiveCanEdit && !writeCapabilityLoading ? (
            <p className="dashboard-inline-note">
              Podés consultar estos valores, pero la escritura de Settings no está habilitada en este entorno.
            </p>
          ) : null}
          {canonicalSubsetMode && effectiveCanEdit ? (
            <p className="dashboard-inline-note">
              En Postgres TEST solo podés editar la unidad de aceite, la próxima fecha de inspección anual y los tres umbrales amarillos. El resto permanece de solo lectura en esta etapa.
            </p>
          ) : null}

          <div className="settings-tabs" role="tablist" aria-label="Tabs de settings">
            {SETTINGS_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                className={`settings-tab ${activeTab === tab.id ? "is-active" : ""}`}
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form className="settings-form" onSubmit={handleSubmit}>
        <fieldset className="settings-readonly-fieldset" disabled={!effectiveCanEdit}>
        {activeTab === "app" ? (
          <div className="settings-grid">
            <SettingsField
              label="Nombre visible"
              value={draft.appConfig.aircraftName}
              onChange={handleChange(["appConfig", "aircraftName"])}
              disabled={!canEditPath("appConfig.aircraftName")}
            />
            <SettingsField
              label="Matricula"
              value={draft.appConfig.aircraftRegistration}
              onChange={handleChange(["appConfig", "aircraftRegistration"])}
              disabled={!canEditPath("appConfig.aircraftRegistration")}
            />
            <SettingsField
              label="Unidad de aceite"
              value={draft.appConfig.oilUnitLabel}
              onChange={handleChange(["appConfig", "oilUnitLabel"])}
              disabled={!canEditPath("appConfig.oilUnitLabel")}
            />
            <SettingsField
              label="Moneda"
              value={draft.appConfig.currency}
              onChange={handleChange(["appConfig", "currency"])}
              disabled={!canEditPath("appConfig.currency")}
            />
          </div>
        ) : null}

        {activeTab === "operation" ? (
          <div className="settings-grid">
            <OwnerOptionsField
              value={draft.operationalConfig.ownerOptions}
              onChange={handleChange(["operationalConfig", "ownerOptions"])}
              disabled={!canEditPath("operationalConfig.ownerOptions")}
            />
            <SettingsField
              label="Origen predeterminado"
              value={draft.operationalConfig.defaultOrigin}
              onChange={handleChange(["operationalConfig", "defaultOrigin"])}
              disabled={!canEditPath("operationalConfig.defaultOrigin")}
            />
            <SettingsField
              label="Destino predeterminado"
              value={draft.operationalConfig.defaultDestination}
              onChange={handleChange(["operationalConfig", "defaultDestination"])}
              disabled={!canEditPath("operationalConfig.defaultDestination")}
            />
            <SettingsField
              label="Tiempo de vuelo JPI predeterminado"
              type="number"
              step="0.1"
              value={draft.operationalConfig.defaultFlightTimeJPI}
              onChange={(value) =>
                handleChange(["operationalConfig", "defaultFlightTimeJPI"])(
                  value === "" ? "" : Number(value)
                )
              }
              disabled={!canEditPath("operationalConfig.defaultFlightTimeJPI")}
            />
            <SettingsField
              label="Tiempo en servicio Garmin predeterminado"
              type="number"
              step="0.1"
              value={draft.operationalConfig.defaultServiceTimeGarmin}
              onChange={(value) =>
                handleChange(["operationalConfig", "defaultServiceTimeGarmin"])(
                  value === "" ? "" : Number(value)
                )
              }
              disabled={!canEditPath("operationalConfig.defaultServiceTimeGarmin")}
            />
          </div>
        ) : null}

        {activeTab === "inspections" ? (
          <div className="settings-stack">
            <div className="settings-subsection">
              <h3>Inspeccion anual</h3>
              <div className="settings-grid">
                <SettingsField
                  label="Proxima fecha"
                  type="date"
                  value={draft.kpiParams.annualInspection.nextDueDate}
                  onChange={handleChange(["kpiParams", "annualInspection", "nextDueDate"])}
                  disabled={!canEditPath("kpiParams.annualInspection.nextDueDate")}
                />
              </div>
            </div>

            <div className="settings-subsection">
              <h3>Inspeccion 50 hrs</h3>
              <div className="settings-grid">
                <SettingsField
                  label="Fecha ultima inspeccion"
                  type="date"
                  value={draft.kpiParams.inspection50.lastInspectionDate}
                  onChange={handleChange(["kpiParams", "inspection50", "lastInspectionDate"])}
                  disabled={!canEditPath("kpiParams.inspection50.lastInspectionDate")}
                />
              </div>
            </div>

            <div className="settings-subsection">
              <h3>Inspeccion 100 hrs</h3>
              <div className="settings-grid">
                <SettingsField
                  label="Fecha ultima inspeccion"
                  type="date"
                  value={draft.kpiParams.inspection100.lastInspectionDate}
                  onChange={handleChange(["kpiParams", "inspection100", "lastInspectionDate"])}
                  disabled={!canEditPath("kpiParams.inspection100.lastInspectionDate")}
                />
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "oil" ? (
          <div className="settings-grid">
            <SettingsField
              label="Precio actual"
              type="number"
              step="0.01"
              value={draft.kpiParams.oil.currentPrice}
              onChange={handleChange(["kpiParams", "oil", "currentPrice"])}
              disabled={!canEditPath("kpiParams.oil.currentPrice")}
            />
            <SettingsField
              label="Ventana movil (meses)"
              type="number"
              step="1"
              value={draft.kpiParams.oil.analysisWindowMonths}
              onChange={handleChange(["kpiParams", "oil", "analysisWindowMonths"])}
              disabled={!canEditPath("kpiParams.oil.analysisWindowMonths")}
            />
          </div>
        ) : null}

        {activeTab === "thresholds" ? (
          <div className="settings-stack">
            <div className="settings-subsection">
              <h3>Inspeccion anual</h3>
              <div className="settings-grid">
                <SettingsField
                  label="Rojo desde (dias)"
                  type="number"
                  value={draft.kpiParams.thresholds.annualInspection.dangerDays}
                  onChange={handleChange([
                    "kpiParams",
                    "thresholds",
                    "annualInspection",
                    "dangerDays",
                  ])}
                  disabled={!canEditPath("kpiParams.thresholds.annualInspection.dangerDays")}
                />
                <SettingsField
                  label="Amarillo desde (dias)"
                  type="number"
                  step="0.1"
                  value={draft.kpiParams.thresholds.annualInspection.warningDays}
                  onChange={handleChange([
                    "kpiParams",
                    "thresholds",
                    "annualInspection",
                    "warningDays",
                  ])}
                  disabled={!canEditPath("kpiParams.thresholds.annualInspection.warningDays")}
                />
              </div>
            </div>

            <div className="settings-subsection">
              <h3>Inspeccion 50 hrs</h3>
              <div className="settings-grid">
                <SettingsField
                  label="Rojo desde (hrs)"
                  type="number"
                  value={draft.kpiParams.thresholds.inspection50.dangerHours}
                  onChange={handleChange([
                    "kpiParams",
                    "thresholds",
                    "inspection50",
                    "dangerHours",
                  ])}
                  disabled={!canEditPath("kpiParams.thresholds.inspection50.dangerHours")}
                />
                <SettingsField
                  label="Amarillo desde (hrs)"
                  type="number"
                  step="0.1"
                  value={draft.kpiParams.thresholds.inspection50.warningHours}
                  onChange={handleChange([
                    "kpiParams",
                    "thresholds",
                    "inspection50",
                    "warningHours",
                  ])}
                  disabled={!canEditPath("kpiParams.thresholds.inspection50.warningHours")}
                />
              </div>
            </div>

            <div className="settings-subsection">
              <h3>Inspeccion 100 hrs</h3>
              <div className="settings-grid">
                <SettingsField
                  label="Rojo desde (hrs)"
                  type="number"
                  value={draft.kpiParams.thresholds.inspection100.dangerHours}
                  onChange={handleChange([
                    "kpiParams",
                    "thresholds",
                    "inspection100",
                    "dangerHours",
                  ])}
                  disabled={!canEditPath("kpiParams.thresholds.inspection100.dangerHours")}
                />
                <SettingsField
                  label="Amarillo desde (hrs)"
                  type="number"
                  step="0.1"
                  value={draft.kpiParams.thresholds.inspection100.warningHours}
                  onChange={handleChange([
                    "kpiParams",
                    "thresholds",
                    "inspection100",
                    "warningHours",
                  ])}
                  disabled={!canEditPath("kpiParams.thresholds.inspection100.warningHours")}
                />
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "annual" ? (
          <div className="settings-grid">
            <SettingsField
              label="Total 2022"
              type="number"
              step="0.1"
              value={draft.kpiParams.annualUtilizationLegacy["2022"]}
              onChange={handleChange(["kpiParams", "annualUtilizationLegacy", "2022"])}
              disabled={!canEditPath("kpiParams.annualUtilizationLegacy.2022")}
            />
          </div>
        ) : null}

        </fieldset>

        {effectiveCanEdit ? (
          <div className="settings-actions">
            <button type="submit" className="settings-save-button" disabled={loading || isSaving}>
              {isSaving ? "Guardando..." : "Guardar settings"}
            </button>
            {saveMessage ? <p className="settings-save-message">{saveMessage}</p> : null}
            {saveError ? (
              <p className="dashboard-status dashboard-status-error">{saveError}</p>
            ) : null}
          </div>
        ) : null}
          </form>
        </>
      ) : (
        <SettingsUsersPanel
          aircraftId={aircraftId}
          aircraftRegistration={aircraftRegistration}
          isGlobalAdmin={isGlobalAdmin}
          currentUserId={currentUserId}
          onUnauthorized={onUnauthorized}
        />
      )}
    </section>
  );
}

export default SettingsPanel;
