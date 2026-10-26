> Actualización de procedencia: [008 reconciliada y 009 reservada](migration-008-reconciliation.md). El bloqueo de ledger descrito en este checkpoint quedó resuelto mediante SELECT y artefacto byte-exacto; preflight SQL sigue pendiente.

# Hours V2 — preparación final de preflight

2026-10-26. Base `3ace73d12ac1b68217aa68f9ec99d7ab9f6335e5`, árbol inicial limpio, rama `codex/hours-v2-preflight-ready`. **Contrato técnico PROPOSED, SQL preparado y no ejecutado.** Este documento actualiza los bloqueos técnicos de D-309 sin convertir D-307/D-308/D-309 en aprobación de persistencia. No hay cambios en runtime, runner, migraciones, flags, dependencias ni infraestructura.

## 1. Autoridad y contraste

Ambos Sheets releídos completos, D-307 CONFIRMED intención de producto; D-308 PROPOSED dirección conservadora; D-309 PROPOSED precisión/conciliación/storage. Settings Matrix distingue intención confirmada de almacenamiento propuesto. Roadmap mantiene validación en TEST/Preview antes de aceptación/cutover. Catalog `source_expires_at` exige bytes temporales eliminables después de commit/rechazo/expiry: se conserva con borrado inmediato elegible al confirmar/cancelar y máximo 24 h. No se modifica ninguna decisión CONFIRMED.

| Fuente real del checkout | Hallazgo / contrato preservado |
| --- | --- |
| 001 | Revisiones y datos asociados append-only; raíces de vuelo con current_revision_id mutable/deferred FK; batch/status V1 y hash COMMITTED; baseline DATE + primer vuelo opcional; ajustes separados; Audit independiente |
| 002 | Revocación de capacidades restringe UPDATE de columnas; no concede autoridad OWNER por nombre/email |
| 003 | Fecha de instalación histórica nullable sin inventar fechas |
| 004 | Export temporal/direct response independiente de import; no reutilizar estados de export para retención de imports |
| 005 | Topología normalizada N posiciones, bootstrap canónico y permisos SELECT/INSERT |
| 006–007 | Revisadas solo como límites de ledger/privilegios; sin cambios ni trabajo funcional en Costs |
| db/migrate.js | Ledger public.schema_migrations, SHA-256 bytes exactos, transacción por archivo y rechazo Production. NO usar runner ni adopt-existing para este preflight: modificaría ledger |
| _postgresFlightRepository | SERIALIZABLE + advisory `app-horas:flight:<uuid>` y membership/flight row locks; no comparte aún el fence de aeronave propuesto |
| _postgresAircraftConfigurationRepository / _postgresComponentLifecycleRepository | SERIALIZABLE y FOR UPDATE de aeronave; futuras escrituras deben actualizar también generation, no solo lockear |
| _postgresSettingsRepository | Locks de settings/Tracking y advisory propio; no es un lock universal de horas |
| _postgresOnboardingRepository | Baseline V1 y membresía OWNER atómicos; no reutilizar opening_tis como TSN/TSO |
| _postgresHistoriesRepository / Tracking / Export | Baselines y ajustes se leen como V1, sin reescritura de contabilización |
| Imports | Esquema V1 batch/issue/provenance, pero no confirmador PostgreSQL V2 desplegado. No afirmar que XLSX ya opera V2 |
| Identity / pilot management / membership | Usuario/membresía activos se revalidan; revocaciones globales deben participar del protocolo y bloquear todas las aeronaves afectadas |

`hours-v2-review/expected-ledger.json` contiene los 7 hashes de **archivos del repositorio**, no un ledger observado en Neon. El catálogo remoto y privilegios efectivos no se consultaron en esta revisión; lectura metadata-only, deriva y comprobación del login real son primer gate del preflight autorizado. No se infiere que 001–007 sean exactamente todo el ledger remoto: si hay otra versión, detenerse y revisar su procedencia sin modificarla ni adoptarla automáticamente.

## 2. F6 implementable sin provisión

Política técnica propuesta `hours-retention-v2.1`: raw XLSX privado hasta 24 h desde created_at servidor, sin renovación; elegible para borrar inmediatamente tras cancelación o confirmación. Staging no confirmado hasta 7 días (168 horas transcurridas, sin efecto DST) desde created_at, cancelación bloquea acceso inmediato. Expiración es una regla de autorización por reloj, no depende de que haya corrido un cron. TTL no es interpretación de fecha de vuelo ni genera contadores.

- **Upload/parse:** sesión canónica, OWNER ACTIVE de UUID exacto, capability global futura más allowlist TEST/Preview; límites F6 de D-309. Clave generada por servidor sin nombre/email/matrícula, sin overwrite; hash verificado contra bytes en servidor. No ejecutar fórmulas, relaciones externas, macros ni celdas no mapeadas. No crear Flight Records en staging.
- **Raw:** OIDC del proveedor preferido para tareas dentro de Vercel si se aprueba; no crear token aquí. Descarga raw deshabilitada por defecto; proxy autenticado `private,no-store`, attachment/nosniff si se autoriza. URL bearer GET 60 s solo mediante aprobación específica y aceptación del intervalo de revocación. Nunca URL de borrado al OWNER.
- **Cleanup:** trabajo periódico propuesto cada 5 min, máximo 100 IDs por enumeración, sin PII ni filas. claim de 2 min con token nuevo y commit; DELETE fuera de la transacción; lectura origin `useCache:false` y comprobación autenticada de ausencia; finish en otra transacción con token aún vigente. 404 esperado es éxito idempotente; timeout, 401/403 o error de red NO prueban borrado. No marcar deleted hasta verificar. Si el lease vence, re-claim y re-verificar, sin reaprovechar token viejo.
- **Fallo:** conservar key protegida, error enumerado y reintento a 5 min; nunca guardar respuesta del proveedor ni filename personal. Alertar tras 3 fallos o 15 min vencido; alarma no reabre acceso ni detiene reintentos. Contadores/alarma son internos, no texto técnico en UI. El scheduler/monitoring no se ha creado.
- **Staging:** purge_batch SERIALIZABLE bloquea aeronave y batch, comprueba inexistencia de cualquier confirmación del lote, borra grafo temporal en orden FK, marca PURGED y emite un único Audit SYSTEM en esa transacción. Reintento PURGED devuelve false. Si falla una FK compartida, rollback completo y alarma; no CASCADE ni eliminar referencias para forzar purge. El raw tiene ciclo independiente: purgar staging no demuestra haber borrado bytes.
- **Evidencia aceptada:** no borrar ninguna fila de un batch confirmado ni snapshots aceptados; se retienen solo mapeo/valores numéricos originales, unidades/resolución, fechas evidenciadas, códigos operativos, referencias canónicas, hashes/versiones/decisiones. Todas las versiones preservadas del batch confirmado son lineage mínimo de la revisión, no copias de hojas. Raw sigue elegible para borrar. Correcciones/invalidez son hechos nuevos, no UPDATE/DELETE.
- **Minimización:** solo columnas mapeadas necesarias; source_sheet pseudónimo estable `sheet-1`, no nombre personal de la hoja; source_filename genérico `source.xlsx`; external record key minimizado/seudonimizado, no nombres/email. Piloto/propietario se referencian por identidad canónica existente solo cuando el mapeo lo requiere; no copiar PII ni crear personas automáticamente. Rechazar/staging pendiente si datos requeridos por el contrato operativo no son resolubles. Nunca inventar un piloto, fecha o contador para confirmar.
- **Tombstone mínimo:** batch conserva UUID, aircraft UUID, actor interno, hash, policy, created/expiry/cancel/purge/raw_deleted y resultado seguro de limpieza. Sin raw ni columnas no mapeadas ni texto de error libre. UUID/hash también pueden ser datos vinculables; acceso y retención requieren aprobación del responsable. El worker no puede borrar el tombstone o Audit.

**Roles distintos:** OWNER accede por servicio autenticado y RLS al scope autorizado; mantenimiento recibe solo IDs/key temporal mediante funciones limitadas; operaciones internas pueden invalidar aceptaciones mediante rol NOLOGIN exclusivo, sin corregir snapshots anteriores. No interpretar OWNER como titular legal ni como administrador de almacenamiento/privilegios.

### Riesgos externos pendientes

Vercel Blob PRIVATE `gru1` sigue siendo propuesta compatible, no servicio provisionado ni configuración de la cuenta verificada. [Seguridad oficial](https://vercel.com/docs/vercel-blob/security) documenta acceso privado y AES-256. El [DPA vigente](https://vercel.com/legal/dpa) distingue condiciones según plan y permite tratamiento fuera de la región; seleccionar gru1 no prueba residencia integral. Revisar lista de [subprocesadores y ubicaciones](https://security.vercel.com/), alcance real del plan/contrato, transferencias, soporte/CDN y política de backups/recuperación. No hay evidencia contractual aquí que permita prometer plazo de eliminación física de todas las copias. Eliminación comprobada significa ausencia accesible en origen, no certificación forense del proveedor.

Pendientes de responsable/legal: aceptación de 24 h/7 días, fundamento/avisos, retención final tras cierre de aeronave/cuenta, tombstones/Audit y datos personales inevitables, excepciones de conservación y respuestas de titulares. No se inventa un plazo legal ni se modifica historia para resolverlos. **Para preflight sintético no se cargan XLSX personales ni se contrata Blob; la habilitación de datos reales sigue bloqueada.**

## 3. Esquema y relaciones congelables

Se conservan 20 tablas nuevas. Correcciones necesarias: aircraft_id en mapping_fields para RLS sin scope implícito; import_batch_id compuesto en staging y snapshots impide cruzar lotes de la misma aeronave; source_ordinal estable por archivo conserva provenance V1; committed_rows solo puede enlazar disposición INCLUDE. Un constraint trigger diferido exige confirmación + aceptación + batch sellado + lineage completo y coincidente con import_batch/ordinal/revisión actual dentro de la misma transacción.

`retention.sql` añade columnas opt-in al batch existente (sin tocar estados V1 ni backfill de negocio) y `hours_v2_generation` en aircraft; **generation es versión de concurrencia, no horas ni un cero ficticio de contador**. Batch V2 usa factory y estados separados OPEN/CANCELLED/EXPIRED/CONFIRMED/PURGED, retención inextensible y lease. Trigger impide cambiar identidad/hash/fechas, eliminar tombstone, desactivar V2 o reabrir terminales mediante UPDATE V1. Raw deletion modifica solo columnas de cleanup, incluso en batch confirmado, sin alterar evidencia de aceptación.

Orden de propuesta: schema.sql → retention.sql → security.sql. Fuera del runner. No nueva migration version, no filas de ledger ni grants ejecutados. Rollback normal: toda la transacción, roles incluidos. Teardown manual vacío: rollback-security.sql → rollback.sql → rollback-retention.sql; solo rama descartable, nunca historia real.

## 4. Permisos por operación y tabla

SQL propuesto crea **solo roles NOLOGIN, NOINHERIT, NOBYPASSRLS**, sin passwords; únicamente membresía ADMIN nativa del creador de migración, con SET/INHERIT FALSE al cierre (ver revisión de bootstrap). No concede membresía a app_runtime/app_horas_runtime. Reader SELECT únicamente de tablas V2 con OWNER ACTIVE + actor/scope de sesión. Writer SELECT/INSERT de evidencia nueva, nunca UPDATE/DELETE; RLS, sello de snapshot y actor coincidente. Invalidation solo INSERT para rol interno separado. Roles dueños de funciones no se conceden a usuarios/runtime/worker; función SECURITY DEFINER tiene search_path pg_catalog, referencias calificadas y EXECUTE PUBLIC revocado, sin SQL dinámico por input.

**Frontera de confianza:** custom GUC no autentica. Actor, scope, canary y verified_preview_test solo se vinculan por backend después de validar sesión/gates canónicos; jamás del payload ni de parámetros URL. Quien obtiene acceso SQL al rol de backend puede falsificar GUC: no se ofrece esta solución como RLS de cliente público. Ninguna credencial SQL se expone a navegadores. Habilitación real exige revisión del código de binding por transacción/retry y del grafo efectivo de membresías. No confiar solo en declaraciones GRANT del archivo: probar login efectivo, table y column privileges, owners, funciones y FORCE RLS.

Factory/open, cancel y seal del batch pasan por funciones con scope/fence; worker solo due_cleanup/claim_raw_cleanup/finish_raw_cleanup/purge_batch. Cleanup_owner tiene DELETE sobre 12 tablas temporales y un guard adicional de no-confirmación; maintenance no tiene SELECT/INSERT/UPDATE/DELETE de tablas ni SET ROLE al dueño. Los 8 restantes son append-only siempre, incluso borradores de referencia/plan: su contenido es mínimo y su retención legal permanece pendiente.

| Tabla | Reader / writer | Purga |
| --- | --- | --- |
| aircraft_hours_plans | SELECT OWNER / INSERT OWNER mediante backend | NUNCA; append-only |
| aircraft_hours_plan_revisions | SELECT OWNER / INSERT OWNER mediante backend | NUNCA; append-only |
| hours_component_overhaul_episodes | SELECT OWNER / INSERT OWNER mediante backend | NUNCA; append-only |
| hours_import_mapping_versions | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| hours_import_mapping_fields | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| hours_import_staged_rows | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| hours_counter_references | SELECT OWNER / INSERT OWNER mediante backend | NUNCA; append-only |
| hours_reconciliation_runs | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| hours_reconciliation_flights | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| hours_reconciliation_installations | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| hours_reconciliation_staged_rows | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| hours_reconciliation_references | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| flight_component_utilization_attributions | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| hours_candidate_component_attributions | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| hours_reconciliation_differences | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| hours_reconciliation_issues | SELECT OWNER / INSERT OWNER mediante backend | Solo grafo de batch NO confirmado vencido/cancelado |
| hours_reconciliation_confirmations | SELECT OWNER / INSERT OWNER mediante backend | NUNCA; append-only |
| hours_import_committed_rows | SELECT OWNER / INSERT OWNER mediante backend | NUNCA; append-only |
| aircraft_hours_acceptances | SELECT OWNER / INSERT OWNER mediante backend | NUNCA; append-only |
| hours_acceptance_invalidations | SELECT OWNER / INSERT interno de invalidación | NUNCA; append-only |

## 5. Protocolo único de concurrencia e historia

**Obligatorio para TODOS los mutadores antes de habilitar V2; no está desplegado en V1.** No basta añadir un lock nuevo solo al confirmador.

1. Validar sesión canónica, vincular actor interno y scope desde el servidor; resolver capacidad global y canary por UUID del servidor, no del payload. Empezar nueva transacción SERIALIZABLE, timeouts acotados y contexto SET LOCAL. Revalidar en cada retry.
2. Orden único: usuarios afectados ordenados por UUID (FOR SHARE en escritura normal, FOR UPDATE para revocación) → aeronaves por UUID → membresías por UUID → batch → plan/head → raíces Flight por UUID → instalaciones/componentes por UUID. Cambios globales de identidad bloquean todos los scopes afectados en ese orden. Nunca usar lock advisory distinto primero ni tomar locks de usuario después de aeronave.
3. `begin_mutation` bloquea usuario, **actualiza generation=generation+1** de la aeronave y bloquea membresía; si expected_generation difiere o snapshot fue tomado antes de una actualización concurrente, 40001/stale. Para varios scopes, coordinador ordena y adquiere todos antes de leer estado. Rollback revierte el incremento.
4. Dentro del fence, reconstruir fingerprint completo del conjunto de fuentes: aircraft/scope, generation esperada, current revisions y ACTIVE/VOID, import lineage/identidades excluidas, todas las instalaciones/bordes/posiciones y topología, referencias/episodios/ajustes, mapping/file/row hashes, algoritmo/policy y evidencia de equivalencia. Canonicalizar strings exactos, NULL, orden por IDs; nunca usar solo un count o max(created_at). Leer conjuntos/ausencias bajo SSI para detectar phantoms, no solo filas ya conocidas.
5. Cada run fija input_generation igual al fence usado para validar; la confirmación SQL exige ese valor igual a generation del nuevo fence menos uno, de modo que begin_mutation(NULL) tampoco permite aceptar un run viejo. Preview/validación y confirmación son transacciones separadas. Comparar head/secuencia, permisos actuales y fingerprint del preview antes de crear datos operativos. Un hash distinto produce preview stale/409 y nuevo run, no un retry de aceptación silenciosa. Revocación ya comprometida nunca se toma de cache de UI. Validar TTL de staging por reloj al sellar y al constraint diferido; raw borrado después de normalización no borra prueba numérica/hash validada.
6. Aplicar mutación y, si cambia entradas de una aceptación vigente, INSERT de invalidación con request/razón/IDs. No UPDATE de aceptación ni sumar sus totales otra vez. Creación/edición/VOID/retroactivo, instalación/retiro/reemplazo, overhaul, referencia o ajuste deben invalidar cuando afecten cobertura/valores. Cancelación/purga de un candidato no cambia por sí sola un absoluto aceptado. Generation es fence de previews, no una decisión automática de invalidez semántica.
7. Confirmación integral: revisiones/raíces importadas + lineage + confirmación idempotente + sucesora + batch COMMITTED/CONFIRMED + Audit de éxito, **una transacción**. Poblar snapshots antes de confirmar (quedan sellados); constraint diferido comprueba integridad al final. Duplicate verificado no crea otro vuelo. Fuentes incompletas, UNKNOWN o brechas bloqueantes no se fuerzan a cero. Para CURRENT_REFERENCE no hay batch, pero sí aceptación atómica.
8. Commit; solo después emitir respuesta. Error: ROLLBACK completo, incluidas revisiones y Audit de éxito. 40001/40P01: máximo 3 transacciones nuevas, backoff aleatorio acotado (por ejemplo 50–250 ms), reautenticar/releer/recalcular; nunca continuar el mismo snapshot ni repetir efectos externos. 23505 no es éxito: comparar request/actor/scope/payload canónicos; misma identidad devuelve resultado previo, distinta 409. 23503/23514/42501 no se reintentan como carreras.

| Mutador | Cambio de fingerprint / invalidación |
| --- | --- |
| Nuevo/retroactivo Flight | Dataset + límites de período; RETROACTIVE_FLIGHT si afecta aceptación |
| Edición/VOID | Revisión actual/status; REVISION_CHANGED / FLIGHT_VOIDED |
| Instalación/retiro/reemplazo | Instalaciones, componente físico/posición/bordes; INSTALLATION_CHANGED |
| Overhaul | Episodio y cobertura TSO; OVERHAUL_CHANGED |
| Referencia/baseline/ajuste | Referencia independiente/ajuste explícito; REFERENCE_SUPERSEDED / ADJUSTMENT_CHANGED; V1 no se reinterpreta |
| Import / sucesora | Conjunto de fuentes y head; sustituye vista aceptada, no suma dos acumulados |
| Política/algoritmo o fuente | POLICY_CHANGED / SOURCE_CHANGED; sin reescribir run anterior |
| Revocación usuario/membresía | Fence común y revalidación; invalida privilegio para confirmar, no borra historia |

DB guards no sustituyen validar fechas, DTO/escala, autoridad de una equivalencia ni recomputar la matemática. La RLS tampoco sustituye la sesión canónica. SQL propuesto ofrece barreras verificables de integridad/privilegios, no una API de confirmación ya lista.

## 6. Plan de pruebas aisladas y rollback

**Estado de todos los tests PostgreSQL: PREPARADOS / NO EJECUTADOS.** No conexión Neon ni DDL ejecutado por esta tarea.

| Fase / escenario | Evidencia exigida |
| --- | --- |
| Target | Control plane independiente: schema-only disposable branch/endpoint, denylist parent TEST/Production, identidad/DB y rol migración sin secretos; sin negocio real; revisión de permisos para CREATE ROLE/ownership |
| Ledger previo | SELECT de public.schema_migrations y comparación con hashes exactos checkout; detectar faltantes/extra/drift (incluida cualquier 008 fuera del checkout). No ejecutar adopt-existing ni registrar propuesta |
| Baseline catálogo | Snapshot columnas/constraints/índices/roles/owners/grants/column-grants, defaults/RLS/function ACL. Metadatos únicamente; no clonar datos personales |
| Forced rollback | forced-rollback.sql dentro BEGIN con excepción terminal; close/ROLLBACK obligatorio. Nueva conexión verifica cero tablas/roles/funciones/columnas Hours V2 persistidas y ledger/baseline exactos |
| Fixture phase | Solo después de rollback probado, preparar schema/roles y fixtures sintéticas COMMITTED en rama descartable para dos sesiones. Ese COMMIT es solo fixture aislada, NO parent TEST ni migración aplicada |
| Scope positivo/negativo | OWNER activo A ve A; no ve B aunque sea OWNER B cuando contexto scope=A. PILOT/VIEWER/inactivo/actor distinto/contexto ausente no lee/escribe; mapping y filas no cruzan batch/aircraft |
| Historia | UPDATE/DELETE de los 20 snapshots denegados; ampliar snapshot ya confirmado denegado; modificación de aceptación anterior denegada; invalidación nueva preserva anterior |
| Purga | OPEN vivo deniega; vencido/cancelado borra grafo no confirmado y emite un evento; retry no duplica; FK externa fuerza rollback; batch confirmado o cualquier confirmación deniega sin cambios |
| Raw cleanup | Dos workers: un lease; token viejo/expirado no marca deleted; error mantiene key y reintenta; ausencia verificada marca borrado una vez; borrar raw confirmado no borra evidencia |
| Atomicidad | Falta aceptación, batch sellado, INCLUDE promovido o provenance de raíz correcta provoca 23514 al final; rollback no deja vuelos operativos ni Audit de éxito |
| Idempotencia | Mismo request y payload devuelve mismo resultado, otro actor/scope/payload 409; hash COMMITTED duplicado no crea dos lotes operativos |
| Concurrencia | preflight-session-a/b prueban fence con snapshot B anterior a commit A; B debe fallar 40001 y no alcanzar aceptación. Repetir con dos confirmaciones del mismo head, cada mutador de la tabla anterior, expiración/purga y revocación |
| Privilegios | preflight-privileges.sql + ejecución con login efectivo/new roles; mantenimiento sin table DML/SELECT; sin camino SET ROLE a dueños; RLS FORCE y EXECUTE PUBLIC denegado |
| Cierre | Counts/hash de fixtures y ausencia de nuevas aceptaciones stale; rollback/teardown solo vacío y eliminación de rama descartable; verificación independiente parent TEST/Production sin cambios |

Scripts de sesiones usan solo avance de fence como caso base. **No demuestran aún integración de todos los repositorios.** La matriz completa requiere adaptar coordinador/confirmador de prueba o ejecutar fixtures de cada operación antes de declarar PASS de concurrencia. El código V1 actual no usa el nuevo contador ni invalidaciones: bloquear persistencia V2 hasta integrar y verificar todos los mutadores. Preflight de contrato SQL sintético y habilitación de runtime son gates distintos.

## 7. Estado y recomendación

Contrato técnico revisado y propuesta SQL de permisos/purga/concurrencia lista para revisión independiente. Recomiendo autorizar después un **preflight aislado, sintético y sin Blob**, condicionado a validar target, deriva/ledger, capacidad de crear roles y diff exacto. Los resultados de ese preflight pueden exigir correcciones del SQL: no se declara SQL PASS por tests de texto/modelos.

Migración NO aplicada; permisos NO desplegados; canary LV-SIM NO ejecutado; flags NO activados. Aprobación definitiva de política/retención, DPA/plan/subprocesadores/backups y datos reales siguen pendientes. Documentación en Sheets distingue PROPOSED de intención CONFIRMED; no hay aceptación funcional autenticada.

## Corrección del preflight de ownership

Ver [bootstrap de dueños y matriz de rollback](hours-v2-review/security-owner-bootstrap.md). El FAIL reportado requiere SET temporal únicamente para app_horas_migration; security PASS sigue pendiente de repetición independiente.
