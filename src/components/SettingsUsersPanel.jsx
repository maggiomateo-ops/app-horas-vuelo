import { useEffect, useState } from "react";
import {
  fetchAircraftPilots,
  fetchPlatformUsers,
} from "../services/usersService";

function StatusBadge({ children }) {
  const normalizedStatus = String(children || "").trim().toUpperCase();
  const active = normalizedStatus === "ACTIVO" || normalizedStatus === "ACTIVA";

  return (
    <span className={`settings-user-status ${active ? "is-active" : "is-inactive"}`}>
      {normalizedStatus || "SIN ESTADO"}
    </span>
  );
}

function PlatformUsersTable({ users }) {
  return (
    <div className="settings-users-table-wrapper">
      <table className="settings-users-table">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Estado</th>
            <th>Datos</th>
            <th>Accesos por aeronave</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.user_id}>
              <td>
                <strong>{user.nombre || "Sin nombre"}</strong>
                <span>{user.email || "Sin email"}</span>
                <small>{user.user_id}</small>
              </td>
              <td>
                <StatusBadge>{user.estado}</StatusBadge>
                {user.is_admin ? <span className="settings-admin-badge">Admin</span> : null}
              </td>
              <td>
                <span>Tel: {user.telefono || "—"}</span>
                <span>DNI: {user.dni || "—"}</span>
                <span>Licencia: {user.licencia || "—"}</span>
              </td>
              <td>
                {user.permisos.length ? (
                  <div className="settings-access-list">
                    {user.permisos.map((permission, permissionIndex) => (
                      <span
                        key={`${permission.aircraft_id}-${permission.rol}-${permission.estado}-${permissionIndex}`}
                        className="settings-access-item"
                      >
                        <strong>{permission.matricula || permission.aircraft_id}</strong>
                        {permission.rol} · {permission.estado}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="settings-users-muted">Sin accesos asignados</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AircraftPilotsTable({ pilots }) {
  return (
    <div className="settings-users-table-wrapper">
      <table className="settings-users-table settings-pilots-table">
        <thead>
          <tr>
            <th>Piloto</th>
            <th>Telefono</th>
            <th>Licencia</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {pilots.map((pilot) => (
            <tr key={pilot.user_id}>
              <td>
                <strong>{pilot.nombre || "Sin nombre"}</strong>
                <span>{pilot.email || "Sin email"}</span>
              </td>
              <td>{pilot.telefono || "—"}</td>
              <td>{pilot.licencia || "—"}</td>
              <td>
                <div className="settings-pilot-statuses">
                  <span>Usuario</span>
                  <StatusBadge>{pilot.estado}</StatusBadge>
                  <span>Permiso</span>
                  <StatusBadge>{pilot.permiso_estado}</StatusBadge>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SettingsUsersPanel({
  aircraftId,
  aircraftRegistration,
  isGlobalAdmin,
  onUnauthorized,
}) {
  const [activeTab, setActiveTab] = useState(isGlobalAdmin ? "users" : "pilots");
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isGlobalAdmin && activeTab !== "pilots") {
      setActiveTab("pilots");
    }
  }, [activeTab, isGlobalAdmin]);

  useEffect(() => {
    const controller = new AbortController();
    let ignore = false;

    async function loadData() {
      try {
        setLoading(true);
        setError("");
        const result = activeTab === "users"
          ? await fetchPlatformUsers(controller.signal)
          : await fetchAircraftPilots(aircraftId, controller.signal);

        if (!ignore) {
          setData(activeTab === "users" ? result : result.pilots);
        }
      } catch (loadError) {
        if (loadError.name === "AbortError") {
          return;
        }

        if (loadError.message === "UNAUTHORIZED") {
          onUnauthorized();
          return;
        }

        if (!ignore) {
          setData([]);
          setError(loadError.message || "No se pudieron cargar los datos.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [activeTab, aircraftId, onUnauthorized]);

  return (
    <div className="settings-users-panel">
      <div className="settings-user-tabs" role="tablist" aria-label="Usuarios de Settings">
        {isGlobalAdmin ? (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "users"}
            className={`settings-user-tab ${activeTab === "users" ? "is-active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            Usuarios autorizados
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "pilots"}
          className={`settings-user-tab ${activeTab === "pilots" ? "is-active" : ""}`}
          onClick={() => setActiveTab("pilots")}
        >
          Pilotos autorizados
        </button>
      </div>

      <div className="settings-users-heading">
        <div>
          <p className="dashboard-eyebrow">
            {activeTab === "users" ? "Administracion de plataforma" : "Aeronave seleccionada"}
          </p>
          <h3>
            {activeTab === "users"
              ? "Usuarios autorizados"
              : `Pilotos autorizados · ${aircraftRegistration}`}
          </h3>
        </div>
        <span className="settings-readonly-badge">Solo lectura</span>
      </div>

      {loading ? <p className="dashboard-status">Cargando datos...</p> : null}
      {error ? <p className="dashboard-status dashboard-status-error">{error}</p> : null}

      {!loading && !error && data.length === 0 ? (
        <div className="settings-users-empty">
          {activeTab === "pilots"
            ? "No hay pilotos autorizados para esta aeronave."
            : "No hay usuarios disponibles."}
        </div>
      ) : null}

      {!loading && !error && data.length > 0 ? (
        activeTab === "users"
          ? <PlatformUsersTable users={data} />
          : <AircraftPilotsTable pilots={data} />
      ) : null}
    </div>
  );
}

export default SettingsUsersPanel;
