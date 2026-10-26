# Canary de configuración técnica por UUID — preparado, no activado

Base: `ba53e26040d66aa4b3dfca2db42a9c77185e642d`, verificada en `origin/codex/settings-v2-preview` al comenzar. Rama segura: `codex/configuration-canary-guard`. Árbol inicial limpio.

## Contratos consultados antes de editar

- [Product & Data Model](https://docs.google.com/spreadsheets/d/1lvzdL169hReQ2nT-mYHEm8ELZVJI2zVJcwU-9bCJosM/edit): D-272 topología explícita, D-273 OWNER/bootstrap atómico, D-275 adopción sin duplicar componentes existentes.
- [Schema Catalog](https://docs.google.com/spreadsheets/d/1Q3VXvhN4vWSVrVuYOiwnuoqHfMP7HC-UApxlDTPlDTg/edit): configuración 1:1, counts smallint, posiciones por instalación, identidades físicas separadas y TIS nullable.

No se modificó ninguno de los Sheets, schema ni contratos persistidos.

## Implementación

Nuevo helper servidor `api/_aircraftConfigurationCanary.js`, usado en PATCH setup-configuration antes de invocar el repositorio y en GET para proyectar configurationSetupAvailable por aeronave.

Requiere simultáneamente:

1. AIRCRAFT_DATA_SOURCE resuelto a POSTGRES y flag global existente habilitado explícitamente.
2. VERCEL_ENV exactamente preview (entorno gestionado por Vercel).
3. POSTGRES_AIRCRAFT_CONFIGURATION_CANARY_AIRCRAFT_ID con exactamente un UUID canónico válido. No acepta listas, comodines, matrícula, nombre, email, JSON ni excepciones enviadas por el cliente. Ausencia/valor inválido bloquea; no existe modo de fallback sin restricción.
4. Sesión versión 2 con userId UUID válido.
5. El aircraftId real del payload debe coincidir con el UUID del entorno. Se comprueba el mismo campo que el repositorio normaliza y usa para todos los writes. Campos alternativos o una supuesta capacidad en el payload no conceden autoridad. El repositorio conserva el whitelist estricto de entrada.
6. El repositorio revalida usuario ACTIVE, aeronave ACTIVE, OWNER ACTIVE y ausencia de configuración, bajo lock/transacción SERIALIZABLE. Conserva rechazo 409 de setup repetido, validación de N posiciones, adopción/bootstrap canónicos y Audit atómico.

La UI solo recibe disponibilidad true cuando cumple la misma política, el rol canónico es OWNER y configurationConfigured es exactamente false. No depende de una matrícula visible. Restricción inválida devuelve capacidad false sin romper las lecturas; las rutas SHEETS/Production no reciben nuevas escrituras. Las demás operaciones PATCH conservan sus gates existentes.

No se cambió el resolver del flag global ni se lo sustituyó. El UUID es un guard adicional de esta operación, no un permiso de usuario. El bypass de UI tampoco omite las comprobaciones del servidor.

## UI

Se eliminó el párrafo técnico de Propiedad. Sin titulares se muestra «Todavía no se configuraron propietarios para esta aeronave.». Con titulares se mantienen directamente las tarjetas. No se cambian parties, propiedad legal, membresías ni opciones legacy.

El formulario técnico existente mantiene propulsión, counts explícitos N, posiciones 1..N, fabricante/modelo/serie, fecha efectiva de instalaciones y TIS desconocidos NULL. Se agrega Cancelar: cierra el formulario y conserva su borrador local para reabrirlo; no llama a una API ni toca otras aeronaves. Cambiar aeronave mantiene el aislamiento por aircraft_id existente. No se copia nada desde LV-TST.

## Lectura real de TEST — 2026-10-26

Proyecto `red-pine-78283204`, rama `br-billowing-band-b62jj1ab`, base `app_horas`, rol `app_horas_runtime`. Solo dos SELECT; ningún DML/DDL ni cambios de grants.

| Registro observado | UUID canónico | Estado | Configurada | Instalaciones activas |
| --- | --- | --- | --- | --- |
| LV-SIM | 96d849aa-2827-4aa3-b02b-6671577444a7 | ACTIVE | false | 0 |
| LV-MHZ | 29d775c5-023b-57d2-b592-ff20051e85fd | ACTIVE | true | 2 |

LV-SIM tiene 1 membresía OWNER con usuario ACTIVE. Runtime: SELECT/INSERT en configuración, componentes e instalaciones; INSERT en Audit; UPDATE/DELETE Audit false. Comprobación de privilegios, no ejecución de writes. Los tests también simulan LV-MHZ pendiente, para comprobar que el guard la rechaza por UUID y no solamente por estar configurada.

## Valores para una activación posterior — NO aplicados

Después de revisión independiente del commit y del Preview autenticado, y autorización explícita en esta conversación, configurar **solo el Preview de la rama que se autorice**:

```text
POSTGRES_AIRCRAFT_CONFIGURATION_CANARY_AIRCRAFT_ID=96d849aa-2827-4aa3-b02b-6671577444a7
POSTGRES_AIRCRAFT_CONFIGURATION_WRITES_ENABLED=true
```

Precondiciones que deben verificarse, sin suponer que otra rama las hereda:

```text
VERCEL_ENV=preview                       # provisto por Vercel; no sobrescribir
AIRCRAFT_DATA_SOURCE=POSTGRES
GOOGLE_USER_RESOLUTION_SOURCE=POSTGRES   # login canónico existente
DATABASE_URL=<conexión restringida existente a Neon TEST/app_horas como app_horas_runtime>
```

No se incluye ninguna credencial en este informe. No modificar Production ni habilitar otros flags (onboarding, ownership, componentes, vuelos, Costs) para este canary. No modificar globalmente variables compartidas entre ramas.

Controles antes de confirmar desde plataforma:

- Verificar SHA y fuentes reales del Preview, el UUID contra lectura independiente de TEST y la sesión OWNER ACTIVE.
- GET /api/aircraft debe mostrar setup disponible exclusivamente para LV-SIM pendiente; LV-MHZ false, incluso si se simula pendiente en tests.
- UUID ausente/inválido o entorno no Preview bloquea. Flag global off sigue bloqueando aunque el UUID sea correcto.
- Un PATCH manipulado con aircraftId de LV-MHZ debe devolver 403 CANARY_DENIED antes de abrir el repositorio. No realizar ese intento mutante real en este bloque: está cubierto con tests.
- Ingresar datos técnicos reales declarados para LV-SIM y revisar posiciones/fechas. No copiar identidades o historial; dejar TIS desconocidos vacíos. Confirmar únicamente tras autorización explícita adicional.
- Luego verificar de forma independiente una configuración, N componentes e instalaciones correctas, NULL donde faltaba TIS y un Audit AIRCRAFT_CONFIGURATION_CREATED; LV-MHZ sin cambios. El segundo setup debe ser 409 y no crear filas adicionales.
- Cerrar el canary volviendo el flag global a false en esa misma rama y verificar capacidad false. No se retira el guard como parte del canary.

## Evidencia y límites

- Tests completos: **227 PASS**, 0 fallos; 22 pruebas nuevas en `test/aircraft-configuration-canary.test.js`.
- Lint PASS, build PASS, git diff --check PASS.
- Positivo de UUID permitido; negativos por otro UUID, manipulación de payload, target ausente/malformado, flag off/inválido, entorno Production, SHEETS, sesión no canónica, rol no OWNER y configuración ya existente/desconocida. La suite previa mantiene pruebas transaccionales positivas y negativas de OWNER, setup pendiente, conflictos, rollback y NULL/N posiciones.
- Smoke local con requests interceptados: desktop claro 1280px y móvil oscuro 390px. LV-MHZ pendiente ficticia no presenta acción; LV-SIM sí. Borrador 2 motores/2 hélices se conserva al cancelar/reabrir. Propiedad vacía muestra el texto solicitado. Capturas en `configuration-canary-review/`.
- La fixture simula capacidades; los tests del helper/handler verifican la política servidor. No constituye aceptación autenticada del deployment.

**Implementación y validación local completas. Activación, canary real y aceptación funcional: PENDIENTES.** No se activaron flags ni se modificaron Vercel, Neon, main, Production, migraciones o Costs. El push normal de la rama segura puede generar Preview automáticamente; no se realizó despliegue manual.
