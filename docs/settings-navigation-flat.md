# Settings — navegación fija

Revisión de UX sobre `codex/settings-v2-preview`, base `34de5c5`.

- Sidebar fijo: Aeronave (Datos generales, Propiedad), Configuración (Formulario, Dashboards), Componentes / Propulsión y Usuarios / Acceso según autorización existente.
- Se eliminan expansión/colapso, símbolos +/−, indentaciones recursivas y líneas de explorer.
- Formulario muestra breadcrumb `Configuración / Formulario`, título `Formulario` y pill interna `Vuelo rápido`. Conserva los valores predeterminados y las opciones legacy del formulario.
- Dashboards muestra breadcrumb `Configuración / Dashboards`, título `Dashboards` y pills internas Preferencias, Inspecciones, Aceite, Umbrales y Utilización. La última pill se recuerda al salir y regresar.
- Propiedad muestra breadcrumb `Aeronave / Propiedad` y título `Propiedad de la aeronave`. La lista legacy se presenta exclusivamente en Formulario como `Opciones de propietario del formulario`, con ayuda: `Separá las opciones con comas. No modifica la propiedad legal.`
- Se mantiene `Nombre en la app`, los 21 campos, el borrador compartido, los paths editables y validaciones. Usuarios y Componentes conservan su montaje diferido y estado al navegar dentro de Settings.
- Móvil usa un selector de secciones principales; las opciones internas permanecen dentro del contenido. Las pills son botones nativos, con foco visible y `aria-current`, sin tablists que requieran manejo de flechas.

## Validación

- `npm test`: 188 PASS, 0 fallos, 0 skipped.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- `git diff --check`: PASS.
- Smoke local en navegador con datos ficticios: desktop claro de 1280 px y móvil oscuro mediante viewport de iframe de 390 px. Se verificaron Formulario, Dashboards, Propiedad, navegación móvil, retención de nombre/origen/opciones legacy/moneda sin guardar y memoria de la pill seleccionada.
- Sin comprobaciones autenticadas de infraestructura en este bloque. No se modificaron lógica de negocio, permisos, API, Neon, Vercel, migraciones, Costs ni main/Production. Commit local sin push para no disparar el despliegue automático de Vercel.

## Capturas

- [Desktop — Dashboards](settings-flat-review/desktop-dashboards.png)
- [Desktop — Formulario](settings-flat-review/desktop-formulario.png)
- [Desktop — Propiedad](settings-flat-review/desktop-propiedad.png)
- [Móvil — Dashboards oscuro, 390 px](settings-flat-review/mobile-dashboards-dark.png)

Esta revisión sustituye la navegación expandible del informe anterior `settings-v2-preview.md`.
