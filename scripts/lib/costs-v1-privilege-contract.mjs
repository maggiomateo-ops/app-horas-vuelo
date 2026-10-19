// Offline-testable post-008 contract. Importing this file never connects to a DB.
export const COST_RUNTIME_ROLES = Object.freeze(['app_runtime', 'app_horas_runtime']);
export const COST_PRIVILEGE_SUBJECTS = Object.freeze([...COST_RUNTIME_ROLES, 'public']);
export const COST_AUTHORITY_TABLES = Object.freeze([
  'app.cost_financial_scopes', 'app.cost_financial_authorities',
  'app.cost_financial_authority_revocations',
]);
export const COST_DETAIL_TABLES = Object.freeze(['app.expense_payments', 'app.expense_allocations']);
export const COST_PROTECTED_TABLES = Object.freeze([
  ...COST_AUTHORITY_TABLES, 'app.cost_financial_records', 'app.cost_expense_corrections',
  ...COST_DETAIL_TABLES, 'app.cost_settlements', 'app.cost_settlement_expense_lines',
  'app.cost_settlement_party_lines', 'app.cost_settlement_owner_lines',
  'app.cost_settlement_utilization_lines', 'audit.audit_events',
]);
export const COST_RETIREMENT_COLUMNS = Object.freeze([
  'retired_correction_id', 'retired_at', 'retired_by_user_id',
]);
export const COST_REQUIRED_COLUMNS = Object.freeze({
  'app.cost_financial_scopes': ['financial_scope_id', 'aircraft_id', 'label', 'approval_reference', 'created_by_user_id', 'created_at'],
  'app.cost_financial_authorities': ['financial_authority_id', 'financial_scope_id', 'user_id', 'approval_reference', 'authorized_by_user_id', 'authorized_at'],
  'app.cost_financial_authority_revocations': ['financial_authority_id', 'revoked_by_user_id', 'revoked_at', 'reason'],
  'app.cost_financial_records': ['financial_record_id', 'financial_scope_id', 'aircraft_id', 'cost_concept_id', 'cost_event_type_id', 'cost_event_id', 'expense_id', 'cost_settlement_id', 'registered_by_user_id', 'registered_at', 'provenance_reference'],
  'app.cost_expense_corrections': ['cost_expense_correction_id', 'expense_id', 'base_details_version', 'request_id', 'actor_user_id', 'corrected_at', 'reason'],
  'app.expense_payments': ['expense_payment_id', 'expense_id', 'payer_party_id', 'amount', 'created_correction_id', ...COST_RETIREMENT_COLUMNS],
  'app.expense_allocations': ['expense_allocation_id', 'expense_id', 'party_id', 'allocation_percent', 'allocated_amount', 'source_method', 'created_correction_id', ...COST_RETIREMENT_COLUMNS],
  'app.cost_settlements': ['cost_settlement_id', 'aircraft_id', 'cost_event_id', 'period_start_date', 'period_end_date', 'currency_code', 'settled_at', 'settled_by_user_id', 'source_snapshot', 'adjusts_settlement_id'],
  'app.cost_settlement_expense_lines': ['cost_settlement_id', 'expense_id', 'cost_concept_id', 'expense_date', 'amount', 'currency_code', 'allocation_method'],
  'app.cost_settlement_party_lines': ['cost_settlement_id', 'expense_id', 'party_id', 'responsibility_amount', 'paid_amount'],
  'app.cost_settlement_owner_lines': ['cost_settlement_id', 'party_id', 'responsibility_amount', 'paid_amount', 'net_amount'],
  'app.cost_settlement_utilization_lines': ['cost_settlement_id', 'flight_id', 'flight_revision_id', 'utilization_owner_party_id', 'utilization_value', 'cost_settlement_utilization_line_id', 'expense_id', 'utilization_metric', 'component_installation_id'],
  'audit.audit_events': ['audit_event_id', 'request_id', 'actor_type', 'actor_user_id', 'operation_source', 'aircraft_id', 'entity_type', 'action_code', 'before_state', 'after_state', 'metadata', 'payload_version'],
});

// Each statement is SELECT-only. A future caller must use a read-only transaction
// against an independently authorized isolated database AFTER approved 008.
export const COST_ROLE_QUERY = `SELECT r.rolname AS role, r.rolcanlogin AS can_login,
  r.rolinherit AS inherit, r.rolsuper AS superuser, r.rolcreatedb AS create_db,
  r.rolcreaterole AS create_role, r.rolreplication AS replication, r.rolbypassrls AS bypass_rls,
  ARRAY(SELECT other_role.rolname::text FROM pg_roles other_role
    WHERE other_role.oid <> r.oid AND pg_has_role(r.oid, other_role.oid, 'MEMBER')
    ORDER BY other_role.rolname) AS member_roles,
  (has_schema_privilege(r.oid,'app','CREATE') OR has_schema_privilege(r.oid,'audit','CREATE')) AS schema_create,
  (EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('app','audit') AND nspowner=r.oid)
    OR EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('app','audit') AND c.relowner=r.oid)
    OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('app','audit') AND p.proowner=r.oid)) AS owns_canonical
  FROM pg_roles r WHERE r.rolname=ANY($1::text[])`;
export const COST_TABLE_QUERY = `SELECT subject AS role, relation AS table,
  has_table_privilege(subject::name,relation,'SELECT') AS select,
  has_table_privilege(subject::name,relation,'INSERT') AS insert,
  has_table_privilege(subject::name,relation,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS forbidden
  FROM unnest($1::text[]) subject CROSS JOIN unnest($2::text[]) relation`;
export const COST_COLUMN_QUERY = `SELECT subject AS role, relation AS table, a.attname AS column,
  has_column_privilege(subject::name,relation,a.attname,'SELECT') AS select,
  has_column_privilege(subject::name,relation,a.attname,'UPDATE') AS update,
  has_column_privilege(subject::name,relation,a.attname,'INSERT') AS insert,
  has_column_privilege(subject::name,relation,a.attname,'REFERENCES') AS references
  FROM unnest($1::text[]) subject CROSS JOIN unnest($2::text[]) relation
  JOIN pg_attribute a ON a.attrelid=relation::regclass AND a.attnum>0 AND NOT a.attisdropped`;

function fail(message) {
  const error = new Error(message);
  error.code = 'COST_RUNTIME_PRIVILEGES_UNSAFE';
  throw error;
}

export function assertCostsV1Privileges({ roles, tables, columns } = {}) {
  if (!Array.isArray(roles) || roles.length !== 2 || !Array.isArray(tables) || !Array.isArray(columns)) {
    fail('Missing effective privilege evidence.');
  }
  for (const name of COST_RUNTIME_ROLES) {
    const matches = roles.filter(row => row.role === name);
    if (matches.length !== 1) fail(`Missing/duplicate role: ${name}`);
    const role = matches[0];
    const allowedMembership = name === 'app_horas_runtime' ? ['app_runtime'] : [];
    if (role.can_login !== (name === 'app_horas_runtime')
      || (name === 'app_horas_runtime' && role.inherit !== true)
      || !Array.isArray(role.member_roles)
      || JSON.stringify([...role.member_roles].sort()) !== JSON.stringify(allowedMembership)
      || ['superuser', 'create_db', 'create_role', 'replication', 'bypass_rls', 'schema_create', 'owns_canonical']
        .some(key => role[key] !== false)) fail(`Unsafe role: ${name}`);
  }
  const expectedCount = COST_PRIVILEGE_SUBJECTS.length * COST_PROTECTED_TABLES.length;
  if (tables.length !== expectedCount) fail('Incomplete table matrix.');
  for (const subject of COST_PRIVILEGE_SUBJECTS) {
    for (const table of COST_PROTECTED_TABLES) {
      const rows = tables.filter(row => row.role === subject && row.table === table);
      const canRead = subject !== 'public';
      const canInsert = canRead && !COST_AUTHORITY_TABLES.includes(table);
      if (rows.length !== 1 || rows[0].select !== canRead || rows[0].insert !== canInsert
        || rows[0].forbidden !== false) fail(`Unsafe table privileges: ${subject}, ${table}`);
      const attrs = columns.filter(row => row.role === subject && row.table === table);
      const names = attrs.map(row => row.column);
      if (!attrs.length || new Set(names).size !== names.length
        || COST_REQUIRED_COLUMNS[table].some(name => !names.includes(name))) fail(`Incomplete columns: ${subject}, ${table}`);
      for (const attr of attrs) {
        const canUpdate = canRead && COST_DETAIL_TABLES.includes(table) && COST_RETIREMENT_COLUMNS.includes(attr.column);
        if (attr.select !== canRead || attr.update !== canUpdate || attr.insert !== canInsert || attr.references !== false) {
          fail(`Unsafe column privileges: ${subject}, ${table}, ${attr.column}`);
        }
      }
    }
  }
  if (columns.some(row => !COST_PRIVILEGE_SUBJECTS.includes(row.role) || !COST_PROTECTED_TABLES.includes(row.table))) {
    fail('Unexpected column evidence.');
  }
  return { ok: true, roles: [...COST_RUNTIME_ROLES], writesPerformed: 0 };
}

export async function readCostsV1PrivilegeEvidence(query) {
  if (typeof query !== 'function') throw new TypeError('A read-only query function is required.');
  const roles = await query(COST_ROLE_QUERY, [COST_RUNTIME_ROLES]);
  const tables = await query(COST_TABLE_QUERY, [COST_PRIVILEGE_SUBJECTS, COST_PROTECTED_TABLES]);
  const columns = await query(COST_COLUMN_QUERY, [COST_PRIVILEGE_SUBJECTS, COST_PROTECTED_TABLES]);
  return assertCostsV1Privileges({ roles: roles.rows, tables: tables.rows, columns: columns.rows });
}
