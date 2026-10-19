# Costs 3.3 — gate de DML con LOGIN runtime

Historial: este bloqueo fue resuelto mediante la autorización posterior de preparación persistente exclusivamente sintética en la temporal. Ver [LOGIN/DML/Audit/rollback PASS y limpieza verificada](issue-8-costs-runtime-acceptance.md). Se conserva el resultado anterior sin reescribir su evidencia.

Base revisada: `239c75b7e495bbab0d1711f2cb75be24ae157bf1`, Issue #8, rama `review/issue-8-migration-008-design`. Se consultaron de nuevo ambos Sheets canónicos: Product & Data Model (D-042, D-297–D-306, Roadmap 3.3) y Postgres Schema Catalog. Ambos mantienen pendiente el smoke de LOGIN runtime, 008 aprobada, mandatos explícitos y aceptación Preview. No se reabrió ninguna decisión ni se cambió Costs V1.

## Resultado real: BLOCKED — no PASS de DML

La infraestructura **sí entregó una conexión real** como `app_horas_runtime`, sin SET ROLE. El bloqueo no es contraseña ni conectividad: **008 no está confirmada en la temporal**. El DDL sin COMMIT del migrador es invisible para otra conexión PostgreSQL. Los mandatos sintéticos sin confirmar tampoco serían visibles. No se sustituyó el LOGIN por el migrador para declarar aprobadas las operaciones económicas.

Se ejecutó `scripts/costs-008-runtime-preflight.mjs --stdin-temporary-target` contra proyecto `red-pine-78283204`, temporal `br-fancy-hall-b6h6g74f`, DB `app_horas`, endpoint `ep-ancient-recipe-b6cjj1qz.c-2.sa-east-1.aws.neon.tech`. Neon confirmó rama ready, no primary/default, parent `br-billowing-band-b62jj1ab`. El ejecutor fija endpoint, DB y roles; no admite otro target.

Evidencia de la ejecución final en [JSON](evidence/costs-008-runtime-gate.json):

| Comprobación real | Resultado |
| --- | --- |
| LOGIN independiente: session_user / current_user | app_horas_runtime / app_horas_runtime, PID 1641 |
| Esquema inicial | ledger 001–007, 008 ausente |
| 008 exacta dentro de transacción del migrador | visible al migrador |
| Misma 008 desde conexión runtime independiente | ausente (to_regclass = null) |
| ROLLBACK de ambas transacciones | completado |
| Verificador nuevo e independiente | PID 1652, fingerprint y conteos iguales |
| Fingerprint antes/después | 4dc61813ae41b37c9e2f8bc0fb5dbdf0 |
| Resultado persistente | cero escrituras lógicas; 008 sigue ausente |
| Código de salida | 2, BLOCKED / COST_RUNTIME_008_NOT_VISIBLE |

La verificación independiente compara catálogos, columnas, constraints, funciones, triggers, ACL, roles/membresías y conteos de todas las tablas Costs existentes, además de los conteos de users/aircraft/parties/Audit del preflight anterior. La ejecución transitoria de DDL genera actividad/WAL; no se presenta como ausencia de ejecución.

**Creación, corrección, liquidación, denegaciones financieras y Audit atómico con LOGIN runtime: NO EJECUTADOS.** El bloqueo se detectó antes de DML económico. Los PASS anteriores con migrador y los tests con mocks no cierran este gate.

## Ejecutor reproducible y límites

Entrada: una sola línea JSON por stdin seguro con `runtimeConnectionString` y `verifierConnectionString`. Obtener ambas de Neon para esa temporal, respectivamente roles app_horas_runtime y app_horas_migration. Desactivar eco del terminal antes de introducir secretos; no usar argv, archivos, variables de entorno ni logs. No pegar URLs en GitHub. Ejecución: `node scripts/costs-008-runtime-preflight.mjs --stdin-temporary-target`.

El ejecutor exige identidad session_user=current_user, sesiones distintas y TLS verify-full. Rechaza endpoints/DB/roles ajenos y opciones de inicio que puedan cambiar rol o sesión. No contiene COMMIT ni SET ROLE, no aprovisiona mandatos y no modifica flags. La migración oficial conserva su guard y SHA256 `30df860f6ba51617e93c55be21e8d2355aba734977dfb3db6bf0776b5c07c160`. Solo el diagnóstico del migrador retira el guard en memoria dentro de su transacción, igual que el preflight anterior; no sirve como sustituto de DML runtime.

Cuando no hay 008 visible, demuestra el bloqueo y revierte inmediatamente. Si en una ejecución futura hay 008 y una fixture sintética previamente aprobada y visible, el mismo ejecutor contiene la suite real de repositorio: concepto, gasto con payer distinto del responsable, corrección OPEN, liquidación, lectura y escritura ajenas denegadas, flag OFF, Audit, fallo SQL real al insertar Audit con rollback de negocio, denegación DB de UPDATE de snapshot/Audit y error terminal forzado. Esa ruta **no se ejecutó aquí**. Requiere `fixture` con userId, aircraftId, scopeId, responsiblePartyId, payerPartyId y deniedUserId del namespace sintético c008; scope label `SYNTHETIC RUNTIME ROLLBACK ONLY` y approval_reference `ISOLATED_RUNTIME_ROLLBACK_TEST_ONLY`. No acepta identidades reales ni crea esa fixture por sí mismo. La capacidad de escritura se inyecta solo en el repositorio del harness; no se habilita ningún flag de aplicación.

Para desbloquear se necesita una autorización separada que permita un esquema 008 y fixture **sintética** confirmados y visibles en la temporal antes de abrir la transacción runtime. Confirmar esa preparación sería un cambio persistente en la temporal, incompatible con mantener **todos** los cambios dentro de la única prueba sin COMMIT. No se hizo ese cambio ni se ampliaron privilegios. Otra autorización deberá definir también su limpieza. No se propone modificar TEST original/Production ni usar mandatos reales.

## Verificación del cambio

- `npm test`: **204/204 PASS** (199 existentes + cinco tests de seguridad y cleanup del ejecutor).
- `npm run lint`: PASS sin warnings.
- `npm run build`: PASS, 44 módulos.
- `node --check scripts/costs-008-runtime-preflight.mjs` y `git diff --check`: PASS.
- Los cinco tests nuevos usan un driver inyectado y no se anuncian como integración PostgreSQL. Cubren rechazo de migrador/target ajeno/opciones de sesión, BLOCKED con rollback y conexión independiente, mismatch de estado, fallos de identidad/DDL y rechazo de identidades no sintéticas antes del DML.

No se cambiaron backend, UI, dependencias, SQL oficial, privilegios persistentes, mandatos reales, flags, TEST original, Production o main. No hay merge ni cutover. Costs 3.3 mantiene pendiente este gate y la aceptación Preview.
