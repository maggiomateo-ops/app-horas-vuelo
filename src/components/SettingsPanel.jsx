import { useEffect, useMemo, useState } from "react";
import SettingsUsersPanel from "./SettingsUsersPanel";

const SETTINGS_CATEGORIES = [
  { id: "aircraft", label: "Aeronave", tabs: [{ id: "app", label: "Identificación" }] },
  { id: "configuration", label: "Configuración", tabs: [
    { id: "operation", label: "Carga de vuelos" },
    { id: "inspections", label: "Inspecciones" },
    { id: "oil", label: "Aceite" },
    { id: "thresholds", label: "Umbrales" },
    { id: "annual", label: "Utilización" },
  ] },
  { id: "components", label: "Componentes / Propulsión", tabs: [] },
  { id: "ownership", label: "Propiedad", tabs: [{ id: "ownership", label: "Propietarios de registro" }] },
  { id: "users", label: "Usuarios / Acceso", tabs: [] },
  { id: "preferences", label: "Preferencias", tabs: [{ id: "preferences", label: "Unidades y moneda" }] },
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
  aircraftConfigurationPanel = null,
}) {
  const [activeSection, setActiveSection] = useState("aircraft");
  const [activeTab, setActiveTab] = useState("app");
  const category = SETTINGS_CATEGORIES.find((item) => item.id === activeSection);
  const selectCategory = (item) => {
    setActiveSection(item.id);
    setActiveTab(item.tabs[0]?.id || "");
  };
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
  const canonicalSubsetMode =
    writeCapability.mode === SETTINGS_WRITE_MODE.CANONICAL_SUBSET;
  const isOwner = String(aircraftRole || "").trim().toUpperCase() === "OWNER";
  const effectiveCanEdit =
    canEdit &&
    writeCapability.enabled &&
    (!canonicalSubsetMode || isOwner);
  const canEditPath = (path) =>
    effectiveCanEdit &&
    (writeCapability.mode === SETTINGS_WRITE_MODE.LEGACY_FULL || editablePathSet.has(path));

  const canViewUsers = isGlobalAdmin || isOwner;

  useEffect(() => {
    if (!canViewUsers && activeSection === "users") {
      setActiveSection("aircraft");
      setActiveTab("app");
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
    if (canonicalSubsetMode && !isOwner) {
      return "La edicion Postgres TEST requiere rol OWNER.";
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
            {activeSection === "aircraft" ? "Ajustes de la aeronave" : "Ajustes"}
          </p>
          <h2 className="dashboard-title">Settings</h2>
        </div>
        <p className="dashboard-meta">
          {activeSection !== "users" ? editStatusText : "Usuarios y accesos de la aeronave."}
        </p>
      </div>

      <div className="settings-layout">
      <label className="settings-mobile-category">
        <span>Categoría</span>
        <select value={activeSection} onChange={(event) => selectCategory(SETTINGS_CATEGORIES.find((item) => item.id === event.target.value))}>
          {SETTINGS_CATEGORIES.filter((item) => item.id !== "users" || canViewUsers).map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
      </label>
      <nav className="settings-section-tabs" aria-label="Categorías de Settings">
        {SETTINGS_CATEGORIES.filter((item) => item.id !== "users" || canViewUsers).map((item) => (
          <button key={item.id} type="button"
            aria-current={activeSection === item.id ? "page" : undefined}
            className={`settings-section-tab ${activeSection === item.id ? "is-active" : ""}`}
            onClick={() => selectCategory(item)}>{item.label}</button>
        ))}
      </nav>
      <div className="settings-category-content">
      {activeSection !== "users" ? (
        <>
          <h3 className="settings-category-title">{category.label}</h3>

          {loading ? <p className="dashboard-status">Cargando settings...</p> : null}
          {error ? <p className="dashboard-status dashboard-status-error">{error}</p> : null}
          {canonicalSubsetMode && effectiveCanEdit ? (
            <p className="dashboard-inline-note">
              Podés editar unidad de aceite, próxima inspección anual y umbrales amarillos.
            </p>
          ) : null}

          {activeSection === "components" ? aircraftConfigurationPanel || <p className="dashboard-status">No hay configuración de componentes disponible para esta aeronave.</p> : null}

          <div className="settings-tabs" role="tablist" aria-label="Tabs de settings" hidden={category.tabs.length < 2}>
            {category.tabs.map((tab) => (
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
          </div>
        ) : null}

        {activeTab === "preferences" ? (
          <div className="settings-grid">
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

        {activeTab === "ownership" ? (
          <div className="settings-grid">
            <OwnerOptionsField
              value={draft.operationalConfig.ownerOptions}
              onChange={handleChange(["operationalConfig", "ownerOptions"])}
              disabled={!canEditPath("operationalConfig.ownerOptions")}
            />
            <p className="dashboard-inline-note">Opciones del formulario de vuelo. No modifican la propiedad legal.</p>
          </div>
        ) : null}

        {activeTab === "operation" ? (
          <div className="settings-grid">
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

        {effectiveCanEdit && category.tabs.length > 0 ? (
          <div className="settings-actions">
            <button type="submit" className="settings-save-button" disabled={loading || isSaving}>
              {isSaving ? "Guardando..." : "Guardar cambios"}
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
      </div>
      </div>
    </section>
  );
}

export default SettingsPanel;
