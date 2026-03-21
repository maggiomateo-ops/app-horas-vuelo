import { useState } from "react";

function App() {
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
      setMensajeError("Completá todos los campos obligatorios.");
      return;
    }

    const [anio, mes, dia] = fecha.split("-");

    const payload = {
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

    console.log(payload);

    try {
      setLoading(true);
    
      const response = await fetch("/api/guardar-vuelo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    
      const result = await response.json();
    
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "No se pudo guardar el vuelo.");
      }
    
      setMensajeExito("Vuelo guardado correctamente.");
      limpiarFormulario();
    } catch (error) {
      console.error(error);
      setMensajeError(error.message || "Hubo un error al guardar el vuelo.");
    } finally {
      setLoading(false);
    }
  }
  
  const formStyle = {
    maxWidth: "720px",
    margin: "32px auto",
    padding: "24px",
    border: "1px solid #e5e7eb",
    borderRadius: "8px",
    backgroundColor: "#ffffff",
    fontFamily: "Arial, sans-serif",
  };

  const fieldStyle = {
    display: "flex",
    flexDirection: "column",
    marginBottom: "14px",
    gap: "6px",
  };

  const inputStyle = {
    padding: "10px",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    fontSize: "14px",
  };

  return (
    <main style={{ padding: "16px", backgroundColor: "#f8fafc", minHeight: "100vh" }}>
      <form onSubmit={handleSubmit} style={formStyle}>
        <h1 style={{ marginTop: 0, marginBottom: "20px" }}>Registro de vuelo</h1>

        <div style={fieldStyle}>
          <label htmlFor="fecha">Fecha *</label>
          <input
            id="fecha"
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="desde">Desde *</label>
          <input
            id="desde"
            type="text"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="hasta">Hasta *</label>
          <input
            id="hasta"
            type="text"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="tiempoVueloJPI">Tiempo Vuelo JPI *</label>
          <input
            id="tiempoVueloJPI"
            type="number"
            step="0.1"
            value={tiempoVueloJPI}
            onChange={(e) => setTiempoVueloJPI(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="tiempoEnServicioGarmin">Tiempo en Servicio Garmin *</label>
          <input
            id="tiempoEnServicioGarmin"
            type="number"
            step="0.1"
            value={tiempoEnServicioGarmin}
            onChange={(e) => setTiempoEnServicioGarmin(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="piloto">Piloto *</label>
          <input
            id="piloto"
            type="text"
            value={piloto}
            onChange={(e) => setPiloto(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="propietario">Propietario *</label>
          <input
            id="propietario"
            type="text"
            value={propietario}
            onChange={(e) => setPropietario(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="aceiteAgregado">Aceite agregado</label>
          <input
            id="aceiteAgregado"
            type="number"
            value={aceiteAgregado}
            onChange={(e) => setAceiteAgregado(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="combustibleTanqueIzquierdo">Combustible tanque izquierdo</label>
          <input
            id="combustibleTanqueIzquierdo"
            type="number"
            value={combustibleTanqueIzquierdo}
            onChange={(e) => setCombustibleTanqueIzquierdo(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="combustibleTanqueDerecho">Combustible tanque derecho</label>
          <input
            id="combustibleTanqueDerecho"
            type="number"
            value={combustibleTanqueDerecho}
            onChange={(e) => setCombustibleTanqueDerecho(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={fieldStyle}>
          <label htmlFor="observaciones">Observaciones</label>
          <textarea
            id="observaciones"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            style={{ ...inputStyle, minHeight: "90px", resize: "vertical" }}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            padding: "10px 16px",
            border: "none",
            borderRadius: "6px",
            backgroundColor: loading ? "#9ca3af" : "#2563eb",
            color: "#ffffff",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: "14px",
          }}
        >
          {loading ? "Guardando..." : "Guardar vuelo"}
        </button>

        {mensajeExito ? (
          <p style={{ color: "#15803d", marginTop: "12px" }}>{mensajeExito}</p>
        ) : null}

        {mensajeError ? (
          <p style={{ color: "#dc2626", marginTop: "12px" }}>{mensajeError}</p>
        ) : null}
      </form>
    </main>
  );
}

export default App;
