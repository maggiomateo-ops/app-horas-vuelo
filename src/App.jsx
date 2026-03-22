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
  const [editingId, setEditingId] = useState(null);
  const [ultimoInput, setUltimoInput] = useState(null);

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
    
      setMensajeExito(
        payload.modo === "update"
          ? "Vuelo actualizado correctamente."
          : "Vuelo guardado correctamente."
      );
      
      setUltimoInput(payload);
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
    color: "#111827",
    lineHeight: 1.2,
    textAlign: "center",
  };
  
  const labelRequiredStyle = {
    color: "#dc2626",
    fontWeight: 700,
    fontSize: "15px",
    lineHeight: 1,
    transform: "translateY(1px)",
  };
  
  const labelSubTechnicalStyle = {
    fontSize: "13px",
    fontWeight: 600,
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    lineHeight: 1.2,
    textAlign: "center",
  };

  const inputStyle = {
    boxSizing: "border-box",
    width: "100%",
    padding: "10px",
    border: "1px solid #d1d5db",
    borderRadius: "6px",
    fontSize: "14px",
  };

  const selectStyle = {
    ...inputStyle,
    backgroundColor: "#ffffff",
    cursor: "pointer",
    width: "100%",
  };

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

  return (
    <main style={{ padding: "16px", backgroundColor: "#f8fafc", minHeight: "100vh" }}>
      <style>
        {`
          .flight-form-placeholder::placeholder {
            color: #9ca3af;
            opacity: 1;
          }
        `}
      </style>
      <form onSubmit={handleSubmit} style={formStyle}>
        <h1 style={{ marginTop: 0, marginBottom: "20px" }}>Registro de Vuelo LV-MHZ</h1>

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
          <FieldLabel htmlFor="tiempoVueloJPI" title="Tiempo vuelo" required subTechnical="(jpi)" />
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
          <select
            id="propietario"
            value={propietario}
            onChange={(e) => setPropietario(e.target.value)}
            style={selectStyle}
          >
            <option value="">Seleccionar…</option>
            <option value="ALEGRE">ALEGRE</option>
            <option value="MAGGIO">MAGGIO</option>
          </select>
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
          <FieldLabel htmlFor="combustibleTanqueIzquierdo" title="Combustible tanque izquierdo" />
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
          <FieldLabel htmlFor="combustibleTanqueDerecho" title="Combustible tanque derecho" />
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
            placeholder="escribe aqui tus observaciones..."
            className={placeholderClassName}
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
          {loading
            ? "Guardando..."
            : editingId
            ? "Actualizar vuelo"
            : "Guardar vuelo"}
        </button>
        <button
          type="button"
          onClick={limpiarFormulario}
          disabled={loading}
          style={{
            marginLeft: "10px",
            padding: "10px 16px",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            backgroundColor: "#ffffff",
            color: "#111827",
            cursor: loading ? "not-allowed" : "pointer",
            fontSize: "14px",
          }}
        >
          Clear All
        </button>

        {mensajeExito ? (
          <p style={{ color: "#15803d", marginTop: "12px" }}>{mensajeExito}</p>
        ) : null}

        {mensajeError ? (
          <p style={{ color: "#dc2626", marginTop: "12px" }}>{mensajeError}</p>
        ) : null}
      </form>

      {ultimoInput ? (
        <section
          style={{
            maxWidth: "720px",
            margin: "0 auto 32px",
            padding: "16px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            backgroundColor: "#ffffff",
            fontFamily: "Arial, sans-serif",
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
              borderRadius: "6px",
              backgroundColor: loading ? "#9ca3af" : "#1d4ed8",
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
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              backgroundColor: "#ffffff",
              color: loading ? "#9ca3af" : "#111827",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: "14px",
            }}
          >
            Replicar ultimo input
          </button>
        </section>
      ) : (
        <p
          style={{
            maxWidth: "720px",
            margin: "0 auto 32px",
            fontFamily: "Arial, sans-serif",
            color: "#374151",
          }}
        >
          Todavia no hay un ultimo input disponible
        </p>
      )}
    </main>
  );
}

export default App;
