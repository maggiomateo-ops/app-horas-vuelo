import { useRef, useState } from "react";

import {
  createOwnershipSubmissionGuard,
  getOwnershipSetupErrorMessage,
  removeOwnershipOwner,
  validateOwnershipOwners,
} from "../services/aircraftService";

let ownerSequence = 0;

function createOwner(kind = "CREATOR_PERSON") {
  ownerSequence += 1;
  return {
    id: `ownership-owner-${ownerSequence}`,
    kind,
    fullName: "",
    email: "",
    organizationName: "",
    countryCode: "",
    ownershipShare: kind === "CREATOR_PERSON" ? "100" : "",
  };
}

function OwnerFieldError({ message }) {
  return message ? <small className="ownership-field-error">{message}</small> : null;
}

export default function AircraftOwnershipOnboarding({
  ownershipConfigured,
  onComplete,
  onUnauthorized,
}) {
  const [showForm, setShowForm] = useState(false);
  const [owners, setOwners] = useState(() => [createOwner()]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const guardRef = useRef(null);

  if (!guardRef.current) guardRef.current = createOwnershipSubmissionGuard();

  const validation = validateOwnershipOwners(owners);
  const totalLabel = (validation.totalCents / 100).toFixed(2).replace(".", ",");

  const updateOwner = (index, field, value) => {
    setOwners((current) =>
      current.map((owner, ownerIndex) =>
        ownerIndex === index ? { ...owner, [field]: value } : owner
      )
    );
    setSubmitError("");
  };

  const handleRemove = (ownerId) => {
    setOwners((current) => removeOwnershipOwner(current, ownerId));
    setSubmitError("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!validation.valid || !guardRef.current.tryStart()) return;

    setSubmitting(true);
    setSubmitError("");
    try {
      await onComplete(owners);
    } catch (error) {
      if (error?.code === "UNAUTHORIZED" || error?.statusCode === 401) {
        onUnauthorized();
        return;
      }
      setSubmitError(getOwnershipSetupErrorMessage(error));
    } finally {
      setSubmitting(false);
      guardRef.current.finish();
    }
  };

  if (ownershipConfigured) {
    return (
      <section className="read-only-access" role="status">
        <p className="dashboard-eyebrow">Configuración inicial</p>
        <h2>Propiedad configurada</h2>
        <p>
          La propiedad legal ya existe, pero la aeronave todavía no está habilitada
          para registrar vuelos. Contactá a soporte para revisar su configuración.
        </p>
      </section>
    );
  }

  return (
    <section className="ownership-onboarding" aria-labelledby="ownership-title">
      <header className="ownership-onboarding-header">
        <p className="dashboard-eyebrow">Configuración inicial</p>
        <h2 id="ownership-title">Aeronave creada correctamente</h2>
        <p>
          Antes de registrar vuelos, configurá quiénes son los propietarios legales
          de la aeronave. Este dato es independiente del rol de acceso OWNER.
        </p>
      </header>

      {!showForm ? (
        <button
          type="button"
          className="form-action-button is-primary ownership-primary-action"
          onClick={() => setShowForm(true)}
        >
          Configurar propiedad
        </button>
      ) : (
        <form className="ownership-form" onSubmit={handleSubmit} noValidate>
          <div className="ownership-form-heading">
            <div>
              <span>Propietarios legales</span>
              <strong>Total: {totalLabel}%</strong>
            </div>
            <button
              type="button"
              className="form-action-button"
              onClick={() => setOwners((current) => [...current, createOwner("PERSON")])}
              disabled={submitting}
            >
              Agregar propietario
            </button>
          </div>

          <div className="ownership-owner-list">
            {owners.map((owner, index) => {
              const errors = validation.ownerErrors[index] || {};
              return (
                <fieldset className="ownership-owner-card" key={owner.id} disabled={submitting}>
                  <legend>Propietario {index + 1}</legend>

                  <label>
                    <span>Tipo de propietario</span>
                    <select
                      value={owner.kind}
                      onChange={(event) => updateOwner(index, "kind", event.target.value)}
                    >
                      <option value="CREATOR_PERSON">Yo</option>
                      <option value="PERSON">Otra persona</option>
                      <option value="ORGANIZATION">Empresa / organización</option>
                    </select>
                    <OwnerFieldError message={errors.kind} />
                  </label>

                  {owner.kind === "CREATOR_PERSON" ? (
                    <p className="ownership-owner-note">
                      Usaremos tu identidad verificada de la cuenta.
                    </p>
                  ) : owner.kind === "PERSON" ? (
                    <>
                      <label>
                        <span>Nombre completo *</span>
                        <input
                          type="text"
                          value={owner.fullName}
                          onChange={(event) => updateOwner(index, "fullName", event.target.value)}
                        />
                        <OwnerFieldError message={errors.fullName} />
                      </label>
                      <label>
                        <span>Email</span>
                        <input
                          type="email"
                          value={owner.email}
                          onChange={(event) => updateOwner(index, "email", event.target.value)}
                        />
                      </label>
                    </>
                  ) : (
                    <label className="ownership-field-wide">
                      <span>Nombre de organización *</span>
                      <input
                        type="text"
                        value={owner.organizationName}
                        onChange={(event) =>
                          updateOwner(index, "organizationName", event.target.value)
                        }
                      />
                      <OwnerFieldError message={errors.organizationName} />
                    </label>
                  )}

                  {owner.kind !== "CREATOR_PERSON" ? (
                    <label>
                      <span>País ISO-2</span>
                      <input
                        type="text"
                        maxLength={2}
                        value={owner.countryCode}
                        onChange={(event) =>
                          updateOwner(index, "countryCode", event.target.value.toUpperCase())
                        }
                        placeholder="AR"
                      />
                      <OwnerFieldError message={errors.countryCode} />
                    </label>
                  ) : null}

                  <label>
                    <span>Porcentaje *</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      max="100"
                      step="0.01"
                      value={owner.ownershipShare}
                      onChange={(event) =>
                        updateOwner(index, "ownershipShare", event.target.value)
                      }
                    />
                    <OwnerFieldError message={errors.ownershipShare} />
                  </label>

                  <button
                    type="button"
                    className="ownership-remove-button"
                    onClick={() => handleRemove(owner.id)}
                  >
                    Eliminar propietario
                  </button>
                </fieldset>
              );
            })}
          </div>

          {validation.formError ? (
            <p className="ownership-form-guidance">{validation.formError}</p>
          ) : null}
          {submitError ? (
            <p className="flight-form-message is-error" role="alert">{submitError}</p>
          ) : null}

          <div className="ownership-submit-actions">
            <button
              type="submit"
              className="form-action-button is-primary"
              disabled={submitting || !validation.valid}
            >
              {submitting ? "Guardando propiedad..." : "Confirmar propiedad"}
            </button>
            <button
              type="button"
              className="form-action-button"
              onClick={() => setShowForm(false)}
              disabled={submitting}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
