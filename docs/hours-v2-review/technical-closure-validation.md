# Evidencia F2/F4/F6 — 2026-10-26

Base local verificada d7e1e5a17d0aefad394a326cf30aed33d2dc4e71, árbol inicialmente limpio. Nueva rama codex/hours-v2-technical-closure. Runtime y bundle sin modificaciones.

- npm test: **266 PASS / 0 fallos**, 7 casos nuevos (con subcasos numéricos/negativos); tests anteriores actualizados para rechazar tolerancia positiva y nueva unidad SQL.
- npm run lint: PASS.
- npm run build: PASS, 55 módulos, JS index-BTHRtJtp.js, CSS index-CXWobXjv.css, iguales a base.
- git diff --check: PASS.
- SQL: propuesta revisada, **no ejecutada**. Assertions SQL y matriz de constraints/concurrencia preparadas fuera del runner; integración PostgreSQL y carreras reales PENDIENTES.
- Tests offline exactos: h:mm/decimal/minutos/centésimas, NULL vs cero, precisión no soportada, HALF_UP por vuelo vs suma, clases de diferencias, base incompatible, evidencia insuficiente, aprobación/revisión obligatoria, no doble conteo y límites XLSX inclusivos.
- Los tests de envelope NO equivalen a parser XLSX seguro, benchmark de memoria ni upload autenticado.
- Sheets: D-307 CONFIRMED y D-308 PROPOSED releídos sin modificación. D-309 añadido como PROPOSED en 01_Decisions!A311:H311; Settings Matrix!A101:J103 añadido como PROPOSED. Readback exacto PASS en ambos, wrap de texto preservado. Tables & Fields del esquema instalado no se altera para aparentar DDL aplicado.
- No conexión Neon en esta revisión. Se inspeccionó contrato del checkout y evidencia de metadatos readonly de base; no prueba deriva remota actual. Relectura efectiva antes del preflight pendiente.
- No capturas nuevas: no hubo cambios de UI. Ninguna prueba autenticada/canary/aceptación funcional realizada.

Recomendación: revisión y aprobación técnica condicionada del contrato, no autorización de migración. Antes de preflight cerrar equivalencias técnicas aplicables, PII/DPA/retención y purga, DTO/hash, privilegios inmutables y protocolo común de locks/invalidación de todos los mutadores. No se modificaron Production/main, Vercel, flags, Neon, LV-MHZ, LV-SIM ni Costs; no se instaló/provisionó almacenamiento.
