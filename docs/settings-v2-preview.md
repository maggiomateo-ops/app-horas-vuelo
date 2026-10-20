# Settings V2 y diagnóstico Preview — 2026-10-20

## Base y alcance

Continuación `codex/settings-v2-preview` desde `2797956c6824c3ce2c8f7f75547459766163f85a`, verificado localmente y en GitHub. No se incorporan commits pendientes de Costs.

Cambios limitados a Settings y sus elementos compartidos: nombre de la acción Vuelo rápido en Registro y reinicio del panel Settings al cambiar `aircraft_id` para evitar arrastrar un borrador a otra aeronave. No se cambian handlers de Registro, cálculos de Dashboard, Historiales, API, roles, permisos ni dependencias.

## Arquitectura y funciones preservadas

| Ruta | Función |
| --- | --- |
| Aeronave → Datos generales | Nombre en la app y matrícula |
| Aeronave → Propiedad | Estado canónico de titularidad recibido de `/api/aircraft`; sin editor legal nuevo |
| Configuración → Formulario | Opciones de propietario del formulario, separadas de titularidad legal |
| Configuración → Formulario → Vuelo rápido | Origen, destino, tiempo JPI y tiempo Garmin predeterminados |
| Configuración → Dashboards → Preferencias | Unidad de aceite y moneda existente |
| Configuración → Dashboards → Inspecciones | Próxima anual y últimas inspecciones 50/100 h |
| Configuración → Dashboards → Aceite | Precio y ventana de análisis |
| Configuración → Dashboards → Umbrales | Avisos/peligro anual y 50/100 h |
| Configuración → Dashboards → Utilización | Utilización histórica existente |
| Componentes / Propulsión | Panel existente, instalaciones e historial y acciones autorizadas |
| Usuarios / Acceso | Panel existente de pilotos; administración global legacy solo cuando ya está autorizada |

Se conservan los 21 campos existentes (SettingsField/OwnerOptionsField), normalización, guardado, borrador compartido, capacidades y paths editables. Usuarios y Componentes se montan al visitarlos y se ocultan sin desmontarlos mientras se navega dentro de Settings, conservando sus estados locales. El cambio de aeronave reinicia ese estado.

Sidebar expandible con botones nativos, `aria-expanded`/`aria-controls`, página activa y breadcrumbs. Móvil usa selector nativo agrupado con las mismas rutas. No hay árboles ARIA incompletos ni tablists sin manejo de flechas. El botón Guardar solo aparece si la página tiene campos autorizados; no amplía los permisos de campos o servidor. Propiedad no ofrece un guardado legal ficticio y Componentes se omite si no hay panel disponible.

### Nombre en la app e idioma

`appConfig.aircraftName` pertenece al JSON legacy `APP_HORAS_SETTINGS`. No hay alias canónico editable en la proyección Postgres: el adapter parte del DEFAULT_SETTINGS y solo reemplaza matrícula/unidad y los valores compatibles. Por eso se cambia únicamente etiqueta y ayuda, conservando el valor y las restricciones originales. No se reutiliza ese campo como `aircraft_id`, matrícula o persona.

`preferred_locale` existe en el modelo de usuarios, pero `/api/session` no lo entrega y el frontend no tiene infraestructura i18n. Se centralizan las etiquetas `Vuelo rápido`/`Quick flight` en `settingsNavigation.js`, sin selector paralelo ni traducción parcial del producto.

## Fuentes canónicas consultadas

- [Product & Data Model](https://docs.google.com/spreadsheets/d/1lvzdL169hReQ2nT-mYHEm8ELZVJI2zVJcwU-9bCJosM/edit): D-038, D-041, D-108, D-110, D-183/D-184, D-202, D-226 y contratos de Tracking/Novedades. Membresía, usuario, persona, party y titularidad son entidades distintas.
- [Schema Catalog](https://docs.google.com/spreadsheets/d/1Q3VXvhN4vWSVrVuYOiwnuoqHfMP7HC-UApxlDTPlDTg/edit): membresías por aeronave, estados, capabilities, personas y fuentes de Settings.

## Diagnóstico real Vercel

El Preview de referencia está READY:

- Deployment `dpl_7eqHSfc2Tfjiz7T6hYnUVDHHwuyU`, commit `2797956`.
- [Preview de referencia](https://app-horas-vuelo-4rj1pe3hb-maggiomateo-2978s-projects.vercel.app).

Se consultaron metadatos de variables sin imprimir secretos y únicamente se leyeron los valores no sensibles de las cuatro fuentes compartidas.

**Causa de configuración identificada:** `codex/ui-hybrid-refresh` no tiene overrides. AIRCRAFT_DATA_SOURCE, SETTINGS_DATA_SOURCE, GOOGLE_USER_RESOLUTION_SOURCE e HISTORIALES_DATA_SOURCE heredan `sheets-api` de los valores compartidos. Los overrides Postgres, DATABASE_URL y flags de TEST están asociados específicamente a `etapa-2e4-test-app-parity`. Crear otra rama no los hereda. La rama nueva de continuación también requiere una configuración Preview explícita antes de su aceptación en TEST.

`/api/session` fue intentado mediante el conector autorizado y devuelve 401 `deployment_authentication_required` antes de poder inspeccionar la sesión de aplicación. No hay `vercel`/`vc` instalada para un fallback con credenciales locales. No se fabrican sesiones ni se leen cookies/secretos.

| Situación | Clasificación y evidencia |
| --- | --- |
| Seguimiento oculto | Configuración: con aeronaves Sheets, `/api/aircraft` no agrega `trackingAvailable`; App exige `=== true` |
| Tracking/Novedades en Sheets | Endpoint no disponible: `api/settings.js` devuelve 404 para esos recursos si Settings no usa Postgres |
| Cuenta sin membresía para otra aeronave | Autorización: el repositorio exige membresía ACTIVE del UUID autenticado y aeronave ACTIVE |
| Preview protegido | Autenticación de plataforma: 401 observado; no se atribuye a una sesión inválida de la app |
| Fuentes identidad/aeronaves diferentes | Configuración incoherente: gestión de usuarios falla cerrada; no se propone mezclar fuentes |
| Defecto de código de Seguimiento | No demostrado por estas lecturas; no se eliminan guards ni se fuerza la capacidad |

Los GET de aeronaves, tracking y squawks no pudieron verificarse con una sesión autenticada de aplicación en este deployment. Las conclusiones de enrutamiento provienen de código y configuración actual, no de respuestas autenticadas inventadas. Los metadatos actuales no sustituyen una inspección del entorno inmutable del deployment.

## Diagnóstico real Neon TEST

Se identificó **App Horas TEST**, proyecto `red-pine-78283204`, rama `test` (`br-billowing-band-b62jj1ab`), base `app_horas`. Solo se ejecutaron SELECT e inspecciones de metadatos en esa rama.

- La cuenta solicitada existe ACTIVE y tiene vínculo verificado con una persona ACTIVE.
- Tiene una membresía OWNER ACTIVE en LV-MHZ y capability MANAGE_OWNERSHIP activa. Eso no constituye un ADMIN global ni una nueva atribución de titularidad legal.
- LV-TST existe ACTIVE y tiene otra membresía OWNER ACTIVE; la cuenta solicitada no posee acceso a LV-TST. No se necesita crear una tercera aeronave para el objetivo multiflota.
- Ambas aeronaves tienen configuración y titularidad presentes. LV-MHZ tiene 3 recordatorios y 0 novedades; LV-TST, 2 recordatorios y 1 novedad.
- La persona de la cuenta tiene asociación piloto ACTIVE en LV-MHZ y no en LV-TST. Una membresía futura no debe crear automáticamente esa asociación.
- `app_horas_runtime` tiene SELECT sobre las 14 tablas inspeccionadas de identidad, aeronaves, membresías, pilotos, Settings, Tracking y Novedades. No se comprobó una conexión autenticada del Preview usando ese rol.
- UUIDs de cuenta, persona, membresías, actor y aeronaves para una eventual autorización están en un plan local separado, excluido del commit. No se publican asociaciones personales innecesarias en GitHub.

El selector usa `aircraft_id`; cada servicio transmite ese ID y los repositorios validan acceso. En smoke ficticio se cambió LV-DEMO → LV-SIM y se verificó nombre/matrícula nuevos, sin mezclar borradores. Esto **no** es aceptación multiflota de la cuenta real.

## Usuarios / Acceso: límite existente

- Settings solo aparece según las reglas originales. El acceso a usuarios se conserva para OWNER/ADMIN global legacy según la política existente; PILOT/VIEWER no obtienen Settings por este cambio.
- `/api/aircraft-pilots` permite lectura a miembros autorizados. Alta/autorización/revocación de pilotos canónicos depende de OWNER y `USER_MANAGEMENT_WRITES_ENABLED`.
- `/api/users` y `/api/permissions` devuelven 403 explícitamente en Postgres: administración global de usuarios/membresías no implementada allí.
- No hay un flujo canónico completo de invitaciones/administración de membresías disponible para probar solo activando flags. Requiere otro bloque funcional aprobado; no se usa el ADMIN legacy como sustituto.
- Los flujos legacy de usuarios/accesos se conservan en el panel y endpoints originales. No se modifican para conceder acceso a TEST.

## Autorizaciones pendientes — no ejecutadas

1. Configurar **solo Preview y solo `codex/settings-v2-preview`**: GOOGLE_USER_RESOLUTION_SOURCE, AIRCRAFT_DATA_SOURCE, SETTINGS_DATA_SOURCE, HISTORIALES_DATA_SOURCE y FLIGHT_DATA_SOURCE = `postgres`; DATABASE_URL apuntando al runtime de la rama TEST identificada, sin exponer su valor. Mantener todos los flags de escritura false. Verificar también credenciales de sesión/Google ya existentes sin copiarlas a documentación. Crear un nuevo Preview después del cambio requiere autorización, sin promoción/cutover.
2. Autorizar acceso a LV-TST para la cuenta canónica, con rol explícito. La opción mínima propuesta es VIEWER para pruebas de lectura multiflota; OWNER solo si se aprueba expresamente probar gestión operativa allí. No otorgar MANAGE_OWNERSHIP ni crear vínculos de piloto/parties. El OWNER actual de LV-TST debe autorizar la operación y el actor real debe quedar registrado. El plan local detalla IDs, precondiciones, filas y Audit.
3. Para probar mutaciones existentes, aprobar por separado el flag exacto, aeronave, actor, casos y evidencia esperada. No se agrupan flags de vuelo, Settings, Tracking, Novedades y usuarios en una habilitación indiscriminada.
4. Invitaciones y administración de membresías Postgres: aprobar un bloque backend separado; no son un problema resoluble con configuración.

## Validación y evidencia

- `npm test`: **186 PASS**, 0 fallos, 0 skipped; cuatro nuevos tests de jerarquía, rutas no autorizadas, etiquetas y guardado por página. Se mantienen tests de roles/Seguimiento y el límite de 12 funciones serverless.
- `npm run lint`: **PASS**.
- `npm run build`: **PASS**.
- `git diff --check`: **PASS**.
- Smoke real en navegador con datos **ficticios**, 1280, 768 y 390 px; temas claro/oscuro, expansión con Enter, selector móvil, cambio de aeronave, retención de borradores al navegar Settings y acceso a Usuarios. Modo canónico parcial simulado mantiene nombre/matrícula deshabilitados y omite Guardar en páginas sin campos editables.
- Harness reproducible: `node scripts/review-settings-v2.mjs`, URL que imprime el script. Intercepta todos los fetch de la app, bloquea mutaciones y solicitudes desconocidas; escucha únicamente en loopback. No se incorpora al build de producción ni cambia flags reales.
- Capturas: [desktop claro](settings-v2-review/desktop-light.png), [desktop oscuro](settings-v2-review/desktop-dark.png), [móvil claro](settings-v2-review/mobile-light.png), [móvil oscuro](settings-v2-review/mobile-dark.png). Las capturas móviles muestran un viewport de iframe de 390 px.

**Implementación y checks locales PASS. Smoke con mocks PASS. Aceptación funcional autenticada de Preview/Neon: PENDIENTE.** READY de Vercel solo prueba el build/deployment, no el funcionamiento de los módulos ni el aislamiento de sus fuentes. No se ejecutaron escrituras en Neon, migraciones, cambios de permisos, cambios manuales de Vercel, modificaciones de Production/main ni de Costs.
