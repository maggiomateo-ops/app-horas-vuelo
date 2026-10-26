> Preparación vigente de permisos, purga y concurrencia: [hours-v2-preflight-preparation.md](hours-v2-preflight-preparation.md). SQL fuera del runner; no ejecutado ni desplegado.

> Revisión vigente F2/F4/F6: [contrato técnico](hours-v2-technical-closure.md). Sustituye precisión preliminar en décimas para referencias/diferencias por segundos exactos y política sin tolerancia. SQL no ejecutado.

# Horas V2 — revisión de arquitectura, NO aprobado para migrar

Esta revisión sustituye la propuesta arquitectónica del commit `8577d7324cf5f41c54bd555dbdafce2c9f02c758`, sin cambiar el prototipo ni el runtime V1. Base local/remota verificada; árbol inicial limpio. Rama: `codex/hours-v2-contract-review`.

**SQL no ejecutado, fuera del runner. Ningún cambio en Neon, LV-MHZ, LV-SIM, main, Production, variables, flags, grants o Costs. Tests no equivalen a aprobación funcional, preflight SQL o aceptación autenticada.**

## 1. Preflight documental y semántica vigente

Se releyeron los dos Sheets canónicos y D-307 mediante el conector. D-307 confirma la elección explícita CURRENT_REFERENCE/HISTORICAL_IMPORT, desconocidos NULL, fechas por instalación y separación de conceptos; **no aprueba persistencia, matemática, permisos o migración**. No se escribió en los Sheets en esta revisión ni se marcó otro contrato CONFIRMED.

Se revisaron `db/migrations/001_initial_schema.sql`, 003, 005 y el runner; Flight Record repository, Tracking/read models y las propuestas previas. En este checkout el runner contiene 001–007; eso **no prueba** el ledger instalado en TEST ni autoriza modificar otros bloques. Se realizaron únicamente SELECT de metadatos de columnas/claves/índices/permisos en Neon TEST, sin consultar registros de aeronaves ni alterar datos. La migración final necesita lectura independiente del ledger después de aprobación funcional.

La lectura real (rol app_horas_runtime, proyecto red-pine-78283204, rama br-billowing-band-b62jj1ab) confirmó PK/FK de las ocho tablas canónicas relevantes: revisiones con UNIQUE(flight_id,flight_revision_id), current_revision_id con FK DEFERRABLE, installed_on nullable bajo 003, baseline_effective_date no nullable con baseline_tis_hours nullable, bordes de baseline/ajustes y metadata de importación/Audit. Evidencia de metadatos en `hours-v2-review/schema-readonly.json`; no equivale a ejecutar la propuesta. El ledger instalado no se inspeccionó ni se modificó.

Contratos que se preservan:

- D-059: opening TIS neutral; TSN/TSO nuevos requieren versión explícita. No cambiar etiquetas de datos V1 como si siempre hubieran representado TSN/TSO.
- D-111/127/129: raíz de vuelo estable, current_revision_id con FK compuesta, snapshots/revisiones inmutables; VOID no borra historia.
- D-138: batch UPLOADED/INVALID/READY/COMMITTED/FAILED e issues. El hash único COMMITTED por aeronave impide reincorporar el mismo archivo; batch+row identifica procedencia operativa.
- D-185/207: posiciones, no superposición, instalación histórica con fecha desconocida genuina. Nueva instalación normal exige su fecha propia; no usar la fecha del primer vuelo como reemplazo.
- D-187: baseline_effective_date + primer vuelo incluido cuando se conoce. D-188: ajustes con fecha y optional after_flight_id. **Se corrige la propuesta anterior que privilegiaba un instante arbitrario como borde.**
- D-203: acumulados de revisiones actuales ACTIVE + baseline/ajustes aplicables. D-125 permite baseline desconocido sin invalidar la configuración técnica; D-290 mantiene seguimiento relativo confiable sin exigir absoluto conocido.

Se detecta además una brecha de integración: `calculateUtilizationSnapshot` V1 suma deltas faltantes con `?? 0` y su agregación de ajustes por fecha no cubre toda la semántica de orden intradía de D-188. V2 debe detectar esos faltantes/órdenes antes de derivar resultados; este bloque no modifica el read model aceptado ni declara corregida esa brecha.

## 2. Estados y transición sin interrupción V1

Separar tres ejes: aircraft ACTIVE/ARCHIVED; técnica PENDING/COMPLETE derivada; plan/reconciliación independiente. El plan versionado conserva DRAFT → REFERENCES_PENDING o IMPORT_VALIDATION_PENDING → RECONCILIATION_PENDING → COMPLETE/CANCELLED. Una importación posterior es un candidato nuevo sobre la misma aeronave, no una recreación ni un cambio automático de aceptación.

La aceptación operativa es una cadena explícita independiente del plan candidato. Un candidato pendiente no sustituye resultados aceptados. Si se detecta que cambió un input histórico aceptado, el resultado queda desactualizado: mostrar snapshot histórico identificado, suspender el absoluto/aviso afectado y requerir nueva conciliación; la configuración técnica no se vuelve falsa por ello.

### Despliegue V1 → V2 propuesto

1. Mantener las ramas/bundles V1 funcionales. El prototipo de esta rama está aislado: **no promover sus pantallas con guardado bloqueado como sustituto de V1**.
2. Aprobar contrato y esquema; después preflight aislado, aplicación expresamente autorizada e implementación backend V2 aditiva/versionada. No cambiar silenciosamente el POST V1 ni inventar un modo para clientes antiguos.
3. Backend anuncia contratos soportados. UI V2 solo se muestra cuando el backend declara V2 disponible para ese cohort/Preview y aeronave; de lo contrario conserva UI/DTO V1. No descartar campos V2 mediante whitelist V1.
4. Alta V2 exige modo. En CURRENT_REFERENCE crea plan REFERENCES_PENDING; en HISTORICAL_IMPORT crea IMPORT_VALIDATION_PENDING. La baseline no recibe fecha ficticia: se difiere hasta evidencia aceptada. Los baseline V1 existentes se siguen leyendo con su semántica original, sin backfill de TSN/TSO.
5. Datos generales ofrece el mismo plan a aeronaves existentes; nueva importación no obliga a reconfigurar motor/ownership. La adopción de referencias V1 requiere revisión explícita, no una declaración automática de COMPLETE.
6. Canary y migración de cohort solo tras autorización independiente. Nunca activar V2 porque compile. Rollback de interfaz vuelve a V1 compatible; no elimina historia ni migra contadores a la inversa.

El prototipo actual se conserva: elección obligatoria sin inferir por vacíos, preparación local para aeronaves existentes, fechas independientes por motor/hélice, TSN/TSO vacíos y guardado bloqueado. No se modifican src/, api/, flags o permisos en esta revisión. El helper `proposedHoursReadiness` anterior es una alternativa conservadora no conectada a runtime; la política operativa definitiva sigue requiriendo aprobación funcional (F5).

## 3. SQL revisado y alcance de sus garantías

Archivos: `proposals/hours-start/schema.sql` y `rollback.sql`. **No son una migración registrada ni SQL preflight-tested**. Se proponen 20 tablas y tres claves candidatas de soporte en tablas existentes, sin grants/backfill/funciones. El aumento frente a las 10 tablas previas responde a staging no operativo, lineage, snapshots por run, episodios e invalidaciones explícitas. La cantidad/superficie final también debe revisarse antes de autorizar DDL.

### Correcciones principales

- PK de `flight_component_utilization_attributions` = **(reconciliation_run_id, flight_revision_id, component_installation_id, usage_basis)**. Dos runs del mismo vuelo/componente/base son válidos; duplicar esa atribución dentro de un run falla. Los snapshots anteriores no se editan. Repetir exactamente el mismo manifest/algoritmo/política para una misma revisión del plan reutiliza el run idempotente; nueva evidencia, revisión de plan, algoritmo o política permite otro run sobre los mismos vuelos.
- `hours_candidate_component_attributions` hace lo mismo para staged_row_id, sin generar revisiones operativas para poder previsualizar.
- Claves de soporte propuestas: flight_records(aircraft_id,flight_id), component_installations(aircraft_id,installation_id,component_id), flight_import_batches(aircraft_id,import_batch_id). Son índices/constraints nuevos en tablas existentes, requieren evaluación de locks/costo y rollback; no se ejecutaron aquí.
- Las referencias y estados nuevos incluyen scope de aeronave y FK compuestas. El campo aircraft_id repetido como ancla de seguridad no es un total ni una segunda identidad; su coherencia se restringe por FK.
- Episodios de overhaul separados (`hours_component_overhaul_episodes`), con evidencia y componente físico. La instalación de contexto permite comprobar acceso/scope: **no implica que el overhaul ocurrió durante esa instalación**. TSO conocido requiere episodio, incluso si es cero; SINCE_NEW_DECLARED también debe ser declaración documentada.
- Confirmación enlaza por FK a un run confirmable=true, con hash de petición y request_id único. Un run VALIDATED no es sinónimo de confirmable: tiene que existir política aprobada, cero bloqueos y revisión expresa.
- Cadena sucesora: primer nodo secuencia 1 sin predecesor; después n=predecessor_sequence+1, misma aeronave, predecesor existente; UNIQUE(aircraft,sequence), UNIQUE(supersedes_acceptance_id) y run único evitan raíces/forks/reutilizaciones aceptadas.
- `hours_acceptance_invalidations` registra invalidación append-only. Audit conserva quién/cuándo/por qué, separado del estado de negocio.

### Matriz completa de scope y FK

| Tabla/sujeto | Restricción SQL propuesta | Validación adicional |
| --- | --- | --- |
| Plan/revisión | FK (aircraft,plan); revisión única por plan | siguiente revisión bajo lock, estado permitido y motivo |
| Episodio overhaul | FK (aircraft,context_installation,component) | fuente confiable, orden/continuidad del episodio; fecha de contexto no es fecha de overhaul |
| Mapeo/campos | FK (aircraft,batch); campos pertenecen a mapping_version | hash de archivo igual al del batch, columnas/transformaciones permitidas y lookup de identidad explícito |
| Staged row | FK (aircraft,mapping); posición de hoja/fila única | parser/calendario real, formato original, fidelidad a archivo y política de privacidad |
| Referencia | FK (aircraft,plan), instalación+componente, episodio del mismo componente; FK (aircraft,boundary_flight) + (flight,revision) | borde/fecha coincide con vuelo, métrica/base compatibles, alcance temporal válido, credibilidad de lectura |
| Run | FK (aircraft,plan,revision), batch de esa aeronave | batch y mapping seleccionados consistentes; fingerprint exhaustivo y algoritmo/política inmutables |
| Vuelos del run | FK misma aeronave+vuelo y pareja vuelo+revisión; solo una revisión por vuelo/run | current_revision/status/date vigentes al validar/confirmar |
| Instalaciones del run | FK aeronave+instalación+componente | snapshot fiel de posición/tipo/fechas y bordes, no superposición |
| Staged rows del run | FK run y candidato de misma aeronave; matched flight/revision del mismo avión | candidato pertenece al batch/mapeo declarado por ese run; resolución de duplicado verificada |
| Referencias del run | FK misma aeronave **y plan** tanto en run como referencia | confianza, validez de evidencia y selección completa |
| Atribuciones operativas | FK vuelo/revisión seleccionado en ese run + instalación snapshot de ese mismo run | aplicabilidad temporal, base, episodio; no atribuir automáticamente por componentes actuales |
| Atribuciones candidatas | FK staged row e instalación de ese run | ningún candidato operativo aún; resolución de ambigüedad explícita |
| Diferencias | FK referencia seleccionada en ese run; MATCH requiere diferencia=0; desconocidos sin número fabricado | fórmula y comparación contra observación verdaderas; límites y reconocimiento de discrepancias |
| Issues | FK run; si tiene staged row debe ser del mismo run | sanitizar mensajes, no copiar PII/raw rows; cualquier bloqueo impide confirmar |
| Confirmación | FK run confirmable, un registro/run, request_id único | mismo actor/scope/payload para replay; comprobar nuevamente OWNER e inputs actuales |
| Committed row link | FK confirmación y staged row del run; FK vuelo/revisión de esa aeronave; staged row única | disposición INCLUDE, raíz IMPORT del batch correcto, índices de procedencia verdaderos |
| Aceptación | FK confirmación, predecesor misma aeronave y secuencia consecutiva, no fork | comprobar head esperado y vigencia bajo lock; aceptar no lo elige el cliente por sí solo |
| Invalidación | FK aceptación de esa aeronave y secuencia | detectar todas las mutaciones relevantes y registrar con su Audit atómico |

FK compuesta con columnas opcionales usa CHECK para impedir parejas parcialmente NULL (referencia a vuelo o componente). MATCH SIMPLE no se usa como sustituto de esa comprobación. Los usuarios/parties/personas canónicos no se vuelven autorizados por una FK: permiso y elegibilidad temporal son invariantes del servicio.

### Lo que SQL NO garantiza por sí solo

No puede demostrar que una fecha pertenece a una revisión, que una revisión sigue siendo actual, que no hubo phantom retroactivo, que no hubo overhaul entre referencias, que la suma es correcta, que los warnings fueron revisados ni que el usuario sigue siendo OWNER. No se implementaron triggers/funciones para esos checks. Los nuevos snapshots necesitan privilegios append-only aprobados y verificados; el comentario «inmutable» no equivale a enforcement instalado. No se heredan permisos de una future default privilege ni se ofrece un endpoint genérico de inserción.

## 4. Staging y trazabilidad sin vuelos operativos

Representación anterior a confirmación:

- flight_import_batches ya posee nombre, SHA-256 de archivo, storage key y expiración. Sus estados/diagnósticos no son Flight Records.
- `hours_import_mapping_versions` + `hours_import_mapping_fields` congelan parser, hash, hoja/columna, field code y transformación controlada. Re-mapping crea otra versión; no edita un mapping usado.
- `hours_import_staged_rows` conserva UUID de candidato, hoja, fila original, hash de fila, clave externa si existe y hechos normalizados nullable. MONTH/YEAR/UNKNOWN conservan precisión y texto de fecha original, con flight_date NULL; no se convierten al primer día de un mes/año.
- Cada run selecciona candidatos con INCLUDE, EXCLUDE_VERIFIED_DUPLICATE o REQUIRES_REVIEW. Sus issues/diferencias/atribuciones se congelan por run. Exclusión por duplicado exige vínculo a vuelo/revisión verificables; parecido de fecha/ruta/piloto no autoriza merge.
- El parser no crea flight_id/current_revision_id ni hijos operativos. No utiliza raíces VOIDED como «staging»: eso también sería historia operativa real antes de confirmar.
- Solo dentro de la confirmación transaccional se generan raíces IMPORT y rev1/hijos para INCLUDE. `hours_import_committed_rows` vincula candidato → vuelo/revisión creada → confirmación. La procedencia antigua batch+row sigue siendo obligatoria.

**Hoja/fila vs import_row_number:** dado que el esquema V1 hace único (batch,import_row_number) sin hoja, V2 asigna un ordinal estable de incorporación por batch y conserva hoja/fila originales en staging/lineage. El ordinal se congela sobre el archivo completo (también filas excluidas), con orden de hoja/fila documentado en el mapeo; nunca se renumeran solo los INCLUDE ni se usa UUID aleatorio para fingir orden temporal. Ese ordinal no es el número de fila XLSX cuando hay varias hojas; no se reinterpretan imports anteriores.

Cadena de trazabilidad: archivo SHA/nombre/batch → mapping_version/parser/columnas → staged_row_id/hoja/fila/hash → run/input hash/policy/algorithm → instalación/componente/episodio/referencias → confirmación/request hash → flight_id/revision_id/Audit → aceptación/sucesoras. Después de expirar el archivo, permanecen hashes y evidencia permitida, no una URL pública ni copias de PII en Audit.

**Múltiples conciliaciones:** run R1 y R2 pueden referenciar la misma rev1/instalación/TIS con resultados/evidencias distintos. Cada uno conserva sus propias atribuciones. Un run solo de conciliación puede reutilizar batch/mapping ya COMMITTED; no crea otro batch COMMITTED con el mismo hash ni vuelve a incorporar sus filas. Una eventual recarga temporal de bytes idénticos debe verificar SHA y resolver a esa procedencia existente, sin sobrescribir el archivo/mapeo aceptado. Un committed batch no se vuelve a incorporar como nuevos vuelos para conciliar: se usan sus raíces actuales y la lineage original.

## 5. Reglas TSN/TSO y ejemplos verificables

Ejemplos en `proposals/hours-start/accounting-examples.mjs` y tests en `test/hours-v2-contract-review.test.js`. Son modelos offline, no autoridad de runtime. Los booleanos current/applicable/coverageKnown son precondiciones de fixture; aún no existe un resolver de períodos V2 implementado.

| Caso | Datos documentados | Resultado propuesto y bloqueo |
| --- | --- | --- |
| Al instalar vs al iniciar | Motor instala TSN 1200.0 / TSO 100.0. Entre instalación y seguimiento hay 30.0 de runtime íntegramente atribuible | Referencia seguimiento 1230.0 / 130.0. Luego 2.0 → 1232.0 / 132.0. Si faltan esas 30.0, no se deriva la lectura de seguimiento desde la de instalación |
| Casco vs motor | Casco TIS 2000.0 + vuelo TIS 1.0. Motor TSN referencia 1230.0 con runtime 1.3 | Casco 2001.0; motor 1231.3 si su TSN usa runtime. Nunca sustituir 1.3 por 1.0, Flight Time o tach sin contrato de base compatible |
| Reemplazo | Motor viejo 500.0 +2.0 =502.0. Nuevo motor trae lectura 10.0 y opera 3.0 | Nuevo 13.0; no 505.0. Hélice vieja 800.0+2.0=802.0; nueva 20.0+3.0=23.0. El casco continúa independiente |
| Overhaul posterior | TSN 1000.0/TSO 100.0; +10.0 antes de recorrida. Nueva lectura TSO 0.0 declarada con episodio overhaul-2; +5.0 después | TSN 1015.0; TSO nuevo 5.0. TSO anterior no se mezcla con el nuevo episodio. Si no hay nueva lectura/episodio confiable, TSO derivado queda NULL, no cero |
| Solapamiento | Referencia 100.0 ya incluye vuelo conocido f1; archivo vuelve a traer f1 y otro vuelo nuevo +2.0 | f1 verificado se excluye; resultado 102.0, no sumar f1 otra vez. Coincidencia solo semántica → REQUIRES_REVIEW |
| Fecha incompleta | Registro «2020-05», TIS 2.0; instalación cambió en ese período | Staging MONTH, flight_date NULL, sin atribución confirmable. No inventar día ni aplicar componente actual |
| Contador desconocido | TSN referencia NULL con delta conocido 2.0 | Absoluto NULL; delta 2.0 es solo utilización relativa. Si lectura explícita es 0.0, entonces 0.0+2.0=2.0 |
| Delta desconocido | Lectura 100.0; un vuelo tiene TIS/runtime NULL | Absoluto pendiente/NULL, no 100.0 ni sumar los demás como si faltante fuera cero |
| Corrección/VOID | R1 validó rev1 ACTIVE; aparece rev2 o raíz VOIDED | R1 se conserva e invalida para uso vivo. R2 revalida con rev2/estado actual; sin UPDATE de snapshots R1 |

Reglas adicionales:

- TSN del componente físico no se reinicia al reinstalar ni al hacer overhaul; acumulación entre instalaciones solo con toda la cobertura compatible y acceso/evidencia válidos. No mezclar motores por posición «Motor 1».
- TSO depende de un episodio de overhaul o since-new expresamente declarado. No inferir episodio por nombre/serie, fecha de instalación, TSN=0 o dato vacío.
- Baseline V1 `opening_tis_hours` no prueba TSN/TSO al instalar. No trasladarlo automáticamente a ninguna lectura nueva.
- TIS, runtime, Flight Time y horas declaradas se distinguen por base. DECLARED_ONLY permite mostrar la observación con procedencia; no autoriza interpolación por vuelos.
- Atribución necesita instalación aplicable por fecha/borde real y período completo. Cada componente puede recibir el TIS íntegro de un vuelo compatible; no dividirlo por N motores. Cambio intradía/intravuelo ambiguo sigue pendiente, sin prorrateo automático.
- DATE_START incluye los vuelos de esa fecha; BEFORE_FLIGHT incluye el vuelo identificado y los posteriores; AFTER_FLIGHT excluye ese vuelo y empieza después. Preservar orden canónico existente y comprobar que el vuelo está en la fecha/avión indicado. Con evidencia de precisión insuficiente no se sustituye por un instante arbitrario.
- Ajustes D-188 son evidencia explícita con razón y borde; no sirven para «tapar» una discrepancia por redondeo ni un vuelo faltante. Cada adjustment_id se incluye una sola vez en el input manifest; BEFORE-date o AFTER-flight determinan su posición. Su inclusión en TSN/TSO requiere que scope/base/episodio sean compatibles, nunca copiar ajustes del casco a todos los motores.

## 6. Criterios concretos de aceptación — propuesta, no aprobación

La política candidata es **coincidencia exacta en segundos normalizados sin pérdida de precisión de fuente**; FT/TIS canónicos siguen en décimas por vuelo según D-024/D-098. Se propone tolerancia 0 segundos, pero **no se declara aprobada ni se activa por defecto**. Sin policy_version, referencia de aprobación funcional y tolerancia explícita, confirmable=false incluso con diferencia cero. Los tests usan una policy fixture identificada como NO FUNCTIONAL APPROVAL.

Para confirmar deben cumplirse simultáneamente:

1. Aircraft scope y OWNER ACTIVE válidos, gate/UUID/environment correctos.
2. Estructura/mapeo/identidades controladas; fechas/períodos y atribuciones de todos los INCLUDE resolubles.
3. Archivo/row hashes, revisiones, estados, instalaciones, episodios, referencias, ajustes y política/algoritmo verificados y sin cambios desde preview.
4. Sin ERROR, REQUIRES_REVIEW, tramo desconocido o atribución ambigua. Un warning revisable requiere reconocimiento explícito; no puede encubrir un bloqueo de integridad.
5. Cada comparación presenta observación, derivado, diferencia con signo, base, borde, cobertura y fuente. NULL se muestra como desconocido; no como diferencia 0.0.
6. Reconocimiento de la preview exacta y petición de confirmación explícita. No se admiten tolerancias positivas en este contrato ni mediante reconocimiento individual. El redondeo documentado clasifica una diferencia y no la convierte en coincidencia; ver hours-reconcile-exact-v2.1.
7. Referencias aceptadas no se corrigen automáticamente para lograr igualdad. Resolver una discrepancia requiere evidencia nueva o ajuste explícito aprobado; entonces se genera otra validación/run.

D-029 permite Flight Records históricos con campos NULL; no se elimina esa posibilidad canónica. Para la incorporación V2 que habilita conciliación operativa se propone dejar el lote pendiente si un INCLUDE tiene fecha/período sin resolver. Una variante de admisión archival-only de registros con fecha incompleta requiere aprobación funcional y estado/lectura propios antes de implementarse. No se confunde archivo de evidencia con vuelo operativo.

Se propone confirmación integral por archivo/lote: no importar silenciosamente la parte válida de un archivo con filas pendientes, porque la unicidad COMMITTED del hash V1 impediría completar luego el mismo archivo sin otro contrato. Un flujo de subconjuntos necesitaría diseño y aprobación específicos. Duplicados verificados explícitamente excluidos permanecen en la evidencia del lote.

## 7. Confirmación, sucesoras, idempotencia y concurrencia

**SQL** impide asociación cruzada, fork/secuencia inválida y duplicar una confirmación/run o clave request_id. No implementa el flujo siguiente por sí solo.

Transacción futura, después de aprobación:

1. Verificar autorización antes de revelar resultados/idempotency keys; obtener lock de aeronave con el mismo protocolo que todos los mutadores de vuelos/instalaciones/referencias. SERIALIZABLE; head de aceptación esperado bajo lock. Sin protocolo compartido completo, gate cerrado.
2. Buscar request_id. Mismo actor autorizado, aircraft, run y request_payload_sha256 → devolver mismo resultado; no insertar Audit ni filas otra vez. Mismo ID con otro actor/payload/scope → conflicto sin escrituras. Autorización se revalida también en replay.
3. Otra clave para un run ya confirmado → 409 ALREADY_CONFIRMED; no una segunda aceptación ni otra incorporación.
4. Releer el conjunto completo de datos pertinente, no solo los IDs seleccionados: detectar nuevas raíces retroactivas/fechas desconocidas y cambios de current revision/status, instalaciones, episodios, ajustes y referencias. Recomputar fingerprint/policy y confirmar que el head es el esperado.
5. Validar nuevamente criterios. Insertar raíces/revisiones/hijos IMPORT solo para candidatos INCLUDE, lineage, confirmación, aceptación n+1 y eventos Audit en una sola transacción. La FK circular de Flight Records es DEFERRABLE como ya define V1. Los pasos internos son invisibles hasta commit.
6. Ante cualquier fallo, ROLLBACK. Retry de serialization failure reinicia **toda** la validación; no reusa una preview desactualizada para forzar commit. El estado FAILED del upload, si procede, se registra después del abort mediante flujo propio, nunca deja vuelos parciales.

El input_sha256 se calcula con serialización canónica UTF-8 y orden estable de conjuntos por identidad: archivo SHA, mapeo/parser, candidatos/hoja/fila/hash, revisiones+estado, instalaciones/bordes, episodios, referencias, ajustes y algoritmo/política. NULL y cero son distintos. No incluye request_id, run_id, signed URL ni timestamp de ejecución. Una fuente expirada bloquea confirmación por una comprobación viva adicional, no por manipular el hash.

Una operación de corrección/VOID/retroactivo o cambio de instalación/episodio/referencia que afecta un resultado aceptado agrega invalidación de negocio (idempotente por aceptación/request_id/motivo) + su Audit en la transacción correspondiente. Detectar además por read-check un input discrepante aunque falte el evento impide mostrar un total vivo falso. Los snapshots anteriores y raíces importadas no se borran para «reconciliar de nuevo».

`accounting-examples.mjs` comprueba modelos de replay/head y fingerprint, **no prueba concurrencia PostgreSQL ni FK instaladas**. Los tests SQL actuales son inspección estructural de DDL/rollback; preflight real permanece pendiente.

## 8. OWNER, gates, XLSX y expiración propuestos

- Mínimo: usuario canónico ACTIVE + membresía OWNER ACTIVE de la aeronave para staging, validar, confirmar o modificar plan. Lecturas operativas conservan reglas existentes; el XLSX fuente no se vuelve accesible a PILOT/VIEWER ni a otra aeronave. No usar ADMIN legacy ni MANAGE_OWNERSHIP para inferir permiso de conciliación.
- Gates nuevos propuestos, **no creados/configurados**: POSTGRES_HOURS_V2_WRITES_ENABLED explícito y POSTGRES_HOURS_V2_CANARY_AIRCRAFT_ID UUID exacto. Exigir Preview y fuentes PostgreSQL TEST verificadas; fail closed ante ausencia/error. El guard existente setup-configuration sigue independiente; habilitarlo no habilita importación ni Horas V2.
- Target UUID validado en servidor en cada operación, upload/download/polling, no solo en UI. Contenido de payload, filename, matrícula/email o mapping no concede scope. El cliente no puede fijar tolerancia, actor, confirmable o acceptance_sequence.
- Fuente XLSX en object storage privado y cifrado; parser aislado con límites, sin ejecutar fórmulas/macros/links externos/URLs del archivo. Proponer máximo 10 MiB, 10 000 filas y 20 hojas, con límites de descompresión para zip bombs; valores sujetos a aprobación F6, no implementados aquí.
- Expiración propuesta: objeto fuente 24 h tras upload; enlaces firmados de descarga 60 s tras revalidar OWNER/scope. Token vinculado al objeto/operación, nunca URL pública permanente. Expirado: no confirmar ni reintentar parse por fallback a otro archivo; nueva carga y revalidación explícitas.
- Hashes, versiones y evidencia normalizada necesaria conservan trazabilidad aunque expire el objeto. No copiar raw rows/PII a issues, logs o Audit. Retención/base de legitimación de candidatos normalizados cancelados y evidencia personal necesita aprobación F6; no se implementa purge ni DELETE de historia para resolverla.
- Datos de negocio (estado del plan, issues y aceptación) viven en tablas propias. Audit contiene actor, request_id, hashes e IDs y acción, no sustituye al estado ni guarda archivo completo. Todo evento material atómico; snapshots append-only sin UPDATE/DELETE runtime. Política exacta de grants/default privileges debe revisarse antes de aplicar; no se instala en este bloque.

## 9. Decisiones que requieren aprobación funcional ANTES de preflight

Ver `hours-v2-open-decisions.md`: F1 bordes/fechas incompletas, F2 base/precisión TSN/TSO, F3 episodios/lecturas overhaul, F4 criterios y tolerancia, F5 continuidad relativa/V1, F6 límites/storage/retención, F7 OWNER/gates y F8 transición/admisión integral. El archivo enumera recomendación, efecto y pregunta exacta a aprobar. **Ninguna queda aprobada por este informe o por tests.**

## 10. Preflight/rollback preparado, no ejecutado

1. Cerrar funcionalmente F1–F8; revisar DDL y contratos en ambos Sheets sin presentar SQL propuesto como confirmado. Este bloque deja D-307 intacta. Elegir número de migración después de inspección autorizada del ledger, sin tocar Costs.
2. Tras autorización adicional, crear rama TEST descartable para preflight; verificar rol/proyecto/branch/checksums. Medir locks/indexes de las tres UNIQUE nuevas. Nunca usar LV-MHZ/LV-SIM ni TEST padre como fixtures de escritura.
3. BEGIN → ejecutar DDL aprobada → fixtures sintéticos → asserts positivos/negativos: múltiples runs sobre misma revisión/instalación; cross-aircraft en todas las familias; staging sin raíces operativas; NULL pares; source ordinal multih hoja; confirmable false; request ID duplicado; sucesoras/forks/carreras; snapshots append-only y Audit. Forzar fallo → ROLLBACK.
4. Verificación independiente: no tablas/constraints nuevas, ledger y grants originales, datos sin cambios. Tests de servicio real deben probar todos los invariantes no expresables por SQL bajo SERIALIZABLE y concurrencia. Esta revisión no ejecuta ese preflight ni afirma syntax/FK/runtime PASS.
5. `rollback.sql` revierte en orden inverso las 20 tablas y las tres constraints **solo en rama descartable vacía**. No CASCADE. Rollback normal es de la transacción entera. Con datos confirmados, no usar teardown: recuperación/forward migration aprobada y correcciones append-only.
6. Solo después de aprobación de esquema, permiso persistente, aplicación autorizada y backend V2 completo se revisa Preview autenticado y se solicita un canary por UUID. No confirmar LV-SIM con el contrato temporal actual ni cambiar flags como parte de este cierre.

## Evidencia y alcance del commit

Cambios únicamente en documentación, SQL propuesto y tests/modelos offline. Prototipo seguro preservado, sin cambios en src/api/migrations. Los tests anteriores siguen cubriendo que campos no soportados no emiten fetch. Las nuevas pruebas cubren ejemplos numéricos, varias conciliaciones, scope, staging, replay/head, invalidación, política explícita y teardown completo. Resultados finales en `hours-v2-review/tests-summary.txt` y `validation.md`.

No se declara contrato aprobado, SQL validado mediante ejecución, deployment READY ni aceptación autenticada por compilar o pasar tests.
