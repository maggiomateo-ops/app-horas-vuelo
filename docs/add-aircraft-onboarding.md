# Alta adicional de aeronave

Base: `codex/settings-v2-preview`, `1742f184aa66d6863059285adb908c9fd41092b5`.
Rama: `codex/add-aircraft-onboarding`.

## Implementación

La última opción del selector de aeronave es «+ Agregar aeronave», dentro de «Gestión de aeronaves». No hay un botón adicional en la cabecera. Abre un diálogo nativo accesible que reutiliza el formulario, validaciones y guard contra envíos repetidos del onboarding canónico. Cancelar o Escape conserva la selección y los borradores montados; durante el envío no se puede cerrar. Tras crear se refrescan las membresías, se selecciona la nueva aeronave y se limpian los estados de la aeronave anterior para evitar contaminación. Si falla la creación se conservan los valores; si falla el refresh tras una creación exitosa se conserva la lista anterior y se incorpora el resultado canónico sin repetir el POST.

GET /api/session proyecta las capacidades existentes: sesión canónica v2/UUID, identidad y aeronaves PostgreSQL, y gate existente POSTGRES_ONBOARDING_WRITES_ENABLED. Sin disponibilidad no aparece la acción; con gate deshabilitado está deshabilitada. POST /api/aircraft conserva sus comprobaciones de gate y usuario ACTIVE. No se cambian roles ni permisos.

El payload mantiene el whitelist original; no copia identidades, miembros, propiedad legal, pilotos, componentes ni vuelos. TIS vacío se envía como null. OWNER y su capacidad canónica, settings, baseline y Audit se crean mediante la transacción ya existente. Ownership legal y topología continúan en sus flujos existentes.

## Validación

- npm test: 197 PASS, 0 fallos.
- npm run lint: PASS.
- npm run build: PASS.
- git diff --check: PASS.
- Navegador local con fetch totalmente interceptado: cero aeronaves, segunda aeronave, fallo de creación, cancelación con borrador de Registro y Settings, nueva selección y ausencia del borrador anterior, gate deshabilitado, validaciones requeridas, responsive de 390px y temas claro/oscuro. Evidencias en `add-aircraft-review/`.
- Prueba final del selector: abre diálogo sin cambiar LV-DEMO; cancelar conserva ruta SADF y devuelve foco al selector. Probado también a 390px.
- Las pruebas de servicio y handler cubren capacidades denegadas, payload aislado, refresh y usuario inactivo. No equivalen a aceptación autenticada en Preview.

## Comprobaciones externas de solo lectura

En Neon TEST (`red-pine-78283204`, rama `br-billowing-band-b62jj1ab`, base `app_horas`), LV-TST tiene fabricante PIPER, modelo PA-28, propulsión PISTON, un motor y una hélice. No se usan como prefill automático. LV-SIM no existía al realizar la consulta. Se verificaron metadatos de USAGE y SELECT/INSERT para el runtime en las tablas canónicas de onboarding y Audit; no se ejecutó DML ni se alteraron grants.

En la rama de referencia de Vercel, POSTGRES_ONBOARDING_WRITES_ENABLED continúa en false. No se cambió ninguna variable ni flag. Los overrides de la rama de referencia no deben asumirse heredados por esta rama nueva: verificar la configuración PostgreSQL TEST de cualquier Preview antes del canary autenticado, sin habilitar escrituras como parte de este cambio.

## Pendientes y límites

Código validado localmente; aceptación funcional autenticada y verificación independiente Neon/Audit pendientes de revisión del commit y autorización explícita. No se creó LV-SIM, no se modificó Neon, migrations, Costs, main ni Production. Un push puede disparar Preview automáticamente; no se realiza despliegue manual ni cutover.
