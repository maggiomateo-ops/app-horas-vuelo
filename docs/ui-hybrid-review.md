# UI híbrida MHZ — 2026-10-20

## Base y aislamiento

- HEAD inicial: `c82714e`, rama `review/issue-8-migration-008-design`, checkout limpio.
- Remotos verificados con `git ls-remote`: base `683ed4838ee5ce5c35efab13a6efab20ac954abb`; Costs review `c82714ecc76d91611feb05b745c8cf9dcd9f0e6f`.
- Rama UI: `codex/ui-hybrid-refresh`, creada finalmente desde el HEAD remoto exacto `683ed48`. El commit local pendiente `caa40cb` y el trabajo posterior de Costs permanecen en sus ramas originales y no se incorporan.
- La base ya contiene `006_costs.sql` y `007_costs_allocation_metric_adjustments.sql`. No se modifican, ejecutan ni activan. No hay cambios en API, roles, permisos, flags, identidad, ownership, Audit, schema, Neon ni datos persistidos.
- No push, deployment, cutover ni modificación de main/Production.

## Fuentes canónicas consultadas

Se leyeron ambos Sheets mediante Google Drive:

- [Product & Data Model](https://docs.google.com/spreadsheets/d/1lvzdL169hReQ2nT-mYHEm8ELZVJI2zVJcwU-9bCJosM/edit): D-050 mantiene Seguimiento como recordatorios sin certificación técnica; D-067 define Novedades; D-070 y D-073 preservan permisos y no derivan aeronavegabilidad. D-202 separa ownership, acceso y seguimiento de la proyección Settings.
- [Schema Catalog](https://docs.google.com/spreadsheets/d/1Q3VXvhN4vWSVrVuYOiwnuoqHfMP7HC-UApxlDTPlDTg/edit): tracking_items conserva identidad, base DATE/TIME_IN_SERVICE, recurrencia, referencias y eventos; los estados de alerta se derivan. No se altera este contrato.

## Seguimiento: diagnóstico y bloqueo

Cadena verificada en código:

1. `App.jsx` toma exclusivamente `selectedAircraft?.trackingAvailable === true`.
2. `rolePermissions.js` agrega Seguimiento solo con esa capacidad y rol ADMIN/OWNER/PILOT/VIEWER reconocido. No se altera esta política.
3. `api/aircraft.js` agrega `trackingAvailable` solo en la rama `AIRCRAFT_DATA_SOURCE=postgres`; su valor depende de `SETTINGS_DATA_SOURCE=postgres`. El allowlist de respuesta ya incluye el campo.
4. `resolveDataSource` usa Sheets cuando la variable está ausente. La ruta Sheets de aeronaves no agrega la capacidad.
5. `api/settings.js?resource=tracking` y `resource=squawks` devuelven 404 si Settings no usa Postgres. Sus repositorios verifican acceso a la aeronave y sus capacidades de escritura por separado.

Por tanto, una configuración Sheets/mixta o una respuesta sin esa capacidad oculta correctamente el módulo. Forzar el tab no resuelve la disponibilidad de sus endpoints. El módulo conserva Recordatorios y Novedades, búsqueda, filtros, estados, formularios y eventos existentes; no se cambian permisos ni se habilitan escrituras.

**No se confirmó la causa efectiva del Preview en runtime.** Vercel lista READY el deployment `dpl_8KvZG9fGCqBBB1Lwpj2huCCT8PSf`, SHA `683ed48`. El navegador redirige a login Vercel; el conector autorizado sobre `/api/aircraft` también devuelve 401 `deployment_authentication_required`. No hay CLI `vercel`/`vc` instalada. No se cambiaron protecciones ni variables para sortearlo. Queda pendiente leer, con una sesión autorizada, `/api/aircraft`, las fuentes efectivas y los GET de ambos recursos para una aeronave autorizada. No se necesita ni se autoriza activar flags para ese diagnóstico.

## Inventario Settings y ubicación final

| Antes | Funciones preservadas | Categoría final |
| --- | --- | --- |
| App | Nombre visible y matrícula | Aeronave |
| App | Unidad de aceite y moneda existente | Preferencias |
| Operación | Origen, destino, tiempos JPI/Garmin predeterminados | Configuración → Carga de vuelos |
| Operación | Lista legacy de propietarios del formulario | Propiedad (aclaración explícita: no cambia propiedad legal) |
| Inspecciones | Próxima anual y últimas inspecciones 50/100 h | Configuración → Inspecciones |
| Aceite | Precio y ventana de análisis | Configuración → Aceite |
| Umbrales | Avisos/peligro anual y 50/100 h | Configuración → Umbrales |
| Utilización | Valor histórico anual existente | Configuración → Utilización |
| Panel aeronáutico | Topología, componentes instalados, historial, instalar/reemplazar/remover y confirmaciones según capacidades existentes | Componentes / Propulsión |
| Usuarios | Panel completo de usuarios/accesos con sus controles existentes | Usuarios / Acceso, solo según autorización original |
| Cabecera | Tema automático/claro/oscuro y cierre de sesión | Cabecera global |

No se mueve el onboarding legal ni se agrega una capacidad de administración de propiedad. No se agrega módulo financiero. El borrador Settings se mantiene al navegar categorías; guardado, paths editables y deshabilitados conservan la lógica original.

## Implementación visual

- Navegación compacta, marca aeronáutica navy/celeste, tamaño de texto consistente, eliminación de mayúsculas globales y del CSS inicial de Vite.
- Settings lateral en desktop y selector nativo de categorías en móvil; unidades y valores separados por propósito.
- Recordatorios/Novedades con títulos breves, selección accesible y advertencia técnica esencial conservada.
- Dashboard con métricas primero, superficies simples y períodos de cálculo desplegables sin cambiar cálculos.
- Historiales con título, matrícula, impresión en español y controles/tablas consistentes. Registro mantiene campos, handlers y flujo.
- Foco visible, modo oscuro explícito y movimiento reducido.

## Validación y límites

- `npm test`: **182 PASS**, 0 fallos, 0 skipped. Incluye 8 nuevos casos de matriz por roles, capacidad por respuesta de aeronaves, errores 401/404 de Recordatorios y Novedades. Los tests existentes cubren repositorios/permisos con dobles, no infraestructura real.
- `npm run lint`: **PASS**.
- `npm run build`: **PASS**.
- `git diff --check`: **PASS**.
- Correcciones de validación heredadas de la base: ESLint aplica globals Node a `db/**/*.js`; test de componentes conserva el límite de 12 funciones y elimina la prohibición obsoleta de una migración 006 ya presente. No se modifica código de base de datos ni Costs.
- Revisión real en navegador del frontend local con respuestas ficticias y bloqueo de todo fetch distinto de GET: Registro, Historiales vacío, Dashboard vacío, Settings, Recordatorios y Novedades; tema claro/oscuro a 1280 px y Settings a 390 px en iframe. VIEWER sin capacidad muestra solo Historiales/Dashboard; OWNER con capacidad muestra Seguimiento. No es una sesión real de producto ni evidencia de persistencia.
- Evidencia: [claro](ui-review/settings-light.png), [oscuro](ui-review/settings-dark.png), [móvil 390 px](ui-review/settings-mobile.png).
- Pendientes: aceptación con datos reales, tablas pobladas y pruebas de interacción en Preview autenticado; confirmación de fuentes efectivas y recursos de Seguimiento; revisión de exportación/impresión y formularios reales sin escrituras no autorizadas.

**Estado:** implementación local y checks PASS; commit local entregado. **Deployment nuevo: no realizado; READY no verificado para esta UI. Aceptación funcional: pendiente.** El READY observado corresponde al Preview anterior de la base.
