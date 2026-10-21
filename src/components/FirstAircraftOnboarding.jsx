import CountrySelector from './CountrySelector';
import { useRef, useState } from "react";

import {
  createAircraftSubmissionGuard,
  getAircraftOnboardingErrorMessage,
} from "../services/aircraftService";

const EMPTY_FORM = Object.freeze({
  registration: "",
  manufacturer: "",
  model: "",
  serialNumber: "",
  countryCode: "",
  openingTisHours: "",
  baselineEffectiveDate: "",
});

function validateForm(values) {
  const errors = {};
  const openingTis = String(values.openingTisHours).trim();

  if (!values.registration.trim()) errors.registration = "Ingresá la matrícula.";
  if (!values.manufacturer.trim()) errors.manufacturer = "Ingresá el fabricante.";
  if (!values.model.trim()) errors.model = "Ingresá el modelo.";
  if (!values.baselineEffectiveDate) {
    errors.baselineEffectiveDate = "Elegí la fecha base.";
  }
  if (values.countryCode && !/^[A-Z]{2}$/.test(values.countryCode)) {
    errors.countryCode = "Usá un código ISO de dos letras.";
  }
  if (
    openingTis !== "" &&
    (!/^\d+(?:\.\d)?$/.test(openingTis) || Number(openingTis) < 0)
  ) {
    errors.openingTisHours = "Ingresá un valor positivo con hasta un decimal.";
  }

  return errors;
}

export default function FirstAircraftOnboarding({
  onCreate,
  onLogout,
  onUnauthorized,
  onCancel,
  canCreate = false,
  embedded = false,
  titleId,
}) {
  const [showForm, setShowForm] = useState(embedded);
  const [values, setValues] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitGuardRef = useRef(null);

  if (!submitGuardRef.current) {
    submitGuardRef.current = createAircraftSubmissionGuard();
  }

  const updateField = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      return { ...current, [field]: "" };
    });
    setSubmitError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!canCreate) return;

    if (!submitGuardRef.current.tryStart()) {
      return;
    }

    const nextErrors = validateForm(values);

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      submitGuardRef.current.finish();
      return;
    }

    setSubmitting(true);
    setSubmitError("");

    try {
      await onCreate(values);
    } catch (error) {
      if (error?.code === "UNAUTHORIZED") {
        onUnauthorized();
        return;
      }

      setSubmitError(getAircraftOnboardingErrorMessage(error));
    } finally {
      setSubmitting(false);
      submitGuardRef.current.finish();
    }
  };

  const content = (
      <section className="first-aircraft-card">
        <p className="login-eyebrow">{embedded ? "Nueva aeronave" : "Primeros pasos"}</p>
        <h1 id={titleId} className="login-title">{embedded ? "Agregar aeronave" : "App Horas de Vuelo"}</h1>
        {!canCreate ? <p className="first-aircraft-copy" role="status">El alta de aeronaves no está habilitada en este entorno.</p> : null}

        {!showForm ? (
          <>
            <p className="first-aircraft-copy">
              Todavía no tenés aeronaves configuradas.
            </p>
            <div className="first-aircraft-actions">
              <button
                type="button"
                className="login-button"
                onClick={() => { if (canCreate) setShowForm(true); }}
                disabled={!canCreate}
              >
                Agregar aeronave
              </button>
              <button
                type="button"
                className="first-aircraft-secondary-button"
                onClick={onLogout}
              >
                Cerrar sesión
              </button>
            </div>
          </>
        ) : (
          <form className="first-aircraft-form" onSubmit={handleSubmit} noValidate>
            <p className="first-aircraft-copy">
              Ingresá los datos básicos. La propiedad legal se configura por separado.
            </p>

            <div className="first-aircraft-grid">
              <label className={errors.registration ? "has-error" : ""}>
                <span>Matrícula *</span>
                <input
                  type="text"
                  value={values.registration}
                  onChange={(event) =>
                    updateField("registration", event.target.value.toUpperCase())
                  }
                  autoComplete="off"
                  disabled={submitting || !canCreate}
                />
                {errors.registration ? <small>{errors.registration}</small> : null}
              </label>

              <label className={errors.manufacturer ? "has-error" : ""}>
                <span>Fabricante *</span>
                <input
                  type="text"
                  value={values.manufacturer}
                  onChange={(event) => updateField("manufacturer", event.target.value)}
                  disabled={submitting || !canCreate}
                />
                {errors.manufacturer ? <small>{errors.manufacturer}</small> : null}
              </label>

              <label className={errors.model ? "has-error" : ""}>
                <span>Modelo *</span>
                <input
                  type="text"
                  value={values.model}
                  onChange={(event) => updateField("model", event.target.value)}
                  disabled={submitting || !canCreate}
                />
                {errors.model ? <small>{errors.model}</small> : null}
              </label>

              <label>
                <span>Número de serie</span>
                <input
                  type="text"
                  value={values.serialNumber}
                  onChange={(event) => updateField("serialNumber", event.target.value)}
                  disabled={submitting || !canCreate}
                />
              </label>

              <CountrySelector value={values.countryCode} onChange={(code) => updateField("countryCode", code)}
                disabled={submitting || !canCreate} error={errors.countryCode} />

              <label className={errors.openingTisHours ? "has-error" : ""}>
                <span>TIS inicial</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.1"
                  value={values.openingTisHours}
                  onChange={(event) => updateField("openingTisHours", event.target.value)}
                  placeholder="Desconocido"
                  disabled={submitting || !canCreate}
                />
                {errors.openingTisHours ? (
                  <small>{errors.openingTisHours}</small>
                ) : null}
              </label>

              <label
                className={`first-aircraft-date ${
                  errors.baselineEffectiveDate ? "has-error" : ""
                }`}
              >
                <span>Fecha base *</span>
                <input
                  type="date"
                  value={values.baselineEffectiveDate}
                  onChange={(event) =>
                    updateField("baselineEffectiveDate", event.target.value)
                  }
                  disabled={submitting || !canCreate}
                />
                {errors.baselineEffectiveDate ? (
                  <small>{errors.baselineEffectiveDate}</small>
                ) : null}
              </label>
            </div>

            {submitError ? (
              <p className="first-aircraft-error" role="alert">
                {submitError}
              </p>
            ) : null}

            <div className="first-aircraft-actions first-aircraft-form-actions">
              <button type="submit" className="login-button" disabled={submitting || !canCreate}>
                {submitting ? "Creando aeronave..." : "Crear aeronave"}
              </button>
              <button
                type="button"
                className="first-aircraft-secondary-button"
                onClick={() => {
                  if (embedded) { onCancel(); return; }
                  setShowForm(false);
                  setErrors({});
                  setSubmitError("");
                }}
                disabled={submitting}
              >
                {embedded ? "Cancelar" : "Volver"}
              </button>
            </div>
          </form>
        )}
      </section>
  );
  return embedded ? content : <main className="app-shell app-auth-shell">{content}</main>;
}
