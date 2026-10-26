# Evidencia de revisión — Horas V2

Base verificada: `8577d7324cf5f41c54bd555dbdafce2c9f02c758` en `origin/codex/hours-start-contract`. Rama de revisión: `codex/hours-v2-contract-review`. Árbol inicial limpio.

## Validación local

| Gate | Resultado |
| --- | --- |
| npm test | **259 PASS**, 0 fallos; 22 tests nuevos |
| npm run lint | PASS |
| npm run build | PASS — 55 módulos, bundle `index-BTHRtJtp.js` (runtime sin cambios) |
| git diff --check | PASS |
| Prototipo/runtime | Sin modificaciones en src/, api/, package.json, lockfile ni db/migrations |
| SQL propuesto ejecutado | **NO** |
| Preflight SQL/concurrencia PostgreSQL | **PENDIENTE**, no probado por tests estructurales |
| Contrato aprobado | **NO** |
| Canary/confirmación real | **NO** |

Los tests nuevos ejercitan lecturas de instalación/referencia, TIS vs runtime, reemplazos físicos, overhaul/episodios, solapamiento sin doble conteo, fechas incompletas, NULL vs cero, cambios de revisión/VOID/retroactivos, fingerprint de episodios/ajustes/fuentes/política, discrepancias y reconocimiento, idempotencia/head, scope y estructura de FK/PK/teardown.

Los ejemplos matemáticos usan décimas enteras BigInt. La policy de tests se identifica como fixture, no autoridad funcional. Las pruebas de SQL inspeccionan texto y orden de dependencias, **no instalan ni ejecutan constraints**. Tampoco son una demostración de carreras SERIALIZABLE reales.

## Fuentes y lectura real de metadatos

- Ambos Sheets canónicos y D-307 se releyeron; sin modificaciones ni nueva decisión CONFIRMED.
- Repositorio: migraciones 001–007, 003 nullable installation date, 005 topología, baselines/ajustes/imports/revisiones/Audit y read models.
- Neon TEST: únicamente SELECT de information_schema/pg_constraint/pg_indexes y probes efectivos de privilegios. Proyecto `red-pine-78283204`, rama `br-billowing-band-b62jj1ab`, rol `app_horas_runtime`. No se consultaron filas de negocio ni se ejecutó DDL/DML.
- `schema-readonly.json`: columnas y claves de las ocho tablas canónicas relevantes.
- `indexes-permissions-readonly.json`: hash COMMITTED por aeronave; batch+ordinal; componente con una instalación abierta; Audit INSERT true/UPDATE false/DELETE false; revisiones UPDATE false/DELETE false.
- No se inspeccionó el ledger instalado para evitar afirmar número de migración final. Esa lectura debe formar parte del preflight posteriormente autorizado; el checkout no demuestra versiones persistidas.

## Decisiones pendientes antes de preflight

`../hours-v2-open-decisions.md` enumera F1–F8 y el gate técnico posterior: bordes/fechas incompletas, base/precisión, overhaul, criterios/tolerancia, continuidad relativa, almacenamiento/retención, OWNER/gates y transición/admisión integral.

El SQL revisado está fuera del runner. El teardown solo corresponde a una rama descartable vacía; no debe utilizarse para borrar historia. No se cambiaron flags, variables Vercel, permisos, main, Production, LV-MHZ, LV-SIM ni datos de Neon. No se trabajó en Costs.
