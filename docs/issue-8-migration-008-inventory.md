# Inventario exacto del borrador 008

Estado: propuesta no aprobada. El SQL asociado es la definición revisable; no se ejecutó. Todas las tablas pertenecen a `app`. No hay cambios en `audit` ni en migrations 001/002/006/007. Los `REFERENCES` sin acción explícita usan NO ACTION; no hay CASCADE. Las FK son inmediatas, no diferidas. Todos los PK UUID nuevos tienen `DEFAULT gen_random_uuid()`, salvo las tablas de revocaciones que usan el ID de su grant/mandato como PK/FK. Todos los timestamps nuevos de creación/emisión/corrección/revocación usan `timestamptz NOT NULL DEFAULT now()`, excepto `retired_at` nullable y sin default.

## Tablas nuevas: ocho

| Tabla | Columnas (NN = NOT NULL; ? = nullable) | Claves, FK y CHECK |
| --- | --- | --- |
| `cost_financial_scopes` | `financial_scope_id uuid PK`, `aircraft_id uuid NN`, `holder_party_id uuid NN`, `label text NN`, `created_by_user_id uuid NN`, `created_at timestamptz NN` | FK aircraft→aircraft.aircraft_id; holder→parties.party_id; creator→users.user_id. CHECK label no vacío. `uq_cost_scope_aircraft(financial_scope_id,aircraft_id)` |
| `cost_financial_authorities` | `financial_authority_id uuid PK`, `financial_scope_id uuid NN`, `user_id uuid NN`, `authority_basis text NN`, `approval_reference text NN`, `authorized_by_user_id uuid NN`, `authorized_at timestamptz NN` | FK scope→scopes; user y authorizer→users. CHECK basis ∈ PERSON_HOLDER/ORGANIZATION_REPRESENTATIVE/DELEGATED_ADMIN; reference no vacía. `uq_cost_authority_scope(financial_authority_id,financial_scope_id)` |
| `cost_financial_authority_revocations` | `financial_authority_id uuid PK/FK`, `revoked_by_user_id uuid NN`, `revoked_at timestamptz NN`, `reason text NN` | FK authority→authorities; actor→users. CHECK reason no vacía. PK permite una revocación por mandato |
| `cost_financial_records` | `financial_record_id uuid PK`, `financial_scope_id uuid NN`, `aircraft_id uuid NN`, `cost_concept_id uuid ?`, `cost_event_type_id uuid ?`, `cost_event_id uuid ?`, `expense_id uuid ?`, `cost_settlement_id uuid ?`, `registered_by_user_id uuid NN`, `registered_at timestamptz NN`, `provenance_reference text NN` | UNIQUE individual de cada una de las cinco raíces; CHECK provenance no vacía. `ck_cost_record_one_root`: exactamente una raíz no NULL. `uq_cost_record_scope(financial_record_id,financial_scope_id)`. FK registrador→users. Seis FK compuestas enumeradas abajo |
| `cost_financial_disclosures` | `financial_disclosure_id uuid PK`, `financial_scope_id uuid NN`, `financial_authority_id uuid NN`, `recipient_user_id uuid NN`, `issued_by_user_id uuid NN`, `issued_at timestamptz NN`, `request_id uuid NN UNIQUE`, `reason text NN` | FK scope→scopes; recipient/issuer→users; CHECK reason no vacía. `uq_cost_disclosure_scope(financial_disclosure_id,financial_scope_id)`; `fk_cost_disclosure_authority(financial_authority_id,financial_scope_id)`→authorities par homónimo |
| `cost_financial_disclosure_records` | `financial_disclosure_id uuid NN`, `financial_scope_id uuid NN`, `financial_record_id uuid NN` | PK(disclosure_id,record_id). `fk_cost_disclosure_record_header(disclosure_id,scope_id)`→disclosures par homónimo; `fk_cost_disclosure_record_scope(record_id,scope_id)`→records par homónimo (usar nombres completos del SQL) |
| `cost_financial_disclosure_revocations` | `financial_disclosure_id uuid PK/FK`, `revoked_by_user_id uuid NN`, `revoked_at timestamptz NN`, `reason text NN`, `request_id uuid NN UNIQUE` | FK disclosure→disclosures; actor→users. CHECK reason no vacía. Una revocación por grant |
| `cost_expense_corrections` | `cost_expense_correction_id uuid PK`, `expense_id uuid NN`, `base_details_version bigint NN`, `request_id uuid NN UNIQUE`, `actor_user_id uuid NN`, `corrected_at timestamptz NN`, `reason text NN` | FK expense→expenses; actor→users. CHECK base_version≥0 y reason no vacía. `uq_cost_correction_version(expense_id,base_details_version)`; `uq_cost_correction_expense(correction_id,expense_id)` |

FK de `cost_financial_records`:

| Nombre | Columnas origen | Destino |
| --- | --- | --- |
| `fk_cost_record_scope` | financial_scope_id, aircraft_id | cost_financial_scopes(financial_scope_id, aircraft_id) |
| `fk_cost_record_concept` | cost_concept_id, aircraft_id | cost_concepts(cost_concept_id, aircraft_id) |
| `fk_cost_record_type` | cost_event_type_id, aircraft_id | cost_event_types(cost_event_type_id, aircraft_id) |
| `fk_cost_record_event` | cost_event_id, aircraft_id | cost_events(cost_event_id, aircraft_id) |
| `fk_cost_record_expense` | expense_id, aircraft_id | expenses(expense_id, aircraft_id) |
| `fk_cost_record_settlement` | cost_settlement_id, aircraft_id | cost_settlements(cost_settlement_id, aircraft_id) |

## Tablas existentes: cambios exactos

| Tabla | Cambio |
| --- | --- |
| cost_concepts | Añadir `uq_cost_concept_aircraft UNIQUE(cost_concept_id,aircraft_id)`; no columnas nuevas |
| cost_event_types | Añadir `uq_cost_type_aircraft UNIQUE(cost_event_type_id,aircraft_id)`; `boundary_basis` intacto |
| cost_events | Añadir `uq_cost_event_aircraft UNIQUE(cost_event_id,aircraft_id)`; lifecycle intacto |
| expenses | Añadir `uq_cost_expense_aircraft UNIQUE(expense_id,aircraft_id)`; `details_version bigint NOT NULL DEFAULT 0`; `ck_cost_details_version CHECK(details_version>=0)` |
| cost_settlements | Añadir `uq_cost_settlement_aircraft UNIQUE(cost_settlement_id,aircraft_id)` como clave referenciable. No columnas ni UPDATE de filas ni cambios en índices originales de 007 |
| expense_payments | Añadir cuatro columnas: `created_correction_id uuid NULL`, `retired_correction_id uuid NULL`, `retired_at timestamptz NULL`, `retired_by_user_id uuid NULL REFERENCES users(user_id)`. Dos FK compuestas `(created_correction_id,expense_id)` y `(retired_correction_id,expense_id)`→cost_expense_corrections(cost_expense_correction_id,expense_id), nombres `fk_cost_payment_created_correction` y `fk_cost_payment_retired_correction`. `ck_cost_payment_retirement`: tres metadatos de retiro todos NULL o todos NOT NULL. Mantener amount>0 y datos originales |
| expense_allocations | Las mismas cuatro columnas y FK, prefijo `fk_cost_allocation_...`; `ck_cost_allocation_retirement` equivalente. Quitar **solo** `uq_expense_allocation_party`; sustituir por UNIQUE parcial vigente. Mantener CHECK de porcentaje positivo/≤100, importe≥0 y método |

Tablas settlement de detalle, `parties`, `users`, memberships y ownership interests no cambian. El runtime conserva sus privilegios previos, salvo el retiro de UPDATE amplio sobre los dos detalles abiertos. No se introduce FK desde snapshots hacia batches: no se reescriben sus identidades ni fuentes.

## Índices

Nuevos explícitos:

| Nombre | Definición |
| --- | --- |
| idx_cost_authority_user_scope | authorities(user_id,financial_scope_id) |
| idx_cost_record_scope | records(financial_scope_id) |
| idx_cost_disclosure_recipient | disclosures(recipient_user_id,financial_scope_id) |
| idx_cost_disclosure_record_lookup | disclosure_records(financial_record_id,financial_disclosure_id) |
| uq_cost_active_allocation_party | UNIQUE expense_allocations(expense_id,party_id) WHERE retired_at IS NULL |
| idx_cost_active_payment_expense | expense_payments(expense_id) WHERE retired_at IS NULL |

Cada PK/UNIQUE descrito arriba también crea su índice B-tree implícito. Al eliminar `uq_expense_allocation_party` se elimina su índice de soporte; no se borran otros índices. No se tocan `uq_cost_original_event_currency`, `uq_cost_original_period_currency`, `uq_cost_settlement_utilization_evidence` ni los dos índices de nombres activos por aeronave.

## Función, triggers y enforcement

`app.guard_cost_open_detail() RETURNS trigger`, PL/pgSQL, SECURITY INVOKER, `search_path=pg_catalog,app`. Sin SECURITY DEFINER. EXECUTE PUBLIC revocado y EXECUTE runtime otorgado. Dos triggers BEFORE INSERT OR UPDATE FOR EACH ROW: `trg_cost_payment_open_detail` y `trg_cost_allocation_open_detail`.

El guard bloquea el gasto padre con FOR UPDATE; rechaza gasto no OPEN, evento no OPEN o gasto presente en cualquier settlement; exige batch al insertar; permite solo transición no retirado→retirado con valores originales iguales; compara base_version+1 con expenses.details_version y actor del retiro con batch. FK/CHECK complementan esa verificación. No hay trigger DELETE porque runtime no recibe DELETE; el procedimiento privilegiado tampoco debe eliminar historia.

**Servicio, no CHECK SQL:** autoridad vigente y su correspondencia con issuer; emisor autorizado para la party; usuario ACTIVE; membresía/OWNER para economía; targets no vacíos; mismo scope para nuevas relaciones entre raíces; detalle que pertenece al gasto; totales; política mixta; snapshot/proyecciones; idempotencia por contenido; Audit atómico. No se afirma aislamiento por usuario final a nivel RLS con el rol compartido.

## Permisos exactos propuestos para app_runtime

| Objetos | Antes | Después |
| --- | --- | --- |
| cost_financial_scopes, cost_financial_authorities, cost_financial_authority_revocations | No existen | SELECT; solo aprovisionamiento/revocación privilegiada revisada |
| cost_financial_records, cost_financial_disclosures, cost_financial_disclosure_records, cost_financial_disclosure_revocations, cost_expense_corrections | No existen | SELECT, INSERT; jamás UPDATE/DELETE |
| expense_payments, expense_allocations | SELECT, INSERT, UPDATE tabla | REVOKE UPDATE tabla; GRANT UPDATE(retired_correction_id,retired_at,retired_by_user_id); SELECT/INSERT conservados; sin DELETE |
| cost_concepts, cost_event_types, cost_events, expenses | SELECT, INSERT, UPDATE tabla | Sin cambios; el servicio debe proteger raíces y details_version |
| cost_settlements y sus cuatro tablas de líneas | SELECT, INSERT | Sin cambios, sin UPDATE/DELETE |
| audit.audit_events | SELECT, INSERT | Sin cambios |

Ningún GRANT nuevo a PUBLIC. Como en 002, revocar el privilegio de tabla es indispensable: un GRANT por columnas por sí solo no limita el UPDATE amplio de 006. En preflight futuro revisar privilegios efectivos/herencia y default privileges, no solo este texto.
