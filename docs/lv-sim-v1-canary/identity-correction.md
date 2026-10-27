# Corrección de identidad LV-SIM — implementación V1

Base: codex/lv-sim-v1-canary-preparation / 4a0056dae01d5d1ed8d21afe1d008ffcd1575fcd, HEAD remoto verificado. Rama: codex/lv-sim-identity-correction. Implementación backend real; flag propio ausente/OFF; no se ejecutó ninguna corrección ni se modificaron variables Vercel.

## Alcance exacto

`PATCH /api/aircraft`, action **correct-pending-aircraft-identity**. Sin nueva función serverless; helpers internos `_...js` siguiendo la estructura existente. No UI nueva ni editor general.

Única transición permitida: UUID 96d849aa-2827-4aa3-b02b-6671577444a7, Cessna/C182 → Piper/PA-34 Seneca, serialNumber **NULL explícito**, reason exactamente **Corrección de identidad ficticia en Neon TEST.** Campos ajenos rechazados. No se modifican matrícula, baseline, ownership, membresías, configuración, instalaciones ni horas. No se borran ni editan Audit o revisiones anteriores.

## Lectura y payload

GET /api/aircraft sigue mostrando fabricante/modelo. Para OWNER del UUID canary con sesión canónica, Preview y binding TEST verificados, agrega `identityCorrectionSnapshot` con manufacturer, model, serialNumber y updatedAt UTC con **seis decimales**. Este snapshot de lectura puede obtenerse con flag de escritura OFF. Se excluye de otros roles/aeronaves/Production. No truncar updatedAt con Date/ISO de milisegundos.

Ejemplo estructural (NO ejecutar ni completar con valores inventados):

```json
{
  "action": "correct-pending-aircraft-identity",
  "aircraftId": "96d849aa-2827-4aa3-b02b-6671577444a7",
  "manufacturer": "Piper",
  "model": "PA-34 Seneca",
  "serialNumber": null,
  "reason": "Corrección de identidad ficticia en Neon TEST.",
  "expected": {
    "manufacturer": "Cessna",
    "model": "C182",
    "serialNumber": "COPIAR EXACTAMENTE EL VALOR DEL GET; NULL SI ES NULL",
    "updatedAt": "COPIAR EXACTAMENTE EL SNAPSHOT UTC CON SEIS DECIMALES"
  }
}
```

El ejemplo deliberadamente no pasa validación: expected debe copiarse del GET autenticado y revisarse antes del gate real. No crear una cookie ni usar un usuario/emisor de sesión supuesto.

## Guards

- AIRCRAFT_DATA_SOURCE resuelto POSTGRES, VERCEL_ENV=preview, sesión v2 con UUID canónico.
- **POSTGRES_AIRCRAFT_IDENTITY_CORRECTIONS_ENABLED=true** requerido. Ausente, false, vacío o valores inválidos cierran la operación con 503. Se implementó el lector del flag, no se configuró ni activó el flag en infraestructura. plan.json propone false.
- UUID hardcodeado: no admite target/override de payload o matrícula.
- DATABASE_URL solo se valida en memoria: host exacto de TEST `ep-jolly-sun-b6a3ayw9[ -pooler ].c-2.sa-east-1.aws.neon.tech` (sin espacios), database app_horas, usuario app_horas_runtime, puerto estándar y parámetros de conexión acotados. No se imprime, copia ni persiste su valor. options/host routing alternativo rechazado. Hosts direct/pooled obtenidos mediante lectura de metadata de red-pine-78283204 / br-billowing-band-b62jj1ab. Cambio futuro de compute/hostname requiere revisar explícitamente el pin, nunca fallback.
- Dentro de la transacción se comprueban current_database()=app_horas y current_user=app_horas_runtime; el host se valida antes de abrir la conexión.
- Usuario ACTIVE → aeronave ACTIVE → membresía OWNER ACTIVE, con FOR SHARE / FOR UPDATE / FOR SHARE en ese orden. Los privilegios existentes para esos locks y UPDATE serial_number/updated_at se consultaron por SELECT y son suficientes; ningún GRANT o cambio de rol.
- Cualquier Flight Record (incluidos VOID), configuración, instalación (incluidas cerradas), import o ajuste da 409. No se usa propiedad legal como sustituto de OWNER ni se exige para esta corrección.

## Transacción e historia

SERIALIZABLE y lock de aeronave, snapshot previo completo exacto, comparación adicional en UPDATE (compare-and-swap). Actualiza solo manufacturer/model/serial_number/updated_at. updated_at se genera en servidor; las fechas de componentes no se inventan.

Inserta AIRCRAFT_IDENTITY_CORRECTED USER/MANUAL, entity AIRCRAFT, con actor canónico, UUID, before/after completos (incluyen serie y versión), motivo y fingerprint SHA-256 del request normalizado y actor. Conserva AIRCRAFT_CREATED y cualquier evidencia anterior. El fingerprint no es autorización ni reemplaza la sesión; identifica reintentos exactos.

Fallo antes del COMMIT (incluido Audit) => wrapper hace ROLLBACK. Ante pérdida de confirmación del COMMIT, no se presume que no ocurrió: reenviar el request exacto permite reconocer el resultado por Audit; la transacción conserva atomicidad, sin escrituras parciales. SERIALIZATION_FAILURE 40001 y deadlock 40P01 se devuelven como 409 tras rollback: el cliente vuelve a enviar el request entero, nunca una continuación parcial.

Un reintento idéntico por el mismo actor, mientras siga sin historial, busca el Audit previo bajo el lock: si fingerprint, actor, motivo, snapshot previo y estado actual exacto coinciden, devuelve 200 con alreadyApplied=true, mismo auditEventId e identity, **sin UPDATE ni nuevo Audit**. Una corrección previa diferente, varias correcciones, estado posterior cambiado, snapshot obsoleto o identidad ya corregida sin Audit compatible produce 409. Si después ya se configuró técnicamente, la regla de historial prevalece: 409, no se reabre el editor.

La ausencia se consulta bajo SERIALIZABLE tras bloquear la raíz; inserciones concurrentes con FK/locks y cambios de status pueden bloquear o abortar. No se afirma prueba real de dos sesiones PostgreSQL: la ejecución real/concurrencia en TEST sigue en el gate independiente.

## Validación local

- npm test: **274 PASS**, cero fallos; 30 pruebas nuevas sobre base 244.
- npm run lint: **PASS**.
- npm run build: **PASS**, 52 módulos, bundle UI sin cambios.
- git diff --check: **PASS**.

Pruebas ejecutan repositorio y endpoint reales con cliente pg simulado y wrapper real de BEGIN/SERIALIZABLE/COMMIT/ROLLBACK, sin sockets: flag OFF/inválido, sesión/rol/estado, UUID manipulado, Production/Sheets/conexión ajena/migrador, validación de transición/NULL/motivo/snapshot, cinco tipos de historial, CAS obsoleto por un microsegundo, Audit y rollback, request repetido sin duplicación, errores de serialización/deadlock, readback PATCH→GET y filtrado del snapshot. No equivalen a SQL real ni aceptación autenticada.

## Gate posterior

Revisión independiente del commit. Autorizar explícitamente entorno Preview TEST para la rama elegida, activación temporal de este flag y una corrección de identidad; no se hereda esa autorización del flag técnico. Verificar origen Google/sesión, binding runtime TEST y UUID. GET snapshot → revisión del payload → PATCH único → GET y SELECT independiente de raíz y Audit, contrastando before/after y original AIRCRAFT_CREATED. La serie NULL no borra la serie anterior de Audit.

La configuración posterior 2+2 conserva su flag y gate independientes y requiere cuatro fechas explícitas. Flights/Ownership siguen deshabilitados. No integrar Horas V2, SQL nuevo, migraciones, Production, main o Costs. La implementación no autoriza ejecutar ninguna de esas operaciones.
