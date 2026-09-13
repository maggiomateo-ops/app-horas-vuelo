import { useCallback, useEffect, useState } from "react";
import {
  authorizeAircraftPilot,
  changePlatformUserState,
  createPlatformUser,
  fetchAircraftPilots,
  fetchPlatformUsers,
  grantAircraftPermission,
  revokeAircraftPermission,
  revokeAircraftPilot,
} from "../services/usersService";

const EMPTY_USER_FORM = { nombre: "", email: "", telefono: "", dni: "", licencia: "", is_admin: false };
const EMPTY_PILOT_FORM = { email: "", nombre: "", telefono: "", dni: "", licencia: "" };

function StatusBadge({ children }) {
  const status = String(children || "").trim().toUpperCase();
  const active = status === "ACTIVO" || status === "ACTIVA";
  return <span className={`settings-user-status ${active ? "is-active" : "is-inactive"}`}>{status || "SIN ESTADO"}</span>;
}

function ManagementForm({ kind, aircraftId, disabled, initialValues, submitting, onCancel, onSubmit }) {
  const isUser = kind === "user";
  const isPilotReauthorization = !isUser && Boolean(initialValues?.user_id);
  const [form, setForm] = useState(
    isUser
      ? EMPTY_USER_FORM
      : {
          email: initialValues?.email || "",
          nombre: initialValues?.nombre || "",
          telefono: initialValues?.telefono || "",
          dni: initialValues?.dni || "",
          licencia: initialValues?.licencia || "",
        }
  );
  const update = (field) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <form className="settings-management-form" onSubmit={(event) => {
      event.preventDefault();
      onSubmit(isUser ? form : { aircraft_id: aircraftId, ...form });
    }}>
      <div className="settings-management-grid">
        {isUser ? <label><span>Nombre *</span><input required value={form.nombre} onChange={update("nombre")} /></label> : null}
        <label><span>Email *</span><input required readOnly={isPilotReauthorization} type="email" value={form.email} onChange={update("email")} /></label>
        {!isUser ? <label><span>Nombre y apellido *</span><input required readOnly={isPilotReauthorization && Boolean(initialValues?.nombre)} value={form.nombre} onChange={update("nombre")} /></label> : null}
        <label><span>Telefono</span><input readOnly={isPilotReauthorization && Boolean(initialValues?.telefono)} value={form.telefono} onChange={update("telefono")} /></label>
        <label><span>DNI{isUser ? "" : " *"}</span><input required={!isUser} readOnly={isPilotReauthorization && Boolean(initialValues?.dni)} value={form.dni} onChange={update("dni")} /></label>
        <label><span>{isUser ? "Licencia" : "N.º de licencia *"}</span><input required={!isUser} readOnly={isPilotReauthorization && Boolean(initialValues?.licencia)} value={form.licencia} onChange={update("licencia")} /></label>
        {isUser ? (
          <label className="settings-management-checkbox">
            <input type="checkbox" checked={form.is_admin} onChange={update("is_admin")} />
            <span>Admin global</span>
          </label>
        ) : null}
      </div>
      {isPilotReauthorization ? <p className="settings-users-muted settings-reauthorization-note">Los datos ya registrados no se modifican desde esta pantalla.</p> : null}
      <div className="settings-management-actions">
        <button type="submit" className="settings-save-button" disabled={disabled || submitting}>
          {submitting ? "Guardando..." : (isUser ? "Crear usuario" : isPilotReauthorization ? "Reautorizar piloto" : "Autorizar piloto")}
        </button>
        <button type="button" className="settings-secondary-button" disabled={submitting} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

function PlatformUsersTable({ aircraftId, aircraftRegistration, busy, currentUserId, users, writesEnabled, onMutation }) {
  const [roleDrafts, setRoleDrafts] = useState({});

  return (
    <div className="settings-users-table-wrapper">
      <table className="settings-users-table">
        <thead><tr><th>Usuario</th><th>Estado</th><th>Datos</th><th>Accesos por aeronave</th></tr></thead>
        <tbody>{users.map((user) => {
          const permission = user.permisos.find((item) => item.aircraft_id === aircraftId);
          const roleDraftKey = `${aircraftId}:${user.user_id}`;
          const role = roleDrafts[roleDraftKey] || permission?.rol || "PILOT";
          const active = String(user.estado).toUpperCase() === "ACTIVO";
          const isCurrentUser = user.user_id === currentUserId;
          return (
            <tr key={user.user_id}>
              <td><strong>{user.nombre || "Sin nombre"}</strong><span>{user.email || "Sin email"}</span><small>{user.user_id}</small></td>
              <td>
                <StatusBadge>{user.estado}</StatusBadge>
                {user.is_admin ? <span className="settings-admin-badge">Admin</span> : null}
                {isCurrentUser ? <span className="settings-users-self">Tu usuario</span> : (
                  <button type="button" className="settings-row-action" disabled={!writesEnabled || busy} onClick={() => {
                    const nextState = active ? "INACTIVO" : "ACTIVO";
                    if (!active || window.confirm(`¿Desactivar a ${user.nombre || user.email}?`)) {
                      onMutation(() => changePlatformUserState(user.user_id, nextState), active ? "Usuario desactivado." : "Usuario reactivado.");
                    }
                  }}>{active ? "Desactivar" : "Reactivar"}</button>
                )}
              </td>
              <td><span>Tel: {user.telefono || "—"}</span><span>DNI: {user.dni || "—"}</span><span>Licencia: {user.licencia || "—"}</span></td>
              <td>
                <div className="settings-current-accesses">
                  <span className="settings-access-label">Accesos actuales</span>
                  {user.permisos.length ? <div className="settings-access-list">{user.permisos.map((item, index) => (
                    <span key={`${item.aircraft_id}-${item.rol}-${index}`} className="settings-access-item">
                      <strong>{item.matricula || item.aircraft_id}</strong>
                      <span><b>{item.rol}</b><StatusBadge>{item.estado}</StatusBadge></span>
                    </span>
                  ))}</div> : <span className="settings-users-muted">Sin accesos asignados</span>}
                </div>
                <div className="settings-permission-editor">
                  <span className="settings-access-label">Gestionar {aircraftRegistration}</span>
                  {isCurrentUser ? <span className="settings-users-self">Tu usuario</span> : null}
                  <div className="settings-permission-actions">
                    <span className="settings-role-select">
                      <select aria-label={`Rol de ${user.nombre || user.email} en la aeronave seleccionada`} value={role} disabled={!writesEnabled || busy || !active} onChange={(event) => setRoleDrafts((current) => ({ ...current, [roleDraftKey]: event.target.value }))}>
                        <option value="OWNER">OWNER</option><option value="PILOT">PILOT</option><option value="VIEWER">VIEWER</option>
                      </select>
                    </span>
                    <button type="button" className="settings-row-action" disabled={!writesEnabled || busy || !active} onClick={() => onMutation(() => grantAircraftPermission(user.user_id, aircraftId, role), "Acceso actualizado.")}>Guardar acceso</button>
                  {!active ? <span className="settings-users-muted settings-access-help">Reactivá el usuario para asignar o modificar accesos.</span> : null}
                  {permission?.estado?.toUpperCase() === "ACTIVO" && !isCurrentUser ? <button type="button" className="settings-row-action is-danger" disabled={!writesEnabled || busy} onClick={() => {
                    if (window.confirm(`¿Revocar el acceso de ${user.nombre || user.email} a esta aeronave?`)) {
                      onMutation(() => revokeAircraftPermission(user.user_id, aircraftId), "Acceso revocado.");
                    }
                  }}>Revocar acceso</button> : null}
                  </div>
                </div>
              </td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function AircraftPilotsTable({ aircraftId, busy, currentUserId, pilots, writesEnabled, onMutation, onPreparePilot }) {
  return (
    <div className="settings-users-table-wrapper">
      <table className="settings-users-table settings-pilots-table">
        <thead><tr><th>Piloto</th><th>Telefono</th><th>DNI</th><th>Licencia</th><th>Estado y acciones</th></tr></thead>
        <tbody>{pilots.map((pilot) => {
          const userActive = String(pilot.estado).toUpperCase() === "ACTIVO";
          const permissionActive = String(pilot.permiso_estado).toUpperCase() === "ACTIVO";
          const isCurrentUser = pilot.user_id === currentUserId;
          return (
            <tr key={pilot.user_id}>
              <td><strong>{pilot.nombre || "Sin nombre"}</strong><span>{pilot.email || "Sin email"}</span></td>
              <td>{pilot.telefono || "—"}</td><td>{pilot.dni || "—"}</td><td>{pilot.licencia || "—"}</td>
              <td>
                <div className="settings-pilot-status-box">
                  <span>Usuario</span><StatusBadge>{pilot.estado}</StatusBadge>
                  <span>Permiso</span><StatusBadge>{pilot.permiso_estado}</StatusBadge>
                </div>
                <div className="settings-pilot-actions">
                  {permissionActive && !isCurrentUser ? <button type="button" className="settings-row-action is-danger" disabled={!writesEnabled || busy} onClick={() => {
                  if (window.confirm(`¿Revocar a ${pilot.nombre || pilot.email} como piloto?`)) {
                    onMutation(() => revokeAircraftPilot(pilot.user_id, aircraftId), "Piloto revocado.");
                  }
                  }}>Revocar</button> : permissionActive && isCurrentUser ? <span className="settings-users-self">Tu usuario</span> : userActive ? <button type="button" className="settings-row-action" disabled={!writesEnabled || busy} onClick={() => onPreparePilot(pilot)}>Reautorizar</button> : <span className="settings-users-warning">Requiere Admin</span>}
                </div>
              </td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function SettingsUsersPanel({ aircraftId, aircraftRegistration, isGlobalAdmin, currentUserId, onUnauthorized }) {
  const [activeTab, setActiveTab] = useState(isGlobalAdmin ? "users" : "pilots");
  const [data, setData] = useState([]);
  const [writesEnabled, setWritesEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [mutating, setMutating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [pilotInitialValues, setPilotInitialValues] = useState(null);

  useEffect(() => { if (!isGlobalAdmin && activeTab !== "pilots") setActiveTab("pilots"); }, [activeTab, isGlobalAdmin]);

  const fetchData = useCallback(async (signal) => {
    const result = activeTab === "users" ? await fetchPlatformUsers(signal) : await fetchAircraftPilots(aircraftId, signal);
    return {
      records: activeTab === "users" ? result.users : result.pilots,
      writesEnabled: result.writesEnabled,
    };
  }, [activeTab, aircraftId]);

  useEffect(() => {
    const controller = new AbortController();
    let ignore = false;
    setData([]); setLoading(true); setError(""); setMessage(""); setShowForm(false); setPilotInitialValues(null);
    fetchData(controller.signal).then((result) => {
      if (!ignore) {
        setData(result.records);
        setWritesEnabled(result.writesEnabled);
      }
    }).catch((loadError) => {
      if (loadError.name === "AbortError" || ignore) return;
      if (loadError.message === "UNAUTHORIZED") return onUnauthorized();
      setData([]); setError(loadError.message || "No se pudieron cargar los datos.");
    }).finally(() => { if (!ignore) setLoading(false); });
    return () => { ignore = true; controller.abort(); };
  }, [fetchData, onUnauthorized]);

  const runMutation = async (operation, successMessage) => {
    if (!writesEnabled || mutating) return;
    try {
      setMutating(true); setError(""); setMessage("");
      await operation();
      const result = await fetchData();
      setData(result.records);
      setWritesEnabled(result.writesEnabled);
      setShowForm(false); setPilotInitialValues(null); setMessage(successMessage);
    } catch (mutationError) {
      if (mutationError.message === "UNAUTHORIZED") onUnauthorized();
      else setError(mutationError.message || "No se pudo completar la accion.");
    } finally { setMutating(false); }
  };

  return (
    <div className="settings-users-panel">
      <div className="settings-user-tabs" role="tablist" aria-label="Usuarios de Settings">
        {isGlobalAdmin ? <button type="button" role="tab" aria-selected={activeTab === "users"} className={`settings-user-tab ${activeTab === "users" ? "is-active" : ""}`} onClick={() => setActiveTab("users")}>Usuarios</button> : null}
        <button type="button" role="tab" aria-selected={activeTab === "pilots"} className={`settings-user-tab ${activeTab === "pilots" ? "is-active" : ""}`} onClick={() => setActiveTab("pilots")}>Pilotos</button>
      </div>
      <div className="settings-users-heading">
        <div><p className="dashboard-eyebrow">{activeTab === "users" ? "Administracion de plataforma" : "Aeronave seleccionada"}</p><h3>{activeTab === "users" ? "Usuarios autorizados" : `Pilotos autorizados · ${aircraftRegistration}`}</h3></div>
        <button type="button" className="settings-save-button" disabled={!writesEnabled || mutating || loading} onClick={() => { setPilotInitialValues(null); setShowForm((visible) => !visible); }}>{activeTab === "users" ? "Nuevo usuario" : "Autorizar piloto"}</button>
      </div>
      {!writesEnabled && !loading ? <p className="settings-management-disabled">Gestión de usuarios temporalmente deshabilitada.</p> : null}
      {message ? <div className="settings-inline-alert is-success" role="status" aria-live="polite">{message}</div> : null}
      {error ? <div className="settings-inline-alert is-error" role="alert" aria-live="assertive">{error}</div> : null}
      {showForm ? <ManagementForm key={`${activeTab}-${pilotInitialValues?.user_id || "new"}`} kind={activeTab === "users" ? "user" : "pilot"} aircraftId={aircraftId} disabled={!writesEnabled} initialValues={pilotInitialValues} submitting={mutating} onCancel={() => { setShowForm(false); setPilotInitialValues(null); }} onSubmit={(form) => runMutation(
        () => activeTab === "users" ? createPlatformUser(form) : authorizeAircraftPilot(form),
        activeTab === "users"
          ? "Usuario creado correctamente."
          : pilotInitialValues
            ? "Piloto reautorizado correctamente."
            : "Piloto autorizado correctamente."
      )} /> : null}
      {loading ? <p className="dashboard-status">Cargando datos...</p> : null}
      {!loading && !error && data.length === 0 ? <div className="settings-users-empty">{activeTab === "pilots" ? "No hay pilotos autorizados para esta aeronave." : "No hay usuarios disponibles."}</div> : null}
      {!loading && data.length > 0 ? (activeTab === "users"
        ? <PlatformUsersTable aircraftId={aircraftId} aircraftRegistration={aircraftRegistration} busy={mutating} currentUserId={currentUserId} users={data} writesEnabled={writesEnabled} onMutation={runMutation} />
        : <AircraftPilotsTable aircraftId={aircraftId} busy={mutating} currentUserId={currentUserId} pilots={data} writesEnabled={writesEnabled} onMutation={runMutation} onPreparePilot={(pilot) => { setError(""); setMessage(""); setPilotInitialValues(pilot); setShowForm(true); }} />
      ) : null}
    </div>
  );
}

export default SettingsUsersPanel;
