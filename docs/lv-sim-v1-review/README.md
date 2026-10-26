# LV-SIM funcional — Bloque 1 / contrato V1

Estado: código y smoke local preparados. Persistencia real del canary NO EJECUTADA. Aceptación autenticada y readback Neon posteriores PENDIENTES.

## Base y alcance

Rama `codex/lv-sim-v1-configuration`, descendiente de `codex/settings-v2-preview` en `eea761bc52b141a734f1f3b6b41fbe2f0732b6fe`, verificado con fetch antes de trabajar. Árbol inicial limpio. Se consultó la arquitectura Horas V2 como referencia; no se integró su SQL, módulos, tablas, precisión ni aceptaciones. No se modificaron API, permisos, schema, migraciones, Costs, flags, variables, Production, main ni datos persistidos.

Se releyeron los dos Sheets canónicos:
- [Producto, decisiones y roadmap](https://docs.google.com/spreadsheets/d/1lvzdL169hReQ2nT-mYHEm8ELZVJI2zVJcwU-9bCJosM/edit)
- [Catálogo de esquema / Settings Matrix](https://docs.google.com/spreadsheets/d/1Q3VXvhN4vWSVrVuYOiwnuoqHfMP7HC-UApxlDTPlDTg/edit)

D-207/278: fechas nuevas explícitas y obligatorias; NULL de fecha preservado para instalaciones históricas ya existentes. Identidad física y opening_tis_hours desconocidos pueden ser NULL. D-275: adopción de instalaciones existentes exactas, sin recrearlas. D-307: fecha por instalación; opening_tis_hours no es alias TSN/TSO. Horas V2 sigue fuera de este bloque. Los Sheets solo fueron consultados.

## Preflight de solo lectura

Neon TEST: proyecto red-pine-78283204, rama br-billowing-band-b62jj1ab, DB app_horas. SELECT sobre metadata y únicamente la aeronave canary; sin DDL/DML.

| Dato de LV-SIM | Lectura |
|---|---|
| UUID | 96d849aa-2827-4aa3-b02b-6671577444a7 |
| Estado / matrícula vigente | ACTIVE / LV-SIM / AR |
| Fabricante / modelo existente | Cessna / C182 |
| Configuración técnica | ausente |
| Instalaciones totales | 0 |
| Vuelos | 0 |
| Membresía OWNER con usuario ACTIVE | 1 |
| Titularidad legal vigente | 0 intereses; participación total NULL |
| Baseline existente | OWNER_ENTRY, 0 h, fecha 2026-10-20, sin primer vuelo |
| Audit del canary | AIRCRAFT_CREATED: 1; sin evento de configuración |

El baseline cero ya existe: no fue introducido, corregido ni usado como sustituto de contadores por esta revisión. Revisar su evidencia antes de operación. Tampoco se cambió la identidad C182: el ensayo técnico bimotor exige verificar que la identidad y datos técnicos declarados para el canary sean los aprobados. No se infiere topología por matrícula/modelo ni se copian datos de LV-TST/LV-MHZ.

Privilegios efectivos consultados para app_horas_runtime: SELECT/INSERT en aircraft_configuration, components, component_installations y Audit; UPDATE components/installations ya existente; sin UPDATE/DELETE Audit, sin DELETE en esas tablas y sin UPDATE configuration. No GRANT ni cambios de rol.

Preview operativo READY: `dpl_H1Mpr3xwPN3VzE4FLNoN2UPidrSv`, SHA eea761b, [URL](https://app-horas-vuelo-7vuflmbjc-maggiomateo-2978s-projects.vercel.app). Configuración actual leída mediante Vercel, limitada a claves no secretas de codex/settings-v2-preview:
- AIRCRAFT_DATA_SOURCE=postgres.
- POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED=true.
- POSTGRES_AIRCRAFT_CONFIGURATION_CANARY_AIRCRAFT_ID=96d849aa-2827-4aa3-b02b-6671577444a7.
- POSTGRES_OWNERSHIP_WRITES_ENABLED=false; POSTGRES_FLIGHT_WRITES_ENABLED=false.

Son valores actuales del control plane de esa rama; no se extrajo una sesión runtime ni se afirma verificar un snapshot de variables dentro de la función desplegada. El intento GET /api/aircraft en navegador llegó a Login Vercel. CLI Vercel no disponible localmente. No se alteró Deployment Protection ni se generó bypass.

Consulta de variables para la NUEVA rama devolvió lista vacía: no hereda automáticamente el routing ni canary por rama de la operativa. Su Preview puede servir para revisar código/UI, pero no se declara preparado para persistir en TEST hasta revisar de forma independiente el entorno autorizado. No se copiaron variables ni credenciales.

## Implementación

Se elimina la fecha global del formulario y del serializador. Cada posición ENGINE/PROPELLER posee su fecha explícita, fabricante, modelo, serie y TIS V1 al instalar. El helper conserva datos por tipo/posición al ampliar N; nuevas posiciones nacen vacías. No se asume igualdad entre cantidades de motores y hélices; siguen las reglas existentes por propulsión.

Validación cliente por posición: fecha calendario válida, posiciones completas/únicas y TIS no negativo con hasta una décima, dentro del rango V1. Error asociado accesiblemente al campo. Vacíos de identidad/TIS se envían como NULL; fecha desconocida no se rellena ni se guarda bajo un contrato nuevo: V1 rechaza instalaciones nuevas sin fecha. Una instalación histórica existente con NULL se sigue leyendo/adoptando sin reinterpretarla.

La revisión muestra fechas y TIS por componente. Cancelar oculta el formulario sin borrar el borrador local ni cambiar la selección. El formulario sigue separado por key de aeronave; los borradores de Registro no se modifican. El resumen posterior muestra fabricante/modelo, serie, fecha y TIS obtenidos mediante el flujo de lectura existente.

Backend V1 inspeccionado, sin modificaciones: PATCH setup-configuration conserva sesión canónica, flag global, VERCEL_ENV=preview y UUID servidor. OWNER ACTIVE/usuario ACTIVE/aeronave ACTIVE revalidados en repositorio. SERIALIZABLE + lock de aeronave; configuración existente devuelve 409 antes de INSERT; instalaciones existentes se adoptan solo si topología exacta, en caso contrario 409; no mezcla creación/adopción parcial. Inserta N componentes, N instalaciones y un Audit en la misma transacción. Cualquier fallo revierte la operación. Readback GET expone installedOn/openingTisHours/identidad y queda limitado por membresía y aeronave. No se requiere propiedad legal para setup técnico; sí es gate separado para vuelos.

## Validación

- npm test: **238 PASS**, 0 fallos. Once pruebas adicionales, más adaptación de fixtures anteriores a fechas por componente.
- npm run lint: **PASS**.
- npm run build: **PASS**, 52 módulos.
- git diff --check: **PASS**.
- Monomotor, bimotor 2+2 y N posiciones; fechas distintas/bisiestas/imposibles; desconocidos NULL; precisión V1 y TSN no soportado; duplicados/faltantes; payload hasta normalizador servidor; INSERTs/Audit por posición.
- Tests existentes mantienen OWNER/ACTIVE, configuración repetida 409 sin INSERT, adopción, flags ausentes/invalidos, rechazo LV-MHZ, bypass por payload y sesión no autorizada.
- Prueba del wrapper transaccional con cliente pg simulado comprueba BEGIN/SERIALIZABLE/ROLLBACK y ausencia de COMMIT ante fallo intermedio o Audit. No equivale a prueba de rollback en PostgreSQL real.

Smoke browser exclusivamente local, fixtures ficticias e intercepción completa de fetch, sin requests externos de negocio: 2+2 con fechas 2024-02-29 / 2025-01-02 / 2023-07-03 / 2026-09-04. Cancelar/reabrir conserva datos. Confirmación simulada y recarga conservan fechas, serie y TIS desconocidos; hay que volver a seleccionar la aeronave en la fixture tras recargar. Desktop 1280x900 claro y móvil 390x844 oscuro, scrollWidth igual al ancho del viewport. Estos datos no describen componentes reales de LV-SIM.

Capturas:
- [Desktop completo](desktop-form.png)
- [Móvil completo](mobile-form.png)
- [Readback ficticio tras recarga](desktop-readback.png)

## Gate posterior exacto

1. Revisión independiente del diff y Preview del SHA entregado; comprobar que no incluye Horas V2 ni migraciones.
2. Resolver entorno TEST del Preview elegido sin modificar Production ni ampliar el canary; esta entrega no cambia variables. Verificar GET autenticado: OWNER ACTIVE, UUID exacto, configurationConfigured=false, configurationSetupAvailable=true y cero instalaciones.
3. Revisar evidencia de fabricante/modelo/topología bimotor, cuatro identidades/fechas/TIS conocidos y baseline ya existente; no reemplazar faltantes con cero ni fechas arbitrarias.
4. Solo tras autorización posterior explícita, confirmar desde la UI una única vez.
5. Readback independiente Neon: una configuración 2+2, cuatro componentes/installations con fechas/NULL exactos, un AIRCRAFT_CONFIGURATION_CREATED con cuatro IDs. GET y recarga de UI iguales. Solicitud repetida debe ser 409 sin nuevas filas/Audit; LV-MHZ rechazado por canary. No provocar nuevas solicitudes reales sin incluirlas en esa autorización.
6. Propiedad legal/vuelos siguen en su gate separado. Aceptación funcional únicamente después de estas verificaciones reales.
