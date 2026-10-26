import { useId, useState } from 'react';
import { HOURS_START_MODES, hoursStartNextAction } from '../utils/hoursStart';
import './HoursStartChoice.css';

export function HoursStartChoice({ value, onChange, disabled = false, error }) {
  const id = useId();
  return <fieldset className="hours-start-choice" aria-describedby={error ? `${id}-error` : undefined} disabled={disabled}>
    <legend>¿Cómo vas a comenzar a registrar las horas?</legend>
    <div className="hours-start-options">{HOURS_START_MODES.map((mode) => <label key={mode.id} className={value === mode.id ? 'is-selected' : ''}>
      <input type="radio" name={id} value={mode.id} checked={value === mode.id} required
        onChange={() => onChange(mode.id)} />
      <span><strong>{mode.title}</strong><small>{mode.description}</small></span>
    </label>)}</div>
    {error ? <small id={`${id}-error`} role="alert">{error}</small> : null}
  </fieldset>;
}

export default function HoursStartPlan() {
  const [mode, setMode] = useState('');
  return <section className="hours-start-plan" aria-label="Inicio del seguimiento">
    <h3>Inicio del seguimiento</h3>
    <HoursStartChoice value={mode} onChange={setMode} />
    <p role="status">{hoursStartNextAction(mode)}</p>
    <small>Preparación local. La elección no se guarda ni cambia las horas existentes. La conciliación está pendiente de habilitación.</small>
    {mode === 'HISTORICAL_IMPORT' ? <ol className="hours-import-steps"><li>Cargar y validar el archivo</li><li>Revisar duplicados e instalaciones</li><li>Conciliar referencias y diferencias</li><li>Confirmar la incorporación</li></ol> : null}
  </section>;
}
