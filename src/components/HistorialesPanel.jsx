import { useEffect, useMemo, useState } from "react";
import HistorialTable from "./HistorialTable";
import { fetchHistoriales } from "../services/historialesService";
import { getLatestRecords } from "../utils/historiales";

const HISTORIAL_TABS = [
  { id: "aeronave", label: "Aeronave", responseKey: "historialAeronave" },
  { id: "motor", label: "Motor", responseKey: "historialMotor" },
  { id: "helice", label: "Helice", responseKey: "historialHelice" },
];

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

function HistorialesPanel() {
  const [activeHistorial, setActiveHistorial] = useState("aeronave");
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

        setError(fetchError.message || "No se pudieron cargar los historiales.");
      } finally {
        setLoading(false);
      }
    }

    loadHistoriales();

    return () => {
      controller.abort();
    };
  }, []);

  const currentTab = useMemo(
    () => HISTORIAL_TABS.find((tab) => tab.id === activeHistorial) ?? HISTORIAL_TABS[0],
    [activeHistorial]
  );

  const currentRows = useMemo(() => {
    return getLatestRecords(historiales[currentTab.responseKey]);
  }, [currentTab.responseKey, historiales]);

  return (
    <section className="history-panel">
      <div className="history-panel-header">
        <h2>Historiales</h2>
        <p>Consulta los ultimos 10 registros de aeronave, motor y helice</p>
      </div>

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

      {loading ? <p className="history-status">Cargando historiales...</p> : null}
      {!loading && error ? <p className="history-status history-status-error">{error}</p> : null}
      {!loading && !error ? (
        <HistorialTable
          columns={HISTORIAL_COLUMNS[activeHistorial]}
          rows={currentRows}
          emptyMessage="Sin datos"
        />
      ) : null}
    </section>
  );
}

export default HistorialesPanel;
