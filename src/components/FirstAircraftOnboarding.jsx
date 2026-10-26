import { HoursStartChoice } from './HoursStartChoice';
import { hoursStartNextAction, isHoursStartMode } from '../utils/hoursStart';
import CountrySelector from './CountrySelector';
import { useState } from "react";

const EMPTY_FORM = Object.freeze({
  registration: "",
  manufacturer: "",
  model: "",
  serialNumber: "",
  countryCode: "",
});

function validateForm(values) {
  const errors = {};

  if (!values.registration.trim()) errors.registration = "Ingresá la matrícula.";
  if (!values.manufacturer.trim()) errors.manufacturer = "Ingresá el fabricante.";
  if (!values.model.trim()) errors.model = "Ingresá el modelo.";
  if (values.countryCode && !/^[A-Z]{2}$/.test(values.countryCode)) {
    errors.countryCode = "Usá un código ISO de dos letras.";
  }

  return errors;
}

export default function FirstAircraftOnboarding({
  onLogout,
  onCancel,
  canCreate = false,
  embedded = false,
  titleId,
}) {
  const [showForm, setShowForm] = useState(embedded);
  const [values, setValues] = useState(EMPTY_FORM);
  const [hoursStartMode, setHoursStartMode] = useState("");
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const submitting = false;

  const updateField = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      return { ...current, [field]: "" };
    });
    setSubmitError("");
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!canCreate) return;
    if (!isHoursStartMode(hoursStartMode)) {
      setErrors({ hoursStartMode: "Elegí una opción para continuar." });
      return;
    }
    const identityErrors = validateForm(values);
    setErrors(identityErrors);
    if (Object.keys(identityErrors).length) return;
    setSubmitError("El nuevo inicio de seguimiento está pendiente de habilitación. No se guardaron datos.");
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

            <HoursStartChoice value={hoursStartMode} onChange={(mode) => { setHoursStartMode(mode); setErrors({}); setSubmitError(""); }}
              disabled={!canCreate} error={errors.hoursStartMode} />
            {hoursStartMode ? <p className="first-aircraft-copy" role="status">{hoursStartNextAction(hoursStartMode)} El nuevo flujo está en preparación; no se guardarán datos.</p> : null}
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
            </div>

            {submitError ? (
              <p className="first-aircraft-error" role="alert">
                {submitError}
              </p>
            ) : null}

            <div className="first-aircraft-actions first-aircraft-form-actions">
              <button type="submit" className="login-button" disabled={submitting || !canCreate}>
                Preparar inicio
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
