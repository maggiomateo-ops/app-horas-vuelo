# Inventario exacto — 008 V1 simplificada

Propuesta D-306, no aplicada. El [SQL](../db/migrations/008_costs_financial_scopes_and_open_corrections.sql) es la definición revisable. No contiene backfill DML. Se retiran del borrador las tres tablas de divulgación y authority_basis; el modelo no incorpora delegación. Se mantienen cinco tablas, una función invoker y dos triggers.

## Tablas nuevas

Todas en app. UUID PK con DEFAULT gen_random_uuid(), excepto la revocación cuyo PK es el mandato. NN=NOT NULL; timestamps de creación/aprobación/revocación/corrección son timestamptz NN DEFAULT now(). FKs inmediatas, NO ACTION, sin CASCADE.

| Tabla | Columnas exactas | Claves/FK/CHECK |
| --- | --- | --- |
| cost_financial_scopes | financial_scope_id uuid PK; aircraft_id uuid NN; label text NN; approval_reference text NN; created_by_user_id uuid NN; created_at timestamptz NN | aircraft→aircraft; creator→users; label/approval no vacíos; uq_cost_scope_aircraft(scope_id,aircraft_id) |
| cost_financial_authorities | financial_authority_id uuid PK; financial_scope_id uuid NN; user_id uuid NN; approval_reference text NN; authorized_by_user_id uuid NN; authorized_at timestamptz NN | scope→scopes; user/authorizer→users; approval no vacío; uq_cost_authority_scope(authority_id,scope_id) |
| cost_financial_authority_revocations | financial_authority_id uuid PK/FK; revoked_by_user_id uuid NN; revoked_at timestamptz NN; reason text NN | authority→authorities; actor→users; reason no vacío |
| cost_financial_records | financial_record_id uuid PK; financial_scope_id uuid NN; aircraft_id uuid NN; cost_concept_id/cost_event_type_id/cost_event_id/expense_id/cost_settlement_id uuid NULL cada uno; registered_by_user_id uuid NN; registered_at timestamptz NN; provenance_reference text NN | UNIQUE individual de las cinco raíces; ck_cost_record_one_root exactamente una raíz; uq_cost_record_scope(record_id,scope_id); registrador→users; provenance no vacío; seis FK compuestas abajo |
| cost_expense_corrections | cost_expense_correction_id uuid PK; expense_id uuid NN; base_details_version bigint NN; request_id uuid NN UNIQUE; actor_user_id uuid NN; corrected_at timestamptz NN; reason text NN | expense→expenses; actor→users; base_version≥0 y reason no vacío; uq_cost_correction_version(expense_id,base_details_version); uq_cost_correction_expense(correction_id,expense_id) |

FK del registro: fk_cost_record_scope(scope_id,aircraft_id)→scopes; fk_cost_record_concept(concept_id,aircraft_id,scope_id)→cost_concepts; fk_cost_record_type(type_id,aircraft_id,scope_id)→cost_event_types; fk_cost_record_event(event_id,aircraft_id)→cost_events; fk_cost_record_expense(expense_id,aircraft_id)→expenses; fk_cost_record_settlement(settlement_id,aircraft_id)→cost_settlements. Los nombres completos de columnas del SQL se conservan, aquí se abrevian solo para lectura.

## Cambios a tablas existentes

| Tabla | Cambio exacto |
| --- | --- |
| cost_concepts | financial_scope_id uuid NULL; fk_cost_concept_scope(financial_scope_id,aircraft_id)→scopes; uq_cost_concept_aircraft UNIQUE(cost_concept_id,aircraft_id,financial_scope_id) |
| cost_event_types | financial_scope_id uuid NULL; fk_cost_type_scope(financial_scope_id,aircraft_id)→scopes; uq_cost_type_aircraft UNIQUE(cost_event_type_id,aircraft_id,financial_scope_id) |
| cost_events | uq_cost_event_aircraft UNIQUE(cost_event_id,aircraft_id) |
| expenses | uq_cost_expense_aircraft UNIQUE(expense_id,aircraft_id); details_version bigint NN DEFAULT 0; ck_cost_details_version CHECK≥0 |
| cost_settlements | uq_cost_settlement_aircraft UNIQUE(cost_settlement_id,aircraft_id); sin UPDATE/DELETE de filas ni cambios a unicidad de 007 |
| expense_payments | created_correction_id uuid NULL; retired_correction_id uuid NULL; retired_at timestamptz NULL; retired_by_user_id uuid NULL FK→users. fk_cost_payment_created_correction(created_correction_id,expense_id) y fk_cost_payment_retired_correction(retired_correction_id,expense_id)→corrections(correction_id,expense_id). ck_cost_payment_retirement: tres metadatos de retiro todos NULL o todos NOT NULL |
| expense_allocations | Mismas cuatro columnas/FK/CHECK que pagos, con prefijo fk_cost_allocation_* y ck_cost_allocation_retirement. Se elimina únicamente uq_expense_allocation_party, sustituida por UNIQUE parcial |

No se cambia el tipo ni los CHECK de amount/porcentajes/métodos de 006/007. No hay columnas nuevas ni DML en las cuatro tablas de líneas settlement, ni cambios de esquema en Audit, usuarios, parties, ownership o membresías.

## Índices

| Nombre | Definición |
| --- | --- |
| idx_cost_authority_user_scope | authorities(user_id,financial_scope_id) |
| idx_cost_record_scope | records(financial_scope_id) |
| uq_active_cost_concept_name | Sustituye el índice de 006: UNIQUE concepts(financial_scope_id,lower(name)) WHERE status=ACTIVE AND scope_id IS NOT NULL |
| uq_active_cost_event_type_name | Sustituye el índice de 006: UNIQUE types(financial_scope_id,lower(name)) WHERE status=ACTIVE AND scope_id IS NOT NULL |
| uq_cost_active_allocation_party | UNIQUE allocations(expense_id,party_id) WHERE retired_at IS NULL |
| idx_cost_active_payment_expense | payments(expense_id) WHERE retired_at IS NULL |

Cada PK/UNIQUE crea su índice de soporte. DROP de los dos índices de nombre previos para recrearlos; DROP de uq_expense_allocation_party elimina su índice de soporte. No se eliminan otros índices, ni se modifica 006/007. uq_cost_original_event_currency/uq_cost_original_period_currency/uq_cost_settlement_utilization_evidence siguen intactos.

## Función y triggers

app.guard_cost_open_detail() RETURNS trigger, LANGUAGE plpgsql SECURITY INVOKER, search_path=pg_catalog,app. EXECUTE PUBLIC revocado, EXECUTE al grupo app_runtime. trg_cost_payment_open_detail y trg_cost_allocation_open_detail: BEFORE INSERT OR UPDATE, FOR EACH ROW.

Guardas: gasto padre FOR UPDATE; OPEN, evento OPEN si existe, ausencia de fuente congelada incluso por período; batch obligatorio en INSERT; solo retiro unidireccional sin cambiar valores; base_version+1 igual a details_version; actor de retiro igual al batch. SQLSTATE 23514 ante violación. No calcula totales ni autoriza al usuario: responsabilidad del servicio. Audit se inserta en la misma transacción del servicio, no desde este trigger.

## Permisos y gates

**13 tablas normalizadas:** las cinco nuevas, expense_payments, expense_allocations, cost_settlements, sus cuatro tablas de líneas y audit.audit_events. Primero REVOKE ALL de tabla para app_runtime, app_horas_runtime y PUBLIC; después REVOKE SELECT/INSERT/UPDATE/REFERENCES por todas las columnas de cada tabla. Sin CASCADE: grants dependientes inesperados bloquean la migración futura y requieren revisión, no ampliación silenciosa.

| Objetos | Derechos reotorgados exclusivamente a app_runtime |
| --- | --- |
| scopes, authorities, authority_revocations | SELECT |
| records, corrections, payments, allocations, settlement header + cuatro líneas, Audit | SELECT, INSERT |
| payments, allocations | Además UPDATE(retired_correction_id,retired_at,retired_by_user_id) únicamente |

app_horas_runtime debe heredar el grupo, no recibe grants directos nuevos. PUBLIC no recibe ninguno. No se otorgan DELETE/TRUNCATE/TRIGGER/REFERENCES ni grants con grant option. Las raíces concepts/types/events/expenses conservan sus permisos anteriores; el servicio impide cambios de ámbito y modificaciones congeladas.

Antes del DDL, DO runtime_roles exige ambos roles existentes con flags seguros, login/grupo correctos, herencia utilizable, ausencia de roles extra (incluso MEMBER/SET ROLE), ownership/CREATE en app/audit y objetos canónicos. No altera membresías ni ownership.

Después de los grants, DO runtime_effective_privileges verifica SELECT/INSERT esperados, ausencia de UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER de tabla y SELECT/UPDATE/INSERT/REFERENCES por columna para grupo, login y PUBLIC. Un RAISE provoca rollback en el runner transaccional futuro. No se basa en information_schema filtrado solo por grantee del grupo.

Se añade scripts/lib/costs-v1-privilege-contract.mjs para leer evidencia mediante tres SELECT inyectados y validar el contrato offline. No conecta ni ejecuta al importarlo. El SQL propuesto y los privilegios del entorno real requieren preflight posterior; no son equivalentes a haber corregido ya el servidor.
