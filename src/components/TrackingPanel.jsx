import { useCallback, useEffect, useRef, useState } from "react";

import {
  archiveTrackingItem,
  completeTrackingItem,
  createTrackingItem,
  fetchTrackingItems,
  updateTrackingItem,
} from "../services/trackingService";

const EMPTY_FORM = Object.freeze({
  concept: "",
  due_basis: "DATE",
  recurrence: "ONE_TIME",
  reference_mode: "ABSOLUTE_TIS",
  due_date: "",
  reference_tis_hours: "",
  interval_hours: "",
  alert_before_value: "30",
  notes: "",
});

const STATUS_LABELS = {
  OK: "En seguimiento",
  DUE_SOON: "Próximo",
  DUE: "Vence hoy / alcanzado",
  OVERDUE: "Vencido / superado",
  UNAVAILABLE: "Sin cálculo disponible",
};

function formFromItem(item) {
  return {
    concept: item.concept || "",
    due_basis: item.due_basis || "DATE",
    recurrence: item.recurrence || "ONE_TIME",
    reference_mode: item.reference_mode || "ABSOLUTE_TIS",
    due_date: item.due_date || "",
    reference_tis_hours: item.reference_tis_hours ?? "",
    interval_hours: item.interval_hours ?? "",
    alert_before_value: item.alert_before_value ?? "",
    notes: item.notes || "",
  };
}

function remainingLabel(item) {
  const value = item.derived?.remaining_value;
  if (value === null || value === undefined) return "No disponible";
  if (item.derived?.remaining_unit === "DAYS") {
    const absolute = Math.abs(value);
    return value < 0 ? `${absolute} días transcurridos` : `${value} días restantes`;
  }
  const absolute = Math.abs(value);
  return value < 0 ? `${absolute.toFixed(1)} h superadas` : `${value.toFixed(1)} h restantes`;
}

function dueLabel(item) {
  if (item.due_basis === "DATE") return item.due_date || "—";
  if (item.reference_mode === "ABSOLUTE_TIS") {
    const due = item.derived?.due_value;
    return due === null || due === undefined ? "TIS no disponible" : `${due.toFixed(1)} h TIS`;
  }
  const elapsed = item.derived?.elapsed_hours ?? 0;
  return `${elapsed.toFixed(1)} / ${Number(item.interval_hours || 0).toFixed(1)} h seguidas`;
}

function TrackingForm({ initialItem, saving, onCancel, onSubmit }) {
  const [values, setValues] = useState(() => initialItem
    ? formFromItem(initialItem)
    : { ...EMPTY_FORM });
  const legacySettingsManaged = initialItem?.legacy_settings_managed === true;

  const setField = (field, value) => {
    setValues((current) => {
      const next = { ...current, [field]: value };
      if (field === "due_basis") {
        next.alert_before_value = value === "DATE" ? "30" : "10";
      }
      return next;
    });
  };

  return (
    <form className="tracking-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit(values);
    }}>
      <header>
        <div>
          <p className="dashboard-eyebrow">Recordatorio del propietario</p>
          <h3>{initialItem ? "Editar recordatorio" : "Nuevo recordatorio"}</h3>
        </div>
        <button type="button" className="tracking-text-button" onClick={onCancel} disabled={saving}>
          Cerrar
        </button>
      </header>

      <div className="tracking-form-grid">
        <label className="tracking-field tracking-field-wide">
          <span>Concepto *</span>
          <input
            value={values.concept}
            onChange={(event) => setField("concept", event.target.value)}
            maxLength={160}
            required
            disabled={saving || legacySettingsManaged}
          />
        </label>
        <label className="tracking-field">
          <span>Base *</span>
          <select
            value={values.due_basis}
            onChange={(event) => setField("due_basis", event.target.value)}
            disabled={saving || legacySettingsManaged}
          >
            <option value="DATE">Fecha</option>
            <option value="TIME_IN_SERVICE">Tiempo en servicio</option>
          </select>
        </label>
        <label className="tracking-field">
          <span>Recurrencia *</span>
          <select
            value={values.recurrence}
            onChange={(event) => setField("recurrence", event.target.value)}
            disabled={saving || legacySettingsManaged}
          >
            <option value="ONE_TIME">Una vez</option>
            <option value="RECURRING">Recurrente</option>
          </select>
        </label>

        {values.due_basis === "DATE" ? (
          <label className="tracking-field">
            <span>Fecha objetivo *</span>
            <input
              type="date"
              value={values.due_date}
              onChange={(event) => setField("due_date", event.target.value)}
              required
              disabled={saving}
            />
          </label>
        ) : (
          <>
            <label className="tracking-field">
              <span>Referencia *</span>
              <select
                value={values.reference_mode}
                onChange={(event) => setField("reference_mode", event.target.value)}
                disabled={saving || legacySettingsManaged}
              >
                <option value="ABSOLUTE_TIS">TIS absoluto</option>
                <option value="TRACKED_FROM_NOW">Seguir desde ahora</option>
              </select>
            </label>
            {values.reference_mode === "ABSOLUTE_TIS" ? (
              <label className="tracking-field">
                <span>TIS de referencia *</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={values.reference_tis_hours}
                  onChange={(event) => setField("reference_tis_hours", event.target.value)}
                  required
                  disabled={saving}
                />
              </label>
            ) : null}
            <label className="tracking-field">
              <span>Intervalo (h) *</span>
              <input
                type="number"
                min="0.1"
                step="0.1"
                value={values.interval_hours}
                onChange={(event) => setField("interval_hours", event.target.value)}
                required
                disabled={saving || legacySettingsManaged}
              />
            </label>
          </>
        )}

        <label className="tracking-field">
          <span>Avisar antes ({values.due_basis === "DATE" ? "días" : "horas"}) *</span>
          <input
            type="number"
            min="0"
            step="0.1"
            value={values.alert_before_value}
            onChange={(event) => setField("alert_before_value", event.target.value)}
            required
            disabled={saving}
          />
        </label>
        {!legacySettingsManaged ? (
          <label className="tracking-field tracking-field-wide">
            <span>Notas</span>
            <textarea
              value={values.notes}
              onChange={(event) => setField("notes", event.target.value)}
              maxLength={2000}
              disabled={saving}
            />
          </label>
        ) : null}
      </div>

      {legacySettingsManaged ? (
        <p className="tracking-form-note">
          Este recordatorio también alimenta Settings. Su concepto, base, recurrencia y
          período y notas de migración permanecen vinculados a esa configuración.
        </p>
      ) : null}

      <div className="tracking-form-actions">
        <button type="submit" className="form-action-button is-primary" disabled={saving}>
          {saving ? "Guardando..." : initialItem ? "Guardar cambios" : "Crear recordatorio"}
        </button>
        <button type="button" className="form-action-button" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function CompletionForm({ item, saving, onCancel, onSubmit }) {
  const [note, setNote] = useState("");
  const [nextDueDate, setNextDueDate] = useState("");
  const requiresNextDate = item.recurrence === "RECURRING" && item.due_basis === "DATE";

  return (
    <form className="tracking-completion-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit({ note, next_due_date: nextDueDate });
    }}>
      <h4>Marcar “{item.concept}” como atendido</h4>
      <p>
        Esta acción registra un evento histórico del propietario y no acredita
        tareas técnicas.
      </p>
      {requiresNextDate ? (
        <label className="tracking-field">
          <span>Próxima fecha *</span>
          <input
            type="date"
            value={nextDueDate}
            onChange={(event) => setNextDueDate(event.target.value)}
            required
            disabled={saving}
          />
        </label>
      ) : null}
      <label className="tracking-field">
        <span>Nota opcional</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={2000}
          disabled={saving}
        />
      </label>
      <div className="tracking-form-actions">
        <button type="submit" className="form-action-button is-primary" disabled={saving}>
          {saving ? "Registrando..." : "Confirmar atendido"}
        </button>
        <button type="button" className="form-action-button" onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function TrackingPanel({ aircraftId, aircraftRegistration, onUnauthorized }) {
  const [tracking, setTracking] = useState(null);
  const [statusFilter, setStatusFilter] = useState("ACTIVE");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingItem, setEditingItem] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [completingItem, setCompletingItem] = useState(null);
  const [saving, setSaving] = useState(false);
  const mutationInFlight = useRef(false);

  const loadTracking = useCallback(async (signal) => {
    try {
      setLoading(true);
      setError("");
      const nextTracking = await fetchTrackingItems(aircraftId, statusFilter, signal);
      setTracking(nextTracking);
      return true;
    } catch (requestError) {
      if (requestError.name === "AbortError") return;
      if (requestError.code === "UNAUTHORIZED" || requestError.message === "UNAUTHORIZED") {
        onUnauthorized?.();
        return false;
      }
      setError(requestError.message || "No se pudieron cargar los recordatorios.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [aircraftId, onUnauthorized, statusFilter]);

  useEffect(() => {
    const controller = new AbortController();
    setTracking(null);
    setMessage("");
    setShowForm(false);
    setEditingItem(null);
    setCompletingItem(null);
    void loadTracking(controller.signal);
    return () => controller.abort();
  }, [loadTracking]);

  const reloadAfterMutation = async (successMessage) => {
    const reloaded = await loadTracking();
    if (reloaded) setMessage(successMessage);
  };

  const runMutation = async (work, successMessage) => {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    try {
      setSaving(true);
      setError("");
      setMessage("");
      await work();
      setShowForm(false);
      setEditingItem(null);
      setCompletingItem(null);
      await reloadAfterMutation(successMessage);
    } catch (mutationError) {
      if (mutationError.code === "UNAUTHORIZED" || mutationError.message === "UNAUTHORIZED") {
        onUnauthorized?.();
        return;
      }
      setError(mutationError.message || "No se pudo completar la acción.");
    } finally {
      mutationInFlight.current = false;
      setSaving(false);
    }
  };

  const items = tracking?.items || [];
  const canManage = tracking?.canManage === true;

  return (
    <section className="tracking-panel">
      <header className="tracking-panel-header">
        <div>
          <p className="dashboard-eyebrow">Seguimiento del propietario</p>
          <h1>Recordatorios · {aircraftRegistration}</h1>
          <p>
            Alertas personales por fecha o tiempo en servicio. Son recordatorios del
            propietario y no reemplazan la evaluación de un profesional habilitado.
          </p>
        </div>
        {canManage ? (
          <button
            type="button"
            className="form-action-button is-primary"
            onClick={() => {
              setEditingItem(null);
              setShowForm(true);
              setCompletingItem(null);
            }}
            disabled={saving}
          >
            Nuevo recordatorio
          </button>
        ) : null}
      </header>

      <div className="tracking-toolbar" role="tablist" aria-label="Estado de recordatorios">
        {[
          ["ACTIVE", "Activos"],
          ["ARCHIVED", "Archivados"],
          ["ALL", "Todos"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={statusFilter === value}
            className={statusFilter === value ? "is-active" : ""}
            onClick={() => setStatusFilter(value)}
          >
            {label}
          </button>
        ))}
        <span>
          TIS actual: {tracking?.currentTisHours === null || tracking?.currentTisHours === undefined
            ? "no disponible"
            : `${Number(tracking.currentTisHours).toFixed(1)} h`}
        </span>
      </div>

      {message ? <p className="tracking-message" role="status">{message}</p> : null}
      {error ? <p className="dashboard-status dashboard-status-error" role="alert">{error}</p> : null}

      {showForm && canManage ? (
        <TrackingForm
          key={editingItem?.tracking_item_id || "new"}
          initialItem={editingItem}
          saving={saving}
          onCancel={() => {
            setShowForm(false);
            setEditingItem(null);
          }}
          onSubmit={(values) => runMutation(
            () => editingItem
              ? updateTrackingItem(aircraftId, editingItem.tracking_item_id, values)
              : createTrackingItem(aircraftId, values),
            editingItem
              ? "Recordatorio actualizado correctamente."
              : "Recordatorio creado correctamente."
          )}
        />
      ) : null}

      {completingItem && canManage ? (
        <CompletionForm
          key={completingItem.tracking_item_id}
          item={completingItem}
          saving={saving}
          onCancel={() => setCompletingItem(null)}
          onSubmit={(values) => runMutation(
            () => completeTrackingItem(
              aircraftId,
              completingItem.tracking_item_id,
              values
            ),
            "El recordatorio fue marcado como atendido."
          )}
        />
      ) : null}

      {loading ? <p className="dashboard-status">Cargando recordatorios...</p> : null}
      {!loading && !items.length ? (
        <div className="tracking-empty">
          <strong>No hay recordatorios {statusFilter === "ARCHIVED" ? "archivados" : "para mostrar"}.</strong>
          <p>Los recordatorios que defina el Owner aparecerán en esta sección.</p>
        </div>
      ) : null}

      {!loading && items.length ? (
        <div className="tracking-card-grid">
          {items.map((item) => {
            const state = item.derived?.due_state || "UNAVAILABLE";
            return (
              <article
                key={item.tracking_item_id}
                className={`tracking-card tracking-state-${state.toLowerCase().replace("_", "-")}`}
              >
                <header>
                  <div>
                    <span className="tracking-basis">
                      {item.due_basis === "DATE" ? "Fecha" : "Tiempo en servicio"}
                    </span>
                    <h2>{item.concept}</h2>
                  </div>
                  <span className="tracking-state-label">{STATUS_LABELS[state]}</span>
                </header>
                <div className="tracking-card-values">
                  <div>
                    <span>Objetivo</span>
                    <strong>{dueLabel(item)}</strong>
                  </div>
                  <div>
                    <span>Estado derivado</span>
                    <strong>{remainingLabel(item)}</strong>
                  </div>
                  <div>
                    <span>Recurrencia</span>
                    <strong>{item.recurrence === "RECURRING" ? "Recurrente" : "Una vez"}</strong>
                  </div>
                  <div>
                    <span>Aviso previo</span>
                    <strong>
                      {item.alert_before_value} {item.due_basis === "DATE" ? "días" : "h"}
                    </strong>
                  </div>
                </div>
                {item.notes && !item.legacy_settings_managed
                  ? <p className="tracking-notes">{item.notes}</p>
                  : null}
                {canManage && item.status === "ACTIVE" ? (
                  <div className="tracking-card-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setCompletingItem(item);
                        setShowForm(false);
                      }}
                      disabled={saving}
                    >
                      Marcar atendido
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingItem(item);
                        setShowForm(true);
                        setCompletingItem(null);
                      }}
                      disabled={saving}
                    >
                      Editar
                    </button>
                    {!item.legacy_settings_managed ? (
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => {
                          if (!window.confirm(`¿Archivar “${item.concept}”?`)) return;
                          void runMutation(
                            () => archiveTrackingItem(aircraftId, item.tracking_item_id),
                            "Recordatorio archivado correctamente."
                          );
                        }}
                        disabled={saving}
                      >
                        Archivar
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <details className="tracking-history">
                  <summary>Historial ({item.events.length})</summary>
                  {item.events.length ? (
                    <ol>
                      {item.events.map((event) => (
                        <li key={event.tracking_event_id}>
                          <strong>Marcado atendido</strong>
                          <span>{new Date(event.completed_at).toLocaleString("es-AR")}</span>
                          {event.completed_at_tis !== null
                            ? <span>TIS: {event.completed_at_tis.toFixed(1)} h</span>
                            : null}
                          {event.next_due_date ? <span>Próxima fecha: {event.next_due_date}</span> : null}
                          {event.note ? <p>{event.note}</p> : null}
                        </li>
                      ))}
                    </ol>
                  ) : <p>Sin eventos de finalización.</p>}
                </details>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

export default TrackingPanel;
