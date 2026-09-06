import { useEffect, useState } from "react";
import "./App.css";
import DashboardPanel from "./components/DashboardPanel";
import HistorialesPanel from "./components/HistorialesPanel";
import SettingsPanel from "./components/SettingsPanel";
import { DEFAULT_SETTINGS, fetchSettings, saveSettings } from "./services/settingsService";

const AUTH_STATUS = {
  loading: "loading",
  authenticated: "authenticated",
  unauthenticated: "unauthenticated",
};

const THEME_MODE = {
  auto: "auto",
  light: "light",
  dark: "dark",
};

const THEME_LABELS = {
  auto: "Tema: Auto",
  light: "Tema: Claro",
  dark: "Tema: Noche",
};

function LoginScreen({ loginLoading, loginError, onLoginSubmit }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (event) => {
    event.preventDefault();
    onLoginSubmit({ username, password });
  };

  return (
    <main className="app-shell app-auth-shell">
      <section className="login-card">
        <p className="login-eyebrow">Acceso protegido</p>
        <h1 className="login-title">App Horas de Vuelo</h1>
        <p className="login-copy">
          Ingresa tus credenciales para cargar vuelos y revisar historiales.
        </p>

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label" htmlFor="login-username">
            Usuario
          </label>
          <input
            id="login-username"
            className="login-input"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            disabled={loginLoading}
          />

          <label className="login-label" htmlFor="login-password">
            Contrasena
          </label>
          <input
            id="login-password"
            className="login-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={loginLoading}
          />

          <button className="login-button" type="submit" disabled={loginLoading}>
            {loginLoading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        {loginError ? <p className="login-error">{loginError}</p> : null}
      </section>
    </main>
  );
}

function PropietarioSelect({ value, onChange, disabled }) {
  const [isOpen, setIsOpen] = useState(false);

  const options = [
    { value: "", label: "Seleccionar..." },
    { value: "ALEGRE", label: "ALEGRE" },
    { value: "MAGGIO", label: "MAGGIO" },
  ];

  const selectedOption =
    options.find((option) => option.value === value) ?? options[0];

  const handleSelect = (nextValue) => {
    onChange(nextValue);
    setIsOpen(false);
  };

  return (
    <div className={`custom-select ${isOpen ? "is-open" : ""} ${disabled ? "is-disabled" : ""}`}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => !disabled && setIsOpen((open) => !open)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className={!selectedOption.value ? "is-placeholder" : ""}>
          {selectedOption.label}
        </span>
        <span className="custom-select-arrow" aria-hidden="true" />
      </button>

      {isOpen ? (
        <div className="custom-select-menu" role="listbox" aria-label="Propietario">
          {options.map((option) => (
            <button
              key={option.value || "placeholder"}
              type="button"
              role="option"
              className={`custom-select-option ${value === option.value ? "is-selected" : ""}`}
              aria-selected={value === option.value}
              onClick={() => handleSelect(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function App() {
  const [authStatus, setAuthStatus] = useState(AUTH_STATUS.loading);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [themeMode, setThemeMode] = useState(() => {
    if (typeof window === "undefined") {
      return THEME_MODE.auto;
    }

    const savedThemeMode = window.localStorage.getItem("theme-mode");
    return Object.values(THEME_MODE).includes(savedThemeMode)
      ? savedThemeMode
      : THEME_MODE.auto;
  });
  const [systemPrefersDark, setSystemPrefersDark] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [activeMainTab, setActiveMainTab] = useState("registro");
  const [fecha, setFecha] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [tiempoVueloJPI, setTiempoVueloJPI] = useState("");
  const [tiempoEnServicioGarmin, setTiempoEnServicioGarmin] = useState("");
  const [piloto, setPiloto] = useState("");
  const [propietario, setPropietario] = useState("");
  const [aceiteAgregado, setAceiteAgregado] = useState("");
  const [combustibleTanqueIzquierdo, setCombustibleTanqueIzquierdo] = useState("");
  const [combustibleTanqueDerecho, setCombustibleTanqueDerecho] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const [loading, setLoading] = useState(false);
  const [mensajeExito, setMensajeExito] = useState("");
  const [mensajeError, setMensajeError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [ultimoInput, setUltimoInput] = useState(null);

  useEffect(() => {
    let ignore = false;

    async function checkSession() {
      try {
        const response = await fetch("/api/session", {
          method: "GET",
          credentials: "include",
        });

        const result = await response.json().catch(() => null);

        if (ignore) {
          return;
        }

        if (response.ok && result?.authenticated) {
          setCurrentUser(result.user ?? null);
          setAuthStatus(AUTH_STATUS.authenticated);
          return;
        }

        setCurrentUser(null);
        setAuthStatus(AUTH_STATUS.unauthenticated);
      } catch {
        if (!ignore) {
          setCurrentUser(null);
          setAuthStatus(AUTH_STATUS.unauthenticated);
        }
      }
    }

    checkSession();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (authStatus !== AUTH_STATUS.authenticated) {
      return undefined;
    }

    const controller = new AbortController();
    let ignore = false;

    async function loadRemoteSettings() {
      try {
        setSettingsLoading(true);
        setSettingsError("");
        const nextSettings = await fetchSettings(controller.signal);

        if (!ignore) {
          setSettings(nextSettings);
        }
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        if (error.message === "UNAUTHORIZED") {
          setCurrentUser(null);
          setAuthStatus(AUTH_STATUS.unauthenticated);
          return;
        }

        if (!ignore) {
          setSettingsError(error.message || "No se pudieron cargar los settings.");
        }
      } finally {
        if (!ignore) {
          setSettingsLoading(false);
        }
      }
    }

    loadRemoteSettings();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [authStatus]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (event) => {
      setSystemPrefersDark(event.matches);
    };

    setSystemPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem("theme-mode", themeMode);

    const resolvedTheme = themeMode === THEME_MODE.auto
      ? (systemPrefersDark ? THEME_MODE.dark : THEME_MODE.light)
      : themeMode;

    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.themeMode = themeMode;
    document.documentElement.style.colorScheme =
      resolvedTheme === THEME_MODE.dark ? "dark" : "light";
  }, [systemPrefersDark, themeMode]);

  const normalizarPropietarioSelect = (valor) => {
    const u = String(valor ?? "").trim().toUpperCase();
    return u === "ALEGRE" || u === "MAGGIO" ? u : "";
  };

  const limpiarFormulario = () => {
    setFecha("");
    setDesde("");
    setHasta("");
    setTiempoVueloJPI("");
    setTiempoEnServicioGarmin("");
    setPiloto("");
    setPropietario("");
    setAceiteAgregado("");
    setCombustibleTanqueIzquierdo("");
    setCombustibleTanqueDerecho("");
    setObservaciones("");
    setEditingId(null);
  };

  const rellenadoRapido = () => {
    const hoy = new Date().toISOString().split("T")[0];

    if (!fecha) setFecha(hoy);
    if (!desde) setDesde("AGR");
    if (!hasta) setHasta("AGR");
    if (!tiempoVueloJPI) setTiempoVueloJPI("0.5");
    if (!tiempoEnServicioGarmin) setTiempoEnServicioGarmin("0.4");
  };

  const cargarUltimoInputParaEditar = () => {
    if (!ultimoInput) return;

    const fechaReconstruida = `${ultimoInput.anio}-${String(ultimoInput.mes).padStart(2, "0")}-${String(ultimoInput.dia).padStart(2, "0")}`;

    setFecha(fechaReconstruida);
    setDesde(ultimoInput.desde ?? "");
    setHasta(ultimoInput.hasta ?? "");
    setTiempoVueloJPI(
      ultimoInput.tiempoVueloJPI === "" || ultimoInput.tiempoVueloJPI == null
        ? ""
        : String(ultimoInput.tiempoVueloJPI)
    );
    setTiempoEnServicioGarmin(
      ultimoInput.tiempoEnServicioGarmin === "" || ultimoInput.tiempoEnServicioGarmin == null
        ? ""
        : String(ultimoInput.tiempoEnServicioGarmin)
    );
    setPiloto(ultimoInput.piloto ?? "");
    setPropietario(normalizarPropietarioSelect(ultimoInput.propietario));
    setAceiteAgregado(
      ultimoInput.aceiteAgregado === "" || ultimoInput.aceiteAgregado == null
        ? ""
        : String(ultimoInput.aceiteAgregado)
    );
    setCombustibleTanqueIzquierdo(
      ultimoInput.combustibleTanqueIzquierdo === "" ||
        ultimoInput.combustibleTanqueIzquierdo == null
        ? ""
        : String(ultimoInput.combustibleTanqueIzquierdo)
    );
    setCombustibleTanqueDerecho(
      ultimoInput.combustibleTanqueDerecho === "" ||
        ultimoInput.combustibleTanqueDerecho == null
        ? ""
        : String(ultimoInput.combustibleTanqueDerecho)
    );
    setObservaciones(ultimoInput.observaciones ?? "");
    setEditingId(ultimoInput.id);
  };

  const replicarUltimoInput = () => {
    if (!ultimoInput) return;

    setFecha("");
    setDesde(ultimoInput.desde ?? "");
    setHasta(ultimoInput.hasta ?? "");
    setTiempoVueloJPI(
      ultimoInput.tiempoVueloJPI === "" || ultimoInput.tiempoVueloJPI == null
        ? ""
        : String(ultimoInput.tiempoVueloJPI)
    );
    setTiempoEnServicioGarmin(
      ultimoInput.tiempoEnServicioGarmin === "" || ultimoInput.tiempoEnServicioGarmin == null
        ? ""
        : String(ultimoInput.tiempoEnServicioGarmin)
    );
    setPiloto(ultimoInput.piloto ?? "");
    setPropietario(normalizarPropietarioSelect(ultimoInput.propietario));
    setAceiteAgregado(
      ultimoInput.aceiteAgregado === "" || ultimoInput.aceiteAgregado == null
        ? ""
        : String(ultimoInput.aceiteAgregado)
    );
    setCombustibleTanqueIzquierdo(
      ultimoInput.combustibleTanqueIzquierdo === "" ||
        ultimoInput.combustibleTanqueIzquierdo == null
        ? ""
        : String(ultimoInput.combustibleTanqueIzquierdo)
    );
    setCombustibleTanqueDerecho(
      ultimoInput.combustibleTanqueDerecho === "" ||
        ultimoInput.combustibleTanqueDerecho == null
        ? ""
        : String(ultimoInput.combustibleTanqueDerecho)
    );
    setObservaciones(ultimoInput.observaciones ?? "");
    setEditingId(null);
  };

  const handleDeleteUltimoVuelo = async () => {
    if (!ultimoInput?.id || loading) {
      return;
    }

    const confirmarBorrado = window.confirm(
      "Se eliminara el ultimo vuelo cargado de la planilla. Deseas continuar?"
    );

    if (!confirmarBorrado) {
      return;
    }

    setMensajeExito("");
    setMensajeError("");

    try {
      setLoading(true);

      const response = await fetch("/api/guardar-vuelo", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modo: "delete",
          id: ultimoInput.id,
        }),
      });

      const result = await response.json().catch(() => null);

      if (response.status === 401) {
        setCurrentUser(null);
        setAuthStatus(AUTH_STATUS.unauthenticated);
        throw new Error("Tu sesion expiro. Vuelve a iniciar sesion.");
      }

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "No se pudo borrar el vuelo.");
      }

      limpiarFormulario();
      setUltimoInput(null);
      setMensajeExito("Ultimo vuelo eliminado correctamente.");
    } catch (error) {
      setMensajeError(error.message || "Hubo un error al borrar el vuelo.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMensajeExito("");
    setMensajeError("");

    if (
      !fecha ||
      !desde.trim() ||
      !hasta.trim() ||
      !tiempoVueloJPI ||
      !tiempoEnServicioGarmin ||
      !piloto.trim() ||
      !propietario.trim()
    ) {
      setMensajeError("Completa todos los campos obligatorios.");
      return;
    }

    const [anio, mes, dia] = fecha.split("-");

    const payload = {
      modo: editingId ? "update" : "create",
      id: editingId || String(Date.now()),
      dia,
      mes,
      anio,
      desde: desde.trim(),
      hasta: hasta.trim(),
      tiempoVueloJPI: Number(tiempoVueloJPI),
      tiempoEnServicioGarmin: Number(tiempoEnServicioGarmin),
      piloto: piloto.trim(),
      propietario: propietario.trim(),
      aceiteAgregado: aceiteAgregado === "" ? "" : Number(aceiteAgregado),
      combustibleTanqueIzquierdo:
        combustibleTanqueIzquierdo === "" ? "" : Number(combustibleTanqueIzquierdo),
      combustibleTanqueDerecho:
        combustibleTanqueDerecho === "" ? "" : Number(combustibleTanqueDerecho),
      observaciones: observaciones.trim(),
    };

    try {
      setLoading(true);

      const response = await fetch("/api/guardar-vuelo", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => null);

      if (response.status === 401) {
        setCurrentUser(null);
        setAuthStatus(AUTH_STATUS.unauthenticated);
        throw new Error("Tu sesion expiro. Vuelve a iniciar sesion.");
      }

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "No se pudo guardar el vuelo.");
      }

      setMensajeExito(
        payload.modo === "update"
          ? "Vuelo actualizado correctamente."
          : "Vuelo guardado correctamente."
      );

      setUltimoInput(payload);
      limpiarFormulario();
    } catch (error) {
      setMensajeError(error.message || "Hubo un error al guardar el vuelo.");
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async ({ username, password }) => {
    setLoginLoading(true);
    setLoginError("");

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || "No se pudo iniciar sesion.");
      }

      setCurrentUser(result.user ?? null);
      setAuthStatus(AUTH_STATUS.authenticated);
    } catch (error) {
      setCurrentUser(null);
      setAuthStatus(AUTH_STATUS.unauthenticated);
      setLoginError(error.message || "No se pudo iniciar sesion.");
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setCurrentUser(null);
      setAuthStatus(AUTH_STATUS.unauthenticated);
      setLoginError("");
      setMensajeError("");
      setMensajeExito("");
    }
  };

  const handleToggleTheme = () => {
    setThemeMode((currentThemeMode) => {
      if (currentThemeMode === THEME_MODE.auto) {
        return THEME_MODE.dark;
      }

      if (currentThemeMode === THEME_MODE.dark) {
        return THEME_MODE.light;
      }

      return THEME_MODE.auto;
    });
  };

  const handleSaveSettings = async (nextSettings) => {
    setSettingsError("");
    const savedSettings = await saveSettings(nextSettings);
    setSettings(savedSettings);
    return savedSettings;
  };

  const formStyle = {
    maxWidth: "720px",
    margin: "32px auto",
    padding: "24px",
    border: "1px solid var(--app-border)",
    borderRadius: "18px",
    background:
      "linear-gradient(180deg, var(--app-surface) 0%, color-mix(in srgb, var(--app-surface) 92%, var(--app-surface-muted) 8%) 100%)",
    color: "var(--app-text)",
    fontFamily: "Arial, sans-serif",
    boxShadow: "var(--app-shadow)",
  };

  const fieldStyle = {
    display: "flex",
    flexDirection: "column",
    marginBottom: "16px",
    gap: "8px",
    alignItems: "stretch",
  };

  const labelBlockStyle = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "0px",
    width: "100%",
    textAlign: "center",
  };

  const labelTitleRowStyle = {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: "6px",
    rowGap: "0px",
    width: "100%",
  };

  const labelTextStyle = {
    textTransform: "uppercase",
    fontSize: "13px",
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: "var(--app-text)",
    lineHeight: 1.2,
    textAlign: "center",
  };

  const labelRequiredStyle = {
    color: "var(--app-danger)",
    fontWeight: 700,
    fontSize: "15px",
    lineHeight: 1,
    transform: "translateY(1px)",
  };

  const labelSubTechnicalStyle = {
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--app-text-soft)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    lineHeight: 1.2,
    textAlign: "center",
  };

  const inputStyle = {
    boxSizing: "border-box",
    width: "100%",
    padding: "13px 14px",
    border: "1px solid var(--app-border-strong)",
    borderRadius: "12px",
    fontSize: "14px",
    color: "var(--app-text)",
    backgroundColor: "var(--app-surface-muted)",
  };

  const resolvedTheme = themeMode === THEME_MODE.auto
    ? (systemPrefersDark ? THEME_MODE.dark : THEME_MODE.light)
    : themeMode;

  const themeIcon = resolvedTheme === THEME_MODE.dark ? "☾" : "☀";
  const themeButtonLabel =
    themeMode === THEME_MODE.auto
      ? `Tema automatico (${resolvedTheme === THEME_MODE.dark ? "noche" : "claro"})`
      : `Tema ${resolvedTheme === THEME_MODE.dark ? "noche" : "claro"}`;

  const FieldLabel = ({ htmlFor, title, required, subTechnical }) => (
    <label htmlFor={htmlFor} style={labelBlockStyle}>
      <div style={labelTitleRowStyle}>
        <span style={labelTextStyle}>{title}</span>
        {subTechnical ? (
          <span style={labelSubTechnicalStyle}>{subTechnical}</span>
        ) : null}
        {required ? (
          <span style={labelRequiredStyle} aria-hidden="true">
            *
          </span>
        ) : null}
      </div>
    </label>
  );

  const placeholderClassName = "flight-form-placeholder";

  if (authStatus === AUTH_STATUS.loading) {
    return (
      <main className="app-shell app-auth-shell">
        <section className="login-card">
          <p className="login-eyebrow">Acceso protegido</p>
          <h1 className="login-title">App Horas de Vuelo</h1>
          <p className="login-copy">Verificando sesion...</p>
        </section>
      </main>
    );
  }

  if (authStatus !== AUTH_STATUS.authenticated) {
    return (
      <LoginScreen
        loginLoading={loginLoading}
        loginError={loginError}
        onLoginSubmit={handleLoginSubmit}
      />
    );
  }

  return (
    <main className="app-shell">
      <style>
        {`
          .flight-form-placeholder::placeholder {
            color: #9ca3af;
            opacity: 1;
          }
        `}
      </style>

      <div className="app-toolbar">
        <div className="app-session-bar">
          <div className="app-user-chip">
            Sesion activa: <strong>{currentUser?.username ?? "usuario"}</strong>
          </div>
          <button
            type="button"
            className="app-theme-toggle"
            onClick={handleToggleTheme}
            aria-label={themeButtonLabel}
            title={themeButtonLabel}
          >
            <span aria-hidden="true">{themeIcon}</span>
          </button>
        </div>
        <button type="button" className="app-logout" onClick={handleLogout}>
          Cerrar sesion
        </button>
      </div>

      <div className="app-tabs" role="tablist" aria-label="Secciones principales">
        <button
          type="button"
          role="tab"
          aria-selected={activeMainTab === "registro"}
          className={`app-tab ${activeMainTab === "registro" ? "is-active" : ""}`}
          onClick={() => setActiveMainTab("registro")}
        >
          Registro
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeMainTab === "historiales"}
          className={`app-tab ${activeMainTab === "historiales" ? "is-active" : ""}`}
          onClick={() => setActiveMainTab("historiales")}
        >
          Historiales
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeMainTab === "dashboards"}
          className={`app-tab ${activeMainTab === "dashboards" ? "is-active" : ""}`}
          onClick={() => setActiveMainTab("dashboards")}
        >
          Dashboards
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeMainTab === "settings"}
          className={`app-tab ${activeMainTab === "settings" ? "is-active" : ""}`}
          onClick={() => setActiveMainTab("settings")}
        >
          Settings
        </button>
      </div>

      {activeMainTab === "registro" ? (
        <>
          <form onSubmit={handleSubmit} style={formStyle}>
            <h1
              style={{
                marginTop: 0,
                marginBottom: "20px",
                textAlign: "center",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "20px",
                color: "var(--app-text)",
              }}
            >
              <span>Registro de Vuelo</span>
              <span style={{ fontSize: "0.8em", letterSpacing: "0.06em" }}>LV-MHZ</span>
            </h1>

            <div style={fieldStyle}>
              <FieldLabel htmlFor="fecha" title="Fecha" required />
              <input
                id="fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <FieldLabel htmlFor="desde" title="Desde" required />
              <input
                id="desde"
                type="text"
                value={desde}
                onChange={(e) => setDesde(e.target.value)}
                placeholder="Ej: AGR"
                className={placeholderClassName}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <FieldLabel htmlFor="hasta" title="Hasta" required />
              <input
                id="hasta"
                type="text"
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
                placeholder="Ej: SACO"
                className={placeholderClassName}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <FieldLabel
                htmlFor="tiempoVueloJPI"
                title="Tiempo vuelo"
                required
                subTechnical="(jpi)"
              />
              <input
                id="tiempoVueloJPI"
                type="number"
                step="0.1"
                value={tiempoVueloJPI}
                onChange={(e) => setTiempoVueloJPI(e.target.value)}
                placeholder="Ej: 1.0"
                className={placeholderClassName}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <FieldLabel
                htmlFor="tiempoEnServicioGarmin"
                title="Tiempo en servicio"
                required
                subTechnical="(garmin)"
              />
              <input
                id="tiempoEnServicioGarmin"
                type="number"
                step="0.1"
                value={tiempoEnServicioGarmin}
                onChange={(e) => setTiempoEnServicioGarmin(e.target.value)}
                placeholder="Ej: 0.8"
                className={placeholderClassName}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <FieldLabel htmlFor="piloto" title="Piloto" required />
              <input
                id="piloto"
                type="text"
                value={piloto}
                onChange={(e) => setPiloto(e.target.value)}
                placeholder="Nombre y apellido"
                className={placeholderClassName}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <FieldLabel htmlFor="propietario" title="Propietario" required />
              <PropietarioSelect
                value={propietario}
                onChange={setPropietario}
                disabled={loading}
              />
            </div>

            <div style={fieldStyle}>
              <FieldLabel htmlFor="aceiteAgregado" title="Aceite agregado" />
              <input
                id="aceiteAgregado"
                type="number"
                value={aceiteAgregado}
                onChange={(e) => setAceiteAgregado(e.target.value)}
                placeholder="Ej: 0.5"
                className={placeholderClassName}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <FieldLabel
                htmlFor="combustibleTanqueIzquierdo"
                title="Combustible tanque izquierdo"
              />
              <input
                id="combustibleTanqueIzquierdo"
                type="number"
                value={combustibleTanqueIzquierdo}
                onChange={(e) => setCombustibleTanqueIzquierdo(e.target.value)}
                placeholder="Ej: 50"
                className={placeholderClassName}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <FieldLabel
                htmlFor="combustibleTanqueDerecho"
                title="Combustible tanque derecho"
              />
              <input
                id="combustibleTanqueDerecho"
                type="number"
                value={combustibleTanqueDerecho}
                onChange={(e) => setCombustibleTanqueDerecho(e.target.value)}
                placeholder="Ej: 70"
                className={placeholderClassName}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <FieldLabel htmlFor="observaciones" title="Observaciones" />
              <textarea
                id="observaciones"
                value={observaciones}
                onChange={(e) => setObservaciones(e.target.value)}
                placeholder="Escribe aqui tus observaciones..."
                className={placeholderClassName}
                style={{ ...inputStyle, minHeight: "90px", resize: "vertical" }}
              />
            </div>

            <div className="form-actions">
              <button
                type="submit"
                className="form-action-button is-primary"
                disabled={loading}
              >
                {loading
                  ? "Guardando..."
                  : editingId
                    ? "Actualizar vuelo"
                    : "Save Flight"}
              </button>
              <button
                type="button"
                className="form-action-button"
                onClick={rellenadoRapido}
                disabled={loading}
              >
                Quick Flight
              </button>
              <button
                type="button"
                className="form-action-button"
                onClick={limpiarFormulario}
                disabled={loading}
              >
                Clear All
              </button>
            </div>

            {mensajeExito ? (
              <p style={{ color: "var(--app-success)", marginTop: "12px" }}>{mensajeExito}</p>
            ) : null}

            {mensajeError ? (
              <p style={{ color: "var(--app-danger)", marginTop: "12px" }}>{mensajeError}</p>
            ) : null}
          </form>

          {ultimoInput ? (
            <section
              style={{
                maxWidth: "720px",
                margin: "0 auto 32px",
                padding: "16px",
                border: "1px solid var(--app-border)",
                borderRadius: "18px",
                background:
                  "linear-gradient(180deg, var(--app-surface) 0%, color-mix(in srgb, var(--app-surface) 92%, var(--app-surface-muted) 8%) 100%)",
                color: "var(--app-text)",
                fontFamily: "Arial, sans-serif",
                boxShadow: "var(--app-shadow)",
              }}
            >
              <h2 style={{ marginTop: 0, marginBottom: "12px" }}>Ultimo input</h2>
              <p style={{ margin: "4px 0" }}>
                <strong>Fecha:</strong> {`${ultimoInput.dia}-${ultimoInput.mes}-${ultimoInput.anio}`}
              </p>
              <p style={{ margin: "4px 0" }}>
                <strong>Desde:</strong> {ultimoInput.desde}
              </p>
              <p style={{ margin: "4px 0" }}>
                <strong>Hasta:</strong> {ultimoInput.hasta}
              </p>
              <p style={{ margin: "4px 0" }}>
                <strong>Piloto:</strong> {ultimoInput.piloto}
              </p>
              <p style={{ margin: "4px 0 12px" }}>
                <strong>Propietario:</strong> {ultimoInput.propietario}
              </p>

              <button
                type="button"
                onClick={cargarUltimoInputParaEditar}
                disabled={loading}
                style={{
                  padding: "8px 12px",
                  border: "none",
                  borderRadius: "10px",
                  backgroundColor: loading ? "#94a3b8" : "var(--app-primary-strong)",
                  color: "#ffffff",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontSize: "14px",
                }}
              >
                Modificar ultimo input
              </button>
              <button
                type="button"
                onClick={replicarUltimoInput}
                disabled={loading}
                style={{
                  marginLeft: "10px",
                  padding: "8px 12px",
                  border: "1px solid var(--app-border-strong)",
                  borderRadius: "10px",
                  backgroundColor: "var(--app-surface-muted)",
                  color: loading ? "var(--app-text-soft)" : "var(--app-text)",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontSize: "14px",
                }}
              >
                Replicar ultimo input
              </button>
              <button
                type="button"
                onClick={handleDeleteUltimoVuelo}
                disabled={loading}
                style={{
                  marginLeft: "10px",
                  padding: "8px 12px",
                  border: "1px solid var(--app-danger-border)",
                  borderRadius: "10px",
                  backgroundColor: loading ? "var(--app-danger-soft)" : "var(--app-surface-soft)",
                  color: loading ? "var(--app-text-soft)" : "var(--app-danger)",
                  cursor: loading ? "not-allowed" : "pointer",
                  fontSize: "14px",
                  fontWeight: 600,
                }}
              >
                Borrar ultimo vuelo
              </button>
            </section>
          ) : (
            <p
              style={{
                maxWidth: "720px",
                margin: "0 auto 32px",
                fontFamily: "Arial, sans-serif",
                color: "var(--app-text-muted)",
              }}
            >
              No se han registrado vuelos hoy
            </p>
          )}
        </>
      ) : activeMainTab === "historiales" ? (
        <HistorialesPanel onUnauthorized={() => setAuthStatus(AUTH_STATUS.unauthenticated)} />
      ) : activeMainTab === "dashboards" ? (
        <DashboardPanel
          settings={settings}
          settingsLoading={settingsLoading}
          settingsError={settingsError}
          onUnauthorized={() => setAuthStatus(AUTH_STATUS.unauthenticated)}
        />
      ) : (
        <SettingsPanel
          settings={settings}
          loading={settingsLoading}
          error={settingsError}
          onSave={handleSaveSettings}
        />
      )}
    </main>
  );
}

export default App;
