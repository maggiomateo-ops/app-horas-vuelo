import { useEffect, useState } from "react";

const SETTINGS_TABS = [
  { id: "app", label: "App" },
  { id: "operation", label: "Operacion" },
  { id: "inspections", label: "Inspecciones" },
  { id: "oil", label: "Aceite" },
  { id: "thresholds", label: "Umbrales" },
  { id: "annual", label: "Utilizacion" },
];

function updateNestedValue(source, path, value) {
  const clone = structuredClone(source);
  let cursor = clone;

  for (let index = 0; index < path.length - 1; index += 1) {
    cursor = cursor[path[index]];
  }

  cursor[path.at(-1)] = value;
  return clone;
}

function SettingsField({ label, type = "text", value, onChange, step, placeholder }) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <input
        type={type}
        value={value}
        step={step}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function OwnerOptionsField({ value, onChange }) {
  const [inputValue, setInputValue] = useState(value.join(", "));

  useEffect(() => {
    setInputValue(value.join(", "));
  }, [value]);

  const commitValue = () => {
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
      />
    </label>
  );
}

function SettingsPanel({ settings, loading, error, onSave }) {
  const [activeTab, setActiveTab] = useState("app");
  const [draft, setDraft] = useState(settings);
  const [saveMessage, setSaveMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const handleChange = (path) => (value) => {
    setSaveMessage("");
    setSaveError("");
    setDraft((currentDraft) => updateNestedValue(currentDraft, path, value));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

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

  return (
    <section className="settings-panel">
      <div className="dashboard-section-header">
        <div>
          <p className="dashboard-eyebrow">Parametros editables</p>
          <h2 className="dashboard-title">Settings</h2>
        </div>
        <p className="dashboard-meta">Editable por cualquier usuario autenticado.</p>
      </div>

      <p className="dashboard-inline-note">
        Estos parametros alimentan los calculos del dashboard y deben quedar persistidos para
        todos los ingresos futuros.
      </p>

      {loading ? <p className="dashboard-status">Cargando settings...</p> : null}
      {error ? <p className="dashboard-status dashboard-status-error">{error}</p> : null}

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
        {activeTab === "app" ? (
          <div className="settings-grid">
            <SettingsField
              label="Nombre visible"
              value={draft.appConfig.aircraftName}
              onChange={handleChange(["appConfig", "aircraftName"])}
            />
            <SettingsField
              label="Matricula"
              value={draft.appConfig.aircraftRegistration}
              onChange={handleChange(["appConfig", "aircraftRegistration"])}
            />
            <SettingsField
              label="Unidad de aceite"
              value={draft.appConfig.oilUnitLabel}
              onChange={handleChange(["appConfig", "oilUnitLabel"])}
            />
            <SettingsField
              label="Moneda"
              value={draft.appConfig.currency}
              onChange={handleChange(["appConfig", "currency"])}
            />
          </div>
        ) : null}

        {activeTab === "operation" ? (
          <div className="settings-grid">
            <OwnerOptionsField
              value={draft.operationalConfig.ownerOptions}
              onChange={handleChange(["operationalConfig", "ownerOptions"])}
            />
            <SettingsField
              label="Origen predeterminado"
              value={draft.operationalConfig.defaultOrigin}
              onChange={handleChange(["operationalConfig", "defaultOrigin"])}
            />
            <SettingsField
              label="Destino predeterminado"
              value={draft.operationalConfig.defaultDestination}
              onChange={handleChange(["operationalConfig", "defaultDestination"])}
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
            />
            <SettingsField
              label="Ventana movil (meses)"
              type="number"
              step="1"
              value={draft.kpiParams.oil.analysisWindowMonths}
              onChange={handleChange(["kpiParams", "oil", "analysisWindowMonths"])}
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
                />
                <SettingsField
                  label="Amarillo desde (dias)"
                  type="number"
                  value={draft.kpiParams.thresholds.annualInspection.warningDays}
                  onChange={handleChange([
                    "kpiParams",
                    "thresholds",
                    "annualInspection",
                    "warningDays",
                  ])}
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
                />
                <SettingsField
                  label="Amarillo desde (hrs)"
                  type="number"
                  value={draft.kpiParams.thresholds.inspection50.warningHours}
                  onChange={handleChange([
                    "kpiParams",
                    "thresholds",
                    "inspection50",
                    "warningHours",
                  ])}
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
                />
                <SettingsField
                  label="Amarillo desde (hrs)"
                  type="number"
                  value={draft.kpiParams.thresholds.inspection100.warningHours}
                  onChange={handleChange([
                    "kpiParams",
                    "thresholds",
                    "inspection100",
                    "warningHours",
                  ])}
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
            />
          </div>
        ) : null}

        <div className="settings-actions">
          <button type="submit" className="settings-save-button" disabled={loading || isSaving}>
            {isSaving ? "Guardando..." : "Guardar settings"}
          </button>
          {saveMessage ? <p className="settings-save-message">{saveMessage}</p> : null}
          {saveError ? <p className="dashboard-status dashboard-status-error">{saveError}</p> : null}
        </div>
      </form>
    </section>
  );
}

export default SettingsPanel;
