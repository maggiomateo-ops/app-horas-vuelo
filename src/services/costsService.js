export async function costsRequest({ archive, action, data, reason, requestId, signal } = {}) {
  const params = new URLSearchParams({ resource: 'costs' });
  if (!action) {
    if (!archive) params.set('action', 'archives');
    else { params.set('aircraft_id', archive.aircraft_id); params.set('financial_scope_id', archive.financial_scope_id); }
  }
  const response = await fetch(`/api/settings?${params}`, { credentials: 'include', signal,
    ...(action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'costs',
      aircraft_id: archive.aircraft_id, financial_scope_id: archive.financial_scope_id, action, data, reason, request_id: requestId }) } : {}) });
  const json = await response.json().catch(error => { if (error.name === 'AbortError') throw error; return null; });
  if (!response.ok || !json?.ok) throw Object.assign(new Error(response.status === 401 ? 'La sesión venció.' : json?.error || 'No se pudo cargar Costs.'),
    { code: response.status === 401 ? 'UNAUTHORIZED' : json?.code, status: response.status });
  return action ? json.result : json.costs;
}

export function buildCostExpenseForm(values, payments, allocations) {
  const fields = ['cost_concept_id', 'expense_date', 'description', 'currency_code', 'allocation_method', 'direct_party_id', 'utilization_metric'];
  return { ...Object.fromEntries(fields.map(key => [key, values[key]])), amount: String(values.amount), cost_event_id: values.cost_event_id || null,
    utilization_component_position: values.utilization_metric === 'ENGINE_CYCLES' ? Number(values.utilization_component_position) : null,
    payments: payments.map(p => ({ payer_party_id: p.party_id, amount: String(p.value) })),
    allocations: allocations.map(a => ({ party_id: a.party_id, allocation_percent: String(a.value) })) };
}
