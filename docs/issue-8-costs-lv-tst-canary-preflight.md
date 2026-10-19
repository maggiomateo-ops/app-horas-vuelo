# Costs V1 — preflight funcional LV-TST

Base revisada: `f2f215308b88126e7838f3b3746687540658d874`, rama `review/issue-8-migration-008-design`, Issue #8. **Canary funcional BLOCKED; no aceptación funcional declarada.** Solo se hicieron lecturas. No se ejecutaron aprovisionamiento, DML económico, cambios de entorno, flags ni despliegues manuales.

[Evidencia estructurada](evidence/costs-lv-tst-canary-preflight.json) y [manifiesto/configuración propuestos, no ejecutables](fixtures/costs-lv-tst-canary-review-only.json).

## Estado de cada gate

| Gate | Estado y evidencia |
| --- | --- |
| Sheets y GitHub | PASS: ambos canónicos releídos, HEAD local/remoto igual a la base |
| 008 en Neon TEST | PASS de lectura: ledger 001–008, checksum exacto, cinco tablas, guard y dos triggers presentes |
| Privilegios esenciales | PASS de lectura: runtime lee scopes, no se autoautoriza; Audit append-only; snapshots sin UPDATE/DELETE; pagos solo retiro, importe sin UPDATE |
| Aeronave canary | PASS: registro canónico LV-TST ACTIVE, UUID inequívocamente distinto de LV-MHZ |
| Identidad de prueba autenticada | BLOCKED: un OWNER activo disponible, sin sesión de prueba comprobada ni designación humana inequívoca como identidad de este canary |
| Mandato financiero | BLOCKED: ningún mandato; faltan UUID del aprobador y referencia verificable para el grant exacto |
| Pagador y responsable sintéticos | BLOCKED: una party elegible existente; no hay pareja sintética ni asociaciones canónicas aprobadas |
| Preview del código | PASS: READY, deployment y SHA exactos |
| Preview conectada exclusivamente a TEST | BLOCKED: la rama de revisión no tiene DATABASE_URL ni overrides Postgres; los selectores heredados son SHEETS |
| Sesión, archivos y denegaciones con flag OFF | NO EJECUTADO: no se alcanzó una sesión de aplicación autenticada ni una Preview configurada para Costs Postgres |
| Activación de escritura | NO AUTORIZADA: plan preparado, no ejecutado; flag Costs ausente, OFF por defecto |
| Canary por interfaz y Audit económico | NO EJECUTADO; no se sustituyó por mocks ni por el smoke anterior de la temporal |

## Fuentes y target

Se consultaron Product & Data Model (modificado 2026-10-19 21:53:53Z) y Postgres Schema Catalog (21:53:54Z), especialmente D-042, D-297–D-306 y Roadmap 3.3. Los Sheets registran la aplicación 008 a TEST, autorizada y ejecutada por ChatGPT después del smoke aislado; este trabajo únicamente la verificó. El backup pre-008 mencionado en Sheets no se modificó.

Neon: proyecto `red-pine-78283204`, rama `br-billowing-band-b62jj1ab` (TEST), DB `app_horas`, endpoint directo `ep-jolly-sun-b6a3ayw9.c-2.sa-east-1.aws.neon.tech`. Las lecturas de negocio usaron LOGIN `app_horas_runtime`. El ledger se leyó con el rol migrador porque runtime no tiene SELECT sobre schema_migrations; no se amplió ese permiso.

008: `008_costs_financial_scopes_and_open_corrections.sql`, checksum `30df860f6ba51617e93c55be21e8d2355aba734977dfb3db6bf0776b5c07c160`. La función app.guard_cost_open_detail() y sus dos triggers están presentes. No se ejecutó SQL de migración ni se editó su guard oficial.

Resolución por app.aircraft_registrations → app.aircraft, con registro vigente y FK exacta:

| Aeronave | aircraft_id | aircraft_registration_id |
| --- | --- | --- |
| LV-TST, ACTIVE, incluida | a784692c-baad-4c73-a79c-c29aee6ce894 | fcf5dcaa-e1f4-46da-8152-db3af5440b07 |
| LV-MHZ, ACTIVE, excluida | 29d775c5-023b-57d2-b592-ff20051e85fd | e549ec7e-66c5-5680-81ea-f1115c5cbe73 |

No se dedujo ningún UUID de nombres, emails ni ADMIN legacy.

## Identidad y preparación financiera detenida

Hay dos users ACTIVE en TEST. Solo `1cbda2ea-240c-4745-a5ec-d3d714cbc6bf` tiene membresía OWNER ACTIVE explícita en LV-TST (`1bdab406-d811-4aa8-b339-6d27f3291ed0`) y enlace a persona verificado. Tener email configurado/enlace verificado no demuestra una sesión Google autenticada ni que deba usarse como identidad de prueba. No se publican emails, nombres o credenciales.

La party elegible existente es `a5a7a718-a466-4214-9685-ef7f86e48399`, PERSON ACTIVE, asociada al propietario canónico actual. No se la reclasificó como sintética. No se crearon otras parties, personas, membresías ni participaciones legales para hacer pasar el escenario de pagador distinto de responsable.

La autorización general del canary LV-TST no especifica un manifiesto de mandato: faltan aprobador humano canónico, evidencia de su autoridad y referencia que autorice expresamente usuario + archivo + facultades. Conforme la instrucción del usuario, **el aprovisionamiento se detuvo**. No se infirió autoridad del OWNER ni de la propiedad.

El borrador propone financial_scope_id `b33efff4-e5a0-48ba-91b7-56c6fe14c463` exclusivamente para revisión; **no existe en DB**. approval_verified=false, aprobador/referencia/request/pagador/responsable sin resolver y mandates vacío. El candidato OWNER se conserva separado de mandates. buildCostsAuthorityPlan rechaza este borrador; no es un SQL listo para ejecutar ni una concesión financiera ficticia.

Para completar el manifiesto se necesita la designación explícita de una identidad existente autenticable de prueba, el aprobador y referencia humanos verificables y los UUID/asociaciones aprobados de dos participantes sintéticos distintos. La provisión deberá ser privilegiada, separada de endpoints ordinarios y atómica con Audit. No se reutiliza el manifiesto de la temporal eliminada.

## Preview y acceso protegido

Proyecto Vercel `prj_sIb43l6pCi1RgfK9N12Qh0nMpu8r`, team `team_uy21aAfWEAi8e08PFhA9VQys`; deployment **dpl_GTgMj6zwEr4bFbefKJcxUcSyDpBk**, READY, repo maggiomateo-ops/app-horas-vuelo, ref review/issue-8-migration-008-design y SHA base exactos.

URL verificada: https://app-horas-vuelo-ht5v7lz3q-maggiomateo-2978s-projects.vercel.app

La inspección actual del proyecto no encontró overrides de entorno para esta rama ni DATABASE_URL aplicable. Las cuatro fuentes heredadas GOOGLE_USER_RESOLUTION_SOURCE, AIRCRAFT_DATA_SOURCE, SETTINGS_DATA_SOURCE e HISTORIALES_DATA_SOURCE normalizan a SHEETS; sus timestamps preceden al deployment. Las URLs Postgres presentes en otras ramas no configuran ésta. No se leyeron ni copiaron sus secretos. No se afirma conexión Postgres de la función desplegada a partir del LOGIN del conector Neon.

POSTGRES_COST_WRITES_ENABLED no está configurado: OFF por defecto según el código. **Esto no es un PASS de POST autenticado con flag OFF.** No se enviaron POST ni se hicieron lecturas de archivos financieros por API. No se ingresó al flujo legacy Sheets para ejercitar el canary.

El navegador llegó al login de protección Vercel. Se intentó el conector oficial web_fetch_vercel_url para GET /api/session; la revisión automática lo rechazó antes de ejecutarlo porque crea/reutiliza un enlace compartible que elude la protección. La autorización de inspección no se consideró aprobación de ese cambio de acceso y sus destinatarios. No se creó enlace, cambió protección ni se buscó un bypass alternativo. Ese gate requiere autorización específica para un acceso temporal limitado a esta Preview y a esta revisión; no concede sesión de aplicación ni mandato financiero.

## Activación preparada, no realizada

El JSON de revisión contiene el plan limitado a **target=preview + gitBranch=review/issue-8-migration-008-design**:

1. Revisar la conexión secreta runtime app_horas_runtime/app_horas al endpoint TEST indicado; nunca usar el migrador ni variables globales/Production.
2. Preparar overrides POSTGRES de los cinco selectores canónicos y POSTGRES_COST_WRITES_ENABLED=false. No copiar otros flags de la rama de parity.
3. Tras revisar/aprobar esa configuración, desplegar el SHA exacto autorizado en Preview y verificar la identidad runtime/DB real y la sesión canónica antes de cualquier operación.
4. Con manifiesto aprobado y provisión auditada, verificar lectura de archivo propio, denegaciones de usuario/archivo ajenos y POST 503 con flag OFF sin filas/Audit nuevos.
5. Solo con **otra aprobación específica** de activación, habilitar Costs para esa Preview y ejecutar UI: concepto, gasto sintético pagador B/responsable A, corrección OPEN, liquidación y resultado inmutable. Reconciliar cada request/actor/scope contra PostgreSQL/Audit y comprobar LV-MHZ sin cambios. No se solicitó habilitarlo aquí porque los gates previos siguen bloqueados.

No se ejecutó ninguna de estas modificaciones de configuración ni de datos.

## Integridad y verificación local

Al inicio y al cierre: scopes=mandates=bindings=corrections=expenses=settlements=Audit COST=**0**. El fingerprint de LV-MHZ **23934cdd964a74aa7cb38541ba3687cb** coincide en ambas lecturas: cubre raíz de aeronave, membresías, ownership, flight_records, conceptos, eventos, gastos, liquidaciones y Audit de ese UUID. Solo se devolvió el hash, sin exportar registros reales.

Todas las sentencias SQL de este trabajo fueron SELECT. La primera lectura del ledger con runtime falló por permiso de metadata: diagnóstico/validador, resuelto leyendo únicamente ese ledger con el migrador, sin modificar grants. El bloqueo del conector Vercel es de autorización/herramienta; identidad/mandato/participantes son gates de datos y aprobación; routing es un gate de configuración. **No hubo transacción mutante que requiriera rollback.** No se declara rollback PASS de un canary que no corrió.

`npm test`: **209/209 PASS**. `npm run lint`: PASS sin warnings. `npm run build`: PASS, 44 módulos. `git diff --check`: PASS. No se añadieron tests que simulen una aceptación funcional ni se cambió código de aplicación.

No se modificaron Production, main, LV-MHZ, TEST financiero, mandatos, roles/grants, flags, entornos ni decisiones canónicas. No hay aceptación funcional de Costs V1; el PASS técnico de la temporal anterior conserva su alcance aislado.
