import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  addSquawkComment,
  changeSquawkStatus,
  createSquawk,
  fetchSquawks,
  updateSquawk,
} from "../services/squawkService";
import {
  getSquawkSummary,
  selectSquawks,
  SQUAWK_CATEGORY_LABELS,
  SQUAWK_STATUS_LABELS,
} from "../utils/squawkPresentation";

const EMPTY_FORM = Object.freeze({ reported_at: "", title: "", description: "", category: "", flight_id: "" });

function localDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function SquawkForm({ initial, flights, saving, onCancel, onSubmit }) {
  const [values, setValues] = useState(() => initial ? {
    reported_at: localDateTime(initial.reported_at), title: initial.title || "",
    description: initial.description || "", category: initial.category || "",
    flight_id: initial.flight_id || "",
  } : { ...EMPTY_FORM, reported_at: localDateTime(new Date().toISOString()) });
  return (
    <form className="squawk-form" onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
      <header><div><p className="dashboard-eyebrow">Registro operativo</p><h3>{initial ? "Editar novedad" : "Reportar novedad"}</h3></div></header>
      <div className="tracking-form-grid">
        <label className="tracking-field"><span>Fecha y hora *</span><input type="datetime-local" required value={values.reported_at} onChange={(e) => setValues({ ...values, reported_at: e.target.value })} disabled={saving} /></label>
        <label className="tracking-field"><span>Categoría</span><select value={values.category} onChange={(e) => setValues({ ...values, category: e.target.value })} disabled={saving}><option value="">Sin categoría</option>{Object.entries(SQUAWK_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="tracking-field tracking-field-wide"><span>Título *</span><input required maxLength={200} value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} disabled={saving} /></label>
        <label className="tracking-field tracking-field-wide"><span>Descripción *</span><textarea required maxLength={5000} value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} disabled={saving} /></label>
        <label className="tracking-field tracking-field-wide"><span>Vuelo relacionado (opcional)</span><select value={values.flight_id} onChange={(e) => setValues({ ...values, flight_id: e.target.value })} disabled={saving}><option value="">Sin vuelo relacionado</option>{flights.map((flight) => <option key={flight.flight_id} value={flight.flight_id}>{flight.flight_date} · {flight.departure_location} → {flight.arrival_location}{flight.status === "VOIDED" ? " · Anulado" : ""} · {String(flight.flight_id).slice(0, 8)}</option>)}</select></label>
      </div>
      <p className="tracking-form-note">Esta novedad registra una observación operativa y no determina por sí sola ninguna condición técnica.</p>
      <div className="tracking-form-actions"><button className="form-action-button is-primary" disabled={saving}>{saving ? "Guardando..." : initial ? "Guardar cambios" : "Reportar novedad"}</button><button type="button" className="form-action-button" onClick={onCancel} disabled={saving}>Cancelar</button></div>
    </form>
  );
}

function TransitionForm({ target, saving, onCancel, onSubmit }) {
  const [values, setValues] = useState({ transition_note: "", workshop_name: "", workshop_contact: "", resolution_note: "" });
  return <form className="squawk-inline-form" onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
    <h4>Cambiar a {SQUAWK_STATUS_LABELS[target]}</h4>
    {target === "SENT_TO_WORKSHOP" ? <><label className="tracking-field"><span>Taller</span><input value={values.workshop_name} onChange={(e) => setValues({ ...values, workshop_name: e.target.value })} /></label><label className="tracking-field"><span>Contacto</span><input value={values.workshop_contact} onChange={(e) => setValues({ ...values, workshop_contact: e.target.value })} /></label></> : null}
    {target === "RESOLVED" ? <label className="tracking-field"><span>Nota de resolución *</span><textarea required value={values.resolution_note} onChange={(e) => setValues({ ...values, resolution_note: e.target.value })} /></label> : <label className="tracking-field"><span>Nota opcional</span><textarea value={values.transition_note} onChange={(e) => setValues({ ...values, transition_note: e.target.value })} /></label>}
    <div className="tracking-form-actions"><button className="form-action-button is-primary" disabled={saving}>Confirmar</button><button type="button" className="form-action-button" onClick={onCancel}>Cancelar</button></div>
  </form>;
}

export default function SquawksPanel({ aircraftId, aircraftRegistration, onUnauthorized }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [category, setCategory] = useState("ALL");
  const [order, setOrder] = useState("NEWEST");
  const [expanded, setExpanded] = useState(new Set());
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [transition, setTransition] = useState(null);
  const [comment, setComment] = useState("");
  const mutation = useRef(false);

  const load = useCallback(async (signal) => {
    try { setLoading(true); setError(""); setData(await fetchSquawks(aircraftId, signal)); return true; }
    catch (requestError) {
      if (requestError.name === "AbortError") return false;
      if (requestError.code === "UNAUTHORIZED") { onUnauthorized?.(); return false; }
      setError(requestError.message || "No se pudieron cargar las novedades."); return false;
    } finally { setLoading(false); }
  }, [aircraftId, onUnauthorized]);

  useEffect(() => { const controller = new AbortController(); setData(null); setExpanded(new Set()); setShowForm(false); void load(controller.signal); return () => controller.abort(); }, [load]);

  const run = async (work, success) => {
    if (mutation.current) return;
    mutation.current = true; setSaving(true); setError(""); setMessage("");
    try { await work(); setShowForm(false); setEditing(null); setTransition(null); setComment(""); if (await load()) setMessage(success); }
    catch (actionError) { if (actionError.code === "UNAUTHORIZED") onUnauthorized?.(); else setError(actionError.message || "No se pudo completar la acción."); }
    finally { mutation.current = false; setSaving(false); }
  };

  const items = useMemo(() => data?.items || [], [data?.items]);
  const summary = useMemo(() => getSquawkSummary(items), [items]);
  const selected = useMemo(() => selectSquawks(items, { query, status, category, order }), [items, query, status, category, order]);
  const canWrite = data?.writes_enabled === true;
  const canCreate = canWrite && data?.capabilities?.can_create === true;

  return <section className="squawk-panel">
    <header className="tracking-panel-header"><div><p className="dashboard-eyebrow">Seguimiento operativo</p><h1>Novedades · {aircraftRegistration}</h1><p>Observaciones reportadas por la tripulación y el propietario, con su conversación y estado.</p></div>{canCreate ? <button type="button" className="form-action-button is-primary" onClick={() => { setEditing(null); setShowForm(true); }}>Reportar novedad</button> : null}</header>
    {!canWrite ? <p className="tracking-form-note">La gestión de novedades está temporalmente deshabilitada. La consulta permanece disponible.</p> : null}
    <div className="squawk-summary">{[["OPEN","Abiertas",summary.open],["SENT_TO_WORKSHOP","En taller",summary.workshop],["RESOLVED","Resueltas",summary.resolved],["ALL","Total",summary.total]].map(([value,label,count]) => <button key={value} type="button" className={status === value ? "is-active" : ""} onClick={() => setStatus(value)}><strong>{count}</strong><span>{label}</span></button>)}</div>
    <div className="squawk-controls"><label className="tracking-search"><span>Buscar</span><input type="search" placeholder="Título o descripción" value={query} onChange={(e) => setQuery(e.target.value)} /></label><label className="tracking-sort"><span>Categoría</span><select value={category} onChange={(e) => setCategory(e.target.value)}><option value="ALL">Todas</option>{Object.entries(SQUAWK_CATEGORY_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="tracking-sort"><span>Orden</span><select value={order} onChange={(e) => setOrder(e.target.value)}><option value="NEWEST">Más recientes</option><option value="OLDEST">Más antiguas</option></select></label></div>
    <p className="tracking-result-count">{selected.length} de {items.length} novedades</p>
    {message ? <p className="tracking-message" role="status">{message}</p> : null}{error ? <p className="dashboard-status dashboard-status-error" role="alert">{error}</p> : null}
    {showForm && canCreate ? <SquawkForm key={editing?.squawk_id || "new"} initial={editing} flights={data?.flights || []} saving={saving} onCancel={() => { setShowForm(false); setEditing(null); }} onSubmit={(values) => run(() => editing ? updateSquawk(aircraftId, editing.squawk_id, values) : createSquawk(aircraftId, values), editing ? "Novedad actualizada." : "Novedad reportada.")} /> : null}
    {loading ? <p className="dashboard-status">Cargando novedades...</p> : null}
    {!loading && !selected.length ? <div className="tracking-empty"><strong>No hay novedades que coincidan con la vista.</strong></div> : null}
    <div className="squawk-list"><div className="squawk-list-head"><span>Novedad</span><span>Categoría</span><span>Reportada</span><span>Estado</span><span /></div>{selected.map((item) => { const open = expanded.has(item.squawk_id); return <article className={`squawk-row${open ? " is-expanded" : ""}`} key={item.squawk_id}><button type="button" className="squawk-row-summary" aria-expanded={open} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(item.squawk_id)) next.delete(item.squawk_id); else next.add(item.squawk_id); return next; })}><span><strong>{item.title}</strong><small>{item.reporter_name}</small></span><span data-label="Categoría">{SQUAWK_CATEGORY_LABELS[item.category] || "Sin categoría"}</span><time dateTime={item.reported_at}>{new Date(item.reported_at).toLocaleString("es-AR")}</time><span className={`squawk-status is-${String(item.status).toLowerCase()}`}>{SQUAWK_STATUS_LABELS[item.status]}</span><span>{open ? "−" : "+"}</span></button>{open ? <div className="squawk-row-detail"><p className="squawk-description">{item.description}</p>{item.flight_id ? <p className="squawk-flight"><strong>Vuelo relacionado:</strong> {item.flight_date} · {item.departure_location} → {item.arrival_location}{item.flight_status === "VOIDED" ? " · Anulado" : ""} · {String(item.flight_id).slice(0,8)}</p> : null}<section className="squawk-timeline"><h3>Timeline</h3><ol>{item.timeline.map((entry) => <li key={entry.timeline_id}><time>{new Date(entry.occurred_at).toLocaleString("es-AR")}</time><strong>{entry.type === "CREATED" ? "Novedad reportada" : entry.type === "COMMENT" ? "Comentario" : `${SQUAWK_STATUS_LABELS[entry.from_status]} → ${SQUAWK_STATUS_LABELS[entry.to_status]}`}</strong><span>{entry.actor_name}</span>{entry.body ? <p>{entry.body}</p> : null}{entry.transition_note ? <p>{entry.transition_note}</p> : null}{entry.workshop_name ? <p>Taller: {entry.workshop_name}{entry.workshop_contact ? ` · ${entry.workshop_contact}` : ""}</p> : null}{entry.resolution_note ? <p>Nota de resolución: {entry.resolution_note}</p> : null}</li>)}</ol></section>{canWrite && item.permissions?.can_edit ? <button type="button" onClick={() => { setEditing(item); setShowForm(true); }}>Editar contenido</button> : null}{canWrite && item.permissions?.can_change_status ? <div className="squawk-actions">{item.status === "OPEN" ? <><button type="button" onClick={() => setTransition({ item, target: "SENT_TO_WORKSHOP" })}>Enviar a taller</button><button type="button" onClick={() => setTransition({ item, target: "RESOLVED" })}>Resolver</button></> : item.status === "SENT_TO_WORKSHOP" ? <><button type="button" onClick={() => setTransition({ item, target: "OPEN" })}>Reabrir</button><button type="button" onClick={() => setTransition({ item, target: "RESOLVED" })}>Resolver</button></> : <button type="button" onClick={() => setTransition({ item, target: "OPEN" })}>Reabrir</button>}</div> : null}{transition?.item.squawk_id === item.squawk_id ? <TransitionForm item={item} target={transition.target} saving={saving} onCancel={() => setTransition(null)} onSubmit={(values) => run(() => changeSquawkStatus(aircraftId, item.squawk_id, item.status, transition.target, values), "Estado actualizado.")} /> : null}{canWrite && item.permissions?.can_comment ? <form className="squawk-comment" onSubmit={(event) => { event.preventDefault(); void run(() => addSquawkComment(aircraftId, item.squawk_id, comment), "Comentario agregado."); }}><label className="tracking-field"><span>Agregar comentario</span><textarea required value={comment} onChange={(e) => setComment(e.target.value)} /></label><button className="form-action-button" disabled={saving || !comment.trim()}>Comentar</button></form> : null}</div> : null}</article>; })}</div>
  </section>;
}
