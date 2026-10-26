# Inicio de seguimiento e importación histórica — arquitectura y prototipo

Fecha: 2026-10-26. Base verificada local/remota `eea761bc52b141a734f1f3b6b41fbe2f0732b6fe` de `codex/settings-v2-preview`. Rama segura: `codex/hours-start-contract`. Árbol inicial limpio.

**D-307 confirma intención de producto. El esquema, los estados de conciliación, los cálculos y los permisos nuevos de este informe son PROPUESTOS, no contratos de escritura activados.** No se ejecutó LV-SIM, SQL, migración, cambio de flag, variable o permiso. No se trabajó en Costs.

## 1. Decisión → diferencias respecto del modelo existente

Antes de editar se leyeron ambos Sheets: Project, Decisions, Roadmap, Data Dictionary, Flight Record, Components y Change Log; y Tables & Fields, Relationships, Settings Matrix y Constraints & Indexes del catálogo. Roadmap mantiene onboarding y componentes V1 aceptados, Settings/Flights con trabajo posterior; no se revoca esa aceptación por proponer otra versión.

| Área | Contrato y código existente | Brecha para el nuevo flujo |
| --- | --- | --- |
| Alta | D-242..245; `_postgresOnboardingRepository.js` crea aircraft/registro/OWNER/capability/settings/baseline/Audit atómicamente. openingTisHours nullable y baselineEffectiveDate obligatorio | No persiste modo de inicio; fecha obligatoria no representa un plan de importación pendiente. No enviar una fecha artificial para satisfacerlo |
| Topología | D-272..275; 005; `aircraft_configuration` 1:1, N posiciones, bootstrap/adopción transaccional | UI usaba fecha compartida. Backend ya acepta installedOn individual por componente |
| Horas | D-059: opening TIS neutral, TSN/TSO explícitos fuera de V1; `component_installations.opening_tis_hours` y baseline casco | No hay evidencia separada de TSN/TSO al instalar y al comenzar el seguimiento, ni referencia a una recorrida; no renombrar el campo legacy |
| Flight Records | raíces estables, revisiones inmutables y snapshots por revisión. `_postgresFlightRepository.js` enlaza instalaciones aplicables por fecha/bordes | Falta snapshot general y reproducible de atribución de horas por instalación para conciliaciones arbitrarias |
| Importaciones | 001 contiene flight_import_batches/issues, hash de archivo único COMMITTED por aeronave, unicidad batch+row, operation_source IMPORT y soporte histórico con campos desconocidos | No hay endpoint/UI/parser XLSX de importación autoservicio. `_xlsxFlightHistoryRenderer.js` es **exportación**, no importación. Los scripts 2E.3 son migración específica LV-MHZ y no un importador genérico |
| Baselines | aircraft_utilization_baselines: horas nullable, fecha y primer vuelo; utilization_adjustments con motivo | Falta workflow de validación, evidencia versionada, diferencias y referencia aceptada independiente de una importación candidata |
| Tracking | `_postgresTrackingRepository.js` devuelve currentTisHours null cuando baseline es null; D-290 permite TRACKED_FROM_NOW relativo sin total absoluto | Nuevos avisos absolutos deben consultar aceptación/continuidad confiables. No degradar el relativo ya aceptado ni confundir desconocido con cero |
| Audit | eventos append-only en misma transacción; correcciones crean nuevas revisiones | Faltan eventos específicos del plan/validación/confirmación y versionado de las evidencias de conciliación |

No se modifica el significado de opening_tis_hours, la API antigua, ownership, revisiones, grants o datos existentes. Los baselines de LV-MHZ no se reinterpretan ni se backfillean.

## 2. Campos/tablas propuestos (no aplicados)

DDL revisable: `proposals/hours-start/schema.sql`, deliberadamente **fuera de db/migrations**. El runner aplica todos los .sql de su carpeta: no debe recoger una propuesta ni confundirse con la migración 008 de otro bloque. La numeración final se asignará después de aprobación y revisión del ledger real.

- `aircraft_hours_plans`: raíz de un plan por aeronave. Puede haber planes posteriores de importación.
- `aircraft_hours_plan_revisions`: versión append-only con modo explícito, estado, actor y motivo. No es aircraft.status ni otro ownership/configuration status.
- `hours_counter_references`: evidencia por casco o instalación, métrica AIRFRAME_TIS/TSN/TSO, scope AT_INSTALLATION/TRACKING_REFERENCE, valor nullable, base de utilización **explícita** TIS/ENGINE_RUNTIME/DECLARED_ONLY, raw value y procedencia. Una referencia de seguimiento se ancla a un instante documentado o a una revisión exacta de vuelo; la referencia al instalar usa la instalación y su fecha propia.
- `hours_reconciliation_runs`, `hours_reconciliation_flights`, `hours_reconciliation_references`, `hours_reconciliation_differences`: inputs congelados, algoritmo/hash, referencias, revisiones utilizadas y diferencias. Validación inmutable separada de confirmación.
- `hours_reconciliation_confirmations`: confirmación explícita append-only por actor/request_id, única por run.
- `flight_component_utilization_attributions`: delta por revisión/instalación/base, con procedencia. No snapshot fijo engine_1/engine_2.
- `aircraft_hours_acceptances`: secuencia append-only de resultados aceptados, con vínculo al anterior. Una importación candidata no sustituye al último resultado aceptado.

Son 10 tablas propuestas; no hay GRANT, backfill ni ALTER de tablas existentes. El SQL no demuestra todavía compatibilidad de runtime ni pasa preflight por existir como archivo. Las funciones/transacciones futuras, política de almacenamiento temporal XLSX y actualización controlada de proyecciones legacy **no están implementadas**.

### Alta V2 propuesta y compatibilidad

El DTO futuro debe versionarse explícitamente y exigir `hoursStart.mode` con uno de los dos enums; no es un parámetro opcional agregado al POST V1. La transacción V2 crea aeronave/registro/acceso/settings/Audit y raíz+primera revisión del plan. CURRENT_REFERENCE comienza en REFERENCES_PENDING; HISTORICAL_IMPORT en IMPORT_VALIDATION_PENDING. No crea una baseline con fecha ficticia para representar un plan pendiente: se difiere su creación/proyección hasta aceptar evidencia real. El esquema actual no exige por FK que toda aircraft tenga baseline; el requerimiento actual está en el servicio V1, que debe refactorizarse de forma versionada tras aprobación.

Una aeronave existente crea un plan candidato nuevo sobre su mismo aircraft_id, sin recrear identidad, membresías, componentes o titulares. La aceptación anterior sigue vigente hasta confirmar una sucesora. Registro técnico, legal ownership y horas continúan separados. La versión/forma exacta del DTO y su despacho dentro de endpoints existentes se aprobarán junto al contrato, sin agregar funciones serverless por defecto. En este bloque el backend V1 no recibe campos V2 ni cambia su comportamiento.

### Estados ortogonales

| Eje | Estado | Fuente |
| --- | --- | --- |
| Aeronave | ACTIVE / ARCHIVED | aircraft existente |
| Técnica | PENDING / COMPLETE | existencia/validez de configuración e instalaciones, derivado |
| Plan de horas | DRAFT | decisión explícita aún en preparación |
| Plan de horas | REFERENCES_PENDING | CURRENT_REFERENCE sin evidencia suficiente |
| Plan de horas | IMPORT_VALIDATION_PENDING | HISTORICAL_IMPORT sin lote validado |
| Plan de horas | RECONCILIATION_PENDING | inputs válidos; diferencias/bordes/referencias no aceptados |
| Plan de horas | COMPLETE | confirmación y aceptación transaccionales de un resultado reproducible |
| Plan de horas | CANCELLED | se abandona un candidato; se conserva historia y aceptación anterior |

Transiciones propuestas: DRAFT → REFERENCES_PENDING o IMPORT_VALIDATION_PENDING → RECONCILIATION_PENDING → COMPLETE. Una corrección o importación posterior abre otro candidato; nunca edita la evidencia anterior. El resultado operativo se calcula a partir de la última aceptación, no de la última revisión candidata.

## 3. Relaciones y contabilización propuestas

**Basado en evidencia, nunca en una fecha elegida para cuadrar números.** Los límites deben venir de libros/lecturas documentadas o una revisión de vuelo identificada. Si no se puede determinar el orden intradía de una sustitución, el lote sigue pendiente hasta resolverlo explícitamente; una fecha sola no autoriza atribución automática.

### Vocabulario y fórmulas

- Horas del casco: referencia canónica de TIS del casco + TIS de revisiones ACTIVE aplicables después de su borde + ajustes explícitos aceptados. Flight Time y Engine Running Time no sustituyen TIS.
- TSN al instalar y TSO al instalar son observaciones independientes del componente físico. La fecha installed_on pertenece a esa instalación; motor y hélice pueden tener fechas distintas.
- TSN/TSO en referencia de seguimiento son observaciones posteriores con su propio borde y procedencia. No pueden copiarse del punto de instalación si falta utilización entre ambos puntos.
- Utilización desde referencia = suma de deltas atribuibles y completos desde el borde. No incluye los vuelos que ya están incorporados en la lectura de referencia; un AFTER_REVISION empieza después de esa revisión.
- TSN actual candidato = TSN de referencia + utilización compatible desde el borde. TSO candidato usa su propia referencia y mismo criterio, **solo si no hubo otra recorrida**. Recorrida nueva requiere evidencia explícita y otro episodio; no se infiere por TSO=0 ni por reemplazo/serie/nombre.
- TIS de aeronave solo alimenta TSN/TSO si la base es explícitamente compatible. ENGINE_RUNTIME usa snapshots de motor por revisión cuando están disponibles; DECLARED_ONLY muestra lecturas y no calcula interpolaciones. Si no hay esa base/delta, el resultado es desconocido.
- Valor desconocido, tramo faltante, atribución ambigua o referencia no confiable → absoluto/diferencia NULL y estado pendiente; **NULL + delta no se convierte en un total**. Cero solo existe cuando fue declarado de forma explícita y validado.
- Solo revisiones actuales ACTIVE participan en resultados actuales. Evidencias anteriores conservan sus IDs incluso si luego hubo corrección/VOID; se produce nueva conciliación, sin reescribir la previa. Ajustes no se aplican dos veces ni reemplazan evidencia faltante para forzar igualdad.

`opening_tis_hours` permanece como saldo neutral de la semántica V1. No se usa como alias de TSN ni TSO al instalar. Si una revisión aceptada cambia por corrección/VOID o aparece un registro retroactivo antes del borde, la vista viva debe marcar conciliación desactualizada y suspender sus absolutos/avisos hasta revalidar; la evidencia vieja se conserva como snapshot, no como total actual. Vuelos nuevos inequívocamente posteriores al borde pueden acumularse por las reglas aceptadas.

Las proyecciones legacy se mantendrán hasta un adaptador versionado aprobado; no se suma una nueva referencia encima de un opening legacy y se cuenta dos veces el mismo período.

### Atribución por instalación

1. Resolver aircraft_id/flight_revision_id/component_installation_id, nunca por matrícula, texto o similitud de serie.
2. Verificar mismo aircraft, tipo y posición válidos, componente físico y período de instalación no superpuestos.
3. Aplicar first/last_applicable_flight_id y orden registrado donde existan. Instalaciones migradas con fecha NULL se conservan bajo D-207; no se fabrican fechas.
4. Un delta completo de TIS puede corresponder a cada instalación que estuvo aplicable durante todo ese vuelo; eso no divide las horas del casco por cantidad de motores. No se duplica el mismo delta dentro de un componente/base.
5. Cambio intravuelo, datos asimétricos o período incompleto requieren evidencia/mapping explícito. No prorratear automáticamente.
6. Los nuevos deltas se congelan por revisión/instalación/base; una corrección genera otra revisión y otra atribución, nunca UPDATE a snapshots previos.

## 4. Settings/dependencias y reglas operativas propuestas

| Operación | Aeronave nueva sin aceptación | Con aceptación vigente | Candidato de importación posterior |
| --- | --- | --- | --- |
| Preparar plan/técnica | Permitido localmente; sin persistencia en este prototipo | Permitido | Permitido |
| Validar/stage de importación | Futuro OWNER + gate dedicado + scope de aeronave; no confirma vuelos | Igual | Igual, sin cambiar aceptados |
| Confirmar importación/referencia | Solo tras validación completa, refs verificables, fingerprint actual y confirmación expresa | Igual; nueva aceptación | Bloquear si solapa/duplica o si cambió el input |
| Registrar vuelos nuevos | Propuesta conservadora: técnica + ownership + aceptación conciliada y referencia fiable del casco | Mantener contratos vigentes y continuidad desde borde aceptado | No bloquear el estado operativo anterior por preparar un candidato; nuevos vuelos invalidan una preview si alteran su snapshot |
| Calcular absoluto del casco | No disponible mientras no exista referencia fiable y tramo completo | Referencia aceptada + deltas posteriores | Mostrar último aceptado, no sumar candidato |
| Calcular TSN/TSO | Solo con referencia compatible y período cubierto por componente | Por métrica/base/episodio, sin inventar desconocidos | No sustituir por candidato |
| Avisos absolutos por horas | Pendientes cuando el absoluto no es confiable | Usar aceptación y deltas verificados | Último resultado aceptado, identificado como tal |
| Avisos relativos | No inferirlos por NULL; requieren ventana/borde confiable | Preservar TRACKED_FROM_NOW conocido incluso con absoluto NULL (D-290) | No mezclar candidato con ventana aceptada |
| Avisos por fecha | Siguen independientes del saldo de horas y conservan su semántica | Igual | Igual |

Estas reglas son propuesta para la versión nueva, **no una modificación de permisos ni gates actuales de vuelos/Tracking**. `proposedHoursReadiness` es un helper de pruebas no conectado a runtime. Permitir registro de aeronave nueva con saldo absoluto desconocido después de una aceptación solo relativa queda abierto a aprobación explícita; no se habilita tácitamente.

El selector existe en alta inicial/adicional. Para aeronaves existentes, Datos generales → Inicio del seguimiento permite preparar la misma elección. Nada se guarda en Settings JSON ni localStorage; el prototipo avisa que es preparación local y no intenta simular persistencia. La elección inicial nunca impide una futura importación.

## 5. Permisos propuestos (sin cambios actuales)

- Lecturas: respetar el acceso a aeronave existente y exponer solo resúmenes permitidos. No ampliar Settings a PILOT/VIEWER por este bloque.
- Proponer OWNER ACTIVE para preparar/validar/confirmar planes/importaciones; gates de Preview/TEST y UUID de aeronave para futuros canaries. Roles existentes, identidad y MANAGE_OWNERSHIP no cambian ni se reutilizan como permiso de conciliación.
- No ejecutar confirmación desde un callback que solo validó archivo. Revalidar sesión, membresía, scope, ownership cuando aplique y todos los inputs dentro de transacción.
- Admisión de pilotos históricos sin cuenta, vínculo de personas y utilización-owner por fecha deben usar los contratos canónicos, no copiar usuarios/titulares de otra aeronave. Etiquetas no resueltas quedan issues, sin matching heurístico.
- No GRANT nuevos ni permisos concedidos en la propuesta SQL. La matriz y las columnas exactas de permisos necesitan aprobación y verificación independiente antes de migrar/activar.

## 6. Importación, historia y Audit propuestos

1. **Carga**: XLSX compatible, límite de bytes/filas/hojas, versión de mapeo, SHA-256 del contenido. Tratar fórmulas/links/macros como contenido no ejecutable; rechazar macros y no evaluar fórmulas. Acordar storage temporal/expiración antes de implementar upload. No subir datos privados en este prototipo.
2. **Validación**: estructura, fechas reales y zona horaria/precisión, unidades, decimales, TIS vs Flight Time, campos históricos faltantes permitidos con issue/procedencia. Archivo original y mapeo versionados. Faltantes no se rellenan con cero, fecha de hoy o una persona de otra aeronave.
3. **Duplicados/períodos**: mantener unicidad COMMITTED de (aircraft, source_file_sha256), batch+row y request_id. Detectar también registros semánticos coincidentes entre archivos/lo ya registrado; no auto-merge. Diferenciar posible duplicado legítimo de identidad externa verificada repetida. Bloquear solapamientos sin resolver.
4. **Instalaciones**: resolver asociación canónica por período/bordes reales. Presentar issues por posiciones faltantes, superposición, cambios intradía y componentes desconocidos. No copiar instalaciones de LV-TST ni asignar toda la historia a los componentes actuales.
5. **Conciliación**: comparar casco y cada componente/métrica/base contra referencias declaradas verificables. Mostrar valor conocido, derivado, diferencia y causa. Incertidumbre NULL no es diferencia cero. Política candidata: igualdad exacta a precisión canónica 0.1 h; tolerancia distinta o redondeo de TSN/TSO requiere aprobación, preservando original.
6. **Preview**: resumen de vuelos/período, nuevos/duplicados, referencias/bordes, instalaciones, gaps/diferencias, advertencias y bloqueos. Congelar hash de contenido+mapeo+referencias+revisiones+instalaciones+algoritmo. Si cambió cualquiera, invalidar preview y revalidar.
7. **Confirmación**: petición expresa, idempotente, para esa versión exacta. SERIALIZABLE + lock de aeronave; revalidar todo; insertar raíces/revisiones/hijos IMPORT, atribuciones y resultado confirmado + Audit atómicamente. No introducir nuevos vuelos antes de resolver referencias fiables ni consolidar por ausencia de datos. Sin autorización o con error: cero escrituras de negocio.

### Idempotencia, fallo y corrección

Antes de commit, fallo → ROLLBACK íntegro; batch puede informar FAILED sin quedar vuelos parciales (diseñar su registro de error fuera de la transacción abortada). Reintentar confirmación con mismo request_id devuelve el mismo resultado. Archivo igual ya COMMITTED para esa aeronave no se reincorpora. Otro archivo con los mismos vuelos no elude el detector semántico.

Después de commit no hay rollback por DELETE: corrección/VOID mediante revisiones y razones; resultado sucesor que mantiene la evidencia anterior. Confirmaciones y referencias aceptadas son append-only. No UPDATE/DELETE de flight_record_revisions ni de sus snapshots, Audit o conciliaciones aceptadas. Los imports laterales a historia ya operativa requieren control explícito de precedencia/proyecciones, nunca cambio retroactivo silencioso de baseline.

Audit futuro: HOURS_PLAN_CREATED/REVISED, HOURS_REFERENCES_RECORDED, IMPORT_VALIDATED, HOURS_RECONCILIATION_VALIDATED/CONFIRMED y aceptación sucesora; además de FLIGHT_IMPORTED por raíz/revisión, batch summary y correcciones existentes. Actor/request_id, aircraft_id, hashes, algoritmo, referencias y revisiones exactas; no archivo completo ni secretos en Audit. Cada mutación material y Audit comparten commit.

## 7. Gates, preflight/rollback y próximos pasos exactos

| Gate | Estado de este bloque |
| --- | --- |
| Decisión de dos modos y separación conceptual | D-307 CONFIRMED, ambos Sheets con readback |
| Campos/tablas | SQL normalizado PROPOSED fuera del runner, no aplicado |
| Relaciones/atribución/matemática | Propuesta documentada; revisión pendiente |
| Settings/dependencias | Prototipo seguro; runtime nuevo pendiente |
| Permisos | Matriz propuesta; no cambios reales |
| Historia/Audit/importación | Workflow propuesto; no ingesta ni confirmación implementadas |
| Tests/UI/lint/build | Evidencia local en informe final; no sustituye los gates anteriores |
| Preflight SQL real, activación, canary LV-SIM y aceptación autenticada | NO ejecutados |

### Puntos abiertos que bloquean implementación persistente

P1. Aprobar semántica TSN/TSO, base TIS vs runtime por componente, precisión original y episodios de recorrida (referencia documental vs entidad normalizada de overhaul). D-059 no queda supersedida automáticamente por este SQL.

P2. Aprobar contrato de evidencia/bordes (instante con zona horaria vs revisión exacta), fuente/documento y política para referencias de precisión solo DATE y reemplazos el mismo día. No pedir al usuario una fecha arbitraria para ocultar esta ambigüedad.

P3. Aprobar tolerancia de conciliación, admisión de saldo solo relativo/absoluto desconocido y política frente a gaps/duplicados legítimos. La propuesta conservadora bloquea consolidación absoluta y nueva operación hasta referencias suficientes.

P4. Aprobar mapeo de identidades/ownership históricos, permisos y storage/retención de XLSX. Los permisos de staging/confirmación no se heredan de MANAGE_OWNERSHIP.

P5. Aprobar invalidación por correcciones posteriores y la transición de proyecciones V1 sin doble conteo. Una aceptación previa sigue identificable aunque su cálculo requiera resultado sucesor.

### Preflight preparado, no ejecutado

1. Revisar/aprobar P1..P5 y el SQL. Completar las filas técnicas de ambos Sheets **solo cuando se cierre ese contrato**, con readback. Elegir número de migración tras inspeccionar el ledger y otras ramas; no tocar ni renumerar Costs.
2. Tras autorización independiente, crear rama Neon TEST descartable para preflight; verificar proyecto/branch/base/rol/checksums y snapshot de tablas/constraints/grants. No usar Production ni TEST padre.
3. En una única transacción de esa rama: BEGIN, ejecutar propuesta aprobada, probar FK/CHECK/unicidad/cross-aircraft, NULL vs cero y revisiones, forzar error y ROLLBACK. Verificar externamente ausencia de tablas nuevas, ledger y grants sin cambios y datos originales idénticos. Este bloque no crea ni usa esa rama.
4. `proposals/hours-start/rollback.sql` tiene teardown en orden FK **solo para la rama descartable vacía**; el rollback principal es transaccional. Después de datos reales no se borran tablas/registros para deshacer una aceptación: recuperación/forward migration aprobada y correcciones append-only.
5. Solo después del preflight PASS, aprobación persistente y readback se implementan repositorios/endpoints, permisos exactos, safe staging y proyecciones. Mantener flags cerrados y guard por aircraft_id.
6. Revisar commit/Preview autenticado. Tras nueva autorización, probar **solo LV-SIM**, con datos técnicos declarados y evidencia de referencia; verificar independientemente Neon/Audit y aislamiento LV-MHZ. No configurar LV-SIM con el contrato temporal antiguo desde este prototipo.

## Implementación segura y evidencia local

- `FirstAircraftOnboarding`: elección requerida sin preselección; se retiran las entradas de baseline/fecha arbitraria del prototipo. El botón «Preparar inicio» solo valida localmente e informa pendiente; **no crea aeronaves**.
- `HoursStartPlan`: equivalente para aeronave existente, local y sin persistencia, con pasos del importador pendiente. No se presenta upload como funcional.
- `AircraftConfigurationOnboarding`: fecha propia por motor/hélice y TSN/TSO al instalar. Revisar produce borrador con guardado deshabilitado; **no configura aeronaves**, incluso si el canary existente está temporalmente habilitado. Cancelar conserva borrador local; no toca otras aeronaves. Resúmenes e instalaciones ya aceptadas conservan lectura legacy; los flujos de lifecycle anteriores no se reescriben.
- `aircraftService`: rechaza campos del plan o TSN/TSO antes de fetch, para que el whitelist legacy no los descarte silenciosamente. El contrato backend antiguo permanece intacto; per-component installedOn ya está soportado y conserva fechas distintas. No se afirma que el nuevo contrato esté protegido/implementado en un endpoint nuevo: ese endpoint no existe todavía.
- La UI bloquea el nuevo guardado, no se cambiaron flags del canary ni permisos para lograrlo. Las ramas previas y Production siguen intactas.

Capturas y evidencia: `hours-start-review/`. Smoke con requests interceptados, sin datos reales. La suite incluye modos obligatorios, cero requests para campos no soportados, NULL, fechas distintas/calendario válido, aislamiento N componentes, política propuesta y exclusión del SQL del runner.

## Actualización canónica y readback

Se agregó solamente intención de producto cerrada: `01_Decisions!A309:H309` D-307, `09_Change_Log!A103:I103` y `Settings Matrix!A99:J99`. Readback de valores/IDs/estado/WRAP PASS. No se editaron decisiones anteriores, Tables & Fields, Constraints, Relationships ni filas de Costs para presentar la propuesta como aprobada.

La verificación visual Google-rendered no pudo realizarse: el navegador solicitó login. Se verificaron valores y formato nativo mediante el conector, sin cambiar accesos ni iniciar un login. Los puntos P1..P5 siguen abiertos tanto en el informe como en las notas canónicas. No se declara aceptación funcional autenticada por tests, build o Preview.


## Resultado de gates locales

- **237 tests PASS**, 0 fallos, 10 pruebas nuevas; una prueba anterior se actualiza para separar el borrador TSN/TSO del payload legacy y conservar la comprobación NULL/N posiciones.
- **npm run lint PASS; npm run build PASS; git diff --check PASS.**
- Smoke de alta inicial/adicional y Datos generales de LV-SIM ficticia; modo inicialmente vacío y requerido, ambas opciones accesibles, preparar sin crear; cancelar alta adicional conserva aeronave LV-DEMO y borrador de Registro SADF; motor 2020-01-02 y hélice 2023-04-05, TSN/TSO vacíos, revisión sin guardado. Desktop claro y móvil oscuro 390px.
- Tests de servicio confirman cero fetch para nuevos campos; no hay nuevo endpoint de importación ni falso PASS de persistencia. No se corrieron scripts SQL ni consultas a Neon en este bloque.
- Build local no equivale a deployment READY; Preview y aceptación autenticada se verifican separadamente. No se solicita activar flags ni se ejecuta LV-SIM como parte del cierre.
