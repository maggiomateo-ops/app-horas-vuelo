# Alta y configuración de aeronaves — revisión

## Base y alcance

Base verificada local y remotamente: `f29c88ce7bccbd966d9452e947ed1d199129bbca`. Al comenzar, `origin/codex/settings-v2-preview` y `origin/codex/add-aircraft-onboarding` apuntaban a ese SHA; la referencia local Settings todavía estaba en `1742f18` y se actualizó mediante fetch. Árbol inicial limpio. Trabajo aislado en `codex/aircraft-setup-experience`.

Antes de editar se consultaron ambos Sheets canónicos, sin modificarlos:

- [Product & Data Model](https://docs.google.com/spreadsheets/d/1lvzdL169hReQ2nT-mYHEm8ELZVJI2zVJcwU-9bCJosM/edit): D-032..D-045, D-125, D-178, D-181, D-184, D-209, D-211 y D-272. Titularidad, party, identidad, membresía y opciones legacy son conceptos separados. La matrícula no prueba el país.
- [Schema Catalog](https://docs.google.com/spreadsheets/d/1Q3VXvhN4vWSVrVuYOiwnuoqHfMP7HC-UApxlDTPlDTg/edit): ownership con intervalos, parties y persons; configuración con counts smallint y componentes/instalaciones por posición. No se modifica el contrato persistido.

## Cambios

### Países

`CountrySelector` compartido por el onboarding inicial y el adicional. Catálogo local de 249 códigos ISO 3166-1 alpha-2 oficialmente asignados, sin códigos excepcionales como XK/UK. Nombres en español materializados con Unicode CLDR / Intl.DisplayNames; referencia del estándar: https://www.iso.org/iso-3166-country-codes.html.

Búsqueda por nombre sin acentos y por código, con coincidencia ISO exacta prioritaria. Combobox con listbox, etiquetas, foco, flechas/Enter, Escape y limpieza opcional. Escape cierra primero la lista, sin cancelar el diálogo. El texto buscado nunca se almacena como país: la selección conserva el ISO-2 y el payload original conserva null para ausencia. No hay inferencia por prefijo ni cambios de API/schema para países. Se mantienen las validaciones originales.

### Propiedad

Antes se mostraba solo ownershipConfigured. Ahora GET /api/aircraft agrega una proyección de solo lectura `ownershipInterests`, acotada por aircraft_id y membresía canónica OWNER ACTIVE del usuario activo. El mapper vuelve a eliminar el detalle para otros roles. Se muestran nombre de la party, tipo, participación, inicio/cierre y estado derivado (vigente/programada/finalizada/titular inactivo). Fechas con hora local del navegador. No se publican emails ni vínculos de login.

Settings conserva un solo título «Propiedad de la aeronave». El detalle se obtiene de interests + parties/persons, nunca del rol OWNER, de la identidad de login o de las etiquetas legacy. Si el detalle no viene de la fuente, se informa disponibilidad; no se simula un titular.

El input legacy «Opciones de propietario del formulario» y su ayuda legal se conservan. Siguen sus dependencias de Registro, payload, validaciones y restricciones de edición existentes. No se añade ningún editor, PATCH o escritura de ownership; MANAGE_OWNERSHIP, los flujos canónicos anteriores, Audit y revisiones no cambian.

### Configuración técnica y LV-SIM

El flujo canónico ya soporta N motores/hélices, posiciones 1..N, fecha de instalación efectiva y TIS nullable. Se reutiliza. Se extrajo el sincronizador de borrador por tipo/posición para probarlo sin duplicar lógica. Settings ahora presenta la configuración pendiente en Componentes / Propulsión, habilitando el formulario solo cuando el OWNER y configurationSetupAvailable ya lo permiten. Con gate cerrado presenta estado de solo lectura. La pantalla continúa reiniciándose por aircraft_id y nunca toma instalaciones de otra aeronave.

Se corrigió la validación frontend que convertía count vacío a cero. Se alinea con el rango smallint existente (0..32767); no se cambia el backend ni el esquema. El resumen no presenta cero cuando faltan counts. Los TIS desconocidos siguen vacíos/null. Se corrigió un texto obsoleto que negaba la existencia del flujo posterior de reemplazo/remoción.

La configuración usa el PATCH setup canónico existente, su gate, validación OWNER, posiciones completas, transacción y Audit ya probados. No se modifica el formulario de Registro ni su guardado.

## Verificación

- **Implementación:** completa para revisión del código.
- **Tests:** 205 PASS, 0 fallos (8 nuevos).
- **Lint:** PASS.
- **Build:** PASS.
- **git diff --check:** PASS.
- **Smoke local:** desktop 1280px y móvil iframe de 390px/700px; claro/oscuro. Requests totalmente interceptados por el fixture, sin escrituras externas.
- **Aceptación funcional autenticada:** PENDIENTE. No se ejecutó la nueva consulta legal contra Neon ni un alta/configuración real. Las pruebas unitarias, revisión SQL y fixture no sustituyen esa aceptación.

Smoke observado: búsqueda «espana» → España/ES y Enter; búsqueda «AR» → Argentina primero y Enter en onboarding inicial móvil; sin resultados; Escape mantiene el diálogo; cancelación conserva selección LV-SIM y borrador técnico de tres motores/dos hélices; detalle ficticio legal en desktop/móvil; cambio de aeronave limpia el detalle anterior; formulario técnico pendiente accesible desde Settings con posiciones independientes y TIS vacíos. Capturas en `aircraft-setup-review/`.

## Preparación del canary autenticado (no ejecutado)

1. Revisar independientemente commit, diff y Preview. Verificar sus fuentes PostgreSQL TEST y gates existentes sin cambiarlos en este bloque. Los overrides de otra rama no se presuponen heredados.
2. Tras autorización explícita adicional, verificar de nuevo los datos técnicos válidos de LV-TST y la ausencia de LV-SIM antes de usarlos. No copiar datos de negocio ni asumir vigente una observación anterior.
3. Crear LV-SIM mediante onboarding canónico con país seleccionado explícitamente (o ausente), fecha real declarada y contadores desconocidos vacíos. Comprobar OWNER atómico y Audit de creación; sin propietarios legales, pilotos o historial copiados.
4. Completar topología/instalaciones usando datos técnicos declarados, revisar N posiciones y NULL desconocidos. Ownership posterior solo por su flujo autorizado y capacidad existente.
5. Verificar por lectura independiente Neon/Audit, selección nueva, estados pendientes, retorno a LV-MHZ, aislamiento de datos y ausencia de regresiones en Registro. No guardar vuelos reales dentro de este bloque.

No se realizaron consultas ni escrituras en Neon en este bloque, ni cambios manuales en Vercel, flags, variables, main, Production, migraciones o Costs. Publicación mediante push normal de la rama de trabajo; Preview puede generarse automáticamente. No se declara deployment READY sin comprobar su estado, ni aceptación funcional por compilar.
