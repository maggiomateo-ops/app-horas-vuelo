import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertCostsV1Privileges, readCostsV1PrivilegeEvidence,
  COST_AUTHORITY_TABLES, COST_DETAIL_TABLES, COST_PROTECTED_TABLES,
  COST_PRIVILEGE_SUBJECTS, COST_RETIREMENT_COLUMNS,
  COST_REQUIRED_COLUMNS,
  COST_ROLE_QUERY, COST_TABLE_QUERY, COST_COLUMN_QUERY,
} from '../scripts/lib/costs-v1-privilege-contract.mjs';

const raw = readFileSync(new URL('../db/migrations/008_costs_financial_scopes_and_open_corrections.sql', import.meta.url), 'utf8');
const sql = raw.replace(/--[^\n]*/g, '');

function fixture() {
  const roles = ['app_runtime', 'app_horas_runtime'].map(role => ({
    role, can_login: role === 'app_horas_runtime', inherit: true,
    superuser: false, create_db: false, create_role: false, replication: false,
    bypass_rls: false, schema_create: false, owns_canonical: false,
    member_roles: role === 'app_horas_runtime' ? ['app_runtime'] : [],
  }));
  const tables = [];
  const columns = [];
  for (const role of COST_PRIVILEGE_SUBJECTS) for (const table of COST_PROTECTED_TABLES) {
    const select = role !== 'public';
    const insert = select && !COST_AUTHORITY_TABLES.includes(table);
    tables.push({ role, table, select, insert, forbidden: false });
    for (const column of COST_REQUIRED_COLUMNS[table]) {
      columns.push({ role, table, column, select, insert, references: false,
        update: select && COST_DETAIL_TABLES.includes(table) && COST_RETIREMENT_COLUMNS.includes(column) });
    }
  }
  return { roles, tables, columns };
}

test('008 V1 is blocked before DDL and contains no sharing/delegation workflow or automatic historical grants', () => {
  assert(sql.indexOf("RAISE EXCEPTION 'MIGRATION_008_DESIGN_ONLY_NOT_APPROVED'") < sql.indexOf('CREATE TABLE'));
  assert.deepEqual([...sql.matchAll(/CREATE TABLE app\.(\w+)/g)].map(m => m[1]), [
    'cost_financial_scopes', 'cost_financial_authorities',
    'cost_financial_authority_revocations', 'cost_financial_records', 'cost_expense_corrections',
  ]);
  assert.doesNotMatch(sql, /cost_financial_disclosures|DELEGATED_ADMIN|ORGANIZATION_REPRESENTATIVE/);
  assert.doesNotMatch(sql, /INSERT INTO app\.(?:cost_financial|aircraft_memberships)/);
  assert.doesNotMatch(sql, /UPDATE app\.cost_settlement|DELETE FROM|GRANT[^;]*\bDELETE\b/i);
  assert.match(sql, /GRANT SELECT ON app\.cost_financial_scopes,[\s\S]*?cost_financial_authority_revocations TO app_runtime/);
});

test('008 preserves aircraft-scoped typed binding and traceable active-only detail correction', () => {
  assert.match(sql, /num_nonnulls\([\s\S]*?cost_settlement_id\) = 1/);
  for (const key of ['concept', 'type', 'event', 'expense', 'settlement']) assert.match(sql, new RegExp(`fk_cost_record_${key} FOREIGN KEY`));
  assert.match(sql, /UNIQUE INDEX uq_cost_active_allocation_party[\s\S]*?WHERE retired_at IS NULL/);
  assert.match(sql, /OLD\.retired_at IS NOT NULL OR NEW\.retired_at IS NULL/);
  assert.match(sql, /FROM app\.cost_settlement_expense_lines WHERE expense_id = NEW\.expense_id/);
  assert.match(sql, /correction\.base_details_version \+ 1 <> parent\.details_version/);
});

test('008 normalizes direct table AND column grants of both roles/PUBLIC and verifies effective privilege functions', () => {
  assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE %s FROM app_runtime, app_horas_runtime, PUBLIC/);
  assert.match(sql, /REVOKE SELECT \(%1\$s\), INSERT \(%1\$s\), UPDATE \(%1\$s\), REFERENCES \(%1\$s\)/);
  assert.match(sql, /pg_has_role\(runtime_role\.oid, other_role\.oid, 'MEMBER'\)/);
  assert.match(sql, /c\.relowner = runtime_role\.oid/);
  assert.match(sql, /FOREACH role_name IN ARRAY ARRAY\['app_runtime', 'app_horas_runtime', 'public'\]/);
  assert.match(sql, /has_table_privilege\(role_name/);
  assert.match(sql, /has_column_privilege\(role_name/);
  for (const table of COST_PROTECTED_TABLES) assert(sql.includes(`'${table}'`));
});

test('privilege contract accepts only complete safe effective evidence for both roles and PUBLIC', () => {
  assert.equal(assertCostsV1Privileges(fixture()).ok, true);
  assert.throws(() => assertCostsV1Privileges(), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
  for (const key of ['roles', 'tables', 'columns']) {
    const data = fixture(); data[key] = [];
    assert.throws(() => assertCostsV1Privileges(data), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
  }
});

test('regression: a safe group cannot hide login UPDATE, column grants, PUBLIC or snapshot mutation', () => {
  for (const role of COST_PRIVILEGE_SUBJECTS) {
    for (const table of COST_PROTECTED_TABLES) {
      const data = fixture();
      data.tables.find(row => row.role === role && row.table === table).forbidden = true;
      assert.throws(() => assertCostsV1Privileges(data), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
    }
    for (const table of COST_DETAIL_TABLES) {
      const data = fixture();
      data.columns.find(row => row.role === role && row.table === table && row.column === 'expense_id').update = true;
      assert.throws(() => assertCostsV1Privileges(data), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
    }
  }
  const publicRead = fixture(); publicRead.tables.find(row => row.role === 'public').select = true;
  assert.throws(() => assertCostsV1Privileges(publicRead), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
  const publicColumnRead = fixture(); publicColumnRead.columns.find(row => row.role === 'public').select = true;
  assert.throws(() => assertCostsV1Privileges(publicColumnRead), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
  const authorityInsert = fixture(); authorityInsert.tables[0].insert = true;
  assert.throws(() => assertCostsV1Privileges(authorityInsert), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
});

test('effective contract rejects elevated/inherited authority, object ownership, incomplete or duplicate evidence', () => {
  for (const roleIndex of [0, 1]) {
    for (const flag of ['superuser', 'create_db', 'create_role', 'replication', 'bypass_rls', 'schema_create', 'owns_canonical']) {
      const data = fixture(); data.roles[roleIndex][flag] = true;
      assert.throws(() => assertCostsV1Privileges(data), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
    }
    const inherited = fixture(); inherited.roles[roleIndex].member_roles.push('neon_superuser');
    assert.throws(() => assertCostsV1Privileges(inherited), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
  }
  const wrongLogin = fixture(); wrongLogin.roles[0].can_login = true;
  assert.throws(() => assertCostsV1Privileges(wrongLogin), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
  const noInheritance = fixture(); noInheritance.roles[1].inherit = false;
  assert.throws(() => assertCostsV1Privileges(noInheritance), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
  const missingAmount = fixture(); missingAmount.columns = missingAmount.columns.filter(row => row.column !== 'amount');
  assert.throws(() => assertCostsV1Privileges(missingAmount), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
  const missingSnapshot = fixture(); missingSnapshot.columns = missingSnapshot.columns.filter(row => row.column !== 'source_snapshot');
  assert.throws(() => assertCostsV1Privileges(missingSnapshot), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
  const duplicate = fixture(); duplicate.tables[0] = duplicate.tables[1];
  assert.throws(() => assertCostsV1Privileges(duplicate), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
});

test('read-only evidence collector never opens connections and rejects unsafe login effective evidence', async () => {
  const data = fixture();
  const calls = [];
  const query = async (text, params) => {
    calls.push({ text, params });
    assert.match(text, /^SELECT /);
    if (text === COST_ROLE_QUERY) return { rows: data.roles };
    if (text === COST_TABLE_QUERY) return { rows: data.tables };
    if (text === COST_COLUMN_QUERY) return { rows: data.columns };
    assert.fail('Unexpected query');
  };
  assert.equal((await readCostsV1PrivilegeEvidence(query)).writesPerformed, 0);
  assert.equal(calls.length, 3);
  data.tables.find(row => row.role === 'app_horas_runtime').forbidden = true;
  await assert.rejects(readCostsV1PrivilegeEvidence(query), { code: 'COST_RUNTIME_PRIVILEGES_UNSAFE' });
});
