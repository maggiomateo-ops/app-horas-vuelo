# Costs 3.3 — cierre del gate técnico runtime en temporal

Base `d56f381d0c1665c79b797b7e056da010543e2586`, Issue #8, rama `review/issue-8-migration-008-design`. El usuario autorizó expresamente confirmar 008 y una fixture sintética **solo** en la temporal descartable y eliminarla al finalizar. No se rediseñó Costs V1.

## Resultado real

| Gate | Resultado |
| --- | --- |
| LOGIN real app_horas_runtime, sin SET ROLE | **PASS** |
| DML del repositorio real | **PASS** |
| Audit y atomicidad | **PASS** |
| Rollback forzado del smoke | **PASS** |
| Readback independiente de todos los datos y roles | **PASS** |
| Eliminación de la temporal autorizada | **PASS** |

[Evidencia de ejecución, preparación y limpieza](evidence/costs-008-authorized-runtime-pass.json). El informe BLOCKED anterior queda como historial: su bloqueo se resolvió mediante la nueva autorización de preparación persistente, no mediante SET ROLE ni privilegios adicionales.

## Verificaciones antes de escribir

Se volvieron a consultar los dos Sheets canónicos: Product & Data Model (D-042, D-297–D-306, Roadmap 3.3) y Postgres Schema Catalog. El catálogo ya registraba el LOGIN PASS / DML BLOCKED anterior y pedía preparación aislada explícitamente autorizada. No se modificaron los Sheets ni las decisiones funcionales.

GitHub y checkout local coincidían en el SHA base; el árbol estaba limpio. Neon confirmó proyecto `red-pine-78283204`, temporal `br-fancy-hall-b6h6g74f`, padre `br-billowing-band-b62jj1ab`, no primary/default/protected. El compute read_write `ep-ancient-recipe-b6cjj1qz` correspondía exactamente a esa rama, con host directo `ep-ancient-recipe-b6cjj1qz.c-2.sa-east-1.aws.neon.tech`, DB `app_horas`.

La inspección con conexiones reales encontró ledger 001–007 con hashes coincidentes con el repositorio, ninguna 008, tablas Costs vacías y **cero filas con cualquier referencia UUID c008** en app/audit. Fingerprint inicial: `4dc61813ae41b37c9e2f8bc0fb5dbdf0`. La inspección evita reutilizar restos de pruebas previas.

## Preparación persistente, distinta del smoke

`scripts/costs-008-temporary-authorized.mjs --prepare` confirmó **una transacción SERIALIZABLE atómica** con:

1. El DDL exacto de 008, quitando únicamente su primer guard en memoria. Archivo oficial y SHA256 `30df860f6ba51617e93c55be21e8d2355aba734977dfb3db6bf0776b5c07c160` intactos.
2. La fixture sintética y el Audit de provisión explícita.
3. Una fila 008 en schema_migrations con nombre y checksum del archivo oficial revisado. Se registra así la excepción de ejecución en memoria autorizada solo para esta temporal.

Una conexión nueva confirmó el commit y los privilegios efectivos de app_runtime, app_horas_runtime y PUBLIC. **No se ejecutó ningún GRANT adicional al SQL exacto 008 ni se cambiaron atributos/membresías de roles.**

Fixture, doce filas persistentes de preparación:

| Tabla | Filas nuevas |
| --- | --- |
| users | 2 ACTIVE, emails example.invalid |
| aircraft | 1 SYNTHETIC RUNTIME ONLY / DISPOSABLE FIXTURE |
| parties | 2 sintéticas: responsable y pagador |
| aircraft_memberships | 2 OWNER ACTIVE |
| aircraft_ownership_interests | 2 participaciones 50/50, solo para asociación canónica de parties |
| cost_financial_scopes | 1 archivo exclusivamente sintético |
| cost_financial_authorities | 1 mandato explícito para el usuario autorizado |
| audit.audit_events | 1 COST_FINANCIAL_AUTHORITY_PROVISIONED, synthetic_only=true |

UUIDs de prueba: user `c0080000-0000-4000-8000-000000000001`; aircraft `...0002`; responsable `...0003`; pagador `...0004`; scope `...0005`; OWNER sin mandato `...0014`. El manifiesto completo está en FIXTURE/fixtureStatements del ejecutor. Ningún usuario real fue autorizado; la propiedad/membresía no concedió el mandato. El segundo OWNER quedó expresamente sin autoridad financiera.

No se crearon conceptos, gastos, correcciones, vínculos financieros ni liquidaciones durante la preparación. Los hashes de los registros reales de **todas** las tablas app/audit existentes permanecieron iguales. El ledger pasó a 001–008 únicamente en esta temporal. Fingerprint de la preparación confirmada: `b858d6c0cbe328b6499a40b76f571280`.

## Smoke real con LOGIN runtime

`--smoke` abrió una conexión PostgreSQL independiente, `session_user=current_user=app_horas_runtime`, PID **952**, con TLS verify-full y sin SET ROLE. Ejecutó createPostgresCostsRepository; el migrador solo preparó y leyó verificaciones. La capacidad de escritura se inyectó en el harness de prueba: **ningún flag de aplicación fue habilitado**.

Dentro de la transacción runtime:

- El OWNER sin mandato tuvo lectura y escritura denegadas por COST_FINANCIAL_AUTHORITY_UNRESOLVED; no bastó su membresía activa. Flag OFF se rechazó antes de acceder a PostgreSQL.
- Creó concepto y gasto DIRECT de **100.00 USD**, responsable party A y pagador party B.
- Corrigió OPEN a **120.00 USD**, details_version **2**, conservando pagos/asignaciones retirados y el lote de corrección.
- Liquidó noviembre 2026: dos líneas separadas, A con **−120.00** y B con **+120.00**. La corrección posterior del gasto congelado devolvió COST_CONFLICT.
- Leyó cuatro Audit reales: COST_CONCEPT_CREATED, COST_EXPENSE_CREATED, COST_EXPENSE_CORRECTED y COST_PERIOD_SETTLED. La operación rechazada no agregó Audit.
- Inyectó un error SQL real **22012** (SELECT 1/0) en el punto de escritura de Audit de otro gasto. El rollback del savepoint revirtió el DML previo y no dejó evento Audit del request fallido. Es una inyección en el cliente en ese punto, no un fallo espontáneo del esquema de Audit.
- UPDATE directo de snapshot y Audit fue denegado por PostgreSQL con **42501**. No se ampliaron grants para superar esos intentos.

El error terminal esperado `COST_RUNTIME_VALIDATED_ROLLBACK` abortó la transacción; se hizo ROLLBACK. Una conexión nueva con PID **981** verificó el mismo fingerprint y conteos. Una verificación adicional del ejecutor comparó hashes/conteos de **todas** las tablas app/audit, ledger y roles antes/después: iguales.

**Operaciones económicas persistidas por el smoke: cero.** Permanecieron únicamente 008 y las doce filas de preparación, incluido el Audit de provisión. No se presenta el rollback del smoke como rollback de esa preparación confirmada; sus estados separados constan en la evidencia.

## Limpieza verificada

Después de los resultados anteriores se volvió a validar el ID/proyecto/padre/no-primary/no-default y se llamó a Neon delete_branch **solo** con proyecto `red-pine-78283204` y rama `br-fancy-hall-b6h6g74f`, conforme la instrucción explícita del usuario.

Confirmación posterior: GET de esa rama devolvió **HTTP 404 branch not found**; el listado de ramas no eliminadas no contiene ese ID. El padre TEST `br-billowing-band-b62jj1ab` continúa presente y ready. No se conectó ni ejecutó SQL en el padre. La eliminación retiró también la preparación persistente de la temporal. No hay fixture o 008 de esta prueba que conservar en una base activa.

## Reproductor y fallos clasificados

El ejecutor específico admite únicamente `--inspect`, `--prepare` y `--smoke`. Requiere el literal AUTHORIZATION de esta autorización, prueba reciente obtenida del control plane de Neon y URLs de ambos roles por stdin sin eco. Fija proyecto/rama/padre/endpoint/DB/roles y checksum; no permite retargeting, actualizaciones de roles, borrados ni flags. La eliminación se hizo mediante operación Neon independiente limitada al ID exacto, no un comando genérico embebido en el script. **Como la rama ya fue eliminada, no se puede repetir contra otro ID sin nueva autorización y revisión del código.**

El primer intento de inspección quedó esperando JSON por el límite de línea del PTY: **herramienta**, antes de transacción/SQL. Se interrumpió sin iniciar la prueba y se usó `stty -echo -icanon min 1 time 0`; no se escribieron secretos en argv/env/archivos/logs. No hubo fallos de dato o código Costs. Las denegaciones 42501 y el 22012 inyectado son resultados esperados, con savepoints revertidos y rollback final independiente. El ejecutor no reintenta automáticamente una preparación fallida y exige confirmación de ROLLBACK antes de devolver un fallo transaccional.

## Verificación local y alcance de aceptación

`npm test`: **209/209 PASS**, incluidos cinco tests nuevos del ejecutor específico. `npm run lint`: PASS sin warnings. `npm run build`: PASS, 44 módulos. Checks de sintaxis y `git diff --check`: PASS. Los tests con driver simulado validan seguridad/cleanup del ejecutor; el DML PASS anterior proviene de PostgreSQL real.

No cambiaron backend/UI Costs, dependencias, SQL oficial ni el guard. No se habilitaron flags, aprovisionaron mandatos reales, aplicó 008 en TEST original, activó Costs en TEST/Preview, desplegó Production, modificó main ni realizó merge/cutover. Este resultado cierra **el gate técnico LOGIN/DML/Audit/rollback**; no declara aceptada la activación o la UI en Preview ni el módulo 3.3 completo en un entorno de uso real.
