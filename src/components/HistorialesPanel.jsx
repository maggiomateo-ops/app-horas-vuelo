import { useEffect, useMemo, useState } from "react";
import HistorialTable from "./HistorialTable";
import { fetchHistoriales } from "../services/historialesService";
import { getLatestRecords } from "../utils/historiales";

const HISTORIAL_TABS = [
  { id: "aeronave", label: "Aeronave", responseKey: "historialAeronave" },
  { id: "motor", label: "Motor", responseKey: "historialMotor" },
  { id: "helice", label: "Helice", responseKey: "historialHelice" },
];

const HISTORIAL_LIMIT_OPTIONS = [10, 20, 30, 40, 50, 100];

const HISTORIAL_COLUMNS = {
  aeronave: [
    { key: "fecha", label: "Fecha" },
    { key: "desde", label: "Desde" },
    { key: "hasta", label: "Hasta" },
    { key: "tiempoEnServicio", label: "Tiempo en Servicio" },
    { key: "tiempoTotalEnServicio", label: "Tiempo Total en Servicio" },
    { key: "tiempoDeVuelo", label: "Tiempo de Vuelo" },
    { key: "piloto", label: "Piloto" },
    { key: "observaciones", label: "Observaciones" },
  ],
  motor: [
    { key: "fecha", label: "Fecha" },
    { key: "desde", label: "Desde" },
    { key: "hasta", label: "Hasta" },
    { key: "tiempoEnServicio", label: "Tiempo en Servicio" },
    { key: "tiempoTotalEnServicio", label: "Tiempo Total en Servicio" },
    { key: "piloto", label: "Piloto" },
    { key: "observaciones", label: "Observaciones" },
  ],
  helice: [
    { key: "fecha", label: "Fecha" },
    { key: "desde", label: "Desde" },
    { key: "hasta", label: "Hasta" },
    { key: "tiempoEnServicio", label: "Tiempo en Servicio" },
    { key: "tiempoTotalEnServicio", label: "Tiempo Total en Servicio" },
    { key: "durg", label: "D.U.R.G." },
    { key: "piloto", label: "Piloto" },
    { key: "observaciones", label: "Observaciones" },
  ],
};

function HistorialesPanel({ onUnauthorized }) {
  const [activeHistorial, setActiveHistorial] = useState("aeronave");
  const [recordsLimit, setRecordsLimit] = useState(HISTORIAL_LIMIT_OPTIONS[0]);
  const [printMode, setPrintMode] = useState(null);
  const [historiales, setHistoriales] = useState({
    historialAeronave: [],
    historialMotor: [],
    historialHelice: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadHistoriales() {
      try {
        setLoading(true);
        setError("");

        const data = await fetchHistoriales(controller.signal);

        setHistoriales({
          historialAeronave: Array.isArray(data.historialAeronave)
            ? data.historialAeronave
            : [],
          historialMotor: Array.isArray(data.historialMotor) ? data.historialMotor : [],
          historialHelice: Array.isArray(data.historialHelice) ? data.historialHelice : [],
        });
      } catch (fetchError) {
        if (fetchError.name === "AbortError") {
          return;
        }

        if (fetchError.message === "UNAUTHORIZED") {
          onUnauthorized?.();
          return;
        }

        setError(fetchError.message || "No se pudieron cargar los historiales.");
      } finally {
        setLoading(false);
      }
    }

    loadHistoriales();

    return () => {
      controller.abort();
    };
  }, [onUnauthorized]);

  useEffect(() => {
    if (!printMode) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      window.print();
    }, 60);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [printMode]);

  useEffect(() => {
    const handleAfterPrint = () => {
      setPrintMode(null);
    };

    window.addEventListener("afterprint", handleAfterPrint);

    return () => {
      window.removeEventListener("afterprint", handleAfterPrint);
    };
  }, []);

  const currentTab = useMemo(
    () => HISTORIAL_TABS.find((tab) => tab.id === activeHistorial) ?? HISTORIAL_TABS[0],
    [activeHistorial]
  );

  const currentRows = useMemo(() => {
    return getLatestRecords(historiales[currentTab.responseKey], recordsLimit);
  }, [currentTab.responseKey, historiales, recordsLimit]);

  const printableSections = useMemo(() => {
    if (printMode === "all") {
      return HISTORIAL_TABS.map((tab) => ({
        id: tab.id,
        label: tab.label,
        columns: HISTORIAL_COLUMNS[tab.id],
        rows: getLatestRecords(historiales[tab.responseKey], recordsLimit),
      }));
    }

    return [
      {
        id: currentTab.id,
        label: currentTab.label,
        columns: HISTORIAL_COLUMNS[currentTab.id],
        rows: currentRows,
      },
    ];
  }, [currentRows, currentTab.id, currentTab.label, historiales, printMode, recordsLimit]);

  const handlePrintCurrent = () => {
    setPrintMode("single");
  };

  const handlePrintAll = () => {
    setPrintMode("all");
  };

  return (
    <section className="history-panel">
      <div className="history-screen">
        <div className="history-topbar">
          <div className="history-subtabs" role="tablist" aria-label="Tipos de historial">
            {HISTORIAL_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeHistorial === tab.id}
                className={`history-subtab ${activeHistorial === tab.id ? "is-active" : ""}`}
                onClick={() => setActiveHistorial(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="history-toolbar-group">
            <div className="history-print-actions">
              <button
                type="button"
                className="history-print-button"
                onClick={handlePrintCurrent}
                disabled={loading || !!error}
              >
                Print
              </button>
              <button
                type="button"
                className="history-print-button is-secondary"
                onClick={handlePrintAll}
                disabled={loading || !!error}
              >
                Print All
              </button>
            </div>

            <label className="history-filter" htmlFor="history-records-limit">
              <span>Cantidad de registros</span>
              <select
                id="history-records-limit"
                value={recordsLimit}
                onChange={(e) => setRecordsLimit(Number(e.target.value))}
              >
                {HISTORIAL_LIMIT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    Ultimos {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {loading ? <p className="history-status">Cargando historiales...</p> : null}
        {!loading && error ? <p className="history-status history-status-error">{error}</p> : null}
        {!loading && !error ? (
          <HistorialTable
            columns={HISTORIAL_COLUMNS[activeHistorial]}
            rows={currentRows}
            emptyMessage="Sin datos"
          />
        ) : null}
      </div>

      <div className="history-print-layout">
        <div className="history-print-header">
          <h2>Historiales LV-MHZ</h2>
          <p>Registros incluidos: ultimos {recordsLimit}</p>
        </div>

        {printableSections.map((section) => (
          <section key={section.id} className="history-print-section">
            <div className="history-print-section-header">
              <h3>{section.label}</h3>
              <span>{section.rows.length} registros</span>
            </div>
            <HistorialTable
              columns={section.columns}
              rows={section.rows}
              emptyMessage="Sin datos"
            />
          </section>
        ))}
      </div>
    </section>
  );
}

export default HistorialesPanel;
