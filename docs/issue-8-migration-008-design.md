# Migración 008 — diseño para revisión

Estado: **MIGRATION 008 DESIGN READY FOR REVIEW**. Propuesta, no contrato aprobado ni migración aplicable. Fecha: 19/10/2026, America/Santiago.

Base: rama `etapa-2e4-test-app-parity`, HEAD `caa40cb4b963675b195a5f622d62134dbc5d3e3d`, árbol inicialmente limpio. No hay cambios respecto del checkpoint al comenzar esta iteración. Se conservan helper, tests y diagnóstico anteriores.

Entregables asociados:

- [Borrador SQL](../db/migrations/008_costs_financial_scopes_and_open_corrections.sql).
- [Inventario de esquema y permisos](issue-8-migration-008-inventory.md).
- [Matriz de verificación](issue-8-migration-008-test-matrix.md).

## Autoridad y límites

Leídos de nuevo: migrations 001, 002, 006 y 007; runner `db/migrate.js`; checkpoint; Product & Data Model y Schema Catalog mediante Google Drive. D-304 fue verificada en `01_Decisions` (el export textual contiene encabezados/índices distintos de la fila visual 306) y los dos asientos nuevos del Change Log. El Catalog consultado conserva el contrato anterior de Costs y aún no contiene estas tablas propuestas. No se editaron los Sheets.

Fuentes: [Product & Data Model](https://docs.google.com/spreadsheets/d/1lvzdL169hReQ2nT-mYHEm8ELZVJI2zVJcwU-9bCJosM/edit), [Schema Catalog](https://docs.google.com/spreadsheets/d/1Q3VXvhN4vWSVrVuYOiwnuoqHfMP7HC-UApxlDTPlDTg/edit). D-042, D-297–D-303 siguen vigentes. D-304 confirma separación histórica, selección explícita, lectura exclusiva, destinatario identificado, revocación y conservación de evidencia. **Todas las decisiones de representación, bootstrap, agrupación, transición y backfill de este documento son recomendaciones pendientes.**

No se ejecuta SQL, ni siquiera BEGIN/ROLLBACK en TEST. No se implementan servicios, endpoints, liquidaciones o UI. No se cambia la capacidad desplegada. No hay commit ni push. El borrador contiene un `RAISE EXCEPTION` incondicional antes del primer DDL, porque el runner descubre automáticamente todo archivo `NNN_*.sql`; quitarlo requiere revisión y autorización posterior. No usar `db/migrate.js` para validar este diseño.

## Modelo recomendado

Un ámbito representa un archivo financiero privado de **una party titular y una aeronave**. No representa al usuario, al piloto ni al dueño legal actual. Puede durar después de una transferencia y recibir registros tardíos. No se crea automáticamente por fechas, membresía o participación legal. Para copropietarios: ámbitos separados por titular como primera opción; un archivo conjunto necesita un mandato expresamente aprobado y definición de su titular, no una party artificial creada para sortear el modelo.

`cost_financial_scopes` identifica ese ámbito. `cost_financial_authorities` contiene mandatos explícitos de administración para usuarios canónicos. La etiqueta de base PERSON_HOLDER / ORGANIZATION_REPRESENTATIVE / DELEGATED_ADMIN describe un mandato verificado, nunca lo prueba por sí sola. `approval_reference` identifica la aprobación revisada; no es Audit metadata ni un nombre/correo que resuelva identidad. La propuesta reserva el aprovisionamiento de ámbitos y autoridades al procedimiento privilegiado de revisión; el runtime recibe únicamente SELECT. No hay un endpoint de autoasignación de administración.

Una autoridad vigente permite leer el ámbito y autorizar divulgaciones, según las condiciones del cuadro de permisos. La revocación del mandato es una fila separada en `cost_financial_authority_revocations`. Cada nuevo mandato tiene UUID propio; reautorizar no borra ni reactiva el mandato revocado. Propuesta conservadora: revocar un mandato suspende también las divulgaciones emitidas bajo él, sin borrar los grants. Mantener esas divulgaciones vigentes sería otra opción que requiere aprobación.

`cost_financial_records` vincula exactamente una raíz (concepto, tipo de evento, evento, gasto o liquidación) a un ámbito. Tiene cinco FK tipadas, un CHECK `num_nonnulls(...)=1`, un UNIQUE por raíz y FK compuestas que verifican aeronave. No hay un UUID polimórfico sin FK. Las raíces siguen con sus tipos reales (`uuid`, fechas, `numeric`) de 006/007. Los detalles heredan el ámbito de su gasto o liquidación; no se duplica ACL por cada pago o línea de snapshot.

Una vinculación externa append-only evita actualizar encabezados o detalles de settlements existentes para hacer backfill. La falta de vinculación equivale a **sin autorización**, nunca a ámbito público/default. Los servicios futuros deben insertar raíz + vinculación + Audit en una transacción. El SQL no impone que toda raíz tenga vinculación mediante un trigger diferido: ese requisito queda explícitamente en el servicio, y todo lector debe hacer INNER JOIN autorizado. Esta asimetría permite cuarentena de historia existente.

## Divulgación selectiva

`cost_financial_disclosures` identifica un mandato emisor, un scope, un usuario destinatario y un request UUID. `cost_financial_disclosure_records` enumera UUID de registros ya existentes de ese mismo scope. Períodos y eventos se expanden a una lista concreta **al emitir**; no se guardan predicados, rangos dinámicos ni wildcards que incluyan futuros registros. Un conjunto de varios ámbitos requiere autorizaciones independientes de cada titular. El servicio no admite ampliar un grant existente: emitir otro grant, manteniendo el primero intacto.

Propuesta de contenido: un grant sobre gasto permite la proyección económica de ese gasto con sus pagos/asignaciones vigentes y los datos descriptivos indispensables. No incluye historial de correcciones, entidades party completas, Audit, notas ajenas, otros gastos o vuelos completos. Un grant sobre liquidación permite su snapshot económico inmutable y evidencia mínima revisada; no permite navegar a los registros fuente. Un grant sobre evento permite encabezado mínimo y solo los gastos enumerados explícitamente, sin totales del conjunto oculto. No seguir FK desde respuestas autorizadas como permiso implícito.

El payload `source_snapshot` de settlements no se expone en bruto: puede contener identidades, notas o información de otros ámbitos. Las fuentes operativas no adquieren permisos por aparecer como evidencia financiera. Se necesita una lista permitida de campos por proyección antes de implementar lecturas; hasta entonces no hay lectura de Costs. Propuesta pendiente: compartir un gasto abierto sigue su identidad y valores económicos vigentes (incluidas correcciones futuras); si se exige congelar lo divulgado al momento de emisión, hace falta una versión/proyección inmutable adicional y cambiar este borrador antes de aplicarlo.

`cost_financial_disclosure_revocations` agrega una revocación por grant. Solo el usuario emisor puede revocar ese grant por la ruta runtime, aunque haya perdido membresía o mandato. Esto materializa el «en cualquier momento» de D-304, sin darle lectura del archivo ni facultad de editar datos. Recuperación por fallecimiento/desactivación/cambio de representante requiere política de revisión privilegiada, no asumir ADMIN u OWNER. Usuario desactivado no puede usar la aplicación; la recuperación tampoco borra historial.

Dos grants superpuestos son independientes: revocar G1 no revoca G2. La interfaz futura debe informar esa semántica y permitir revocar todos los grants propios seleccionados, registrando cada revocación. El esquema no implementa denegaciones globales que prevalezcan sobre otras autorizaciones expresas.

## Matriz de autorización propuesta

Todos los caminos parten de sesión válida y usuario ACTIVE. Se revalida el permiso financiero por objeto y aeronave en cada petición. No se usa el flag para autorizar lecturas.

| Actor/credencial | Leer | Modificar economía OPEN | Divulgar | Revocar |
| --- | --- | --- | --- | --- |
| OWNER activo sin mandato financiero | No | No | No | Solo grants que él emitió antes |
| Mandato financiero vigente, sin membresía actual (titular anterior) | Su ámbito privado | No, por contrato OWNER activo vigente | Sí, su ámbito | Sus grants |
| Mandato vigente + OWNER activo de esa aeronave | Su ámbito | Sí, si editable + flag POSTGRES habilitado | Sí, su ámbito | Sus grants |
| PILOT/VIEWER con mandato explícito | Su ámbito | No | Sí, solo si la aprobación le confiere administración; confirmar política P1 | Sus grants |
| Destinatario con grant vigente | Solo objetos enumerados y proyección permitida | No | No, sin subdelegación | No sobre grant ajeno |
| Nuevo propietario legal, legacy ADMIN, party/pilot por sí solos | No | No | No | No |
| Revisor privilegiado | Procedimiento separado, autorizado y auditado | Solo procedimiento aprobado, no endpoint genérico | Provisiona mandatos según aprobación | Recuperación sujeta a política P1 |

El borrador modela un único mandato ADMIN, no un rol READ con alcance dinámico. READ se expresa con divulgaciones enumeradas. Lectura del archivo privado anterior y del destinatario sin membresía de aeronave es la recomendación P2: exigir membresía activa también allí impediría el caso del titular anterior tras transferencia. Los identificadores de aeronave no habilitan acceso operativo. Para mutaciones económicas se mantienen OWNER y membresía activa requeridos por Issue #8, además de mandato financiero.

Revocación y emisión son escrituras de autorizaciones: propuesta de usar también el flag Costs antes de abrir transacción para cualquier mutación runtime, incluida revocación. **Conflicto por resolver P2:** si se exige revocar aun con flag global apagado, definir una capacidad separada o una excepción revocation-only; no implementar una excepción unilateral. Aprovisionamiento privilegiado queda fuera del runtime y del helper.

## Revocación inmediata y transacciones

Todas las operaciones de divulgación, revocación y lectura financiera usan el mismo advisory lock transaccional por ámbito (`app-horas:cost-scope:<UUID>`), con ámbitos múltiples bloqueados en orden UUID. Para modificaciones económicas, adquirir primero el lock por aeronave (`app-horas:costs:<aircraft_id>`), después scopes y luego expense/event. El procedimiento privilegiado de revocación de mandatos también respeta esos locks.

Lecturas: transacción READ COMMITTED, no snapshot REPEATABLE READ reutilizado; adquirir el lock, **después** consultar autoridad/grants/revocaciones en otra sentencia y recién entonces consultar datos. Un grant efectivo exige destinatario exacto, emisor igual al usuario del mandato referenciado, mandato no revocado, grant no revocado, vínculo financiero válido y conjunto seleccionado. Los CHECK/FK no comprueban actividad, igualdad entre emisor y mandatario ni autoridad humana: lo hace el servicio dentro del lock. El borrador no es RLS; el rol runtime compartido sigue siendo de confianza y no identifica al usuario final en PostgreSQL.

Escrituras: SERIALIZABLE; flag antes de conectar; locks; revalidación del actor/mandato/membresía/estado; business state + Audit en el mismo cliente; commit. **Adquisición no bloqueante** mediante `pg_try_advisory_xact_lock`: si cualquier lock no está disponible, rollback y nueva transacción/snapshot antes de reintentar. Esperar un lock dentro de SERIALIZABLE y luego leer ACL podría reutilizar un snapshot anterior al commit de revocación; ese patrón se prohíbe. Aplicar la misma regla al lock por aeronave y a cada ámbito. Revocaciones idempotentes devuelven el registro existente si actor/grant/request coinciden. Reutilización de request con distinto payload => 409 sin efectos. Grants requieren conjunto no vacío; las FK no aseguran que el encabezado tenga al menos un target, por lo que se valida antes del commit.

Punto de orden: una consulta autorizada antes de la revocación puede terminar enviando su respuesta; una consulta que adquiere permiso después del commit de revocación se deniega. No es posible retirar bytes ya entregados. Sin caché de ACL entre peticiones, sin CDN pública, `Cache-Control: private, no-store`; paginación, búsquedas, totales, exportaciones y cada descarga vuelven a autorizar. Trabajos en cola revalidan al ejecutar y entregar; no reutilizan permiso del enqueue. No emitir URLs de descarga permanentes que eludan revocación. La respuesta externa para objeto inexistente/ajeno/no autorizado es un 404 genérico; logs internos restringidos mantienen causa sin contenido financiero innecesario.

## Transiciones de ámbitos y casos mixtos

| Situación | Recomendación (pendiente) | Alternativa / costo |
| --- | --- | --- |
| Transferencia aeronave A→B | Mantener ámbitos y grants anteriores; crear ámbito de B por aprobación explícita | Trasladar historia automáticamente contradice D-304 |
| Incorporación/retiro de copropietario | No conceder ACL por interés legal; ámbito nuevo o mandato aprobado | Archivo conjunto exige titular/representantes/consentimiento definidos |
| Gasto ingresado hoy por período anterior | Seleccionar ámbito anterior autorizado, conservar expense_date real; no inferir por fecha | Rechazar captura tardía perdería historia válida |
| Cambio de representante de organización | Mandato explícito nuevo y revocación del anterior; la party titular permanece | Vinculación automática por correo/cargo no admitida |
| Mover un registro entre ámbitos | Sin endpoint genérico; vínculo inmutable. Corrección excepcional revisada y nueva propuesta, nunca reasignar por transferencia | Tabla de revisiones de binding requiere contrato y controles adicionales |
| Nuevo evento/gastos con scopes distintos | Primera versión rechaza mezcla; dividir contenedores económicos por scope, conservando referencia operativa autorizada | Envelope compartido requiere permisos por hijo, consentimiento multiemisor y proyecciones sin totales ocultos |
| Historia existente con evento mixto | Cuarentena del evento/settlement; no inventar scope ni modificar snapshot | Publicación de proyecciones parciales requeriría un contrato adicional |
| Nueva liquidación de gastos multiscoped | Rechazar hasta aprobar modelo multiámbito; no cambiar D-302 uniqueness silenciosamente | Dividir por scope exigiría revisar índices originales evento/período/moneda de 007 |
| Liquidación existente | Binding externo tras revisión de todo su contenido; lectura de snapshot filtrada | No UPDATE de snapshot para clasificar o redactar |
| Sucesor | Mismo ámbito que la liquidación anterior y aprobación de fuente; grant del original no incluye sucesor | Compartir cadena automáticamente ampliaría alcance sin consentimiento |

Estas restricciones son propuestas para la siguiente implementación, no comportamientos instalados. La política elegida para eventos mixtos debe cerrarse antes de quitar el bloqueo SQL.

Conceptos/tipos: se incluyen en el registro financiero para no filtrar sus nombres por listas globales. Se conservan índices existentes de nombres únicos por aeronave: siguen siendo un contrato heredado, no unicidad por scope. El servicio no devuelve la fila conflictiva ni su titular. **P3 incluye decidir** si mantener catálogos compartidos explícitos o permitir nombres repetidos por scope; lo segundo necesita columnas/índices adicionales y revisión de este borrador. No fingir que un índice sobre una tabla puede filtrar por JOIN al registro financiero.

## Correcciones de detalles OPEN

Comparación: DELETE acotado elimina filas fuente y necesita otra representación histórica; un ledger completo de revisiones es más amplio que el gap; ACTIVE/RETIRED conserva filas y cambia solo metadatos de retiro. Se recomienda esta última opción, representando ACTIVE por `retired_at IS NULL`, con CHECK que exige metadatos de retiro completos. No se agrega un status redundante.

Cada corrección registra `cost_expense_corrections` con actor, reason, request UUID y `base_details_version`. `expenses.details_version` permite detectar un formulario obsoleto. En pagos/asignaciones, `created_correction_id` identifica la operación que creó la fila; `retired_correction_id`, `retired_at`, `retired_by_user_id` identifican el retiro. Valores originales, parties, expense_id y porcentajes no se reescriben. Filas existentes conservan `created_correction_id=NULL` como origen legacy honesto; no se inventa actor. El trigger exige batch para nuevas filas.

Pasos propuestos de `replace_open_details`:

1. Flag válido/habilitado, payload decimal exacto, UUID, request UUID y versión esperada; antes de conectar.
2. SERIALIZABLE; lock aeronave → scope → expense `FOR UPDATE`; actor ACTIVE + OWNER activo + mandato vigente del scope. Evento OPEN si existe; gasto OPEN y sin ninguna línea en `cost_settlement_expense_lines` (incluye períodos).
3. Comprobar idempotencia por request; mismo payload canónico y actor devuelve resultado previo, distinto => 409. El payload se compara con la evidencia normalizada del batch y las filas creadas/retiradas, no solo con un hash aportado por cliente. No aceptar UUID de fila fuera del gasto.
4. Exigir `expected_details_version = details_version`; registrar batch; incrementar versión con CAS; retirar filas afectadas primero; insertar nuevas filas positivas para reemplazos. Actualizaciones in-place/reversión de retiros se rechazan por grants y trigger.
5. Calcular solo filas `retired_at IS NULL`. Pagos en centavos exactos deben sumar importe; CUSTOM suma 100.0000%; DIRECT un responsable 100%; ownership histórico y utilización se derivan del servidor. No convertir faltantes a cero ni mezclar monedas. Repartir residuo por mayor resto con desempate por UUID; porcentaje derivado se expresa con cuatro decimales, evitando valores positivos inventados cuando redondea a cero. Cerrar esta regla con los cálculos completos de Issue #8 antes de implementar UTILIZATION.
6. Guardar `COST_EXPENSE_DETAILS_CORRECTED` USER/MANUAL con before/after, batch/request/actor, IDs retirados/creados, versión y motivo. Commit único. Si falla validación, trigger, Audit o serialización, rollback íntegro. No reintentar ciegamente un 40001; devolver 409 y recargar o retry idempotente de todo el comando.

Ejemplo 100.00: retirar pago A=50 y B=50, insertar A=100; activos suman 100, retirados siguen 50/50 como evidencia sin peso económico. CUSTOM A/B→DIRECT A: retirar ambas asignaciones, insertar A 100%; el UNIQUE parcial permite la nueva A sin borrar su fila anterior. Retirar todo sin reemplazar, dejando totales inválidos, revierte la operación. Múltiples pagos reales del mismo payer siguen permitidos, como en 006; solo asignaciones activas tienen unicidad expense/party.

El trigger invoker propuesto impide modificar detalles de gastos congelados y verifica versión/batch, con lock sobre el gasto. No autoriza al usuario ni valida totales cruzados o Audit. El servicio de settlement futuro debe adquirir el mismo lock antes de congelar evidencia, y toda mutación de encabezado, VOID, evento o vínculo debe comprobar congelamiento; no basta con estos triggers de detalles. Fuentes congeladas se corrigen mediante sucesor explícito con fuentes nuevas autorizadas, sin editar detalles históricos de la original. El contrato completo de sucesores permanece en la etapa posterior.

## Backfill fail-closed propuesto

No se consultó Neon, por lo que no se presupone que Costs esté vacío. La futura preparación deberá inventariar conteos y huérfanos con permiso read-only. El SQL no contiene DML de backfill ni crea ámbitos/grants por defecto. Metadatos nuevos de retiro quedan NULL, versión inicial 0; importes, parties y snapshots no cambian.

Si hay datos: construir un manifiesto revisable de UUID exactos → titular party → scope → evidencia humana de autorización. Auditar gastos, pagos, asignaciones y contenido completo de cada evento/settlement; no asignar titular por payer, responsable, creador, fecha, rol o propiedad actual. Revisar también referencias cruzadas por aeronave. Ambiguos/mixtos permanecen sin binding y sin acceso. Registrar el manifiesto aprobado con checksum fuera del runtime y conservar sus referencias en cada binding/mandato.

Luego de aprobación separada: insertar ámbitos/mandatos revisados y bindings con Audit en una transacción privilegiada, sin tocar snapshots. Verificar cobertura, exclusividad, FK y denegación del resto. No abrir grants históricos automáticamente; son otra acción expresa. Ante rollback no queda ningún permiso parcialmente creado. Datos con asociación financiera incorrecta no se «arreglan» otorgando acceso más amplio.

## Contratos de servicio para implementación posterior

Estos son nombres internos propuestos; no hay nuevos endpoints implementados. El routing futuro conserva `api/settings.js?resource=costs`. `actorUserId` se obtiene de la sesión firmada y nunca del body; aircraft/scope/record/party/recipient son UUID canónicos validados. Campos desconocidos se rechazan. El cliente no aporta `issued_by`, `retired_by`, timestamps, importes derivados ni privilegios. Los requests son UUID generados por el cliente para idempotencia, no credenciales.

| Operación | Entrada explícita | Salida | Validaciones adicionales |
| --- | --- | --- | --- |
| `readFinancialRecord` | actor, aircraft_id, financial_record_id | `{record, projection_version:1}` | Autoridad o target exacto vigente; proyección por tipo; no seguir relaciones ocultas |
| `listFinancialRecords` | actor, aircraft_id, scope opcional, cursor opaco, límite≤100 | `{records,next_cursor}` | Cursor no autoriza ni congela ACL; filtrar antes de contar/paginar; toda petición revalida |
| `issueFinancialDisclosure` | actor, aircraft_id, scope_id, authority_id, recipient_user_id, financial_record_ids[], reason, request_id | `{financial_disclosure_id, financial_record_ids, issued_at}` | Destinatario ACTIVE; emisor igual a usuario del mandato vigente; targets existentes, no vacíos, únicos y mismo scope/aircraft; conjuntos/períodos resueltos en la misma transacción; sin grant mutable |
| `revokeFinancialDisclosure` | actor, aircraft_id, disclosure_id, reason, request_id | `{financial_disclosure_id,revoked_at,already_revoked}` | Actor=emisor original; se usa grant para resolver scope bajo lock; no exige lectura del contenido; grants ajenos no se revelan |
| `replaceOpenExpenseDetails` | actor, aircraft_id, expense_id, expected_details_version, request_id, reason, payments[], allocations[] | `{expense_id,details_version,cost_expense_correction_id}` | Payload es el conjunto completo deseado; comparar con vigentes, no-op no crea batch/Audit; retirar vigentes reemplazados e insertar filas nuevas; método/importe/moneda vienen del gasto canónico; no cliente deriva ownership/utilization |
| `provisionFinancialScopeAndAuthority` | Manifiesto aprobado de scope/party/aircraft/user/basis/approval_reference | IDs nuevos y conciliación del manifiesto | Procedimiento privilegiado separado; sin auto-bootstrap runtime ni asociación por fechas/nombres |
| `revokeFinancialAuthority` | Mandato, actor revisor autorizado, motivo, aprobación | Revocación append-only | Procedimiento privilegiado con mismos locks; no simple botón OWNER |

Cada elemento payments incluye únicamente `payer_party_id` y `amount` decimal como string (máximo dos decimales); cada allocation manual incluye `party_id` y `allocation_percent` decimal como string (máximo cuatro), sin `allocated_amount` derivado. OWNERSHIP/UTILIZATION no aceptan allocations autoritativas del cliente; los reemplazos derivados requieren el cálculo servidor de la etapa siguiente. Se preservan todas las contribuciones reales y se valida el alcance aplicable de parties sin equipararlas a propietarios. El retiro que solo cambia pagos no invalida/recrea responsabilidad sin necesidad: se comparan conjuntos canónicos por tipo y se conservan filas sin cambio.

Errores propuestos: 400 payload/UUID/decimal inválido; 401 sin sesión; 404 recurso/ámbito ajeno o sin autorización (misma proyección externa); 403 para una acción no permitida sobre un recurso que el actor ya puede leer; 409 versión obsoleta/request conflict/congelamiento/serialización; 422 regla económica inválida; 503 capacidad de escritura deshabilitada; 500 configuración inválida o error interno sin datos sensibles. Los SQLSTATE del guard no se exponen como stack/raw SQL.

Audit propuesto: `COST_FINANCIAL_DISCLOSURE_ISSUED`, `COST_FINANCIAL_DISCLOSURE_REVOKED`, `COST_FINANCIAL_SCOPE_REGISTERED`, `COST_FINANCIAL_AUTHORITY_GRANTED`, `COST_FINANCIAL_AUTHORITY_REVOKED`, `COST_FINANCIAL_RECORD_BOUND`, `COST_EXPENSE_DETAILS_CORRECTED`. Runtime humano usa USER/MANUAL, actor y request UUID reales, siguiendo el esquema existente de audit_events. Backfill privilegiado debe declarar su procedencia verdadera según contrato de migración, sin inventar actor. Audit es inseparable de cada operación; la respuesta de replay no agrega Audit nuevo. Las lecturas no se anuncian como auditadas sin un contrato adicional.

## Incompatibilidades clasificadas

| Clasificación | Hallazgo / tratamiento |
| --- | --- |
| Contrato de negocio | D-304 fija principios, deja representantes, bootstrap, ámbitos mixtos y backfill pendientes; recomendaciones P1–P5 no son confirmadas |
| Código/esquema | 006/007 carecen de scopes/ACL y retiro de detalles; este borrador propone resolverlo sin reescribirlas |
| Contrato de negocio/esquema | Unicidad evento/período/moneda de 007 impide dividir liquidaciones originales por scope; no ampliar ese índice sin decisión |
| Dato | Conteos/atribución histórica no inspeccionados; no presumir base vacía ni inventar backfill |
| Validador/documentación | Catalog conserva entradas anteriores `utilization_basis`, PK/UNIQUE pre-007; seguir D-302/007 y pedir limpieza documental |
| Código | Ningún endpoint Costs consume aún el helper o las ACL; el borrador no protege endpoints no implementados ni el rol SQL contra código malicioso |
| Herramienta | Runner auto-descubre 008; bloqueo incondicional antes del DDL evita aplicarla accidentalmente, debe preservarse en esta revisión |
| Herramienta local | Al iniciar esta iteración faltaban dependencias (`pg`), fallando la carga de 11 archivos de tests; reinstalación del lockfile, sin cambios de versiones, permite repetir el baseline |

## Decisiones funcionales pendientes

- **P1 — titular y representación:** ámbito por party/aeronave; archivo de copropietarios; quién verifica/provisiona/revoca mandatos y recuperación; ADMIN financiero separado de OWNER operativo; efecto de revocar representante en grants ya emitidos.
- **P2 — acceso tras transferencia y revocación:** permitir lecturas/divulgación del titular anterior y receptor sin membresía; cómo garantizar revocación con flag apagado; gestión de cuentas desactivadas.
- **P3 — ámbitos mixtos/catálogos/transiciones:** primera versión monoscope con cuarentena de mixtos versus envelopes/proyecciones multiámbito; unicidad de nombres; corrección excepcional de bindings equivocados.
- **P4 — contenido divulgado:** gasto abierto vivo versus versión congelada, proyección permitida de evidencia, metadatos y exportaciones; grants superpuestos independientes.
- **P5 — backfill:** aprobar titular y evidencia de cada conjunto concreto; ninguna asignación automática por propiedad actual. Aprobar también lifecycle de retiro y protocolo de correcciones antes de aplicarlo.

No hace falta que el usuario apruebe este documento durante su elaboración. ChatGPT debe revisar este contrato y cerrar P1–P5 antes de autorizar la siguiente etapa. El Issue #8 permanece abierto.

## Verificaciones realizadas en esta iteración

- HEAD/rama/status confirmados al inicio: `caa40cb4b963675b195a5f622d62134dbc5d3e3d`, rama autorizada, limpio. Sin cambios en archivos ya versionados del checkpoint.
- El primer `npm test` falló por dependencias ausentes, con 37 casos aprobados y 11 archivos sin cargar. Tras `npm ci` usando lockfile: **176/176 aprobados**, cero fallos. No se alteraron dependencias/lockfile. npm mantiene el reporte previo de 13 vulnerabilidades.
- `npm run lint`: PASS. `git diff --check` para archivos versionados: PASS; comprobar también whitespace de archivos nuevos al generar el diff de revisión.
- Comprobación estática por lectura: ocho CREATE TABLE, seis CREATE INDEX explícitos, dos triggers, una función SECURITY INVOKER; bloqueo previo al primer DDL, sin DML de backfill, sin DELETE grant ni modificación SQL de snapshots. Nombres explícitos dentro del límite de 63 caracteres; enlaces relativos existentes.
- Hashes exactos de migrations 006/007 iguales al checkpoint. No se añadieron pruebas de comportamiento para servicios aún no implementados; la matriz U/I es trabajo futuro.
- No hay parser PostgreSQL ni `psql` local disponible. La revisión estática no demuestra compilación del SQL, integridad sobre datos reales, permisos efectivos ni comportamiento concurrente. Ningún SQL del borrador fue enviado a una base de datos.
- No se repitió build: solo se añadieron documentos y un SQL no consumido por Vite. No hubo cambios de aplicación. Sin commit, staging, push ni cambios desplegados.
