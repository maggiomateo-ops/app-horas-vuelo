import { useMemo, useState } from "react";

import { getComponentLifecycleErrorMessage } from "../services/aircraftService";

function componentLabel(componentType, positionIndex) {
  return `${componentType === "ENGINE" ? "Motor" : "Hélice"} ${positionIndex}`;
}

function emptyValues() {
  return {
    effectiveDate: "",
    manufacturer: "",
    model: "",
    serialNumber: "",
    notes: "",
    openingTisHours: "",
  };
}

function identityText(installation) {
  return [installation?.manufacturer, installation?.model, installation?.serialNumber]
    .filter(Boolean)
    .join(" · ") || "Identidad física desconocida";
}

export default function AircraftComponentLifecyclePanel({
  configuration,
  activeInstallations = [],
  installationHistory = [],
  canManage,
  onMutate,
  onUnauthorized,
}) {
  const [pendingAction, setPendingAction] = useState(null);
  const [values, setValues] = useState(emptyValues);
  const [reviewing, setReviewing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const positions = useMemo(() => [
    ...Array.from({ length: Number(configuration?.engineCount || 0) }, (_, index) => ({
      componentType: "ENGINE",
      positionIndex: index + 1,
    })),
    ...Array.from({ length: Number(configuration?.propellerCount || 0) }, (_, index) => ({
      componentType: "PROPELLER",
      positionIndex: index + 1,
    })),
  ], [configuration?.engineCount, configuration?.propellerCount]);

  const openAction = (kind, position, installation = null) => {
    setPendingAction({ kind, position, installation });
    setValues(emptyValues());
    setReviewing(false);
    setMessage("");
    setError("");
  };

  const closeAction = () => {
    if (submitting) return;
    setPendingAction(null);
    setReviewing(false);
    setError("");
  };

  const handleReview = (event) => {
    event.preventDefault();
    setError("");
    if (!values.effectiveDate) {
      setError("Seleccioná una fecha efectiva.");
      return;
    }
    const openingTis = String(values.openingTisHours).trim();
    if (openingTis && (!Number.isFinite(Number(openingTis)) || Number(openingTis) < 0)) {
      setError("El TIS inicial debe ser un número mayor o igual a cero.");
      return;
    }
    setReviewing(true);
  };

  const handleConfirm = async () => {
    if (!pendingAction || submitting) return;
    const { kind, position, installation } = pendingAction;
    let action;
    let payload;
    if (kind === "install") {
      action = "install-component";
      payload = {
        componentType: position.componentType,
        positionIndex: position.positionIndex,
        installedOn: values.effectiveDate,
        manufacturer: values.manufacturer || null,
        model: values.model || null,
        serialNumber: values.serialNumber || null,
        notes: values.notes || null,
        openingTisHours: values.openingTisHours === ""
          ? null
          : Number(values.openingTisHours),
      };
    } else if (kind === "remove") {
      action = "remove-component";
      payload = {
        componentInstallationId: installation.componentInstallationId,
        removedOn: values.effectiveDate,
      };
    } else {
      action = "replace-component";
      payload = {
        oldComponentInstallationId: installation.componentInstallationId,
        effectiveDate: values.effectiveDate,
        newComponent: {
          manufacturer: values.manufacturer || null,
          model: values.model || null,
          serialNumber: values.serialNumber || null,
          notes: values.notes || null,
          openingTisHours: values.openingTisHours === ""
            ? null
            : Number(values.openingTisHours),
        },
      };
    }

    try {
      setSubmitting(true);
      setError("");
      await onMutate(action, payload);
      setPendingAction(null);
      setReviewing(false);
      setMessage(
        kind === "install"
          ? "Componente instalado correctamente."
          : kind === "remove"
            ? "Componente removido correctamente."
            : "Componente reemplazado correctamente."
      );
    } catch (mutationError) {
      if (mutationError?.statusCode === 401 || mutationError?.code === "UNAUTHORIZED") {
        onUnauthorized?.();
        return;
      }
      setError(getComponentLifecycleErrorMessage(mutationError));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="aircraft-component-lifecycle" aria-labelledby="component-lifecycle-title">
      <header>
        <h3 id="component-lifecycle-title">Componentes por posición</h3>
        <p>La identidad física se conserva por instalación y no se edita en el historial.</p>
      </header>

      {message ? <p className="flight-form-message is-success" role="status">{message}</p> : null}

      <div className="aircraft-position-list">
        {positions.map((position) => {
          const current = activeInstallations.find(
            (installation) => installation.componentType === position.componentType
              && Number(installation.positionIndex) === position.positionIndex
          );
          const previous = installationHistory.filter(
            (installation) => installation.componentType === position.componentType
              && Number(installation.positionIndex) === position.positionIndex
              && installation.removedOn
          );
          return (
            <article
              key={`${position.componentType}:${position.positionIndex}`}
              className="aircraft-position-card"
            >
              <div className="aircraft-position-heading">
                <div>
                  <strong>{componentLabel(position.componentType, position.positionIndex)}</strong>
                  <span>{current ? "Instalado" : "Posición vacía"}</span>
                </div>
                {canManage ? current ? (
                  <div className="aircraft-position-actions">
                    <button type="button" onClick={() => openAction("replace", position, current)}>
                      Reemplazar
                    </button>
                    <button type="button" onClick={() => openAction("remove", position, current)}>
                      Remover
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => openAction("install", position)}>
                    Instalar componente
                  </button>
                ) : null}
              </div>

              {current ? (
                <div className="aircraft-position-current">
                  <span>{identityText(current)}</span>
                  <small>
                    Instalado: {current.installedOn || "Desconocido"} · TIS inicial: {current.openingTisHours ?? "Desconocido"}
                  </small>
                </div>
              ) : null}

              {previous.length > 0 ? (
                <details className="aircraft-position-history">
                  <summary>Historial anterior ({previous.length})</summary>
                  {previous.map((installation) => (
                    <div key={installation.componentInstallationId}>
                      <span>{identityText(installation)}</span>
                      <small>
                        {installation.installedOn || "Fecha inicial desconocida"} → {installation.removedOn}
                      </small>
                    </div>
                  ))}
                </details>
              ) : null}
            </article>
          );
        })}
      </div>

      {pendingAction ? (
        <form className="aircraft-lifecycle-form" onSubmit={handleReview} noValidate>
          <div className="aircraft-lifecycle-form-heading">
            <div>
              <strong>
                {pendingAction.kind === "install"
                  ? "Instalar"
                  : pendingAction.kind === "remove"
                    ? "Remover"
                    : "Reemplazar"} {componentLabel(
                      pendingAction.position.componentType,
                      pendingAction.position.positionIndex
                    )}
              </strong>
              <p>Los campos de identidad física pueden quedar vacíos.</p>
            </div>
            <button type="button" onClick={closeAction} disabled={submitting}>Cancelar</button>
          </div>

          <div className="aircraft-configuration-grid">
            <label>
              <span>{pendingAction.kind === "remove" ? "Fecha de remoción" : "Fecha efectiva"} *</span>
              <input
                type="date"
                value={values.effectiveDate}
                onChange={(event) => {
                  setValues((current) => ({ ...current, effectiveDate: event.target.value }));
                  setReviewing(false);
                }}
                disabled={submitting}
              />
            </label>
            {pendingAction.kind !== "remove" ? (
              <>
                <label><span>Fabricante</span><input value={values.manufacturer} onChange={(event) => setValues((current) => ({ ...current, manufacturer: event.target.value }))} disabled={submitting} /></label>
                <label><span>Modelo</span><input value={values.model} onChange={(event) => setValues((current) => ({ ...current, model: event.target.value }))} disabled={submitting} /></label>
                <label><span>Número de serie</span><input value={values.serialNumber} onChange={(event) => setValues((current) => ({ ...current, serialNumber: event.target.value }))} disabled={submitting} /></label>
                <label><span>TIS inicial</span><input type="number" min="0" step="0.1" value={values.openingTisHours} onChange={(event) => setValues((current) => ({ ...current, openingTisHours: event.target.value }))} disabled={submitting} placeholder="Desconocido" /></label>
                <label className="aircraft-lifecycle-notes"><span>Notas</span><textarea value={values.notes} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} disabled={submitting} /></label>
              </>
            ) : null}
          </div>

          {reviewing ? (
            <div className="aircraft-configuration-confirmation" role="status">
              <strong>Confirmá esta operación</strong>
              <p>
                {pendingAction.kind === "remove"
                  ? "La instalación actual se cerrará sin alterar vuelos históricos."
                  : pendingAction.kind === "replace"
                    ? "La instalación actual se cerrará y se creará un componente físico nuevo."
                    : "Se creará un componente físico nuevo en esta posición."}
              </p>
              <button type="button" className="form-action-button is-primary" onClick={handleConfirm} disabled={submitting}>
                {submitting ? "Guardando..." : "Confirmar operación"}
              </button>
            </div>
          ) : (
            <button type="submit" className="form-action-button is-primary" disabled={submitting}>
              Revisar operación
            </button>
          )}
          {error ? <p className="flight-form-message is-error" role="alert">{error}</p> : null}
        </form>
      ) : null}
    </section>
  );
}
