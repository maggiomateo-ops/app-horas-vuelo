import { useCallback, useEffect, useState } from "react";
import "./App.css";
import DashboardPanel from "./components/DashboardPanel";
import HistorialesPanel from "./components/HistorialesPanel";
import SettingsPanel from "./components/SettingsPanel";
import { fetchAircrafts } from "./services/aircraftService";
import { DEFAULT_SETTINGS, fetchSettings, saveSettings } from "./services/settingsService";
import {
  getAllowedMainTabIds,
  getPreferredMainTab,
  MAIN_TABS,
} from "./utils/rolePermissions";

const AUTH_STATUS = {
  loading: "loading",
  authenticated: "authenticated",
  unauthenticated: "unauthenticated",
};

function getTodayInputValue() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

const GOOGLE_AUTH_ENABLED = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";
const GOOGLE_CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();

function GoogleSignInButton({ clientId, disabled, onCredential, onError }) {
  useEffect(() => {
    if (!clientId) {
      onError("Google Sign-In no esta configurado.");
      return undefined;
    }

    let cancelled = false;

    const renderButton = () => {
      const buttonContainer = document.getElementById("google-sign-in-button");

      if (cancelled || !buttonContainer || !window.google?.accounts?.id) {
        return;
      }

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response?.credential) {
            onCredential(response.credential);
          } else {
            onError("Google no devolvio una credencial valida.");
          }
        },
      });

      buttonContainer.replaceChildren();
      window.google.accounts.id.renderButton(buttonContainer, {
        type: "standard",
        theme: "outline",
        size: "large",
        text: "continue_with",
        shape: "pill",
        width: 320,
      });
    };

    if (window.google?.accounts?.id) {
      renderButton();
      return () => {
        cancelled = true;
      };
    }

    let script = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');

    if (!script) {
      script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    const handleScriptError = () => onError("No se pudo cargar Google Sign-In.");

    script.addEventListener("load", renderButton);
    script.addEventListener("error", handleScriptError);

    return () => {
      cancelled = true;
      script.removeEventListener("load", renderButton);
      script.removeEventListener("error", handleScriptError);
    };
  }, [clientId, onCredential, onError]);

  return (
    <div className={`google-login-control ${disabled ? "is-disabled" : ""}`}>
      <div id="google-sign-in-button" className="google-login-button" />
      {disabled ? <p className="google-login-status">Ingresando con Google...</p> : null}
    </div>
  );
}

function LoginScreen({
  googleEnabled,
  googleClientId,
  googleLoading,
  loginLoading,
  loginError,
  onGoogleCredential,
  onGoogleError,
  onLoginSubmit,
}) {
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

        {googleEnabled ? (
          <>
            <GoogleSignInButton
              clientId={googleClientId}
              disabled={googleLoading}
              onCredential={onGoogleCredential}
              onError={onGoogleError}
            />
            <div className="login-separator" aria-hidden="true">
              <span>o ingresa con tu usuario actual</span>
            </div>
          </>
        ) : null}

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
            disabled={loginLoading || googleLoading}
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
            disabled={loginLoading || googleLoading}
          />

          <button
            className="login-button"
            type="submit"
            disabled={loginLoading || googleLoading}
          >
            {loginLoading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        {loginError ? <p className="login-error">{loginError}</p> : null}
      </section>
    </main>
  );
}

function PropietarioSelect({ value, options: ownerOptions, onChange, disabled }) {
  const [isOpen, setIsOpen] = useState(false);

  const options = [
    { value: "", label: "Seleccionar..." },
    ...ownerOptions.map((option) => ({ value: option, label: option })),
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
  const [googleLoginLoading, setGoogleLoginLoading] = useState(false);
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
  const [aircrafts, setAircrafts] = useState([]);
  const [selectedAircraftId, setSelectedAircraftId] = useState("");
  const [aircraftsLoading, setAircraftsLoading] = useState(true);
  const [aircraftsError, setAircraftsError] = useState("");
  const [activeMainTab, setActiveMainTab] = useState("registro");
  const [fecha, setFecha] = useState(getTodayInputValue);
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
  const [formErrors, setFormErrors] = useState({});
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
      setAircrafts([]);
      setSelectedAircraftId("");
      return undefined;
    }

    const controller = new AbortController();
    let ignore = false;

    async function loadAircrafts() {
      try {
        setAircraftsLoading(true);
        setAircraftsError("");
        const nextAircrafts = await fetchAircrafts(controller.signal);

        if (!ignore) {
          setAircrafts(nextAircrafts);
          setSelectedAircraftId(nextAircrafts[0]?.aircraft_id ?? "");
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
          setAircrafts([]);
          setSelectedAircraftId("");
          setAircraftsError(error.message || "No se pudieron cargar las aeronaves.");
        }
      } finally {
        if (!ignore) {
          setAircraftsLoading(false);
        }
      }
    }

    loadAircrafts();

    return () => {
      ignore = true;
      controller.abort();
    };
  }, [authStatus]);

  const selectedAircraft =
    aircrafts.find((aircraft) => aircraft.aircraft_id === selectedAircraftId) ?? null;
  const selectedAircraftRole = String(selectedAircraft?.rol || "").trim().toUpperCase();
  const isGlobalAdmin = currentUser?.isAdmin === true;
  const allowedMainTabIds = getAllowedMainTabIds({
    isAdmin: isGlobalAdmin,
    aircraftRole: selectedAircraftRole,
  });
  const preferredMainTab = getPreferredMainTab({
    isAdmin: isGlobalAdmin,
    aircraftRole: selectedAircraftRole,
  });
  const effectiveActiveMainTab = allowedMainTabIds.includes(activeMainTab)
    ? activeMainTab
    : preferredMainTab;
  const canEditAircraft =
    isGlobalAdmin || selectedAircraftRole === "OWNER" || selectedAircraftRole === "ADMIN";

  useEffect(() => {
    if (selectedAircraft && !allowedMainTabIds.includes(activeMainTab)) {
      setActiveMainTab(preferredMainTab);
    }
  }, [activeMainTab, allowedMainTabIds, preferredMainTab, selectedAircraft]);

  useEffect(() => {
    if (authStatus !== AUTH_STATUS.authenticated) {
      return undefined;
    }

    if (!selectedAircraftId) {
      setSettings(DEFAULT_SETTINGS);
      setSettingsError("");
      return undefined;
    }

    const controller = new AbortController();
    let ignore = false;

    async function loadRemoteSettings() {
      try {
        setSettingsLoading(true);
        setSettingsError("");
        const nextSettings = await fetchSettings(selectedAircraftId, controller.signal);

        if (!ignore) {
          setSettings(nextSettings);
          const operationalConfig = nextSettings.operationalConfig;
          setFecha(getTodayInputValue());
          setDesde(String(operationalConfig.defaultOrigin ?? ""));
          setHasta(String(operationalConfig.defaultDestination ?? ""));
          setTiempoVueloJPI(String(operationalConfig.defaultFlightTimeJPI ?? ""));
          setTiempoEnServicioGarmin(
            String(operationalConfig.defaultServiceTimeGarmin ?? "")
          );
          setPiloto("");
          setPropietario("");
          setAceiteAgregado("");
          setCombustibleTanqueIzquierdo("");
          setCombustibleTanqueDerecho("");
          setObservaciones("");
          setEditingId(null);
          setFormErrors({});
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
  }, [authStatus, selectedAircraftId]);

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
    return settings.operationalConfig.ownerOptions.includes(u) ? u : "";
  };

  const limpiarFormulario = () => {
    const operationalConfig = settings.operationalConfig;
    setFecha(getTodayInputValue());
    setDesde(String(operationalConfig.defaultOrigin ?? ""));
    setHasta(String(operationalConfig.defaultDestination ?? ""));
    setTiempoVueloJPI(String(operationalConfig.defaultFlightTimeJPI ?? ""));
    setTiempoEnServicioGarmin(String(operationalConfig.defaultServiceTimeGarmin ?? ""));
    setPiloto("");
    setPropietario("");
    setAceiteAgregado("");
    setCombustibleTanqueIzquierdo("");
    setCombustibleTanqueDerecho("");
    setObservaciones("");
    setEditingId(null);
    setFormErrors({});
  };

  const rellenadoRapido = () => {
    const hoy = getTodayInputValue();
    const operationalConfig = settings.operationalConfig;

    if (!fecha) setFecha(hoy);
    if (!desde) setDesde(String(operationalConfig.defaultOrigin));
    if (!hasta) setHasta(String(operationalConfig.defaultDestination));
    if (!tiempoVueloJPI) setTiempoVueloJPI(String(operationalConfig.defaultFlightTimeJPI));
    if (!tiempoEnServicioGarmin) {
      setTiempoEnServicioGarmin(String(operationalConfig.defaultServiceTimeGarmin));
    }
    setFormErrors({});
    setMensajeError("");
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
    setFormErrors({});
    setMensajeExito("");
    setMensajeError("");
  };

  const replicarUltimoInput = () => {
    if (!ultimoInput) return;

    setFecha(getTodayInputValue());
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
    setFormErrors({});
    setMensajeExito("");
    setMensajeError("");
  };

  const handleDeleteUltimoVuelo = async () => {
    if (!ultimoInput?.id || loading || !selectedAircraft) {
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
          aircraft_id: selectedAircraft.aircraft_id,
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

    if (loading) {
      return;
    }

    setMensajeExito("");
    setMensajeError("");
    const nextErrors = {};

    if (!selectedAircraft) {
      setMensajeError("Selecciona una aeronave antes de guardar el vuelo.");
      return;
    }

    const dateParts = fecha.split("-");
    const parsedDate = new Date(`${fecha}T00:00:00`);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(fecha) &&
      !Number.isNaN(parsedDate.getTime()) &&
      parsedDate.getFullYear() === Number(dateParts[0]) &&
      parsedDate.getMonth() + 1 === Number(dateParts[1]) &&
      parsedDate.getDate() === Number(dateParts[2]);

    if (!validDate) nextErrors.fecha = "Ingresá una fecha válida.";
    if (!desde.trim()) nextErrors.desde = "Ingresá el origen.";
    if (!hasta.trim()) nextErrors.hasta = "Ingresá el destino.";
    if (tiempoVueloJPI === "" || !Number.isFinite(Number(tiempoVueloJPI)) || Number(tiempoVueloJPI) < 0) {
      nextErrors.tiempoVueloJPI = "Ingresá un tiempo válido.";
    }
    if (
      tiempoEnServicioGarmin === "" ||
      !Number.isFinite(Number(tiempoEnServicioGarmin)) ||
      Number(tiempoEnServicioGarmin) < 0
    ) {
      nextErrors.tiempoEnServicioGarmin = "Ingresá un tiempo válido.";
    }
    if (!piloto.trim()) nextErrors.piloto = "Ingresá el piloto.";
    if (!propietario.trim()) nextErrors.propietario = "Seleccioná el propietario.";

    const optionalNumericFields = [
      ["aceiteAgregado", aceiteAgregado],
      ["combustibleTanqueIzquierdo", combustibleTanqueIzquierdo],
      ["combustibleTanqueDerecho", combustibleTanqueDerecho],
    ];
    optionalNumericFields.forEach(([field, value]) => {
      if (value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
        nextErrors[field] = "Ingresá un valor válido.";
      }
    });

    if (Object.keys(nextErrors).length) {
      setFormErrors(nextErrors);
      setMensajeError("Revisá los campos marcados antes de guardar.");
      return;
    }

    setFormErrors({});

    const [anio, mes, dia] = fecha.split("-");

    const payload = {
      aircraft_id: selectedAircraft.aircraft_id,
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

  const handleGoogleCredential = async (credential) => {
    if (googleLoginLoading) {
      return;
    }

    setGoogleLoginLoading(true);
    setLoginError("");

    try {
      const loginResponse = await fetch("/api/google-login", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ credential }),
      });

      const loginResult = await loginResponse.json().catch(() => null);

      if (!loginResponse.ok || !loginResult?.ok) {
        throw new Error(loginResult?.error || "No se pudo ingresar con Google.");
      }

      const sessionResponse = await fetch("/api/session", {
        method: "GET",
        credentials: "include",
      });
      const sessionResult = await sessionResponse.json().catch(() => null);

      if (!sessionResponse.ok || !sessionResult?.authenticated) {
        throw new Error("No se pudo confirmar la sesion iniciada con Google.");
      }

      setCurrentUser(sessionResult.user ?? null);
      setAuthStatus(AUTH_STATUS.authenticated);
    } catch (error) {
      setCurrentUser(null);
      setAuthStatus(AUTH_STATUS.unauthenticated);
      setLoginError(error.message || "No se pudo ingresar con Google.");
    } finally {
      setGoogleLoginLoading(false);
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
      setAircrafts([]);
      setSelectedAircraftId("");
      setAircraftsError("");
    }
  };

  const handleUnauthorized = useCallback(() => {
    setAuthStatus(AUTH_STATUS.unauthenticated);
  }, []);

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
    if (!selectedAircraft) {
      throw new Error("Selecciona una aeronave antes de guardar los settings.");
    }

    setSettingsError("");
    const savedSettings = await saveSettings(selectedAircraft.aircraft_id, nextSettings);
    setSettings(savedSettings);
    return savedSettings;
  };

  const handleAircraftChange = (event) => {
    const nextAircraftId = event.target.value;

    if (nextAircraftId === selectedAircraftId) {
      return;
    }

    limpiarFormulario();
    setUltimoInput(null);
    setMensajeError("");
    setMensajeExito("");
    setSelectedAircraftId(nextAircraftId);
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
    <label htmlFor={htmlFor} className="flight-field-label">
      <span className="flight-field-label-row">
        <span>{title}</span>
        {subTechnical ? (
          <span className="flight-field-technical">{subTechnical}</span>
        ) : null}
        {required ? (
          <span className="flight-field-required" aria-hidden="true">
            *
          </span>
        ) : null}
      </span>
    </label>
  );

  const FieldError = ({ name }) => formErrors[name] ? (
    <span className="flight-field-error" id={`${name}-error`}>
      {formErrors[name]}
    </span>
  ) : null;

  const clearFieldError = (name) => {
    setFormErrors((current) => {
      if (!current[name]) return current;
      return { ...current, [name]: "" };
    });
  };

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
        googleEnabled={GOOGLE_AUTH_ENABLED}
        googleClientId={GOOGLE_CLIENT_ID}
        googleLoading={googleLoginLoading}
        loginLoading={loginLoading}
        loginError={loginError}
        onGoogleCredential={handleGoogleCredential}
        onGoogleError={setLoginError}
        onLoginSubmit={handleLoginSubmit}
      />
    );
  }

  if (aircraftsLoading) {
    return (
      <main className="app-shell app-auth-shell">
        <section className="login-card">
          <p className="login-eyebrow">Aeronaves</p>
          <h1 className="login-title">App Horas de Vuelo</h1>
          <p className="login-copy">Cargando aeronaves habilitadas...</p>
        </section>
      </main>
    );
  }

  if (aircraftsError || !selectedAircraft) {
    return (
      <main className="app-shell app-auth-shell">
        <section className="login-card">
          <p className="login-eyebrow">Aeronaves</p>
          <h1 className="login-title">App Horas de Vuelo</h1>
          <p className={aircraftsError ? "login-error" : "login-copy"}>
            {aircraftsError || "No tenés aeronaves habilitadas."}
          </p>
          <button type="button" className="login-button" onClick={handleLogout}>
            Cerrar sesion
          </button>
        </section>
      </main>
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

      <header className="app-header">
        <div className="app-brand">
          <span className="app-brand-mark" aria-hidden="true">✦</span>
          <div>
            <p className="app-brand-eyebrow">Flight operations</p>
            <p className="app-brand-title">App Horas de Vuelo</p>
          </div>
        </div>

        <label className="aircraft-selector" htmlFor="aircraft-selector">
          <span className="aircraft-selector-label">Aeronave activa</span>
          <span className="aircraft-selector-control">
            <select
              id="aircraft-selector"
              value={selectedAircraft.aircraft_id}
              onChange={handleAircraftChange}
              disabled={aircrafts.length === 1}
            >
              {aircrafts.map((aircraft) => (
                <option key={aircraft.aircraft_id} value={aircraft.aircraft_id}>
                  {aircraft.matricula} · {aircraft.modelo}
                </option>
              ))}
            </select>
            <span className="aircraft-role">{selectedAircraftRole}</span>
          </span>
        </label>

        <div className="app-toolbar-actions">
          <button
            type="button"
            className="app-theme-toggle"
            onClick={handleToggleTheme}
            aria-label={themeButtonLabel}
            title={themeButtonLabel}
          >
            <span aria-hidden="true">{themeIcon}</span>
          </button>
          <button type="button" className="app-logout" onClick={handleLogout}>
            Cerrar sesion
          </button>
        </div>
      </header>

      <nav className="app-tabs" role="tablist" aria-label="Secciones principales">
        {MAIN_TABS.filter((tab) => allowedMainTabIds.includes(tab.id)).map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={effectiveActiveMainTab === tab.id}
            className={`app-tab ${effectiveActiveMainTab === tab.id ? "is-active" : ""}`}
            onClick={() => setActiveMainTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="app-content">
      {effectiveActiveMainTab === "registro" ? canEditAircraft ? (
        <>
          <form onSubmit={handleSubmit} className="flight-form" noValidate>
            <header className="flight-form-header">
              <div className="flight-form-title">
                <h1>Registro de Vuelo</h1>
                <p>{selectedAircraft.matricula}</p>
              </div>
              {editingId ? (
                <div className="flight-editing-status" role="status">
                  <strong>Editando vuelo</strong>
                  <span>ID {editingId}</span>
                </div>
              ) : null}
            </header>

            <section className="flight-form-section">
              <div className="flight-section-heading">
                <span>01</span>
                <h2>Fecha y ruta</h2>
              </div>
              <div className="flight-field-grid flight-field-grid-three">
                <div className={`flight-field ${formErrors.fecha ? "has-error" : ""}`}>
                  <FieldLabel htmlFor="fecha" title="Fecha" required />
                  <input id="fecha" type="date" value={fecha} aria-describedby={formErrors.fecha ? "fecha-error" : undefined} onChange={(e) => { setFecha(e.target.value); clearFieldError("fecha"); }} />
                  <FieldError name="fecha" />
                </div>
                <div className={`flight-field ${formErrors.desde ? "has-error" : ""}`}>
                  <FieldLabel htmlFor="desde" title="Desde" required />
                  <input id="desde" type="text" value={desde} onChange={(e) => { setDesde(e.target.value.toUpperCase()); clearFieldError("desde"); }} placeholder={settings.operationalConfig.defaultOrigin ? `Ej: ${settings.operationalConfig.defaultOrigin}` : "Código de origen"} className={placeholderClassName} />
                  <FieldError name="desde" />
                </div>
                <div className={`flight-field ${formErrors.hasta ? "has-error" : ""}`}>
                  <FieldLabel htmlFor="hasta" title="Hasta" required />
                  <input id="hasta" type="text" value={hasta} onChange={(e) => { setHasta(e.target.value.toUpperCase()); clearFieldError("hasta"); }} placeholder={settings.operationalConfig.defaultDestination ? `Ej: ${settings.operationalConfig.defaultDestination}` : "Código de destino"} className={placeholderClassName} />
                  <FieldError name="hasta" />
                </div>
              </div>
            </section>

            <section className="flight-form-section">
              <div className="flight-section-heading">
                <span>02</span>
                <h2>Tiempos</h2>
              </div>
              <div className="flight-field-grid flight-field-grid-two">
                <div className={`flight-field ${formErrors.tiempoVueloJPI ? "has-error" : ""}`}>
                  <FieldLabel htmlFor="tiempoVueloJPI" title="Tiempo de vuelo" required subTechnical="JPI" />
                  <input id="tiempoVueloJPI" type="number" inputMode="decimal" min="0" step="0.1" value={tiempoVueloJPI} onChange={(e) => { setTiempoVueloJPI(e.target.value); clearFieldError("tiempoVueloJPI"); }} placeholder="0.0" className={placeholderClassName} />
                  <FieldError name="tiempoVueloJPI" />
                </div>
                <div className={`flight-field ${formErrors.tiempoEnServicioGarmin ? "has-error" : ""}`}>
                  <FieldLabel htmlFor="tiempoEnServicioGarmin" title="Tiempo en servicio" required subTechnical="Garmin" />
                  <input id="tiempoEnServicioGarmin" type="number" inputMode="decimal" min="0" step="0.1" value={tiempoEnServicioGarmin} onChange={(e) => { setTiempoEnServicioGarmin(e.target.value); clearFieldError("tiempoEnServicioGarmin"); }} placeholder="0.0" className={placeholderClassName} />
                  <FieldError name="tiempoEnServicioGarmin" />
                </div>
              </div>
            </section>

            <section className="flight-form-section">
              <div className="flight-section-heading">
                <span>03</span>
                <h2>Tripulación</h2>
              </div>
              <div className="flight-field-grid flight-field-grid-two">
                <div className={`flight-field ${formErrors.piloto ? "has-error" : ""}`}>
                  <FieldLabel htmlFor="piloto" title="Piloto" required />
                  <input id="piloto" type="text" value={piloto} onChange={(e) => { setPiloto(e.target.value); clearFieldError("piloto"); }} placeholder="Nombre y apellido" className={placeholderClassName} />
                  <FieldError name="piloto" />
                </div>
                <div className={`flight-field ${formErrors.propietario ? "has-error" : ""}`}>
                  <FieldLabel htmlFor="propietario" title="Propietario" required />
                  <PropietarioSelect value={propietario} options={settings.operationalConfig.ownerOptions} onChange={(value) => { setPropietario(value); clearFieldError("propietario"); }} disabled={loading} />
                  <FieldError name="propietario" />
                </div>
              </div>
            </section>

            <section className="flight-form-section">
              <div className="flight-section-heading">
                <span>04</span>
                <h2>Consumibles</h2>
              </div>
              <div className="flight-field-grid flight-field-grid-three">
                <div className={`flight-field ${formErrors.aceiteAgregado ? "has-error" : ""}`}>
                  <FieldLabel htmlFor="aceiteAgregado" title="Aceite agregado" />
                  <input id="aceiteAgregado" type="number" inputMode="decimal" min="0" step="any" value={aceiteAgregado} onChange={(e) => { setAceiteAgregado(e.target.value); clearFieldError("aceiteAgregado"); }} placeholder="0" className={placeholderClassName} />
                  <FieldError name="aceiteAgregado" />
                </div>
                <div className={`flight-field ${formErrors.combustibleTanqueIzquierdo ? "has-error" : ""}`}>
                  <FieldLabel htmlFor="combustibleTanqueIzquierdo" title="Combustible izquierdo" />
                  <input id="combustibleTanqueIzquierdo" type="number" inputMode="decimal" min="0" step="any" value={combustibleTanqueIzquierdo} onChange={(e) => { setCombustibleTanqueIzquierdo(e.target.value); clearFieldError("combustibleTanqueIzquierdo"); }} placeholder="0" className={placeholderClassName} />
                  <FieldError name="combustibleTanqueIzquierdo" />
                </div>
                <div className={`flight-field ${formErrors.combustibleTanqueDerecho ? "has-error" : ""}`}>
                  <FieldLabel htmlFor="combustibleTanqueDerecho" title="Combustible derecho" />
                  <input id="combustibleTanqueDerecho" type="number" inputMode="decimal" min="0" step="any" value={combustibleTanqueDerecho} onChange={(e) => { setCombustibleTanqueDerecho(e.target.value); clearFieldError("combustibleTanqueDerecho"); }} placeholder="0" className={placeholderClassName} />
                  <FieldError name="combustibleTanqueDerecho" />
                </div>
              </div>
            </section>

            <section className="flight-form-section flight-form-notes">
              <div className="flight-section-heading">
                <span>05</span>
                <h2>Observaciones</h2>
              </div>
              <div className="flight-field">
                <FieldLabel htmlFor="observaciones" title="Detalle" />
                <textarea id="observaciones" value={observaciones} onChange={(e) => setObservaciones(e.target.value)} placeholder="Escriba aquí..." className={placeholderClassName} />
              </div>
            </section>

            <div className="form-actions flight-form-actions">
              <button
                type="submit"
                className="form-action-button is-primary"
                disabled={loading}
              >
                {loading
                  ? "Guardando..."
                  : editingId
                    ? "Guardar cambios"
                    : "Guardar vuelo"}
              </button>
              <div className="flight-secondary-actions">
                <button
                  type="button"
                  className="form-action-button"
                  onClick={rellenadoRapido}
                  disabled={loading}
                  title="Completa solamente los campos vacíos con la fecha, ruta y tiempos configurados. No guarda automáticamente."
                  aria-label="Quick Flight: completar campos vacíos sin guardar"
                >
                  Quick Flight
                </button>
                <button
                  type="button"
                  className="form-action-button"
                  onClick={limpiarFormulario}
                  disabled={loading}
                >
                  {editingId ? "Cancelar edición" : "Limpiar formulario"}
                </button>
              </div>
            </div>

            {mensajeExito ? (
              <p className="flight-form-message is-success" role="status">{mensajeExito}</p>
            ) : null}

            {mensajeError ? (
              <p className="flight-form-message is-error" role="alert">{mensajeError}</p>
            ) : null}
          </form>

          {ultimoInput ? (
            <section className="last-flight-card">
              <div className="last-flight-heading">
                <div>
                  <p className="flight-form-eyebrow">Actividad reciente</p>
                  <h2>Último vuelo registrado</h2>
                </div>
                <span className="last-flight-date">
                  {`${String(ultimoInput.dia).padStart(2, "0")}/${String(ultimoInput.mes).padStart(2, "0")}/${ultimoInput.anio}`}
                </span>
              </div>

              <div className="last-flight-summary">
                <div className="last-flight-route">
                  <strong>{ultimoInput.desde || "—"}</strong>
                  <span aria-hidden="true">→</span>
                  <strong>{ultimoInput.hasta || "—"}</strong>
                </div>
                <dl>
                  <div><dt>Tiempo JPI</dt><dd>{ultimoInput.tiempoVueloJPI ?? "—"} h</dd></div>
                  <div><dt>Piloto</dt><dd>{ultimoInput.piloto || "—"}</dd></div>
                  <div><dt>Propietario</dt><dd>{ultimoInput.propietario || "—"}</dd></div>
                </dl>
              </div>

              <div className="last-flight-actions">
                <button type="button" onClick={cargarUltimoInputParaEditar} disabled={loading} className="form-action-button is-primary">
                  Editar vuelo
                </button>
                <button type="button" onClick={replicarUltimoInput} disabled={loading} className="form-action-button">
                  Replicar
                </button>
                <button type="button" onClick={handleDeleteUltimoVuelo} disabled={loading} className="form-action-button is-danger">
                  Borrar vuelo
                </button>
              </div>
            </section>
          ) : (
            <section className="last-flight-empty">
              <strong>Sin vuelos registrados hoy</strong>
              <p>El último vuelo guardado durante esta sesión aparecerá acá.</p>
            </section>
          )}
        </>
      ) : (
        <section className="read-only-access" role="status">
          <p className="dashboard-eyebrow">PILOT</p>
          <h2>Carga de vuelos pendiente</h2>
          <p>
            La carga de vuelos con validación del Owner se habilitará en la etapa correspondiente.
          </p>
        </section>
      ) : effectiveActiveMainTab === "historiales" ? (
        <HistorialesPanel
          aircraftId={selectedAircraft.aircraft_id}
          aircraftRegistration={selectedAircraft.matricula}
          onUnauthorized={handleUnauthorized}
        />
      ) : effectiveActiveMainTab === "dashboards" ? (
        <DashboardPanel
          aircraftId={selectedAircraft.aircraft_id}
          settings={settings}
          settingsLoading={settingsLoading}
          settingsError={settingsError}
          onUnauthorized={handleUnauthorized}
        />
      ) : (
        <SettingsPanel
          aircraftId={selectedAircraft.aircraft_id}
          aircraftRegistration={selectedAircraft.matricula}
          aircraftRole={selectedAircraftRole}
          canEdit={canEditAircraft}
          isGlobalAdmin={isGlobalAdmin}
          settings={settings}
          loading={settingsLoading}
          error={settingsError}
          onSave={handleSaveSettings}
          onUnauthorized={handleUnauthorized}
        />
      )}
      </div>
    </main>
  );
}

export default App;
