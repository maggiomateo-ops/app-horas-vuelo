import { useEffect, useMemo, useState } from "react";
import { fetchHistoriales } from "../services/historialesService";
import { buildDashboardMetrics } from "../utils/dashboardMetrics";

function formatMetricValue(value, decimals = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "--";
  }

  return Number(value).toFixed(decimals).replace(/\.0$/, "");
}

function KpiCard({ title, value, suffix, tone = "neutral", detail }) {
  return (
    <article className={`dashboard-card dashboard-card-${tone}`}>
      <p className="dashboard-card-title">{title}</p>
      <div className="dashboard-card-value-row">
        <strong className="dashboard-card-value">{value}</strong>
        {suffix ? <span className="dashboard-card-suffix">{suffix}</span> : null}
      </div>
      <p className="dashboard-card-detail">{detail}</p>
    </article>
  );
}

function DataTable({ columns, rows, emptyMessage, compact = false }) {
  if (!rows.length) {
    return <p className="dashboard-empty">{emptyMessage}</p>;
  }

  return (
    <div className="dashboard-table-wrapper">
      <table className={`dashboard-table ${compact ? "dashboard-table-compact" : ""}`}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id ?? row.year ?? row.owner}>
              {columns.map((column) => (
                <td key={column.key}>{row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DashboardPanel({ aircraftId, onUnauthorized, settings, settingsLoading, settingsError }) {
  const [historiales, setHistoriales] = useState({
    computacionHoras: [],
    historialAeronave: [],
    historialMotor: [],
    historialHelice: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboardData() {
      try {
        setLoading(true);
        setError("");
        const response = await fetchHistoriales(aircraftId, "dashboard", controller.signal);

        setHistoriales({
          computacionHoras: Array.isArray(response.computacionHoras)
            ? response.computacionHoras
            : [],
          historialAeronave: Array.isArray(response.historialAeronave)
            ? response.historialAeronave
            : [],
          historialMotor: Array.isArray(response.historialMotor)
            ? response.historialMotor
            : [],
          historialHelice: Array.isArray(response.historialHelice)
            ? response.historialHelice
            : [],
        });
      } catch (fetchError) {
        if (fetchError.name === "AbortError") {
          return;
        }

        if (fetchError.message === "UNAUTHORIZED") {
          onUnauthorized?.();
          return;
        }

        setError(fetchError.message || "No se pudieron cargar los dashboards.");
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();

    return () => {
      controller.abort();
    };
  }, [aircraftId, onUnauthorized]);

  const metrics = useMemo(
    () => buildDashboardMetrics(historiales, settings),
    [historiales, settings]
  );

  const totalCards = [
    {
      title: "Total aeronave",
      value: formatMetricValue(metrics.totals.aeronave),
      suffix: "hrs",
      detail: "Historial Aeronave",
    },
    {
      title: "Total motor",
      value: formatMetricValue(metrics.totals.motor),
      suffix: "hrs",
      detail: "Historial Motor",
    },
    {
      title: "Total helice",
      value: formatMetricValue(metrics.totals.helice),
      suffix: "hrs",
      detail: "Historial Helice",
    },
    {
      title: "D.U.R.G. helice",
      value: formatMetricValue(metrics.totals.durg),
      suffix: "hrs",
      detail: "Ultimo valor registrado",
    },
  ];

  const ownerUsageSections = metrics.ownerUsageSections.map((section) => ({
    ...section,
    rows: section.rows.map((entry) => ({
      id: `${section.id}-${entry.owner}`,
      owner: entry.owner,
      hours: `${formatMetricValue(entry.hours)} hrs`,
      share: `${formatMetricValue(entry.share)}%`,
    })),
  }));

  const annualRows = metrics.annualUtilization.map((entry) => ({
    id: String(entry.year),
    year: entry.year,
    hours: entry.hours === null ? "--" : `${formatMetricValue(entry.hours)} hrs`,
    variation:
      entry.variationPct === null
        ? "--"
        : `${entry.variationPct > 0 ? "+" : ""}${formatMetricValue(entry.variationPct)}%`,
  }));

  if (loading) {
    return (
      <section className="dashboard-panel">
        <p className="dashboard-status">Cargando dashboards...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="dashboard-panel">
        <p className="dashboard-status dashboard-status-error">{error}</p>
      </section>
    );
  }

  return (
    <section className="dashboard-panel">
      <div className="dashboard-section-header">
        <h2 className="dashboard-title">Dashboard</h2>
      </div>

      {!metrics.meta.hasComputacionHoras ? (
        <p className="dashboard-inline-note">
          Aun no llegaron filas de Computacion Horas desde la API. Los KPIs de propietario y
          aceite pueden verse incompletos.
        </p>
      ) : null}

      {settingsLoading ? <p className="dashboard-status">Cargando parametros de dashboard...</p> : null}
      {settingsError ? (
        <p className="dashboard-status dashboard-status-error">{settingsError}</p>
      ) : null}

      <section className="dashboard-section dashboard-section-totals">
        <div className="dashboard-section-heading">
          <h3>Totales generales</h3>
          <p>Tomados del ultimo valor disponible de cada historial tecnico.</p>
        </div>
        <div className="dashboard-grid dashboard-grid-four">
          {totalCards.map((card) => (
            <KpiCard key={card.title} {...card} tone="neutral" />
          ))}
        </div>
      </section>

      <section className="dashboard-section dashboard-section-inspections">
        <div className="dashboard-section-heading">
          <h3>Proximas inspecciones</h3>
          <p>Estados dinamicos segun los umbrales configurados en Settings.</p>
        </div>
        <div className="dashboard-grid dashboard-grid-three">
          {metrics.inspections.map((inspection) => (
            <KpiCard
              key={inspection.id}
              title={inspection.label}
              value={formatMetricValue(inspection.value)}
              suffix={inspection.suffix}
              tone={inspection.tone}
              detail={inspection.detail}
            />
          ))}
        </div>
      </section>

      <section className="dashboard-section dashboard-section-owner">
        <div className="dashboard-section-heading">
          <h3>Uso por propietario</h3>
          <p>Sumatoria de Tiempo en Servicio y porcentaje sobre el total segun cada corte.</p>
        </div>
        <div className="settings-stack">
          {ownerUsageSections.map((section) => (
            <div key={section.id} className="settings-subsection">
              <h3>{section.title}</h3>
              <p className="dashboard-meta">{section.detail}</p>
              {section.startFound && section.startFlightId ? (
                <p className="dashboard-meta">
                  Vuelo de corte resuelto: ID {section.startFlightId}
                  {section.startFlightDate ? ` | Fecha ${section.startFlightDate}` : ""}
                </p>
              ) : (
                <p className="dashboard-inline-note">{section.fallbackMessage}</p>
              )}
              <DataTable
                columns={[
                  { key: "owner", label: "Propietario" },
                  { key: "hours", label: "Horas" },
                  { key: "share", label: "% Uso" },
                ]}
                rows={section.rows}
                compact
                emptyMessage="Sin datos suficientes para este corte."
              />
            </div>
          ))}
        </div>
      </section>

      <section className="dashboard-section dashboard-section-oil">
        <div className="dashboard-section-heading">
          <h3>Consumo de aceite</h3>
          <p>Ventana movil de {metrics.oil.windowMonths} meses usando Tiempo en Servicio.</p>
        </div>
        <div className="dashboard-grid dashboard-grid-three">
          <KpiCard
            title={`${settings.appConfig.oilUnitLabel}/Hr`}
            value={formatMetricValue(metrics.oil.perHour, 3)}
            tone="neutral"
            detail={`Aceite: ${formatMetricValue(metrics.oil.totalOilAdded, 2)} ${settings.appConfig.oilUnitLabel}`}
          />
          <KpiCard
            title={`${settings.appConfig.oilUnitLabel}/10 hrs`}
            value={formatMetricValue(metrics.oil.perTenHours, 2)}
            tone="neutral"
            detail={`Horas base: ${formatMetricValue(metrics.oil.totalServiceHours)} hrs`}
          />
          <KpiCard
            title={`Costo/Hr (${settings.appConfig.currency})`}
            value={formatMetricValue(metrics.oil.costPerHour, 2)}
            tone="neutral"
            detail="Calculado con precio actual de aceite"
          />
        </div>
      </section>

      <section className="dashboard-section dashboard-section-annual">
        <div className="dashboard-section-heading">
          <h3>Utilización anual</h3>
        </div>
        <DataTable
          columns={[
            { key: "year", label: "AÑO" },
            { key: "hours", label: "Horas" },
            { key: "variation", label: "Variación" },
          ]}
          rows={annualRows}
          compact
          emptyMessage="Sin datos suficientes para calcular utilizacion anual."
        />
      </section>
    </section>
  );
}

export default DashboardPanel;
