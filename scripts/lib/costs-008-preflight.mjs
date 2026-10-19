import { createHash } from 'node:crypto';
import { COSTS_008_FIXTURE_STATEMENTS } from './costs-008-fixture.mjs';

export const COSTS_PREFLIGHT_TARGET = Object.freeze({
  project_id: 'red-pine-78283204', branch_id: 'br-fancy-hall-b6h6g74f', database_name: 'app_horas',
});
// One statement per prepared query. Dollar bodies, comments and SQL strings are
// preserved; BEGIN/COMMIT are supplied by the transaction executor, never SQL text.
export function splitPostgresStatements(sql) {
  const out = []; let start = 0; let quote = null; let dollar = null; let comment = 0;
  for (let i = 0; i < sql.length; i++) {
    if (comment === 1) { if (sql[i] === '\n') comment = 0; continue; }
    if (comment === 2) { if (sql.slice(i, i + 2) === '*/') { comment = 0; i++; } continue; }
    if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length - 1; dollar = null; } continue; }
    if (quote) { if (sql[i] === quote) { if (sql[i + 1] === quote) i++; else quote = null; } continue; }
    if (sql.slice(i, i + 2) === '--') { comment = 1; i++; continue; }
    if (sql.slice(i, i + 2) === '/*') { comment = 2; i++; continue; }
    if (sql[i] === "'" || sql[i] === '"') { quote = sql[i]; continue; }
    const tag = sql.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/);
    if (tag) { dollar = tag[0]; i += dollar.length - 1; continue; }
    if (sql[i] === ';') { out.push(sql.slice(start, i + 1)); start = i + 1; }
  }
  if (quote || dollar || comment === 2) throw new Error('Unterminated SQL token.');
  if (sql.slice(start).replace(/--[^\n]*/g, '').trim()) out.push(sql.slice(start));
  return out.filter(s => s.replace(/--[^\n]*/g, '').trim());
}

export const COSTS_FINGERPRINT_SQL = `SELECT current_database() AS database,
  (SELECT jsonb_agg(version ORDER BY version) FROM public.schema_migrations) AS versions,
  md5(jsonb_build_object(
    'rowcounts',jsonb_build_array((SELECT count(*) FROM app.users),(SELECT count(*) FROM app.aircraft),
      (SELECT count(*) FROM app.parties),(SELECT count(*) FROM app.expenses),(SELECT count(*) FROM audit.audit_events)),
    'relations',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relowner,c.relacl) ORDER BY n.nspname,c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('app','audit')),
    'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attname,a.atttypid,a.atttypmod,a.attnotnull,a.attacl) ORDER BY a.attrelid,a.attnum)
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('app','audit') AND a.attnum>0 AND NOT a.attisdropped),
    'constraints',(SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname,conrelid)
      FROM pg_constraint WHERE connamespace IN ('app'::regnamespace,'audit'::regnamespace)),
    'functions',(SELECT jsonb_agg(jsonb_build_array(p.proname,pg_get_functiondef(p.oid),p.proacl) ORDER BY p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('app','audit')),
    'triggers',(SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY t.oid) FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('app','audit') AND NOT t.tgisinternal)
  )::text) AS schema_fingerprint,
  to_regclass('app.cost_financial_scopes') AS scope_table`;

export function buildCosts008Preflight(sql, target) {
  for (const [key, value] of Object.entries(COSTS_PREFLIGHT_TARGET)) if (target?.[key] !== value) throw new Error('Unauthorized preflight target.');
  const parts = splitPostgresStatements(sql);
  const first = parts.shift();
  if (!/DO \$draft_only\$[\s\S]*RAISE EXCEPTION 'MIGRATION_008_DESIGN_ONLY_NOT_APPROVED'[\s\S]*\$draft_only\$;/.test(first)) {
    throw new Error('Exact design guard missing.');
  }
  const check = `DO $verify_008$ BEGIN
    IF current_database()<>'app_horas' OR (SELECT count(*) FROM public.schema_migrations)<>7
      OR to_regprocedure('app.guard_cost_open_detail()') IS NULL
      OR (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_cost_payment_open_detail','trg_cost_allocation_open_detail') AND NOT tgisinternal)<>2
      OR NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='ck_cost_record_one_root')
      OR NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='app' AND indexname='uq_cost_active_allocation_party') THEN
      RAISE EXCEPTION 'COSTS_008_STRUCTURE_FAILED';
    END IF;
  END; $verify_008$;`;
  return { target, sha256: createHash('sha256').update(sql).digest('hex'), sql_statements: [
    `DO $initial$ BEGIN IF current_database()<>'app_horas' OR to_regclass('app.cost_financial_scopes') IS NOT NULL
      OR (SELECT array_agg(version ORDER BY version) FROM public.schema_migrations) IS DISTINCT FROM ARRAY['001','002','003','004','005','006','007']::text[]
      THEN RAISE EXCEPTION 'COSTS_008_INITIAL_SCHEMA_FAILED'; END IF; END; $initial$;`,
    ...parts, check, ...COSTS_008_FIXTURE_STATEMENTS,
    `DO $rollback_proof$ BEGIN RAISE EXCEPTION 'COSTS_008_PREFLIGHT_VALIDATED_ROLLBACK'; END; $rollback_proof$;`,
  ] };
}

export async function runCosts008Preflight({ sql, target, query, transaction }) {
  const plan = buildCosts008Preflight(sql, target);
  const before = await query(COSTS_FINGERPRINT_SQL);
  if (before.rows[0]?.scope_table !== null) throw new Error('008 is already present.');
  let validated = false;
  try { await transaction(plan.sql_statements, target); }
  catch (error) { if (!String(error.message).includes('COSTS_008_PREFLIGHT_VALIDATED_ROLLBACK')) throw error; validated = true; }
  if (!validated) throw new Error('Transaction did not reach forced rollback.');
  const after = await query(COSTS_FINGERPRINT_SQL); // Separate connection/transaction.
  if (JSON.stringify(before.rows) !== JSON.stringify(after.rows)) throw new Error('Rollback fingerprint mismatch.');
  return { ok: true, sha256: plan.sha256, forcedRollback: true, persistentWrites: 0, fingerprint: after.rows[0].schema_fingerprint };
}
