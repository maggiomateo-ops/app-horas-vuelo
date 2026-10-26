# Reconciliación 008 — prerequisite Horas V2

2026-10-26. Base `codex/hours-v2-preflight-ready`, `3ed6574c48e1516ee005e7751e8a6f1bcd943500`, árbol inicial limpio. Trabajo en `codex/reconcile-migration-008`. **Artefacto reconciliado; no migración ejecutada.**

## Resultado y procedencia

El archivo oficial del checkpoint Costs V1 reproduce exactamente el ledger real de Neon TEST:

- `008_costs_financial_scopes_and_open_corrections.sql`, 18.225 bytes.
- SHA-256 `30df860f6ba51617e93c55be21e8d2355aba734977dfb3db6bf0776b5c07c160`.
- Git blob `4363dff38c4abe0c0a64116cc678e1e383c18ff9`.
- Introducido en [719d3de0b3629573df22e42bac5b90f92bd31a0a](https://github.com/maggiomateo-ops/app-horas-vuelo/commit/719d3de0b3629573df22e42bac5b90f92bd31a0a); conservado sin cambio en [f2f215308b88126e7838f3b3746687540658d874](https://github.com/maggiomateo-ops/app-horas-vuelo/commit/f2f215308b88126e7838f3b3746687540658d874) y en el head remoto inspeccionado `c82714ecc76d91611feb05b745c8cf9dcd9f0e6f`.
- Ledger observado: aplicado `2026-10-19T21:53:24.663Z`, proyecto `red-pine-78283204`, branch `br-billowing-band-b62jj1ab`, DB `app_horas`.

Se incorporó exclusivamente ese archivo mediante `git show` desde el commit fuente, sin cherry-pick/merge de Costs. SHA-256 recomputado antes y después de incorporarlo. No se cambió ni un comentario, espacio o guard. No se incorporaron backend, UI, harness de escrituras, fixtures financieras ni flags de Costs.

## Borrador, archivo canónico y ejecución histórica son cosas distintas

| Artefacto | Identidad / estado |
| --- | --- |
| Primer borrador `f6bba8b1c191157e2647b26a8bfac89901abae45` | 13.553 bytes, SHA-256 `3a488e8b2bd406b0b74cadce125f340bf0911a3a351578ca49438b77b385c1b4`, blob `591b41c66c4024c0741289bdc3315509e03ded60`. Ocho tablas, incluía divulgaciones. **No coincide con ledger, no integrado** |
| V1 simplificada desde `719d3de…` | Cinco tablas, mismo archivo oficial presente en `f2f21530…`, hash exacto 30df860…; todavía conserva encabezado DESIGN DRAFT y excepción `MIGRATION_008_DESIGN_ONLY_NOT_APPROVED` |
| Ejecución histórica autorizada | Sheets Change Log y documentación/harness de `f2f21530…` registran omisión del primer guard **solo en memoria**, ejecución de 33 statements restantes y registro del checksum del **archivo íntegro**. La reconciliación conserva esa excepción de procedencia, sin repetirla |

Se leyeron en la rama de Costs `issue-8-migration-008-design.md`, inventory, runtime-acceptance, evidencia authorized-runtime-pass y el constructor `costs-008-preflight.mjs`. Sus textos de “bloqueado/no aplicado” describen checkpoints anteriores y el guard del archivo, no invalidan por sí mismos la aplicación posterior registrada. La evidencia histórica local de `f2f21530…` es principalmente la temporal eliminada; el **commit en TEST padre** está documentado en ambos Sheets y confirmado por el ledger/metadata leídos ahora. No confundir ambos targets.

El ledger no conserva el transcript SQL ejecutado. Podemos demostrar identidad exacta del archivo registrado y correspondencia del catálogo instalado con el cuerpo V1; no afirmar ejecución byte por byte del archivo íntegro, porque su guard habría abortado. **No retirar el bloqueo ni fabricar un SQL equivalente** para hacer coincidir el número.

## Comparación real, exclusivamente SELECT

Se consultaron el ledger y catálogos `information_schema`/`pg_catalog`, funciones de definición y privilegios. No se leyeron filas de gastos, mandatos, personas, vuelos o aeronaves; ninguna consulta DDL/DML, función de negocio o runner fue ejecutada.

- Los ocho nombres y checksums 001–008 coinciden con los bytes del checkout reconciliado; readback final a `2026-10-26T20:38:22.855Z` conserva el mismo ledger.
- Columnas, tipos, NULL/defaults de las cinco tablas V1 coinciden, al igual que `financial_scope_id`, `details_version` y las cuatro columnas de retiro por tabla. `bigint` / `int8` son representaciones del mismo tipo de PostgreSQL, no una discrepancia.
- Constraints nombradas de la 008 comparadas con sus definiciones normalizadas de formato; FK compuestas, unicidad y CHECK coincidentes; antigua `uq_expense_allocation_party` ausente.
- Los seis índices coinciden tras normalizar exclusivamente formato de `pg_get_indexdef`, cast de texto y paréntesis de presentación.
- Cuerpo PL/pgSQL del guard coincide exactamente salvo whitespace exterior; SECURITY INVOKER, search_path y dos triggers coinciden. EXECUTE PUBLIC denegado, runtime heredado permitido.
- Ambas identidades runtime sin privilegios elevados, CREATE ni ownership canónico; membresía login→app_runtime. En las 13 tablas protegidas: lectura correcta, sin autoaprovisionamiento de autoridad, sin UPDATE de tabla/DELETE/TRUNCATE/REFERENCES/TRIGGER; UPDATE por columna solo en los tres metadatos de retiro de pagos/asignaciones. Audit y settlements conservan ausencia de UPDATE/DELETE.
- Las tres tablas de divulgación del primer borrador no existen en TEST, conforme a la V1 simplificada.

Evidencias en `hours-v2-review/migration-008-neon-*.json`, `migration-008-final-readonly.json` y `migration-008-comparison.json`. El comparador offline `scripts/lib/migration-008-evidence.mjs` recalcula 80 comprobaciones sobre esos snapshots: PASS, sin diferencias en ese alcance. No equivale a probar nuevamente DML, privacidad del servicio, UI de Costs o carreras SQL. Las consultas se hicieron separadamente, no un snapshot transaccional de todo el catálogo: si otro actor cambia TEST luego, repetir lectura antes de preflight.

## Runner e integración segura

`db/migrate.js` queda **intacto**. Su función real `applyMigration` consulta el ledger antes de ejecutar el SQL: filename + checksum iguales → `skip  008_costs_financial_scopes_and_open_corrections.sql`, sin BEGIN, DDL ni INSERT de ledger para esa versión. Los tests ejecutan esa misma función extraída del archivo, con cliente simulado que solo acepta el SELECT; hash o filename distintos fallan antes de DDL.

**No se ejecutó el CLI del runner contra Neon.** `main()` además usa advisory lock y `ensureMigrationLedger()` (CREATE TABLE IF NOT EXISTS); invocarlo no sería una comprobación exclusivamente de lectura. No se usó adopt-existing ni se cambió el ledger.

Si una base no registra 008, el archivo seguirá abortando por su guard: comportamiento deliberado, no quitarlo para inicializar otra base. El futuro preflight debe verificar esquema/ledger autorizados del target descartable o preparar metadatos de fixture mediante autorización propia; no inventar adopción ni suponer que schema-only conserva filas del ledger.

Los workflows de administración inspeccionados se disparan por ramas específicas y controles separados; esta nueva rama no coincide con sus filtros. No se despachó ningún workflow administrativo ni se cambió su configuración.

## Reserva 009 y disponibilidad para preflight

Se inspeccionaron 22 refs de origin (incluye origin/HEAD), los árboles de migraciones de todas ellas, historia alcanzable de archivos 009, ambos Sheets y búsqueda de PRs abiertos por 009. No aparece una migración 009+ ni una reserva canónica distinta; el ledger termina en 008. **009 queda reservada para Horas V2** por la instrucción condicional del usuario. Revalidar esa disponibilidad antes de registrar la migración final: otros trabajos pueden avanzar. No se creó archivo 009 ni se incorporó SQL Hours V2 al runner.

**Bloqueo de procedencia/ledger 008: RESUELTO.** Recomiendo permitir la revisión/autorización del preflight SQL aislado y sintético desde este checkpoint, sin Blob ni datos personales. No se ha ejecutado ni aprobado automáticamente el preflight. Siguen gates: target descartable independiente, revisión exacta del SQL/roles, rollback forzado, dos sesiones y privilegios efectivos, integración futura de todos los mutadores, políticas externas de retención/PII/DPA/backups y aceptación funcional autenticada. Esta reconciliación no aprueba DDL Horas V2 ni canary LV-SIM.

## Validación y límites

- npm test: 284 PASS, 0 fallos (seis tests nuevos: identidad del archivo, deriva de catálogo/privilegios, skip real del runner simulado, rechazo de mismatch y ledger 001–008).
- npm run lint: PASS. npm run build: PASS; bundle idéntico a la base. git diff --check: PASS.
- Main, Production, schema/datos/ledger Neon, flags, Vercel y funcionalidad Costs: sin cambios. Sin preflight ni migración SQL ejecutados. Única integración en migrations: 008 exacta ya registrada.

## Sincronización canónica

D-311 añadido en Product 01_Decisions!A313:H313 con CONFIRMED limitado a identidad del artefacto/reserva del número; no aprobación del contrato SQL Horas V2. Roadmap!H22 actualizado conservando el estado del stage. Schema Settings Matrix!A107:J107 registra procedencia; J106 deja explícita la resolución del bloqueo anterior. Readback exacto y WRAP PASS de los cuatro rangos. D-307–D-310 y decisiones funcionales Costs preservadas. Verificación de formato por API, sin afirmar inspección visual autenticada del navegador.
