import { useRef, useState } from "react";

import {
  createAircraftSubmissionGuard,
  getAircraftConfigurationErrorMessage,
  validateAircraftConfiguration,
} from "../services/aircraftService";

const PROPULSION_OPTIONS = [
  ["PISTON", "Pistón"],
  ["TURBOPROP", "Turbohélice"],
  ["TURBOJET", "Turbojet"],
  ["TURBOFAN", "Turbofan"],
  ["ELECTRIC", "Eléctrica"],
  ["OTHER", "Otra"],
];

function componentKey(componentType, positionIndex) {
  return `${componentType}:${positionIndex}`;
}

function syncComponents(current, engineCount, propellerCount) {
  const byKey = new Map(current.map((component) => [
    componentKey(component.componentType, component.positionIndex),
    component,
  ]));
  return [
    ...Array.from({ length: engineCount }, (_, index) => ({
      componentType: "ENGINE",
      positionIndex: index + 1,
    })),
    ...Array.from({ length: propellerCount }, (_, index) => ({
      componentType: "PROPELLER",
      positionIndex: index + 1,
    })),
  ].map((identity) => ({
    manufacturer: "",
    model: "",
    serialNumber: "",
    openingTisHours: "",
    ...identity,
    ...(byKey.get(componentKey(identity.componentType, identity.positionIndex)) || {}),
  }));
}

function ComponentFields({ component, disabled, onChange }) {
  const label = component.componentType === "ENGINE" ? "Motor" : "Hélice";
  return (
    <fieldset className="aircraft-component-card" disabled={disabled}>
      <legend>{label} {component.positionIndex}</legend>
      <div className="aircraft-component-grid">
        <label>
          <span>Fabricante</span>
          <input
            type="text"
            value={component.manufacturer}
            onChange={(event) => onChange("manufacturer", event.target.value)}
          />
        </label>
        <label>
          <span>Modelo</span>
          <input
            type="text"
            value={component.model}
            onChange={(event) => onChange("model", event.target.value)}
          />
        </label>
        <label>
          <span>Número de serie</span>
          <input
            type="text"
            value={component.serialNumber}
            onChange={(event) => onChange("serialNumber", event.target.value)}
          />
        </label>
        <label>
          <span>TIS inicial</span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="0.1"
            value={component.openingTisHours}
            onChange={(event) => onChange("openingTisHours", event.target.value)}
            placeholder="Desconocido"
          />
        </label>
      </div>
    </fieldset>
  );
}

export default function AircraftConfigurationOnboarding({
  configurationConfigured,
  configuration,
  componentInstallations = [],
  onComplete,
  onUnauthorized,
}) {
  const adoptingExisting = componentInstallations.length > 0;
  const [showForm, setShowForm] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [values, setValues] = useState({
    propulsionType: "",
    engineCount: "",
    propellerCount: "",
    installedOn: "",
    components: [],
    adoptExisting: adoptingExisting,
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const guardRef = useRef(null);
  if (!guardRef.current) guardRef.current = createAircraftSubmissionGuard();

  const updateCount = (field, rawValue) => {
    setValues((current) => {
      const next = { ...current, [field]: rawValue };
      const engineCount = Math.max(0, Number.parseInt(next.engineCount, 10) || 0);
      const propellerCount = Math.max(0, Number.parseInt(next.propellerCount, 10) || 0);
      return {
        ...next,
        components: adoptingExisting
          ? []
          : syncComponents(current.components, engineCount, propellerCount),
      };
    });
    setReviewing(false);
    setErrors({});
  };

  const updateComponent = (component, field, value) => {
    const key = componentKey(component.componentType, component.positionIndex);
    setValues((current) => ({
      ...current,
      components: current.components.map((candidate) =>
        componentKey(candidate.componentType, candidate.positionIndex) === key
          ? { ...candidate, [field]: value }
          : candidate
      ),
    }));
    setReviewing(false);
    setSubmitError("");
  };

  const handleReview = (event) => {
    event.preventDefault();
    const validation = validateAircraftConfiguration(values);
    setErrors(validation.errors);
    setSubmitError("");
    if (validation.valid) setReviewing(true);
  };

  const handleConfirm = async () => {
    if (!guardRef.current.tryStart()) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await onComplete(values);
    } catch (error) {
      if (error?.code === "UNAUTHORIZED" || error?.statusCode === 401) {
        onUnauthorized();
        return;
      }
      setSubmitError(getAircraftConfigurationErrorMessage(error));
    } finally {
      setSubmitting(false);
      guardRef.current.finish();
    }
  };

  if (configurationConfigured) {
    return (
      <section className="aircraft-configuration-summary" aria-labelledby="configuration-summary-title">
        <header>
          <p className="dashboard-eyebrow">Configuración aeronáutica</p>
          <h2 id="configuration-summary-title">Topología configurada</h2>
          <p>
            {configuration?.propulsionType || "—"} · {configuration?.engineCount ?? 0} motor(es) · {configuration?.propellerCount ?? 0} hélice(s)
          </p>
        </header>
        <div className="aircraft-installation-summary">
          {componentInstallations.map((installation) => (
            <article key={installation.componentInstallationId}>
              <strong>
                {installation.componentType === "ENGINE" ? "Motor" : "Hélice"} {installation.positionIndex}
              </strong>
              <span>{[installation.manufacturer, installation.model].filter(Boolean).join(" ") || "Identidad física desconocida"}</span>
              <small>
                Instalado: {installation.installedOn || "—"} · TIS inicial: {installation.openingTisHours ?? "Desconocido"}
              </small>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="aircraft-configuration-onboarding" aria-labelledby="aircraft-configuration-title">
      <header>
        <p className="dashboard-eyebrow">Configuración inicial</p>
        <h2 id="aircraft-configuration-title">Configurar aeronave</h2>
        <p>
          {adoptingExisting
            ? "Definí la topología para vincular los componentes existentes."
            : "Definí la topología y los componentes instalados antes de operar la aeronave."}
        </p>
      </header>

      {adoptingExisting ? (
        <div className="aircraft-existing-components" role="status">
          <strong>Componentes existentes que se vincularán</strong>
          <div className="aircraft-installation-summary">
            {componentInstallations.map((installation) => (
              <article key={installation.componentInstallationId}>
                <strong>
                  {installation.componentType === "ENGINE" ? "Motor" : "Hélice"} {installation.positionIndex}
                </strong>
                <span>{[installation.manufacturer, installation.model].filter(Boolean).join(" ") || "Identidad física desconocida"}</span>
                <small>
                  Instalado: {installation.installedOn || "—"} · TIS inicial: {installation.openingTisHours ?? "Desconocido"}
                </small>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {!showForm ? (
        <button
          type="button"
          className="form-action-button is-primary"
          onClick={() => setShowForm(true)}
        >
          Configurar aeronave
        </button>
      ) : (
        <form className="aircraft-configuration-form" onSubmit={handleReview} noValidate>
          <div className="aircraft-configuration-grid">
            <label>
              <span>Tipo de propulsión *</span>
              <select
                value={values.propulsionType}
                onChange={(event) => {
                  setValues((current) => ({ ...current, propulsionType: event.target.value }));
                  setReviewing(false);
                  setErrors({});
                }}
                disabled={submitting}
              >
                <option value="">Seleccionar...</option>
                {PROPULSION_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              {errors.propulsionType ? <small>{errors.propulsionType}</small> : null}
            </label>
            <label>
              <span>Cantidad de motores *</span>
              <input
                type="number"
                min="0"
                step="1"
                value={values.engineCount}
                onChange={(event) => updateCount("engineCount", event.target.value)}
                disabled={submitting}
              />
              {errors.engineCount ? <small>{errors.engineCount}</small> : null}
            </label>
            <label>
              <span>Cantidad de hélices *</span>
              <input
                type="number"
                min="0"
                step="1"
                value={values.propellerCount}
                onChange={(event) => updateCount("propellerCount", event.target.value)}
                disabled={submitting}
              />
              {errors.propellerCount ? <small>{errors.propellerCount}</small> : null}
            </label>
            {!adoptingExisting ? (
              <label>
                <span>Fecha de instalación efectiva *</span>
                <input
                  type="date"
                  value={values.installedOn}
                  onChange={(event) => {
                    setValues((current) => ({ ...current, installedOn: event.target.value }));
                    setReviewing(false);
                    setErrors({});
                  }}
                  disabled={submitting}
                />
                {errors.installedOn ? <small>{errors.installedOn}</small> : null}
              </label>
            ) : null}
          </div>

          {errors.topology ? <p className="flight-form-message is-error">{errors.topology}</p> : null}

          {!adoptingExisting ? (
            <div className="aircraft-component-list">
              {values.components.map((component) => (
                <ComponentFields
                  key={componentKey(component.componentType, component.positionIndex)}
                  component={component}
                  disabled={submitting}
                  onChange={(field, value) => updateComponent(component, field, value)}
                />
              ))}
            </div>
          ) : null}

          {reviewing ? (
            <div className="aircraft-configuration-confirmation" role="status">
              <strong>Confirmá la configuración inicial</strong>
              <p>
                {adoptingExisting
                  ? `Se vincularán los componentes existentes a una topología de ${values.engineCount} motor(es) y ${values.propellerCount} hélice(s). No se modificarán sus datos físicos.`
                  : `Se crearán ${values.engineCount} motor(es) y ${values.propellerCount} hélice(s). Esta etapa no permite reemplazar ni remover componentes posteriormente.`}
              </p>
              <button
                type="button"
                className="form-action-button is-primary"
                onClick={handleConfirm}
                disabled={submitting}
              >
                {submitting ? "Guardando configuración..." : "Confirmar y guardar"}
              </button>
            </div>
          ) : (
            <button type="submit" className="form-action-button is-primary" disabled={submitting}>
              Revisar configuración
            </button>
          )}

          {submitError ? <p className="flight-form-message is-error" role="alert">{submitError}</p> : null}
        </form>
      )}
    </section>
  );
}
