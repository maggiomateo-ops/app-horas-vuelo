# Issue #8 — context recovery and dependencies

Recovery date: 2026-10-19. Branch: `etapa-2e4-test-app-parity`.
Initial HEAD: `683ed4838ee5ce5c35efab13a6efab20ac954abb`.

## Verified sources

- [Issue #8](https://github.com/maggiomateo-ops/app-horas-vuelo/issues/8).
- [Product & Data Model](https://docs.google.com/spreadsheets/d/1lvzdL169hReQ2nT-mYHEm8ELZVJI2zVJcwU-9bCJosM/edit): D-042 and D-297–D-303.
- [Schema Catalog](https://docs.google.com/spreadsheets/d/1Q3VXvhN4vWSVrVuYOiwnuoqHfMP7HC-UApxlDTPlDTg/edit): Costs fields, relationships, settings and constraints.
- Complete migrations 006/007; relevant identity, membership, ownership, flight and component definitions in 001; runtime hardening in 002.
- Existing Settings routing/capabilities, PostgreSQL transaction helper, aircraft access, identity/ownership repositories, Squawks repository/Audit and test conventions.

No live database or deployment verification was performed. Applied migration and Preview status remain supplied context, not independently verified runtime results.

## Compatibility

Use `withPostgresTransaction` with SERIALIZABLE and an aircraft advisory lock; inject dependencies using the existing repository factory convention. Revalidate active user, aircraft and OWNER membership inside write transactions. Existing `getValidatedAircraftAccessFromPostgres` checks active membership, but does not establish historical financial authorization. The authenticated session's canonical user UUID is the actor; legacy ADMIN does not imply OWNER.

Extend `settings.js` with `resource=costs`, without another top-level function. Follow the existing USER/MANUAL Audit shape and insert Audit in the business transaction. Flight metrics come from current revision IDs, aircraft counters and installation-scoped component counters. Reuse effective component binding rules, including same-day boundary flight evidence.

The capability helper is the only implementation block completed. It reads no database, defaults to disabled, rejects invalid configuration, and enables logically only for POSTGRES plus explicit true. It does not itself authorize a user or execute writes. It is not yet wired to any endpoint. No Costs API contract or repository has been delivered.

## Dependencies requiring technical/product review

### Historical financial privacy (D-042)

D-042 excludes prior-owner financial records from default transfer. Costs roots contain `aircraft_id` but no private ledger/ownership-episode identifier or access grants. Membership is aircraft-wide. Expense/event dates and membership activation dates do not establish a canonical financial entitlement: an old expense can be entered after transfer, historical obligations can remain private, and members need not be legal owners. An OWNER role cannot establish access to prior-owner financial data by itself.

Decision needed: define the financial visibility scope for each active member, including organizational representatives, ownership changes, backdated records and mixed historical settlements. Do not silently equate membership activation with the start of financial visibility or legal ownership with administrator authority.

Proposal for review, not an approved design: a normalized private financial scope plus explicit membership grants, associated with financial roots and settlement evidence. Define transfer behavior and legacy backfill before a forward migration. Do not use Audit metadata as the ACL or business-state authority.

### Removing open payment/allocation rows

Migration 006 grants SELECT/INSERT/UPDATE, explicitly no DELETE, on payments and allocations. Payments require `amount > 0`; allocations require `allocation_percent > 0` and one row per expense/party. Neither table has an inactive/void marker.

Reproduction without executing SQL: record a 100.00 expense paid 50.00 by A and 50.00 by B. Correct it while OPEN so A paid 100.00 and B paid nothing. Keeping two positive rows cannot represent this result, and the runtime cannot delete B's contribution. Similarly, a CUSTOM allocation changing from A/B to DIRECT A cannot remove B's positive allocation row.

Changing payer identities or retaining dummy positive amounts is incorrect. Voiding and replacing the entire expense is technically possible but introduces an unconfirmed correction/identity contract; it must not be silently substituted for editing open contributions.

Proposal for review: choose narrowly scoped removal rights for OPEN detail rows or an explicit lifecycle/revision model with corresponding constraints. Settlement snapshots must remain SELECT/INSERT only. A later reviewed migration must preserve historical migrations and all frozen evidence. No DDL is proposed for execution in this task.

### Catalog entries predating D-302

The Catalog retains older entries for `utilization_basis`, event/currency uniqueness and the old utilization primary key alongside the corrective entries. Product Data Dictionary also retains `utilization_basis`. These are documentation discrepancies: migration 007 and D-302 explicitly describe the replacement, so no schema rename-back or historical migration edit is appropriate. Canonical document cleanup remains for ChatGPT.

## Continuation

### Propuesta concreta para ChatGPT (pendiente de aprobación)

1. **Privacidad:** confirmar si el ámbito privado es un ledger económico por episodio de propiedad u otra entidad. Definir quién concede acceso a OWNER/PILOT/VIEWER, cómo actúan los representantes de organizaciones, qué ocurre al revocar membresía y si las transferencias requieren consentimiento explícito. El acceso a un registro histórico debe depender de ese ámbito y no solo del `aircraft_id` o de la fecha del gasto. Los eventos que crucen ámbitos necesitan una regla explícita para sus gastos, evidencia y totales.
2. **Persistencia de privacidad:** si se elige un ámbito privado, definir tablas normalizadas de ámbitos y grants, sus referencias desde conceptos/tipos/eventos/gastos/liquidaciones, y una estrategia de backfill. La membresía activa sigue siendo condición necesaria; el grant financiero agrega el límite histórico. No usar JSON de Audit como sustituto.
3. **Correcciones OPEN:** elegir entre DELETE acotado a pagos/asignaciones abiertos, o lifecycle explícito de esos detalles. Se recomienda evaluar lifecycle si se desea conservar cada contribución retirada; requeriría reglas de unicidad para asignaciones activas y filtros en todos los cálculos. Ninguna alternativa modifica snapshots cerrados. Rechazar cambios sobre gastos ya congelados salvo el flujo de corrección definido.
4. **Migración posterior:** preparar un archivo nuevo después de acordar el diseño y los permisos. No modificar 006/007. Su preflight/aplicación en TEST queda fuera de este checkpoint y requiere el procedimiento independiente del proyecto.
5. **Aceptación de los cambios:** probar una transferencia A→B con gastos antiguos registrados antes y después de la transferencia; un miembro activo sin grant; una organización con representante explícito; un evento con evidencia histórica; corrección de dos pagadores a uno; CUSTOM A/B→DIRECT A; rechazo sobre snapshots; rollback y Audit atómico. Incorporar también la matriz completa del handoff al continuar Issue #8.

El usuario confirmó el 19/10/2026 que no hay contrato adicional y solicitó preparar esta propuesta para ChatGPT. Estas recomendaciones no constituyen decisiones canónicas ni autorización para aplicar DDL.

The handoff requires resolving dependencies before advancing to the next block and reporting schema gaps instead of ad hoc DDL. Resume repository/authorized reads after the privacy contract is clarified; implement corrections after the detail-row lifecycle is resolved. Continue through settlements, Audit, routing and the full requested test matrix. The capability-only tests do not establish repository, authorization, HTTP, settlement, concurrency or runtime correctness. Do not mark Issue #8 complete or Preview PASS from this checkpoint.

No migration, database mutation, canary, Production action, flag configuration or remote push was performed. The original handoff's restrictions remain in force.

## Local verification

- `npm ci`: completed using the lockfile; npm reported 13 dependency vulnerabilities (1 low, 4 moderate, 8 high). No dependency versions changed.
- Initial `npm test`: 174 passed, 1 failed because a pre-Costs component test prohibited migration 006. Removed that obsolete assertion, preserved the 12-function guard, and added exact SHA256 checks of both Costs migrations from the confirmed HEAD.
- Initial `npm run lint`: 5 existing `process` no-undef errors in `db/migrate.js`. Added `db/**/*.js` to the existing Node globals override without changing migration runtime behavior.
- `npm run build`: passed.
- Final `npm test`: 176 passed, 0 failed. Final `npm run lint`: passed. `git diff --check`: passed. None of these checks exercised a database or deployment.
