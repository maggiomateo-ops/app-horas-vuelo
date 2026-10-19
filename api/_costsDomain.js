export function costError(message, code = 'COST_VALIDATION', statusCode = 422) {
  return Object.assign(new Error(message), { code, statusCode });
}
export function costUuid(value) {
  if (typeof value !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(value)) throw costError('Identificador no válido.', 'COST_INVALID_ID', 400);
  return value.toLowerCase();
}
export function costDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw costError('Fecha no válida.');
  return value;
}
export function costText(value, required = true) {
  if (value == null && !required) return null;
  if (typeof value !== 'string' || value.length > 4000 || (required && !value.trim())) throw costError('Completá los campos de texto.');
  return value.trim();
}
export function decimalUnits(value, scale = 2, maxDigits = 14) {
  if (typeof value !== 'string' || !new RegExp(`^(0|[1-9][0-9]*)(?:\\.[0-9]{1,${scale}})?$`).test(value)) throw costError('Importe o porcentaje no válido; usá un decimal exacto.');
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole + fraction.padEnd(scale, '0'));
  if (units >= 10n ** BigInt(maxDigits)) throw costError('El valor supera la precisión admitida.');
  return units;
}
export function decimalString(units, scale = 2) {
  const negative = units < 0n; const s = (negative ? -units : units).toString().padStart(scale + 1, '0');
  return `${negative ? '-' : ''}${s.slice(0, -scale)}.${s.slice(-scale)}`;
}
export function distributeUnits(total, weighted) {
  const rows = [...weighted].filter(r => r.weight > 0n).sort((a, b) => a.party_id.localeCompare(b.party_id));
  if (!rows.length || rows.some(r => typeof r.weight !== 'bigint')) throw costError('Falta una base de reparto válida.');
  if (new Set(rows.map(r => r.party_id)).size !== rows.length) throw costError('Participante repetido.');
  const sum = rows.reduce((a, r) => a + r.weight, 0n);
  const result = rows.map(r => ({ ...r, value: total * r.weight / sum, remainder: total * r.weight % sum }));
  let residual = total - result.reduce((a, r) => a + r.value, 0n);
  const order = [...result].sort((a, b) => a.remainder === b.remainder ? a.party_id.localeCompare(b.party_id) : a.remainder > b.remainder ? -1 : 1);
  for (let i = 0; residual > 0n; i++, residual--) order[i].value++;
  return result;
}
export const COST_METHODS = ['OWNERSHIP', 'CUSTOM', 'DIRECT', 'UTILIZATION'];
export const COST_METRICS = ['FLIGHT_TIME', 'LANDINGS', 'PRESSURIZATION_CYCLES', 'ENGINE_CYCLES'];

export function normalizeExpense(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw costError('Falta el gasto.');
  const amount = decimalUnits(input.amount);
  if (amount <= 0n || !/^[A-Z]{3}$/.test(input.currency_code) || !COST_METHODS.includes(input.allocation_method)) throw costError('Revisá importe, moneda y distribución.');
  if (!Array.isArray(input.payments) || input.payments.length < 1 || input.payments.length > 100) throw costError('Indicá los pagos reales.');
  const payments = input.payments.map(p => ({ payer_party_id: costUuid(p.payer_party_id), amount: decimalString(decimalUnits(p.amount)) }));
  if (payments.some(p => decimalUnits(p.amount) <= 0n) || payments.reduce((s, p) => s + decimalUnits(p.amount), 0n) !== amount) throw costError('Los pagos deben sumar exactamente el importe del gasto.');
  let weights = [];
  if (input.allocation_method === 'CUSTOM') {
    if (!Array.isArray(input.allocations) || input.allocations.length > 100) throw costError('Indicá los porcentajes.');
    weights = input.allocations.map(a => ({ party_id: costUuid(a.party_id), weight: decimalUnits(a.allocation_percent, 4, 7) }));
    if (weights.some(w => w.weight <= 0n) || weights.reduce((s, w) => s + w.weight, 0n) !== 1000000n) throw costError('Los porcentajes deben sumar 100.0000%.');
  } else if (input.allocation_method === 'DIRECT') weights = [{ party_id: costUuid(input.direct_party_id), weight: 1000000n }];
  const metric = input.allocation_method === 'UTILIZATION' ? input.utilization_metric : null;
  const position = metric === 'ENGINE_CYCLES' ? input.utilization_component_position : null;
  if (input.allocation_method === 'UTILIZATION' && (!COST_METRICS.includes(metric) || !input.cost_event_id)) throw costError('La utilización requiere un evento con intervalo explícito y una métrica.');
  if (metric === 'ENGINE_CYCLES' && (!Number.isInteger(position) || position < 1 || position > 32767)) throw costError('Indicá la posición del motor.');
  return {
    expense: { cost_concept_id: costUuid(input.cost_concept_id), cost_event_id: input.cost_event_id ? costUuid(input.cost_event_id) : null,
      expense_date: costDate(input.expense_date), description: costText(input.description, false), amount: decimalString(amount), currency_code: input.currency_code,
      allocation_method: input.allocation_method, utilization_metric: metric, utilization_component_position: position },
    payments, weights,
  };
}

export function allocationRows(amount, weights, method) {
  const money = distributeUnits(decimalUnits(amount), weights);
  const percents = distributeUnits(1000000n, weights);
  return money.map((r, i) => {
    if (percents[i].value === 0n) throw costError('Una participación está por debajo de la precisión disponible; revisá el reparto.');
    return { party_id: r.party_id, allocated_amount: decimalString(r.value), allocation_percent: decimalString(percents[i].value, 4), source_method: method };
  });
}

export function utilizationWeights(flights, metric, position) {
  const totals = new Map(); const evidence = [];
  for (const flight of flights) {
    const party = costUuid(flight.utilization_owner_party_id);
    let value; let installation = null;
    if (metric === 'FLIGHT_TIME') value = flight.flight_time_hours;
    else if (metric === 'ENGINE_CYCLES') {
      const matches = (flight.components || []).filter(c => c.position_index === position && c.counter_code === metric && c.aircraft_id === flight.aircraft_id
        && (!c.installed_on || c.installed_on <= flight.flight_date) && (!c.removed_on || flight.flight_date <= c.removed_on));
      if (matches.length !== 1) throw costError('Falta evidencia inequívoca del motor instalado para un vuelo.', 'COST_ENGINE_EVIDENCE_MISSING');
      value = matches[0].counter_value; installation = costUuid(matches[0].component_installation_id);
    } else value = (flight.counters || []).find(c => c.counter_code === metric)?.counter_value;
    if (value == null) throw costError('Hay vuelos sin contador o atribución necesarios para liquidar.', 'COST_UTILIZATION_MISSING');
    const units = decimalUnits(String(value), 3, 12);
    totals.set(party, (totals.get(party) || 0n) + units);
    evidence.push({ flight_id: flight.flight_id, flight_revision_id: flight.flight_revision_id, utilization_owner_party_id: party,
      utilization_value: decimalString(units, 3), utilization_metric: metric, component_installation_id: installation });
  }
  if (![...totals.values()].some(v => v > 0n)) throw costError('El intervalo no tiene utilización medible.');
  return { weights: [...totals].map(([party_id, weight]) => ({ party_id, weight })), evidence };
}

export function selectCostFlights(flights, start, end) {
  function within(f, boundary, lower) {
    if (f.flight_date !== boundary.event_date) return lower ? f.flight_date > boundary.event_date : f.flight_date < boundary.event_date;
    if (!boundary.boundary_after_flight_id) return !lower;
    const marker = flights.find(x => x.flight_id === boundary.boundary_after_flight_id && x.flight_date === boundary.event_date);
    const time = f.movement_start_at || f.takeoff_at;
    const cutoff = marker?.movement_start_at || marker?.takeoff_at;
    if (!time || !cutoff || (f.flight_id !== marker.flight_id && new Date(time).getTime() === new Date(cutoff).getTime())) throw costError('El límite del evento es ambiguo dentro del día.');
    return lower ? new Date(time) > new Date(cutoff) : new Date(time) <= new Date(cutoff);
  }
  return flights.filter(f => within(f, start, true) && within(f, end, false));
}
