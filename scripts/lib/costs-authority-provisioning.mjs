// Plan generation only. No connection, execution, environment access or API route.
// A human-approved manifest is a prerequisite, not a role inferred by this code.
import crypto from 'node:crypto';
import { costUuid, costText } from '../../api/_costsDomain.js';

export function buildCostsAuthorityPlan(manifest) {
  if (!manifest || manifest.approval_verified !== true) throw new Error('A reviewed, explicitly approved financial mandate manifest is required.');
  const aircraft = costUuid(manifest.aircraft_id), scope = costUuid(manifest.financial_scope_id);
  const approver = costUuid(manifest.approved_by_user_id), request = costUuid(manifest.request_id);
  const label = costText(manifest.label), reference = costText(manifest.approval_reference);
  if (!Array.isArray(manifest.mandates) || !manifest.mandates.length || manifest.mandates.length > 100) throw new Error('Explicit mandate UUIDs and users are required.');
  const mandates = manifest.mandates.map(m => ({ financial_authority_id: costUuid(m.financial_authority_id), user_id: costUuid(m.user_id) }));
  if (new Set(mandates.map(m => m.user_id)).size !== mandates.length || new Set(mandates.map(m => m.financial_authority_id)).size !== mandates.length) throw new Error('Duplicate mandate/user.');
  const statements = [
    { text: `DO $provision$ BEGIN IF current_database()<>'app_horas' OR current_user<>'app_horas_migration'
        OR to_regclass('app.cost_financial_authorities') IS NULL THEN RAISE EXCEPTION 'COST_PRIVILEGED_PROVISIONING_REQUIRED'; END IF; END; $provision$;`, values: [] },
    { text: 'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', values: [`app-horas:costs:${aircraft}`], requireLocked: true },
    { text: 'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', values: [`app-horas:cost-scope:${scope}`], requireLocked: true },
    { text: "SELECT aircraft_id FROM app.aircraft WHERE aircraft_id=$1 AND status='ACTIVE'", values: [aircraft], requireRows: 1 },
    { text: "SELECT user_id FROM app.users WHERE user_id=ANY($1::uuid[]) AND status='ACTIVE'", values: [[...new Set([approver, ...mandates.map(m => m.user_id)])]], requireRows: new Set([approver, ...mandates.map(m => m.user_id)]).size },
    { text: 'INSERT INTO app.cost_financial_scopes(financial_scope_id,aircraft_id,label,approval_reference,created_by_user_id) VALUES($1,$2,$3,$4,$5)', values: [scope, aircraft, label, reference, approver] },
    ...mandates.map(m => ({ text: 'INSERT INTO app.cost_financial_authorities(financial_authority_id,financial_scope_id,user_id,approval_reference,authorized_by_user_id) VALUES($1,$2,$3,$4,$5)', values: [m.financial_authority_id, scope, m.user_id, reference, approver] })),
    { text: `INSERT INTO audit.audit_events(audit_event_id,request_id,actor_type,actor_user_id,operation_source,aircraft_id,
      entity_type,entity_id,entity_key,action_code,after_state,metadata,payload_version)
      VALUES($1,$2,'USER',$3,'MANUAL',$4,'COST',$5,$6::jsonb,'COST_FINANCIAL_AUTHORITY_PROVISIONED',$7::jsonb,$8::jsonb,1)`,
    values: [crypto.randomUUID(), request, approver, aircraft, scope, JSON.stringify({ financial_scope_id: scope }),
      JSON.stringify({ financial_scope_id: scope, mandates }), JSON.stringify({ approval_reference: reference, contract: 'COSTS_V1_EXPLICIT_PROVISIONING' })] },
  ];
  return { operation: 'REVIEW_ONLY_NOT_EXECUTED', isolationLevel: 'SERIALIZABLE', statements,
    instruction: 'Execute only with separate target authorization, verifying requireLocked/requireRows and approval evidence; one transaction, rollback on any failure. Never expose through runtime APIs.' };
}
