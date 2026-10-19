# Migración 008 — Costs V1 (D-306)

**V1 DESIGN READY FOR REVIEW — SQL BLOQUEADO, NO APLICADO.** 19/10/2026. Rama `review/issue-8-migration-008-design`, base `f6bba8b1c191157e2647b26a8bfac89901abae45`. Este diseño reemplaza la propuesta amplia de ese commit, que queda preservada en Git. No equivale a implementación completa del Issue #8.

## Decisiones canónicas revisadas

Se consultaron nuevamente [Product & Data Model](https://docs.google.com/spreadsheets/d/1lvzdL169hReQ2nT-mYHEm8ELZVJI2zVJcwU-9bCJosM/edit) y [Schema Catalog](https://docs.google.com/spreadsheets/d/1Q3VXvhN4vWSVrVuYOiwnuoqHfMP7HC-UApxlDTPlDTg/edit). D-306 está CONFIRMED: V1 prioriza OWNER, gastos/pagadores/reparto, correcciones OPEN, snapshots SETTLED, privacidad y Audit. D-305 confirma que el titular financiero anterior conserva lectura de su archivo sin membresía activa. D-304/D-305 siguen vigentes para las funcionalidades futuras; no se cancelan.

V1 no crea divulgaciones, destinatarios, delegaciones ni workflows de representantes; no admite eventos/liquidaciones entre ámbitos. No se necesita resolver esas funciones para construir el núcleo. Ninguna regla de roles operativos concede autoridad financiera. Las migrations 001/002/006/007 y el checkpoint de Costs no se editan.

Archivos: [SQL](../db/migrations/008_costs_financial_scopes_and_open_corrections.sql), [inventario exacto](issue-8-migration-008-inventory.md), [matriz de tests](issue-8-migration-008-test-matrix.md). El SQL conserva una excepción incondicional antes de cualquier consulta/DDL. No ejecutarlo con `db/migrate.js`, que descubre automáticamente los archivos numerados.

## Modelo mínimo

Cinco tablas nuevas, frente a ocho en el borrador anterior:

1. `cost_financial_scopes`: archivo privado de una administración de una aeronave, identificado y aprobado explícitamente. No es una party económica ni un episodio de propiedad deducido por fechas; puede reunir gastos cuyo reparto incluye varios copropietarios. No necesita inventar una party conjunta.
2. `cost_financial_authorities`: mandato explícito de un usuario canónico sobre ese archivo, con usuario aprobador, fecha y referencia de aprobación verificable. No contiene categorías/delegación organizacional. V1 no resuelve representantes desde cargo, nombre o correo; un caso sin mandato explícito verificado se bloquea.
3. `cost_financial_authority_revocations`: revocación append-only del mandato. Cambiar membresía no genera esta fila automáticamente: D-305 exige conservar el acceso al archivo propio tras transferencia. Revocar explícitamente una autoridad financiera sí impide nuevas lecturas; una reautorización crea otro mandato, no borra evidencia.
4. `cost_financial_records`: vínculo inmutable de una raíz concreta (concepto/tipo/evento/gasto/settlement) con un único ámbito y aeronave. Cinco FK tipadas, CHECK de exactamente una raíz, UNIQUE por raíz y FK compuestas. Permite clasificar historia sin UPDATE de snapshots.
5. `cost_expense_corrections`: lote idempotente de corrección con actor, motivo, request y versión base; vincula filas creadas/retiradas sin sobrescribir sus valores económicos.

Ámbitos y mandatos se provisionan por procedimiento privilegiado expresamente revisado, atómico con Audit. El runtime tiene solo SELECT sobre ellos y sus revocaciones. No se incorpora un endpoint para que un OWNER se otorgue su propio mandato. El usuario aprobador debe estar realmente autorizado según la evidencia revisada: su UUID o una referencia textual por sí solos no prueban autoridad. Un único archivo puede autorizar explícitamente a varios usuarios; no se generan mandatos por copropiedad.

Sin vínculo o mandato válido, la consulta falla cerrada. Cada raíz nueva se inserta junto con su binding y Audit en una transacción. El servicio exige ese binding; la base permite raíces históricas sin binding para que permanezcan en cuarentena. Los lectores hacen INNER JOIN por binding autorizado, nunca fallback por `aircraft_id`.

Los conceptos/tipos llevan además `financial_scope_id` nullable para historia aún no clasificada. Sus nombres activos son únicos dentro del ámbito, no globalmente por aeronave: evita que el nombre de un concepto privado anterior se filtre por conflictos o impida crear el mismo concepto en otra administración. FK triples garantizan que su binding coincida con ese scope. Ninguna fila histórica se asigna automáticamente.

## Matriz de acceso V1

Siempre sesión válida + usuario ACTIVE + mandato financiero vigente del scope solicitado. Un mandato es vigente si no tiene revocación; registros y referencias deben pertenecer al mismo ámbito/aeronave.

| Caso | Leer archivo | Crear/corregir economía OPEN | SETTLE | Administrar mandatos/divulgar |
| --- | --- | --- | --- | --- |
| OWNER activo + mandato explícito | Sí | Sí, con flag habilitado y fuente POSTGRES | Sí, mismas condiciones | No en runtime V1 |
| OWNER activo sin mandato | No | No | No | No |
| Titular anterior autorizado, sin membresía activa | Su archivo, D-305 | No | No | Sin divulgaciones V1 |
| Mandato vigente con rol PILOT/VIEWER | Su archivo autorizado | No | No | No |
| Nuevo propietario legal / ADMIN legacy / payer / piloto sin mandato | No | No | No | No |
| Autoridad ausente, ambigua o revocada; usuario DISABLED | No | No | No | No |

La ausencia de membresía activa no invalida el mandato de lectura del archivo anterior ni habilita acceso operativo o al ámbito del comprador. Mutaciones económicas exigen además aeronave ACTIVE y membresía OWNER ACTIVE. El flag no es una autorización; true no suple ningún mandato y las lecturas no dependen de él.

No se devuelve Audit ni entidades completas de persona/party por navegar una FK. Las respuestas financieras exponen solo contenido autorizado; datos operativos históricos requieren su propio acceso. `source_snapshot` se proyecta por campos permitidos, no se devuelve JSON bruto. Historiales, filtros, totales, paginación y futuras exportaciones usan el mismo scope: no enumerar IDs ni counts ajenos. Objeto inexistente/ajeno/sin autorización => 404 externo genérico.

## Operaciones y transacciones

Contrato para el servicio futuro dentro de `settings.js`, sin nueva función serverless. Este commit no instala rutas ni repositorio Costs. actor/fechas/derivados vienen del servidor; entradas desconocidas se rechazan.

| Operación | Entrada de negocio | Resultado y guardas |
| --- | --- | --- |
| Leer/listar | aircraft_id, scope_id, filtros/cursor | Solo raíces con binding autorizado; reautorizar cada petición; `private, no-store` |
| Crear concepto/tipo/evento/gasto | scope explícito, referencias y payload normal de 006/007, request_id | OWNER+mandato; relaciones del mismo scope; raíz+binding+Audit atómicos |
| Corregir gasto OPEN | expense_id, expected_details_version, request_id, reason, encabezado económico y/o conjunto deseado de pagos/asignaciones | Validar before/after y congelamiento; CAS versión; retiro/reemplazos; Audit único |
| Liquidar evento/período | scope, evento o fechas, request_id | Todos los gastos/fuentes de ese ámbito; moneda separada; snapshots append-only + Audit + estado de evento atómicos |
| Provisionar/revocar autoridad | Manifiesto aprobado con UUID, ámbito y evidencia | Procedimiento privilegiado separado; sin auto-bootstrap runtime |

Escrituras: capacidad antes de conectar; SERIALIZABLE; locks ordenados aeronave → scope → expense/event, `pg_try_advisory_xact_lock` no bloqueante para locks de autorización. Ante contención abortar y comenzar otra transacción/snapshot; no esperar en SERIALIZABLE y luego autorizar con un snapshot anterior a una revocación. Revalidar usuario, mandato, OWNER, estados y referencias bajo lock. Una lectura usa READ COMMITTED, lock por scope y consulta ACL posterior a adquirirlo; la revocación privilegiada usa el mismo lock. Una petición posterior al commit de revocación se deniega; no se promete retirar respuestas ya enviadas.

## Correcciones OPEN trazables

Se mantiene la solución simple de retiro de filas. ACTIVE se representa por `retired_at IS NULL`; los tres metadatos de retiro son todos NULL o todos presentes. Valores originales, payer/party y porcentajes no se editan in-place. Retirar primero e insertar reemplazos nuevos permite A=50/B=50 → A=100 y CUSTOM A/B → DIRECT A sin contribuciones ficticias. Se conservan filas sin cambios y múltiples pagos reales de una misma party.

`details_version` es la versión del gasto y su conjunto abierto completo, también para cambios de encabezado; toda corrección material compara expected version, registra batch, avanza versión e inserta Audit. Filas existentes mantienen created_correction_id NULL como origen legacy veraz; nuevas filas requieren batch. No-op no crea lote/Audit. Replays del mismo request/actor/contenido devuelven el resultado anterior, distinto contenido => 409. UNIQUE(expense_id,base_details_version) y CAS rechazan dobles correcciones.

El guard invoker bloquea el gasto, exige OPEN, evento OPEN si existe y ausencia de cualquier línea en cost_settlement_expense_lines (también períodos). Rechaza reactivación de retiradas, modificación de valores y batch/versión/actor inconsistentes. Settlement y modificaciones de encabezados deben bloquear/revalidar el mismo gasto; no basta con el trigger de detalles. VOID también está prohibido sobre fuentes congeladas. Una corrección posterior requiere sucesor explícito sin alterar la evidencia original; no se construyen casos especiales de sucesor en este diseño.

Pagos vigentes suman importe; CUSTOM suma 100.0000%; DIRECT tiene un responsable 100%; OWNERSHIP y UTILIZATION usan fuentes canónicas/históricas. No aceptar derivados financieros del frontend ni inferir payer por dueño. Dinero con centavos enteros/decimal exacto, moneda independiente, faltantes no son cero. El cálculo completo y su regla de redondeo siguen el contrato D-297–D-303 de la siguiente implementación; nunca inventar una contribución positiva para satisfacer un CHECK. Fallo de negocio, trigger, Audit o serialización revierte encabezado, versión, filas y lote.

SETTLED conserva gastos exactos, pagos/responsabilidades, fuentes de propiedad/utilización, IDs de vuelo/revisión/instalación y totales por moneda en tablas normalizadas; JSON solo complementa. Las tablas de snapshots no reciben UPDATE/DELETE. No se habilita SETTLE hasta que el repositorio y sus tests completos estén implementados y revisados.

Audit propuesto para el servicio: COST_EXPENSE_CREATED, COST_EXPENSE_CORRECTED, COST_SETTLED y COST_CONCEPT_*/COST_EVENT_* según la operación material. Aprovisionamiento explícito: COST_FINANCIAL_SCOPE_REGISTERED, COST_FINANCIAL_AUTHORITY_GRANTED/REVOKED y COST_FINANCIAL_RECORD_BOUND. Usar USER/MANUAL para acciones humanas reales, UUID de actor/request y before/after coherentes con el patrón existente; una migración futura declara su procedencia verdadera. Audit no sustituye bindings, mandatos, detalles ni snapshots. No registrar éxito ni responder antes del commit; replay idempotente no agrega otra auditoría.

## Privilegios efectivos: corrección del defecto

El borrador anterior revocaba UPDATE al grupo `app_runtime`, dejando posibles grants directos de tabla o columna al LOGIN `app_horas_runtime`, o PUBLIC. Un GRANT por columnas no reduce privilegios más amplios. La actualización propone:

1. Antes de DDL: verificar que existen ambos roles; grupo NOLOGIN, login LOGIN/INHERIT; ninguno superuser/createdb/createrole/replication/bypassrls, ni owner de esquemas/relaciones/funciones canónicos ni CREATE en app/audit. Única membresía permitida del login: app_runtime; el grupo no puede heredar roles adicionales. Cualquier camino inesperado, incluso SET ROLE, aborta: no se alteran membresías/ownership unilateralmente.
2. Para las 13 tablas protegidas enumeradas en SQL/inventario: REVOKE ALL de tabla para ambos roles y PUBLIC; luego REVOKE SELECT/INSERT/UPDATE/REFERENCES por **todas** las columnas reales. Esto elimina tanto grants amplios como residuales por columna, sin CASCADE silencioso.
3. Reotorgar exclusivamente al grupo: SELECT en ámbitos/mandatos/revocaciones; SELECT/INSERT en bindings/lotes/detalles/snapshots/Audit; UPDATE solo de los tres metadatos de retiro en pagos/asignaciones. El login hereda del grupo, no recibe grants directos nuevos.
4. Antes de commit: comprobar has_table_privilege y has_column_privilege para grupo, login y PUBLIC. Snapshot/Audit/ACL sin modificaciones, detalles sin UPDATE de amount/party/expense/porcentaje. Si queda permiso efectivo imprevisto, RAISE y rollback completo.

Esto corrige el **SQL propuesto**, no los roles vivos: no hubo conexión ni cambios en Neon. No se afirma PASS de permisos actuales. Las fuentes canónicas anotan una inspección previa realizada por ChatGPT; no se la sustituye por tests simulados.

`scripts/lib/costs-v1-privilege-contract.mjs` incluye lector SELECT-only con query inyectada y validador offline para la futura comprobación post-008. No tiene CLI, conexión automática ni fallback de credenciales. Tests prueban el rechazo de evidencias inseguras. Su ejecución futura requiere autorización separada y transacción read-only sobre el target aprobado. La documentación PostgreSQL respalda [REVOKE por tabla/columna](https://www.postgresql.org/docs/current/sql-revoke.html) y [funciones de privilegios efectivos](https://www.postgresql.org/docs/current/functions-info.html#FUNCTIONS-INFO-ACCESS-TABLE).

El rol runtime compartido sigue siendo de confianza: estos grants no hacen RLS por usuario ni autorizan business state. El servidor debe aplicar el mandato financiero en cada consulta y mutación. No presentar este diseño como defensa frente a código arbitrario que use el login runtime.

## Transiciones y backfill V1

Transferencia/cambio de administración: nuevo ámbito y mandatos aprobados explícitamente; anteriores se conservan privados. Nunca copiar grants ni mover historia por nuevas membresías/propiedad. Captura tardía usa el ámbito anterior explícitamente autorizado y fecha real; quien ya no es OWNER activo no puede escribir por la ruta V1. No implementar excepciones para resolver ese caso: bloquear la escritura y reportar la necesidad concreta.

Eventos, gastos y nuevas liquidaciones deben usar un único scope. Si aparece historia mixta o binding ambiguo, cuarentena sin proyectar totales parciales. Los índices originales evento/período/moneda de 007 se conservan: una colisión con un original de otro scope bloquea con `COST_SETTLEMENT_SCOPE_CONFLICT`, sin revelar su contenido ni crear un segundo original ocultamente.

No se consultaron filas reales ni se supone Costs vacío. El SQL no crea datos ni permisos históricos. Backfill posterior: inventario read-only autorizado → manifiesto de UUID exactos, ámbitos y aprobaciones financieras explícitas → revisión independiente → transacción privilegiada de bindings/mandatos con Audit. Conceptos/tipos requieren clasificar su scope antes de insertar binding; los settlements no se actualizan. Sin evidencia suficiente, dejar sin binding/mandato e inaccesible; el usuario aprobador del manifiesto no se deduce del creador del gasto o del propietario actual.

**Único bloqueo de datos para habilitar V1:** no se proporcionó en las fuentes revisadas un manifiesto de autoridad financiera explícita para los usuarios/archivo actuales. El futuro servicio debe devolver internamente `COST_FINANCIAL_AUTHORITY_UNRESOLVED` (sin exposición de datos) hasta obtenerlo. No hace falta reabrir decisiones sobre sharing/representantes/mixtos; están fuera de V1. La provisión de esos mandatos debe ser autorizada por separado, no es parte de aplicar DDL.

## Verificación y límites de entrega

El inventario detalla cada cambio; la matriz separa tests ejecutados de integración futura. Se conservan hashes de 006/007. El SQL sigue bloqueado; no se envió a PostgreSQL ni se ejecutó una migración de prueba. Tests offline no prueban compilación PL/pgSQL, grants reales ni concurrencia de dos conexiones; esos son gates de la revisión posterior. No se añaden funciones serverless ni cambios UI/API. Se publica solo un commit de revisión, sin merge/main/Production/flags.

Validación local: `npm test` **183/183 PASS** (176 anteriores + 7 nuevos); `npm run lint` PASS; `npm run build` PASS; `node --check scripts/lib/costs-v1-privilege-contract.mjs` PASS; `git diff --check` PASS. Las pruebas de regresión incluyen grants directos del login, PUBLIC por tabla/columna, flags elevados, herencia, ownership y evidencia incompleta. No se declara PASS del servidor, de Preview ni del backend Costs aún pendiente.
