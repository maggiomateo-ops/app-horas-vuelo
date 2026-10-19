import crypto from 'node:crypto';
import { withPostgresTransaction } from './_postgres.js';
import { resolveDataSource } from './_dataSource.js';
import { resolvePostgresCostWriteCapability } from './_settingsWriteCapability.js';
import { costError, costUuid, costDate, costText, normalizeExpense, allocationRows, utilizationWeights,
  selectCostFlights, decimalUnits, decimalString, COST_METHODS, COST_METRICS } from './_costsDomain.js';

const ROOTS = Object.freeze({ concepts: ['cost_concepts', 'cost_concept_id'], types: ['cost_event_types', 'cost_event_type_id'],
  events: ['cost_events', 'cost_event_id'], expenses: ['expenses', 'expense_id'], settlements: ['cost_settlements', 'cost_settlement_id'] });
const notFound = () => costError('No tenés autorización financiera para este archivo o registro.', 'COST_FINANCIAL_AUTHORITY_UNRESOLVED', 404);
const conflict = () => costError('El registro cambió o ya fue liquidado. Actualizá antes de continuar.', 'COST_CONFLICT', 409);
const canonicalJson = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v);
const fingerprint = value => crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
const dateSql = column => `to_char(${column},'YYYY-MM-DD')`;
const AUDIT_ACTIONS = Object.freeze({ create_concept: 'COST_CONCEPT_CREATED', create_event_type: 'COST_EVENT_TYPE_CREATED',
  create_event: 'COST_EVENT_CREATED', correct_event: 'COST_EVENT_CORRECTED', create_expense: 'COST_EXPENSE_CREATED',
  correct_expense: 'COST_EXPENSE_CORRECTED', settle_event: 'COST_EVENT_SETTLED', settle_period: 'COST_PERIOD_SETTLED' });

export function createPostgresCostsRepository({ transaction = withPostgresTransaction, randomUUID = crypto.randomUUID,
  capability = () => resolvePostgresCostWriteCapability(resolveDataSource('SETTINGS_DATA_SOURCE')) } = {}) {
  const rows = async (c, sql, p = []) => (await c.query(sql, p)).rows;
  async function schema(c, userId) {
    if (!(await rows(c, "SELECT user_id FROM app.users WHERE user_id=$1 AND status='ACTIVE'", [userId])).length) throw notFound();
    if (!(await rows(c, "SELECT to_regclass('app.cost_financial_scopes') AS ready"))[0]?.ready) throw costError('Costs está pendiente de la migración y autorización inicial.', 'COST_SCHEMA_NOT_READY', 503);
  }
  async function lock(c, key) {
    if (!(await rows(c, 'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [key]))[0]?.locked) throw conflict();
  }
  async function access(c, userId, scopeId, aircraftId, write) {
    const found = await rows(c, `SELECT s.financial_scope_id,s.aircraft_id,s.label,
      EXISTS(SELECT 1 FROM app.aircraft_memberships m JOIN app.aircraft a ON a.aircraft_id=m.aircraft_id
        WHERE m.aircraft_id=s.aircraft_id AND m.user_id=$1 AND m.status='ACTIVE' AND m.role='OWNER' AND a.status='ACTIVE') AS owner
      FROM app.cost_financial_scopes s WHERE s.financial_scope_id=$2 AND s.aircraft_id=$3
      AND EXISTS(SELECT 1 FROM app.cost_financial_authorities f JOIN app.users u ON u.user_id=f.user_id
        WHERE f.financial_scope_id=s.financial_scope_id AND f.user_id=$1 AND u.status='ACTIVE'
        AND NOT EXISTS(SELECT 1 FROM app.cost_financial_authority_revocations r WHERE r.financial_authority_id=f.financial_authority_id))`, [userId, scopeId, aircraftId]);
    if (found.length !== 1) throw notFound();
    if (write && !found[0].owner) throw costError('La escritura requiere OWNER activo y autorización financiera vigente.', 'COST_WRITE_DENIED', 403);
    return found[0];
  }
  async function root(c, kind, id, context, forUpdate = false) {
    const [table, key] = ROOTS[kind];
    const found = await rows(c, `SELECT t.* ${kind === 'expenses' ? `,${dateSql('t.expense_date')} AS expense_date` : kind === 'events' ? `,${dateSql('t.event_date')} AS event_date` : ''}
      FROM app.${table} t JOIN app.cost_financial_records f ON f.${key}=t.${key}
      WHERE t.${key}=$1 AND f.financial_scope_id=$2 AND f.aircraft_id=$3 AND t.aircraft_id=$3 ${forUpdate ? 'FOR UPDATE OF t' : ''}`, [costUuid(id), context.scopeId, context.aircraftId]);
    if (found.length !== 1) throw notFound();
    return found[0];
  }
  async function insert(c, table, value) {
    // All identifiers/keys originate from this module's fixed internal objects.
    const keys = Object.keys(value);
    const result = await rows(c, `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(value));
    return result[0];
  }
  async function bind(c, kind, id, ctx) {
    await insert(c, 'app.cost_financial_records', { financial_record_id: randomUUID(), financial_scope_id: ctx.scopeId,
      aircraft_id: ctx.aircraftId, [ROOTS[kind][1]]: id, registered_by_user_id: ctx.userId, provenance_reference: ctx.requestId });
  }
  async function parties(c, ids, aircraftId) {
    for (const id of new Set(ids)) {
      // Explicit existing aircraft association through legal history. Payer is
      // never inferred from ownership and need not own on the expense date.
      const found = await rows(c, `SELECT p.party_id FROM app.parties p WHERE p.party_id=$1
        AND (EXISTS(SELECT 1 FROM app.aircraft_ownership_interests o WHERE o.party_id=p.party_id AND o.aircraft_id=$2)
          OR EXISTS(SELECT 1 FROM app.aircraft_persons a WHERE a.person_id=p.person_id AND a.aircraft_id=$2 AND a.status='ACTIVE'))`, [id, aircraftId]);
      if (!found.length) throw costError('Un participante no tiene una asociación canónica con esta aeronave.', 'COST_PARTY_SCOPE');
    }
  }
  async function editable(c, expense) {
    if (expense.status !== 'OPEN' || (await rows(c, 'SELECT expense_id FROM app.cost_settlement_expense_lines WHERE expense_id=$1 LIMIT 1', [expense.expense_id])).length) throw conflict();
    if (expense.cost_event_id && (await rows(c, 'SELECT status FROM app.cost_events WHERE cost_event_id=$1', [expense.cost_event_id]))[0]?.status !== 'OPEN') throw conflict();
  }
  async function derive(c, input, ctx) {
    let weights = input.weights; let evidence = []; let ownership = []; let boundaries = null;
    const e = input.expense;
    await root(c, 'concepts', e.cost_concept_id, ctx);
    if (e.cost_event_id) await root(c, 'events', e.cost_event_id, ctx);
    if (e.allocation_method === 'OWNERSHIP') {
      ownership = await rows(c, `SELECT ownership_interest_id,party_id,ownership_share::text,effective_from_at,effective_to_at
        FROM app.aircraft_ownership_interests WHERE aircraft_id=$1 AND effective_from_at::date <= $2::date
        AND (effective_to_at IS NULL OR $2::date < effective_to_at::date) ORDER BY party_id`, [ctx.aircraftId, e.expense_date]);
      weights = ownership.map(o => ({ party_id: o.party_id, weight: decimalUnits(o.ownership_share) }));
      if (weights.reduce((s, w) => s + w.weight, 0n) !== 10000n) throw costError('La propiedad histórica de esa fecha no suma 100%.', 'COST_OWNERSHIP_MISSING');
    }
    if (e.allocation_method === 'UTILIZATION') {
      const end = await root(c, 'events', e.cost_event_id, ctx);
      if (!end.previous_cost_event_id) throw costError('El evento necesita un límite anterior explícito para repartir por utilización.');
      const start = await root(c, 'events', end.previous_cost_event_id, ctx);
      if (start.status !== 'SETTLED') throw costError('El límite anterior debe estar liquidado.');
      boundaries = { start, end };
      const flights = await rows(c, `SELECT f.flight_id,f.aircraft_id,r.flight_revision_id,${dateSql('r.flight_date')} AS flight_date,
        r.movement_start_at,r.takeoff_at,r.flight_time_hours::text,r.utilization_owner_party_id,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('counter_code',fc.counter_code,'counter_value',fc.counter_value))
          FROM app.flight_counters fc WHERE fc.flight_revision_id=r.flight_revision_id),'[]') AS counters,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('counter_code',cc.counter_code,'counter_value',cc.counter_value,
          'component_installation_id',ci.component_installation_id,'aircraft_id',ci.aircraft_id,'position_index',ci.position_index,
          'installed_on',ci.installed_on,'removed_on',ci.removed_on))
          FROM app.flight_component_counters cc JOIN app.component_installations ci ON ci.component_installation_id=cc.component_installation_id
          JOIN app.components comp ON comp.component_id=ci.component_id AND comp.component_type='ENGINE'
          WHERE cc.flight_revision_id=r.flight_revision_id),'[]') AS components
        FROM app.flight_records f JOIN app.flight_record_revisions r ON r.flight_revision_id=f.current_revision_id AND r.flight_id=f.flight_id
        WHERE f.aircraft_id=$1 AND f.status='ACTIVE' AND r.flight_date BETWEEN $2::date AND $3::date
        ORDER BY r.flight_date,r.movement_start_at,f.flight_id`, [ctx.aircraftId, start.event_date, end.event_date]);
      ({ weights, evidence } = utilizationWeights(selectCostFlights(flights, start, end), e.utilization_metric, e.utilization_component_position));
    }
    await parties(c, [...input.payments.map(p => p.payer_party_id), ...weights.map(w => w.party_id)], ctx.aircraftId);
    return { allocations: allocationRows(e.amount, weights, e.allocation_method), evidence, ownership, boundaries };
  }
  async function expenseInput(c, expense) {
    const payments = await rows(c, `SELECT payer_party_id,amount::text FROM app.expense_payments WHERE expense_id=$1 AND retired_at IS NULL ORDER BY expense_payment_id`, [expense.expense_id]);
    const allocations = await rows(c, `SELECT party_id,allocation_percent::text FROM app.expense_allocations WHERE expense_id=$1 AND retired_at IS NULL ORDER BY party_id`, [expense.expense_id]);
    return normalizeExpense({ ...expense, payments, allocations, direct_party_id: allocations[0]?.party_id });
  }
  async function writeDetails(c, id, input, derived, ctx, base = 0) {
    const batch = randomUUID();
    await insert(c, 'app.cost_expense_corrections', { cost_expense_correction_id: batch, expense_id: id,
      base_details_version: base, request_id: ctx.requestId, actor_user_id: ctx.userId, reason: ctx.reason });
    const updated = await rows(c, 'UPDATE app.expenses SET details_version=details_version+1 WHERE expense_id=$1 AND details_version=$2 RETURNING details_version', [id, base]);
    if (updated.length !== 1) throw conflict();
    for (const table of ['expense_payments', 'expense_allocations']) await c.query(`UPDATE app.${table} SET retired_correction_id=$2,retired_at=now(),retired_by_user_id=$3 WHERE expense_id=$1 AND retired_at IS NULL`, [id, batch, ctx.userId]);
    for (const payment of input.payments) await insert(c, 'app.expense_payments', { expense_payment_id: randomUUID(), expense_id: id, ...payment, created_correction_id: batch });
    for (const allocation of derived.allocations) await insert(c, 'app.expense_allocations', { expense_allocation_id: randomUUID(), expense_id: id, ...allocation, created_correction_id: batch });
    return { expense_id: id, details_version: String(updated[0].details_version), correction_id: batch };
  }
  async function audit(c, ctx, action, result, before, extra = {}) {
    await insert(c, 'audit.audit_events', { audit_event_id: randomUUID(), request_id: ctx.requestId, actor_type: 'USER', actor_user_id: ctx.userId,
      operation_source: 'MANUAL', aircraft_id: ctx.aircraftId, entity_type: 'COST', entity_id: ctx.scopeId,
      entity_key: JSON.stringify({ financial_scope_id: ctx.scopeId }), action_code: AUDIT_ACTIONS[action],
      before_state: before ? JSON.stringify(before) : null, after_state: JSON.stringify(result),
      metadata: JSON.stringify({ contract: 'COSTS_V1', input_hash: ctx.hash, reason: ctx.reason, ...extra }), payload_version: 1 });
  }

  async function listArchives({ userId }) {
    userId = costUuid(userId);
    return transaction(async c => {
      await schema(c, userId);
      return rows(c, `SELECT DISTINCT s.financial_scope_id,s.aircraft_id,s.label FROM app.cost_financial_scopes s
        JOIN app.cost_financial_authorities f ON f.financial_scope_id=s.financial_scope_id
        WHERE f.user_id=$1 AND NOT EXISTS(SELECT 1 FROM app.cost_financial_authority_revocations r WHERE r.financial_authority_id=f.financial_authority_id)
        ORDER BY s.label,s.financial_scope_id`, [userId]);
    }, { isolationLevel: 'READ COMMITTED', readOnly: true });
  }
  async function read({ userId, aircraftId, scopeId }) {
    const ctx = { userId: costUuid(userId), aircraftId: costUuid(aircraftId), scopeId: costUuid(scopeId) };
    return transaction(async c => {
      await schema(c, ctx.userId); await lock(c, `app-horas:cost-scope:${ctx.scopeId}`);
      const scope = await access(c, ctx.userId, ctx.scopeId, ctx.aircraftId, false);
      const result = { scope, writes_enabled: false };
      try { result.writes_enabled = scope.owner && capability().enabled; } catch { /* Read authorization does not depend on configuration of writes. */ }
      for (const [kind, [table, key]] of Object.entries(ROOTS)) {
        result[kind] = await rows(c, `SELECT t.* ${kind === 'expenses' ? `,${dateSql('t.expense_date')} AS expense_date` : kind === 'events' ? `,${dateSql('t.event_date')} AS event_date` : ''}
          FROM app.${table} t JOIN app.cost_financial_records f ON f.${key}=t.${key}
          WHERE f.financial_scope_id=$1 AND f.aircraft_id=$2 AND t.aircraft_id=$2 ORDER BY t.${key}`, [ctx.scopeId, ctx.aircraftId]);
      }
      // Financial children are scoped through their exact authorized root. Never
      // expose Audit, live source records or settlement provenance JSON directly.
      for (const expense of result.expenses) {
        expense.payments = await rows(c, 'SELECT payer_party_id,amount::text,retired_at,retired_by_user_id FROM app.expense_payments WHERE expense_id=$1 ORDER BY expense_payment_id', [expense.expense_id]);
        expense.allocations = await rows(c, 'SELECT party_id,allocation_percent::text,allocated_amount::text,source_method,retired_at FROM app.expense_allocations WHERE expense_id=$1 ORDER BY expense_allocation_id', [expense.expense_id]);
        expense.corrections = await rows(c, 'SELECT cost_expense_correction_id,base_details_version,corrected_at,reason FROM app.cost_expense_corrections WHERE expense_id=$1 ORDER BY base_details_version', [expense.expense_id]);
        expense.frozen = (await rows(c, 'SELECT expense_id FROM app.cost_settlement_expense_lines WHERE expense_id=$1 LIMIT 1', [expense.expense_id])).length > 0;
        if (!expense.frozen && expense.status === 'OPEN') {
          try { expense.current_allocations = (await derive(c, await expenseInput(c, expense), ctx)).allocations; }
          catch (error) { expense.calculation_error = error.statusCode ? error.message : 'No se pudo actualizar el reparto.'; }
        }
      }
      for (const settlement of result.settlements) {
        delete settlement.source_snapshot;
        settlement.lines = await rows(c, 'SELECT party_id,responsibility_amount::text,paid_amount::text,net_amount::text FROM app.cost_settlement_owner_lines WHERE cost_settlement_id=$1 ORDER BY party_id', [settlement.cost_settlement_id]);
        settlement.expenses = await rows(c, 'SELECT expense_id,amount::text,currency_code,allocation_method FROM app.cost_settlement_expense_lines WHERE cost_settlement_id=$1 ORDER BY expense_id', [settlement.cost_settlement_id]);
      }
      const partyIds = new Set(result.expenses.flatMap(e => [...e.payments.map(p => p.payer_party_id), ...e.allocations.map(a => a.party_id)]));
      // A current authorized OWNER needs existing canonical parties for entry;
      // archive-only readers see labels only for parties already in their archive.
      result.parties = await rows(c, `SELECT DISTINCT p.party_id,COALESCE(person.full_name,p.organization_name) AS name
        FROM app.parties p LEFT JOIN app.persons person ON person.person_id=p.person_id
        WHERE p.party_id=ANY($1::uuid[]) OR ($3::boolean AND p.status='ACTIVE' AND (
          EXISTS(SELECT 1 FROM app.aircraft_ownership_interests o WHERE o.aircraft_id=$2 AND o.party_id=p.party_id)
          OR EXISTS(SELECT 1 FROM app.aircraft_persons a WHERE a.aircraft_id=$2 AND a.person_id=p.person_id AND a.status='ACTIVE')))
        ORDER BY name,p.party_id`, [[...partyIds], ctx.aircraftId, scope.owner]);
      return result;
    }, { isolationLevel: 'READ COMMITTED', readOnly: true });
  }

  async function command({ userId, aircraftId, scopeId, action, requestId, data = {}, reason }) {
    if (!capability().enabled) throw costError('La escritura de Costs está deshabilitada.', 'COST_WRITES_DISABLED', 503);
    const ctx = { userId: costUuid(userId), aircraftId: costUuid(aircraftId), scopeId: costUuid(scopeId), requestId: costUuid(requestId),
      reason: costText(action?.startsWith('correct_') ? reason : reason || 'Registro de Costs'), hash: fingerprint({ action, data, reason: reason || 'Registro de Costs' }) };
    try {
      return await transaction(async c => {
        await schema(c, ctx.userId);
        await lock(c, `app-horas:costs:${ctx.aircraftId}`); await lock(c, `app-horas:cost-scope:${ctx.scopeId}`);
        await access(c, ctx.userId, ctx.scopeId, ctx.aircraftId, true);
        const replay = await rows(c, 'SELECT actor_user_id,aircraft_id,entity_id,metadata,after_state FROM audit.audit_events WHERE request_id=$1', [ctx.requestId]);
        if (replay.length) {
          const r = replay[0];
          if (replay.length !== 1 || r.actor_user_id !== ctx.userId || r.aircraft_id !== ctx.aircraftId || r.entity_id !== ctx.scopeId || r.metadata?.input_hash !== ctx.hash) throw conflict();
          return r.after_state;
        }
        let result; let before = null; let extra = {};
        if (action === 'create_concept') {
          if (!['FIXED', 'VARIABLE'].includes(data.cost_class) || !COST_METHODS.includes(data.default_allocation_method)) throw costError('Concepto no válido.');
          const id = randomUUID();
          result = await insert(c, 'app.cost_concepts', { cost_concept_id: id, aircraft_id: ctx.aircraftId, financial_scope_id: ctx.scopeId,
            name: costText(data.name), cost_class: data.cost_class, default_allocation_method: data.default_allocation_method });
          await bind(c, 'concepts', id, ctx);
        } else if (action === 'create_event_type') {
          if (!['NONE', ...COST_METRICS].includes(data.boundary_basis) || (data.boundary_basis === 'ENGINE_CYCLES' && (!Number.isInteger(data.component_position) || data.component_position < 1))) throw costError('Base de evento no válida.');
          const id = randomUUID();
          result = await insert(c, 'app.cost_event_types', { cost_event_type_id: id, aircraft_id: ctx.aircraftId, financial_scope_id: ctx.scopeId,
            name: costText(data.name), boundary_basis: data.boundary_basis, component_position: data.boundary_basis === 'ENGINE_CYCLES' ? data.component_position : null });
          await bind(c, 'types', id, ctx);
        } else if (action === 'create_event' || action === 'correct_event') {
          await root(c, 'types', data.cost_event_type_id, ctx);
          const eventDate = costDate(data.event_date);
          const previousId = data.previous_cost_event_id ? costUuid(data.previous_cost_event_id) : null;
          if (previousId) { const p = await root(c, 'events', previousId, ctx); if (p.status !== 'SETTLED' || p.event_date > eventDate) throw costError('Límite anterior no válido.'); }
          const boundary = data.boundary_after_flight_id ? costUuid(data.boundary_after_flight_id) : null;
          if (boundary && !(await rows(c, `SELECT f.flight_id FROM app.flight_records f JOIN app.flight_record_revisions r ON r.flight_revision_id=f.current_revision_id
            WHERE f.flight_id=$1 AND f.aircraft_id=$2 AND f.status='ACTIVE' AND r.flight_date=$3::date`, [boundary, ctx.aircraftId, eventDate])).length) throw costError('Vuelo de límite no válido para la fecha del evento.');
          const value = { cost_event_type_id: data.cost_event_type_id, title: costText(data.title), event_date: eventDate, previous_cost_event_id: previousId, boundary_after_flight_id: boundary };
          let id;
          if (action === 'correct_event') {
            id = costUuid(data.cost_event_id); before = await root(c, 'events', id, ctx, true); if (before.status !== 'OPEN' || previousId === id) throw conflict();
            const keys = Object.keys(value);
            result = (await rows(c, `UPDATE app.cost_events SET ${keys.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE cost_event_id=$1 RETURNING *`, [id, ...Object.values(value)]))[0];
          } else { id = randomUUID(); result = await insert(c, 'app.cost_events', { cost_event_id: id, aircraft_id: ctx.aircraftId, ...value }); await bind(c, 'events', id, ctx); }
        } else if (action === 'create_expense' || action === 'correct_expense') {
          const input = normalizeExpense(data);
          if (input.expense.cost_event_id && (await root(c, 'events', input.expense.cost_event_id, ctx)).status !== 'OPEN') throw conflict();
          const derived = await derive(c, input, ctx);
          let id; let version = 0;
          if (action === 'correct_expense') {
            id = costUuid(data.expense_id); before = await root(c, 'expenses', id, ctx, true); await editable(c, before);
            if (String(data.expected_details_version) !== String(before.details_version)) throw conflict();
            version = before.details_version;
            const keys = Object.keys(input.expense);
            await c.query(`UPDATE app.expenses SET ${keys.map((key, i) => `${key}=$${i + 2}`).join(',')} WHERE expense_id=$1`, [id, ...Object.values(input.expense)]);
          } else { id = randomUUID(); await insert(c, 'app.expenses', { expense_id: id, aircraft_id: ctx.aircraftId, ...input.expense }); await bind(c, 'expenses', id, ctx); }
          result = await writeDetails(c, id, input, derived, ctx, version);
          extra = { allocations: derived.allocations, payments: input.payments, ownership: derived.ownership, boundaries: derived.boundaries };
        } else if (action === 'settle_event' || action === 'settle_period') {
          const eventId = action === 'settle_event' ? costUuid(data.cost_event_id) : null;
          const start = eventId ? null : costDate(data.period_start_date); const end = eventId ? null : costDate(data.period_end_date);
          if (start && start > end) throw costError('Período no válido.');
          if (eventId && (await root(c, 'events', eventId, ctx, true)).status !== 'OPEN') throw conflict();
          // Lock/inspect ALL selected roots; silently omitting a foreign/unmapped
          // expense from an event would produce an incomplete settlement.
          const expenses = await rows(c, `SELECT e.*,${dateSql('e.expense_date')} AS expense_date,f.financial_scope_id FROM app.expenses e
            LEFT JOIN app.cost_financial_records f ON f.expense_id=e.expense_id
            WHERE e.aircraft_id=$1 AND e.status='OPEN' AND ${eventId ? 'e.cost_event_id=$2' : 'e.cost_event_id IS NULL AND e.expense_date BETWEEN $2::date AND $3::date'}
            ORDER BY e.expense_id FOR UPDATE OF e`, eventId ? [ctx.aircraftId, eventId] : [ctx.aircraftId, start, end]);
          // Periods are private: other administrations' standalone rows are not
          // selected. Event children must all belong to the selected event scope.
          const selected = eventId ? expenses : expenses.filter(e => e.financial_scope_id === ctx.scopeId);
          if ((!selected.length && !eventId) || selected.some(e => e.financial_scope_id !== ctx.scopeId)) throw costError('No hay gastos liquidables o el evento contiene ámbitos incompatibles.');
          const groups = new Map();
          for (const expense of selected) { await editable(c, expense); const list = groups.get(expense.currency_code) || []; list.push(expense); groups.set(expense.currency_code, list); }
          result = { settlement_ids: [] };
          for (const [currency, group] of groups) {
            if ((await rows(c, `SELECT cost_settlement_id FROM app.cost_settlements WHERE aircraft_id=$1 AND currency_code=$2 AND adjusts_settlement_id IS NULL
              AND ${eventId ? 'cost_event_id=$3' : 'cost_event_id IS NULL AND period_start_date=$3::date AND period_end_date=$4::date'}`, eventId ? [ctx.aircraftId, currency, eventId] : [ctx.aircraftId, currency, start, end])).length) throw conflict();
            const id = randomUUID(); const calculated = []; const totals = new Map();
            for (const expense of group) {
              const input = await expenseInput(c, expense); const derived = await derive(c, input, ctx);
              calculated.push({ expense, input, derived });
            }
            await insert(c, 'app.cost_settlements', { cost_settlement_id: id, aircraft_id: ctx.aircraftId, cost_event_id: eventId,
              period_start_date: start, period_end_date: end, currency_code: currency, settled_at: new Date().toISOString(), settled_by_user_id: ctx.userId,
              source_snapshot: JSON.stringify({ version: 1, expenses: calculated.map(({ expense, input, derived }) => ({ expense_id: expense.expense_id,
                concept: expense.cost_concept_id, payments: input.payments, allocation_percentages: derived.allocations, ownership: derived.ownership,
                boundaries: derived.boundaries, utilization_metric: expense.utilization_metric, component_position: expense.utilization_component_position })) }) });
            await bind(c, 'settlements', id, ctx);
            for (const { expense, input, derived } of calculated) {
              await insert(c, 'app.cost_settlement_expense_lines', { cost_settlement_id: id, expense_id: expense.expense_id, cost_concept_id: expense.cost_concept_id,
                expense_date: expense.expense_date, amount: expense.amount, currency_code: currency, allocation_method: expense.allocation_method });
              const partyLines = new Map(derived.allocations.map(a => [a.party_id, { responsibility: decimalUnits(a.allocated_amount), paid: 0n }]));
              for (const p of input.payments) { const line = partyLines.get(p.payer_party_id) || { responsibility: 0n, paid: 0n }; line.paid += decimalUnits(p.amount); partyLines.set(p.payer_party_id, line); }
              for (const [party, line] of partyLines) {
                await insert(c, 'app.cost_settlement_party_lines', { cost_settlement_id: id, expense_id: expense.expense_id, party_id: party,
                  responsibility_amount: decimalString(line.responsibility), paid_amount: decimalString(line.paid) });
                const total = totals.get(party) || { responsibility: 0n, paid: 0n }; total.responsibility += line.responsibility; total.paid += line.paid; totals.set(party, total);
              }
              for (const evidence of derived.evidence) await insert(c, 'app.cost_settlement_utilization_lines', { cost_settlement_utilization_line_id: randomUUID(), cost_settlement_id: id, expense_id: expense.expense_id, ...evidence });
            }
            for (const [party, total] of totals) await insert(c, 'app.cost_settlement_owner_lines', { cost_settlement_id: id, party_id: party,
              responsibility_amount: decimalString(total.responsibility), paid_amount: decimalString(total.paid), net_amount: decimalString(total.paid - total.responsibility) });
            result.settlement_ids.push(id);
          }
          if (eventId) await c.query("UPDATE app.cost_events SET status='SETTLED',settled_at=now(),settled_by_user_id=$2 WHERE cost_event_id=$1", [eventId, ctx.userId]);
        } else throw costError('Acción de Costs no válida.', 'COST_ACTION_INVALID', 400);
        await audit(c, ctx, action, result, before, extra);
        return result;
      }, { isolationLevel: 'SERIALIZABLE' });
    } catch (error) {
      if (['40001', '40P01', '23505'].includes(error.code)) throw conflict();
      throw error;
    }
  }
  return { listArchives, read, command };
}

export const costsRepository = createPostgresCostsRepository();
