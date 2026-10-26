# Evidencia de preparación de preflight — 2026-10-26

Base local/remota verificada `3ace73d12ac1b68217aa68f9ec99d7ab9f6335e5`; rama nueva `codex/hours-v2-preflight-ready`; árbol inicial limpio.

| Gate | Resultado |
| --- | --- |
| Contrato técnico | Revisado, PROPOSED; especificación de retención, matriz de las 20 tablas, SQL de RLS/roles/guards/purga/leases, fence y atomicidad preparados |
| npm test | 278 PASS, 0 fail, 0 skip; 12 tests nuevos con subcasos de retención, leases, roles, scope, rollback y bypass de generación |
| npm run lint | PASS |
| npm run build | PASS, 55 módulos; JS index-BTHRtJtp.js y CSS index-CXWobXjv.css sin cambios |
| git diff --check | PASS |
| PostgreSQL preflight / sintaxis y constraints reales | PENDIENTE; ningún SQL se ejecutó |
| Tests de dos sesiones | Scripts/matriz PREPARADOS; NO ejecutados; fence base separado de integración completa de todos los mutadores |
| Ledger / permisos remotos efectivos | NO verificados en vivo; manifest de SHA-256 del checkout y probes metadata-only preparados |
| Migración / permisos / roles | NO aplicados ni desplegados; ningún archivo del runner modificado |
| Infraestructura / runtime | Sin cambios en src/, api/, db/, package*.json, flags, Neon, Vercel, Production/main, Costs ni datos de aeronaves |
| Prueba autenticada / LV-SIM | NO realizada |

Los tests ejecutan modelos offline y verifican texto/consistencia estructural de propuestas, no SQL. Pasar tests no demuestra permisos PostgreSQL ni ausencia de carreras reales. No se instaló un parser PostgreSQL o almacenamiento para simular ese resultado. No se requieren capturas de UI: runtime y bundle no cambiaron.

Sheets releídos: D-307 CONFIRMED intent, D-308/D-309 PROPOSED; roadmap y catálogo confrontados. Roadmap menciona 008 en TEST, checkout solo 001–007: toda discrepancia debe detener el futuro preflight hasta revisar fuente/checksum independiente, sin tocar Costs ni adoptar ledger. La política externa de retención/PII/DPA/backups sigue pendiente; únicamente datos sintéticos y sin Blob son candidatos para preflight aislado tras aprobación independiente.

Sin conexión Neon en esta tarea, sin DDL/DML de negocio ni creación de credenciales. Publicación del código no autoriza ejecutar los scripts preparados.

## Sincronización canónica verificada

- Product 01_Decisions!A312:H312: D-310 PROPOSED, sin tocar D-307/308/309.
- Product 02_Roadmap!H22: nota de preparación en Settings; estado del stage preservado, fila de Costs sin cambios.
- Schema Settings Matrix!A104:J106: retención, roles y fence como propuestas no desplegadas.
- Schema Constraints & Indexes!A185:H187: scope, historia/purga y generación, todos PROPOSED.
- Readback exacto PASS de los cuatro rangos; WRAP nativo PASS. Verificación visual mediante formato de API, sin afirmar inspección autenticada en navegador.
- Tables & Fields del esquema instalado no se reescribe para aparentar DDL aplicado.
