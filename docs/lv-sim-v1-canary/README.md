# LV-SIM — preparación de canary funcional V1

**Preparación publicada; ejecución NO autorizada por esta entrega.** Sin escrituras Neon, cambios Vercel/flags/roles, SQL Hours V2, migraciones, datos LV-MHZ, main, Production ni cambios funcionales de Costs.

Base GitHub verificada por ls-remote: `codex/lv-sim-v1-configuration` = `f5e8934861cd1dd83b897af7f4c66f51c1cff452`; operativa `codex/settings-v2-preview` = `eea761bc52b141a734f1f3b6b41fbe2f0732b6fe`. Rama de preparación: `codex/lv-sim-v1-canary-preparation`, descendiente exacta de la base solicitada. No modifica el código runtime existente.

## Autoridad consultada

Se releyeron [Producto/Decisiones/Roadmap](https://docs.google.com/spreadsheets/d/1lvzdL169hReQ2nT-mYHEm8ELZVJI2zVJcwU-9bCJosM/edit) y [Esquema/Settings Matrix](https://docs.google.com/spreadsheets/d/1Q3VXvhN4vWSVrVuYOiwnuoqHfMP7HC-UApxlDTPlDTg/edit), sin editarlos. D-207/D-278 exigen fecha explícita para instalaciones nuevas; D-272/273/275 separan topología, creación y adopción; D-307 mantiene fechas propias y no equipara opening_tis_hours a TSN/TSO. Settings Matrix distingue identidad de aeronave, baseline, propiedad y topología. Horas V2 no se integra ni se necesita para este canary.

## Estado real — SELECT solamente

Neon TEST: `red-pine-78283204` / `br-billowing-band-b62jj1ab` / `app_horas`. UUID canónico: `96d849aa-2827-4aa3-b02b-6671577444a7`.

| Hecho observado | Resultado |
|---|---|
| Matrícula vigente / país / estado | LV-SIM / AR / ACTIVE |
| Fabricante/modelo | Cessna / C182 |
| Serie del casco | Hay un valor previo; requiere decisión explícita antes de presentar identidad Piper |
| Configuración | 0 |
| Todas las instalaciones, incluidas cerradas | 0 |
| Componentes distintos vinculados por instalaciones | 0 |
| Flight Records | 0 |
| Imports / ajustes de utilización | 0 / 0 |
| Registro de matrículas | 1 |
| OWNER ACTIVE con usuario ACTIVE | 1 |
| Intereses de propiedad legal | 0 |
| Baseline | 0 h, OWNER_ENTRY, 2026-10-20, first_tracked_flight_id NULL |
| Audit del canary | AIRCRAFT_CREATED: 1; configuración: 0 |

`components` es inventario físico global sin aircraft_id: la afirmación comprobable es cero componentes vinculados a LV-SIM, no que el inventario global esté vacío. Audit no informa creación previa de componentes para este UUID. No se toca ni se reutiliza inventario ajeno.

El baseline cero y su fecha son preexistentes: esta preparación no los genera, valida su evidencia, convierte a NULL ni los usa para rellenar TIS de componentes. No constituye por sí solo un bloqueo SQL para el setup técnico, pero debe revisarse antes de habilitar contabilización/vuelos. El valor previo de serie tampoco es evidencia de una Piper PA-34.

Permisos efectivos leídos para app_horas_runtime: UPDATE manufacturer/model en app.aircraft; INSERT en aircraft_configuration/components/component_installations y Audit. Audit UPDATE/DELETE denegados. Privilegio SQL no implica que exista una operación de negocio autorizada. No se concedió ningún permiso.

## Identidad de prueba: propuesta mínima, no implementación

Intención aprobada: fabricante **Piper**, modelo **PA-34 Seneca**, escenario ficticio PISTON 2 motores + 2 hélices. No se infiere identidad de los cuatro componentes a partir del modelo ni de LV-TST. Se necesita decidir explícitamente qué hacer con la serie de casco previa: preservarla sin atribuir evidencia, o declarar desconocido y corregirla a NULL con Audit. No se asigna una serie nueva ni se limpia el dato automáticamente.

Inspección: api/aircraft.js ofrece onboarding, setup-configuration, ownership y lifecycle; no corrección de identidad. El subset PostgreSQL de Settings solo admite unidad de aceite y ciertos parámetros de inspección. Nombre en la app no cambia manufacturer/model. No usar Settings legacy, onboarding duplicado ni SQL manual para eludir esta carencia.

Propuesta de operación futura `PATCH /api/aircraft`, `action=correct-pending-aircraft-identity`:

1. Sesión canónica validada; OWNER ACTIVE, usuario/aeronave ACTIVE; POSTGRES; Preview; mismo UUID servidor del canary. Revalidar dentro de la transacción.
2. Habilitación específica adicional, por defecto desactivada, aprobada para esa operación; no reutilizar el permiso de configuración como autorización implícita de identidad. Es una propuesta, sin flag nuevo creado ni código activado.
3. Whitelist manufacturer/model, motivo y snapshot esperado de manufacturer/model/serial/updated_at. Valores explícitos no vacíos. Serie fuera del cambio por defecto; solo permitir corrección explícita a NULL si se aprueba ese contrato. Sin cambios de UUID, matrícula, ownership, membresías, baseline ni instalaciones.
4. SERIALIZABLE + lock de aeronave; comprobar snapshot previo exacto, ausencia de configuración/instalaciones/vuelos/imports/ajustes. Si cambió algo, 409, sin escrituras. Este caso acotado no es un editor general de identidad histórica.
5. Actualizar únicamente campos autorizados y updated_at; insertar Audit USER/MANUAL, entity AIRCRAFT, acción propuesta AIRCRAFT_IDENTITY_CORRECTED, before/after completos y motivo indicando corrección ficticia TEST. Conserva AIRCRAFT_CREATED y sus datos originales; no reescribe historia. Error Audit => rollback. No-op => sin nueva escritura/Audit; conflicto ante snapshot obsoleto.
6. GET tras commit y verificación independiente de datos/Audit. Tests de rol, canary, stale input, ausencia de historial, repetición/no-op y rollback antes de habilitar.

El schema y privilegios observados permiten proponerlo sin DDL ni GRANT. **La operación no está implementada y requiere revisión/aprobación adicional antes del cambio real.** No se entrega SQL UPDATE ejecutable. Son dos operaciones futuras distintas: corrección de identidad con su propio Audit, y bootstrap técnico con exactamente un AIRCRAFT_CONFIGURATION_CREATED; no afirmar que habrá un único evento Audit total.

## Preview: comparación y conjunto propuesto

Operativa actual: [Preview READY eea761b](https://app-horas-vuelo-7vuflmbjc-maggiomateo-2978s-projects.vercel.app). Rama de UI: [Preview READY f5e8934](https://app-horas-vuelo-3il7qwft6-maggiomateo-2978s-projects.vercel.app). READY solo significa despliegue construido, no aceptación autenticada.

`filter_project_envs(gitBranch=codex/settings-v2-preview)` devolvió 18 overrides: cinco selectores postgres, DATABASE_URL y gates; configuración true con UUID LV-SIM, Flights/Ownership y demás writes operativos consultados false. Se consultaron valores únicamente de selectores/flags no secretos. No se leyó ni copió el valor de DATABASE_URL, SESSION_SECRET ni credenciales Google. Costs no se altera.

`codex/lv-sim-v1-configuration` no tiene overrides propios. **No significa que esté sin variables**: metadata general confirma selectores compartidos Preview/Production con valor `sheets-api`. Se leyeron solo esos cuatro valores no secretos y no se modificaron. FLIGHT_DATA_SOURCE ausente también cae a SHEETS. La metadata general trae entradas truncadas: no se afirma inventario completo de auth/secretos heredados ni ausencia global de claves sin verificación adicional. No se afirma conocer el snapshot efectivo de variables de las funciones desplegadas.

El conjunto propuesto exacto está en [plan.json](plan.json), `environmentProposal`, con `apply=false`. Destino propuesto: **solo target preview, gitBranch codex/lv-sim-v1-configuration**, después de integrar/revisar el código necesario; si se elige otra rama debe aprobarse y repetirse la revisión de alcance. No configurar esta rama documental automáticamente ni cambiar variables compartidas.

| Grupo | Preparar tras autorización, sin aplicar ahora |
|---|---|
| Identidad/routing | GOOGLE_USER_RESOLUTION_SOURCE, AIRCRAFT_DATA_SOURCE, SETTINGS_DATA_SOURCE, HISTORIALES_DATA_SOURCE y FLIGHT_DATA_SOURCE = POSTGRES |
| Configuración técnica | POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED=true y POSTGRES_AIRCRAFT_CONFIGURATION_CANARY_AIRCRAFT_ID=96d849aa-2827-4aa3-b02b-6671577444a7 |
| Gates cerrados | POSTGRES_FLIGHT_WRITES_ENABLED=false; POSTGRES_OWNERSHIP_WRITES_ENABLED=false; lifecycle, onboarding, Settings, Tracking, Squawks, self-service user creation y user management false |
| Conexión | Binding gestionado DATABASE_URL a TEST/app_horas como app_horas_runtime, nunca migrador; verificar host/endpoint contra rama TEST sin imprimir URL |
| Auth | Verificar SESSION_SECRET gestionado, GOOGLE_AUTH_ENABLED/VITE_GOOGLE_AUTH_ENABLED=true, IDs cliente existentes compatibles y origen exacto Preview autorizado; login Google canónico, no fabricar cookies |
| Prohibido | DATABASE_MIGRATION_URL en Vercel; secretos en repositorio, .env, logs o respuestas; cambios Production, variables compartidas/de otra rama o Costs |

Los cinco selectores evitan pantallas conectadas a backends diferentes y, especialmente, que un flag PostgreSQL false deje una ruta legacy de Flights activa por fallback SHEETS. No hay selector separado de configuración: su PATCH y GET usan AIRCRAFT_DATA_SOURCE. El mínimo habilita solo setup-configuration; los false explícitos impiden heredar aperturas de otros dominios. La propuesta no garantiza por sí misma una conexión o sesión efectiva: comprobar GET autenticado y capacidades después del deployment aprobado.

## Matriz de entrada pendiente

| Posición | Fabricante | Modelo | Serie | TIS al instalar (h) | Fecha de instalación |
|---|---|---|---|---|---|
| ENGINE 1 | NULL | NULL | NULL | NULL | **PENDIENTE: entrada explícita YYYY-MM-DD** |
| ENGINE 2 | NULL | NULL | NULL | NULL | **PENDIENTE: entrada explícita YYYY-MM-DD** |
| PROPELLER 1 | NULL | NULL | NULL | NULL | **PENDIENTE: entrada explícita YYYY-MM-DD** |
| PROPELLER 2 | NULL | NULL | NULL | NULL | **PENDIENTE: entrada explícita YYYY-MM-DD** |

NULL indica desconocido, no cero ni identidad tomada de otro avión. Las cuatro fechas pueden ser iguales únicamente si el usuario lo declara; no se propagan ni se derivan del baseline. Por tratarse de aeronave ficticia, el usuario puede declarar fechas de ensayo, pero deben quedar explícitamente aprobadas como tales; el sistema no las inventa. La matriz JSON conserva installedOn=null como marcador de pendiente: **no es un payload listo para guardar** y los validadores actuales la rechazan. TIS V1 admite hasta una décima >=0, nunca alias de TSN/TSO.

## Readiness comprobado por código/tests

Formulario: App exige rol OWNER y configurationSetupAvailable; estado pendiente no se deduce de matrícula. Cuatro tarjetas con fechas independientes, revisión explícita, cancelación sin borrar borrador local. El payload coincide con normalizeAircraftConfigurationInput y usa whitelist de campos V1.

Servidor: sesión firmada canónica, flag global y UUID servidor + Preview; repositorio revalida OWNER ACTIVE/usuario ACTIVE/aeronave ACTIVE y bloquea fila aeronave en SERIALIZABLE. Configuración existente => 409 antes de INSERT. Cero instalaciones activas => CREATE_COMPONENTS; existentes exactas => ADOPT_EXISTING sin recrear; parciales/mismatch => 409. N componentes/installations + Audit atómico, no doble bootstrap. El helper de transacción hace rollback ante fallo. GET conserva installedOn/openingTisHours/serie y scope por membresía. La titularidad legal no es requisito de setup técnico, pero bloquea posteriores vuelos junto con su flag.

Esto es evidencia de código y pruebas locales con cliente simulado, no prueba real de PostgreSQL ni sesión autenticada. No abrir flags para resolver carencias de ownership. No ejecutar configuración con los datos actuales.

## Consultas preparadas y pasos posteriores

[preflight-readonly.sql](preflight-readonly.sql): SELECT fijo por UUID para repetir la lectura antes de cualquier autorización efectiva. [postflight-readonly.sql](postflight-readonly.sql): SELECT parametrizado con JSON exacto revisado de cuatro entradas y UUID canónico del actor. Comprueba cuatro posiciones, cuatro componentes e instalaciones distintos/activos, topología PISTON 2+2, diferencias de valores con EXCEPT ALL (incluye NULL), un evento de configuración con actor/topología. Contrastar también los IDs y cada campo del snapshot Audit con GET y la entrada aprobada. Los archivos no se ejecutaron; no contienen mutaciones.

Después de revisar y autorizar código/datos/entorno: aplicar identidad mediante flujo canónico revisado, verificar; recién entonces revisar cuatro instalaciones y confirmar una vez desde UI. Repetir GET/recarga y SELECT independiente. Solo si la autorización incluye prueba de repetición, enviar la misma solicitud y comprobar HTTP 409 y mismos conteos/IDs/Audit. Si falla la transacción, no editar filas para repararla: readback y diagnóstico. Rollback de bootstrap real debe probarse en fixtures descartables con autorización propia, no provocarse sobre LV-SIM.

## Bloqueos exactos

| Categoría | Bloqueo actual | Resolución necesaria |
|---|---|---|
| Datos | Cuatro fechas faltantes | Declaración explícita por posición; identidad/TIS pueden permanecer desconocidos |
| Identidad | Cessna/C182 y serie previa no describen la Piper ficticia aprobada | Aprobar/implementar corrección mínima + decidir serie; preservar Audit |
| Código | Falta operación segura de corrección de identidad | Implementación y tests de la propuesta anterior; setup técnico existente preparado |
| Entorno | Rama UI cae a selectores Sheets compartidos y no tiene binding TEST/canary propios verificados | Autorizar/configurar únicamente overrides Preview de rama elegida; auth/binding y snapshot runtime efectivos por verificar |
| Autorización | No hay autorización de escritura real ni de cambios de variables/flags en este bloque | Autorización posterior específica para identidad, entorno y único bootstrap técnico |
| Operación posterior | Titularidad legal vacía, Flights writes false; baseline previo requiere evidencia | Gates propios, no ampliar el alcance de setup técnico |

No se declara canary listo para ejecutar ni aceptación funcional autenticada. La preparación documenta qué falta y evita un primer guardado con datos inventados.

## Resultados de entrega

npm test **244 PASS**, 0 fallos (seis pruebas nuevas de preparación, sobre 238 existentes); npm run lint **PASS**; npm run build **PASS**, 52 módulos; git diff --check **PASS**. Pruebas nuevas: matriz incompleta bloqueada, fechas sintéticas explícitas en test sin mutar el plan, NULL preservado, gates/roles/UUID/Production, routing y writes cerrados, consultas preparadas sin DML. SQL PostgreSQL y canary reales **NO ejecutados**. Build conserva assets `index-GS59XvUe.css` / `index-DHishipX.js` de la base. No hay archivos runtime/migraciones modificados. Commit/push es evidencia de publicación, no aprobación de datos, variables, identidad ni persistencia.
