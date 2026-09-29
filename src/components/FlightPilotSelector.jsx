import { useCallback, useEffect, useMemo, useState } from "react";

import {
  authorizeAircraftPilot,
  fetchAircraftPilots,
} from "../services/usersService";
import {
  buildPilotOptions,
  findSameNamePilotCandidates,
  getPilotDisplayLabel,
  normalizePilotName,
} from "../utils/pilotIdentity";

function PilotCreationForm({ aircraftId, pilots, refreshing, onCancel, onCreated }) {
  const [form, setForm] = useState({ nombre: "", email: "", telefono: "", dni: "", licencia: "" });
  const [confirmDistinct, setConfirmDistinct] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const candidates = useMemo(() => {
    return findSameNamePilotCandidates(pilots, form.nombre);
  }, [form.nombre, pilots]);

  const update = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "nombre") setConfirmDistinct(false);
    setError("");
  };

  const submit = async () => {
    if (!form.nombre.trim()) {
      setError("Ingresá el nombre del piloto.");
      return;
    }
    if (candidates.length > 0 && !confirmDistinct) {
      setError("Seleccioná una persona existente o confirmá que es una persona distinta.");
      return;
    }
    try {
      setSubmitting(true);
      const result = await authorizeAircraftPilot({ aircraft_id: aircraftId, ...form });
      await onCreated(result?.pilot || result);
    } catch (requestError) {
      setError(requestError.message || "No se pudo agregar el piloto.");
    } finally {
      setSubmitting(false);
    }
  };

  const reuse = async (pilot) => {
    try {
      setSubmitting(true);
      if (pilot.permiso_estado === "ACTIVO" && pilot.estado === "ACTIVO") {
        await onCreated(pilot);
        return;
      }
      const result = await authorizeAircraftPilot({
        aircraft_id: aircraftId,
        person_id: pilot.person_id,
      });
      await onCreated(result?.pilot || result);
    } catch (requestError) {
      setError(requestError.message || "No se pudo reutilizar el piloto.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flight-pilot-create">
      <div className="flight-pilot-create-heading">
        <div><strong>Agregar piloto</strong><span>Nombre obligatorio; los demás datos son opcionales.</span></div>
        <button type="button" onClick={onCancel} disabled={submitting || refreshing}>Cerrar</button>
      </div>
      <div className="flight-pilot-create-grid">
        <label>Nombre *<input value={form.nombre} onChange={(event) => update("nombre", event.target.value)} /></label>
        <label>Email<input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} /></label>
        <label>Teléfono<input value={form.telefono} onChange={(event) => update("telefono", event.target.value)} /></label>
        <label>DNI<input value={form.dni} onChange={(event) => update("dni", event.target.value)} /></label>
        <label>Licencia<input value={form.licencia} onChange={(event) => update("licencia", event.target.value)} /></label>
      </div>
      {candidates.length > 0 ? (
        <div className="flight-pilot-candidates" role="status">
          <strong>Ya existen pilotos con ese nombre</strong>
          <p>Elegí una persona por su identidad canónica o confirmá que se trata de otra persona.</p>
          {candidates.map((candidate) => (
            <button key={candidate.person_id} type="button" onClick={() => reuse(candidate)} disabled={submitting}>
              Reutilizar {getPilotDisplayLabel(candidate)}
            </button>
          ))}
          <label className="flight-pilot-distinct-confirmation">
            <input type="checkbox" checked={confirmDistinct} onChange={(event) => setConfirmDistinct(event.target.checked)} />
            Es una persona distinta
          </label>
        </div>
      ) : null}
      {error ? <p className="flight-pilot-error" role="alert">{error}</p> : null}
      <button type="button" className="form-action-button is-primary" disabled={submitting || refreshing} onClick={submit}>
        {submitting || refreshing ? "Agregando..." : "Agregar y seleccionar"}
      </button>
    </div>
  );
}

export default function FlightPilotSelector({
  aircraftId,
  selectedPersonId,
  selectedName,
  canCreate,
  disabled,
  onChange,
  onUnauthorized,
}) {
  const [pilots, setPilots] = useState([]);
  const [query, setQuery] = useState(selectedName || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);

  const loadPilots = useCallback(async (signal) => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchAircraftPilots(aircraftId, signal);
      setPilots(result.pilots);
      setWritesEnabled(result.writesEnabled);
      return result.pilots;
    } catch (loadError) {
      if (loadError.name === "AbortError") return [];
      if (loadError.message === "UNAUTHORIZED") onUnauthorized?.();
      else setError(loadError.message || "No se pudieron cargar los pilotos.");
      return [];
    } finally {
      setLoading(false);
    }
  }, [aircraftId, onUnauthorized]);

  useEffect(() => {
    const controller = new AbortController();
    setPilots([]);
    setShowCreate(false);
    loadPilots(controller.signal);
    return () => controller.abort();
  }, [aircraftId, loadPilots]);

  useEffect(() => {
    setQuery(selectedName || "");
  }, [selectedName]);

  const options = useMemo(() => buildPilotOptions(pilots), [pilots]);
  const filtered = options.filter((option) =>
    normalizePilotName(option.label).includes(normalizePilotName(query))
  );
  const selectedOption = options.find((option) => option.personId === selectedPersonId);

  useEffect(() => {
    if (selectedOption && query !== selectedOption.label) setQuery(selectedOption.label);
  }, [query, selectedOption]);

  const choose = (option) => {
    if (option.ambiguous) return;
    setQuery(option.label);
    setOpen(false);
    onChange({ personId: option.personId, name: option.name });
    setError("");
  };

  const handleCreated = async (pilot) => {
    setCreating(true);
    try {
      const refreshed = await loadPilots();
      const personId = String(pilot?.person_id || "");
      const canonical = refreshed.find((item) => String(item.person_id) === personId) || pilot;
      const option = buildPilotOptions([canonical])[0];
      if (option) choose(option);
      setShowCreate(false);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flight-pilot-selector">
      <input
        id="piloto"
        type="search"
        value={query}
        disabled={disabled || loading}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          onChange({ personId: "", name: event.target.value });
        }}
        placeholder={loading ? "Cargando pilotos..." : "Buscar piloto autorizado"}
        autoComplete="off"
      />
      {open && (!selectedOption || query !== selectedOption.label) ? (
        <div className="flight-pilot-options" role="listbox">
          {filtered.length === 0 ? <span>No hay coincidencias autorizadas.</span> : filtered.map((option) => (
            <button
              key={option.personId}
              type="button"
              role="option"
              aria-disabled={option.ambiguous}
              disabled={option.ambiguous}
              onClick={() => choose(option)}
            >
              {option.label}{option.ambiguous ? " · identidad ambigua" : ""}
            </button>
          ))}
        </div>
      ) : null}
      {selectedOption ? <span className="flight-pilot-selected">Piloto seleccionado</span> : null}
      {error ? <p className="flight-pilot-error" role="alert">{error}</p> : null}
      {canCreate && writesEnabled ? (
        <button type="button" className="flight-pilot-add" onClick={() => setShowCreate((visible) => !visible)} disabled={disabled}>
          + Agregar piloto
        </button>
      ) : null}
      {showCreate ? (
        <PilotCreationForm aircraftId={aircraftId} pilots={pilots} refreshing={creating} onCancel={() => setShowCreate(false)} onCreated={handleCreated} />
      ) : null}
    </div>
  );
}
