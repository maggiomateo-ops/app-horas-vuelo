import { useEffect, useRef, useState } from 'react';
import { costsRequest, buildCostExpenseForm } from '../services/costsService.js';
import './CostsPanel.css';

const METHODS = [['OWNERSHIP', 'Propiedad a la fecha'], ['CUSTOM', 'Porcentajes personalizados'], ['DIRECT', 'Un responsable'], ['UTILIZATION', 'Utilización del evento']];
const METRICS = [['FLIGHT_TIME', 'Horas de vuelo'], ['LANDINGS', 'Aterrizajes'], ['PRESSURIZATION_CYCLES', 'Ciclos de presurización'], ['ENGINE_CYCLES', 'Ciclos de motor']];
const today = () => new Date().toLocaleDateString('en-CA');
const emptyExpense = () => ({ expense_date: today(), amount: '', currency_code: 'USD', description: '', cost_concept_id: '', cost_event_id: '',
  allocation_method: 'OWNERSHIP', direct_party_id: '', utilization_metric: 'FLIGHT_TIME', utilization_component_position: '1' });

function ParticipantRows({ title, rows, onChange, parties, percent = false, disabled }) {
  return <fieldset disabled={disabled}><legend>{title}</legend>{rows.map((row, i) => <div className="costs-grid" key={i}>
    <label>Participante<select required value={row.party_id} onChange={e => { const value = e.target.value; onChange(previous => previous.map((r, j) => j === i ? { ...r, party_id: value } : r)); }}>
      <option value="">Elegir…</option>{parties.map(p => <option key={p.party_id} value={p.party_id}>{p.name}</option>)}
    </select></label>
    <label>{percent ? 'Porcentaje' : 'Importe pagado'}<input required type="number" inputMode="decimal" min="0" step={percent ? '0.0001' : '0.01'} value={row.value}
      onChange={e => { const value = e.target.value; onChange(previous => previous.map((r, j) => j === i ? { ...r, value } : r)); }} /></label>
    <button type="button" onClick={() => onChange(previous => previous.filter((_, j) => j !== i))} disabled={rows.length === 1}>Quitar participante {i + 1}</button>
  </div>)}<button type="button" onClick={() => onChange(previous => [...previous, { party_id: '', value: '' }])}>Agregar participante</button></fieldset>;
}

export default function CostsPanel({ onUnauthorized }) {
  const [archives, setArchives] = useState(null); const [archiveId, setArchiveId] = useState('');
  const [data, setData] = useState(null); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [view, setView] = useState('expenses'); const [busy, setBusy] = useState(false); const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState(emptyExpense); const [editing, setEditing] = useState(null); const [detailId, setDetailId] = useState('');
  const [payments, setPayments] = useState([{ party_id: '', value: '' }]); const [allocations, setAllocations] = useState([{ party_id: '', value: '100' }]);
  const [filter, setFilter] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [reason, setReason] = useState(''); const retry = useRef(null);
  const archive = archives?.find(a => a.financial_scope_id === archiveId);
  const detail = data?.expenses.find(e => e.expense_id === detailId);
  const parties = data?.parties || [];
  const name = id => parties.find(p => p.party_id === id)?.name || 'Participante del archivo';
  const canWrite = data?.writes_enabled === true;

  useEffect(() => {
    const controller = new AbortController();
    costsRequest({ signal: controller.signal }).then(result => {
      setArchives(result.archives); setArchiveId(result.archives[0]?.financial_scope_id || '');
    }).catch(e => { if (e.name !== 'AbortError') { setError(e.message); if (e.code === 'UNAUTHORIZED') onUnauthorized?.(); } });
    return () => controller.abort();
  }, [onUnauthorized]);
  useEffect(() => {
    if (!archive) return undefined;
    const controller = new AbortController();
    costsRequest({ archive, signal: controller.signal }).then(result => { setData(result); setError(''); }).catch(e => {
      if (e.name !== 'AbortError') { setData(null); setError(e.message); if (e.code === 'UNAUTHORIZED') onUnauthorized?.(); }
    });
    return () => controller.abort();
  }, [archive, refresh, onUnauthorized]);

  async function save(action, values, note = reason) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    const key = JSON.stringify({ archiveId, action, values, note });
    if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
    try {
      await costsRequest({ archive, action, data: values, reason: note || 'Registro de gasto', requestId: retry.current.id });
      retry.current = null; setRefresh(n => n + 1); setView('expenses'); setEditing(null); setConfirmation(null);
      setNotice('Guardado correctamente.'); setForm(emptyExpense());
    } catch (e) { setError(e.message); if (e.code === 'UNAUTHORIZED') onUnauthorized?.(); }
    finally { setBusy(false); }
  }
  function edit(expense) {
    setEditing(expense); setForm({ ...emptyExpense(), ...expense, cost_event_id: expense.cost_event_id || '', direct_party_id: expense.allocations.find(a => !a.retired_at)?.party_id || '' });
    setPayments(expense.payments.filter(p => !p.retired_at).map(p => ({ party_id: p.payer_party_id, value: p.amount })));
    setAllocations(expense.allocations.filter(a => !a.retired_at).map(a => ({ party_id: a.party_id, value: a.allocation_percent })));
    setReason(''); setView('new');
  }
  const field = key => ({ value: form[key] ?? '', onChange: e => { const value = e.target.value; setForm(previous => ({ ...previous, [key]: value })); } });
  return <section className="costs-panel" aria-label="Gastos y liquidaciones">
    <header><p className="dashboard-eyebrow">Archivo financiero privado</p><h1>Gastos y liquidaciones</h1>
      <p>Los gastos de cada administración se conservan en su propio archivo.</p></header>
    {error && <p role="alert" className="costs-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {archives === null && !error && <p role="status">Cargando archivos autorizados…</p>}
    {archives?.length === 0 && <p role="status">No tenés un archivo financiero autorizado. El responsable debe registrar expresamente tu autorización; el rol Owner no la concede automáticamente.</p>}
    {!!archives?.length && <label>Archivo<select value={archiveId} disabled={busy} onChange={e => {
      setArchiveId(e.target.value); setData(null); setDetailId(''); setEditing(null); setConfirmation(null); setError(''); setNotice(''); setView('expenses');
    }}>{archives.map(a => <option key={a.financial_scope_id} value={a.financial_scope_id}>{a.label}</option>)}</select></label>}
    {archive && !data && !error && <p role="status">Cargando gastos…</p>}
    {data && <>
      {!canWrite && <p role="status">Archivo disponible para consulta. La escritura requiere autorización financiera, Owner activo y habilitación del sistema.</p>}
      <nav aria-label="Secciones de gastos" className="costs-actions">
        <button type="button" onClick={() => setView('expenses')} aria-pressed={view === 'expenses'}>Gastos</button>
        {canWrite && <button type="button" onClick={() => { setError(''); setEditing(null); setForm(emptyExpense()); setPayments([{ party_id: '', value: '' }]); setAllocations([{ party_id: '', value: '100' }]); setView('new'); }}>Nuevo gasto</button>}
        <button type="button" onClick={() => setView('settlements')} aria-pressed={view === 'settlements'}>Liquidaciones</button>
        <button type="button" onClick={() => setView('concepts')} aria-pressed={view === 'concepts'}>Conceptos y eventos</button>
      </nav>
      {view === 'expenses' && <>
        <h2>Gastos</h2><div className="costs-grid"><label>Buscar<input value={filter} onChange={e => setFilter(e.target.value)} /></label>
          <label>Desde<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>Hasta<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label></div>
        {!data.expenses.length && <p>No hay gastos registrados en este archivo.</p>}
        <div className="costs-table-wrap"><table><caption>Gastos del archivo seleccionado</caption><thead><tr><th>Fecha</th><th>Concepto</th><th>Importe</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>
          {data.expenses.filter(e => (!from || e.expense_date >= from) && (!to || e.expense_date <= to)
            && `${e.description || ''} ${data.concepts.find(c => c.cost_concept_id === e.cost_concept_id)?.name || ''}`.toLowerCase().includes(filter.toLowerCase())).map(e => <tr key={e.expense_id}>
              <td>{e.expense_date}</td><td>{data.concepts.find(c => c.cost_concept_id === e.cost_concept_id)?.name}</td><td>{e.amount} {e.currency_code}</td><td>{e.frozen ? 'Liquidado' : 'Abierto'}</td>
              <td><button type="button" onClick={() => { setDetailId(e.expense_id); setView('detail'); }}>Ver detalle</button></td></tr>)}
        </tbody></table></div>
      </>}
      {view === 'detail' && detail && <article><h2>{detail.description || 'Detalle del gasto'}</h2><p>{detail.expense_date} · {detail.amount} {detail.currency_code}</p>
        <h3>Pagos reales</h3><ul>{detail.payments.filter(p => !p.retired_at).map((p, i) => <li key={i}>{name(p.payer_party_id)}: {p.amount} {detail.currency_code}</li>)}</ul>
        <h3>Responsabilidad económica</h3>{detail.calculation_error && <p role="alert">{detail.calculation_error}</p>}<ul>{(detail.current_allocations || detail.allocations.filter(a => !a.retired_at)).map(a => <li key={a.party_id}>{name(a.party_id)}: {a.allocated_amount} {detail.currency_code} ({a.allocation_percent}%)</li>)}</ul>
        <h3>Historial de cambios</h3><ul>{detail.corrections.map(c => <li key={c.cost_expense_correction_id}>{new Date(c.corrected_at).toLocaleString()} · {c.reason}</li>)}</ul>
        {canWrite && !detail.frozen && detail.status === 'OPEN' && <button type="button" onClick={() => edit(detail)}>Corregir gasto abierto</button>}
        {detail.frozen && <p>La liquidación está cerrada. Su evidencia no se modifica.</p>}</article>}
      {view === 'new' && canWrite && <form onSubmit={e => { e.preventDefault(); save(editing ? 'correct_expense' : 'create_expense', {
        ...buildCostExpenseForm(form, payments, allocations), ...(editing ? { expense_id: editing.expense_id, expected_details_version: editing.details_version } : {}),
      }); }}>
        <h2>{editing ? 'Corregir gasto' : 'Nuevo gasto'}</h2><fieldset disabled={busy}><legend>Datos del gasto</legend><div className="costs-grid">
          <label>Concepto<select required {...field('cost_concept_id')}><option value="">Elegir…</option>{data.concepts.filter(c => c.status === 'ACTIVE').map(c => <option key={c.cost_concept_id} value={c.cost_concept_id}>{c.name}</option>)}</select></label>
          <label>Fecha<input required type="date" {...field('expense_date')} onInput={e => { const value = e.currentTarget.value; setForm(f => ({ ...f, expense_date: value })); }} /></label><label>Importe<input required type="number" min="0.01" step="0.01" {...field('amount')} /></label>
          <label>Moneda<input required maxLength={3} pattern="[A-Z]{3}" {...field('currency_code')} /></label></div>
          <label>Descripción<input {...field('description')} /></label><label>Evento (opcional)<select {...field('cost_event_id')}><option value="">Gasto independiente</option>{data.events.filter(e => e.status === 'OPEN').map(e => <option key={e.cost_event_id} value={e.cost_event_id}>{e.title}</option>)}</select></label>
        </fieldset>
        <ParticipantRows title="Quién pagó" rows={payments} onChange={setPayments} parties={parties} disabled={busy} />
        <fieldset disabled={busy}><legend>Distribución económica</legend><label>Método<select {...field('allocation_method')}>{METHODS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
          {form.allocation_method === 'DIRECT' && <label>Responsable<select required {...field('direct_party_id')}><option value="">Elegir…</option>{parties.map(p => <option key={p.party_id} value={p.party_id}>{p.name}</option>)}</select></label>}
          {form.allocation_method === 'UTILIZATION' && <><p>Usa el intervalo entre el evento anterior liquidado y el evento seleccionado.</p><label>Métrica<select {...field('utilization_metric')}>{METRICS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
            {form.utilization_metric === 'ENGINE_CYCLES' && <label>Posición del motor<input required type="number" min="1" step="1" {...field('utilization_component_position')} /></label>}</>}
        </fieldset>
        {form.allocation_method === 'CUSTOM' && <ParticipantRows title="Responsabilidad (total 100%)" rows={allocations} onChange={setAllocations} parties={parties} percent disabled={busy} />}
        <label>{editing ? 'Motivo de la corrección' : 'Nota del registro'}<input required={!!editing} value={reason} onChange={e => setReason(e.target.value)} /></label>
        {!parties.length && <p role="alert">Faltan participantes canónicos asociados a la aeronave. No se pueden inferir ni crear desde este formulario.</p>}
        <button disabled={busy || !parties.length} type="submit">{busy ? 'Guardando…' : 'Guardar gasto'}</button>
      </form>}
      {view === 'concepts' && <><h2>Conceptos</h2><ul>{data.concepts.map(c => <li key={c.cost_concept_id}>{c.name} · {c.cost_class === 'FIXED' ? 'Fijo' : 'Variable'}</li>)}</ul>
        {canWrite && <form onSubmit={e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.currentTarget)); save('create_concept', v); }}>
          <fieldset disabled={busy}><legend>Agregar concepto</legend><label>Nombre<input required name="name" /></label><label>Clase<select name="cost_class"><option value="FIXED">Fijo</option><option value="VARIABLE">Variable</option></select></label>
            <label>Distribución habitual<select name="default_allocation_method">{METHODS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label><button>Guardar concepto</button></fieldset></form>}
        <h2>Tipos de evento</h2><ul>{data.types.map(t => <li key={t.cost_event_type_id}>{t.name} · {t.boundary_basis}</li>)}</ul>
        {canWrite && <form onSubmit={e => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.currentTarget)); save('create_event_type', { ...v, component_position: Number(v.component_position) }); }}>
          <fieldset disabled={busy}><legend>Agregar tipo de evento</legend><label>Nombre<input required name="name" /></label><label>Base del límite<select name="boundary_basis"><option value="NONE">Fecha</option>{METRICS.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>
            <label>Posición del motor (solo ciclos de motor)<input type="number" name="component_position" min="1" step="1" /></label><button>Guardar tipo</button></fieldset></form>}
        <h2>Eventos</h2><ul>{data.events.map(e => <li key={e.cost_event_id}>{e.event_date} · {e.title} · {e.status === 'SETTLED' ? 'Liquidado' : 'Abierto'}</li>)}</ul>
        {canWrite && <form onSubmit={e => { e.preventDefault(); save('create_event', Object.fromEntries(new FormData(e.currentTarget))); }}><fieldset disabled={busy}><legend>Nuevo evento</legend>
          <label>Nombre<input required name="title" /></label><label>Fecha<input required type="date" name="event_date" /></label><label>Tipo<select required name="cost_event_type_id"><option value="">Elegir…</option>{data.types.map(t => <option key={t.cost_event_type_id} value={t.cost_event_type_id}>{t.name}</option>)}</select></label>
          <label>Evento anterior para utilización<select name="previous_cost_event_id"><option value="">Sin límite anterior</option>{data.events.filter(e => e.status === 'SETTLED').map(e => <option key={e.cost_event_id} value={e.cost_event_id}>{e.event_date} · {e.title}</option>)}</select></label><button>Guardar evento</button></fieldset></form>}
      </>}
      {view === 'settlements' && <><h2>Liquidaciones</h2>{!data.settlements.length && <p>Todavía no hay liquidaciones cerradas.</p>}
        {data.settlements.map(s => <article key={s.cost_settlement_id}><h3>{s.cost_event_id ? data.events.find(e => e.cost_event_id === s.cost_event_id)?.title : `${String(s.period_start_date).slice(0, 10)} a ${String(s.period_end_date).slice(0, 10)}`} · {s.currency_code}</h3>
          <p>Liquidación cerrada: los importes y responsabilidades son inmutables.</p><div className="costs-table-wrap"><table><caption>Resumen por participante ({s.currency_code})</caption><thead><tr><th>Participante</th><th>Responsabilidad</th><th>Pagado</th><th>Saldo a favor / a cargo</th></tr></thead><tbody>
            {s.lines.map(l => <tr key={l.party_id}><td>{name(l.party_id)}</td><td>{l.responsibility_amount}</td><td>{l.paid_amount}</td><td>{l.net_amount}</td></tr>)}</tbody></table></div></article>)}
        {canWrite && <><h3>Liquidar gastos independientes</h3><form onSubmit={e => { e.preventDefault(); const values = Object.fromEntries(new FormData(e.currentTarget));
          if (!values.period_start_date || !values.period_end_date || values.period_start_date > values.period_end_date) { setError('Completá un período válido.'); return; }
          setConfirmation({ action: 'settle_period', values }); }}><div className="costs-grid">
          <label>Desde<input required name="period_start_date" type="date" /></label><label>Hasta<input required name="period_end_date" type="date" /></label></div><button disabled={busy}>Revisar liquidación</button></form>
          <h3>Liquidar evento</h3>{data.events.filter(e => e.status === 'OPEN').map(e => <p key={e.cost_event_id}>{e.title} · {e.event_date} <button disabled={busy} type="button" onClick={() => setConfirmation({ action: 'settle_event', values: { cost_event_id: e.cost_event_id } })}>Revisar cierre</button></p>)}
          {confirmation && <section role="region" aria-label="Confirmar liquidación"><h3>Confirmar cierre</h3><p>Se congelarán los gastos seleccionados, sus pagos y responsabilidades, por separado en cada moneda. Un evento sin gastos se cierra únicamente como límite operativo.</p>
            <p>{confirmation.action === 'settle_period' ? `${confirmation.values.period_start_date} a ${confirmation.values.period_end_date}` : data.events.find(e => e.cost_event_id === confirmation.values.cost_event_id)?.title}</p>
            <button disabled={busy} type="button" onClick={() => save(confirmation.action, confirmation.values, 'Liquidación confirmada')}>Confirmar liquidación</button><button disabled={busy} type="button" onClick={() => setConfirmation(null)}>Cancelar</button></section>}
        </>}
      </>}
    </>}
  </section>;
}
