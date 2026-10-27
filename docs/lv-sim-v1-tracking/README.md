# LV-SIM: configuración y seguimiento V1

Base verificada local y origin: ebadb2059912ad3f11e2dac786fe19a56d8b7f32.
Rama: codex/lv-sim-v1-tracking-reference. Sin integración de Hours V2.

## Contrato implementado

Alta técnica N posiciones, cada una con instalación física opcional, identidad física opcional, elección explícita CURRENT_REFERENCE, fecha de seguimiento obligatoria y referencia TIS opcional. Vacío es NULL; cero solo si fue declarado. No se usa opening_tis_hours como sustituto de referencia actual. HISTORICAL_IMPORT no se acepta. Revisión/cancelación conserva valores; guardado requiere lectura GET fresca: un fallo de lectura informa guardado no verificado y pide recargar, sin repetir PATCH automáticamente.

Las instalaciones nuevas guardan installed_on y opening_tis_hours separados de tracking_started_on y tracking_reference_tis_hours. El alta actual deja opening_tis_hours NULL. La fecha física no se infiere. Los flujos de reemplazo ya existentes mantienen sus reglas de fecha/boundary y opening_tis_hours; no se reinterpretan sus datos.

Historias V1 nuevas: ACTIVE + current_revision_id, inicio inclusivo, fin de instalación exclusivo salvo boundaries históricos explícitos. Referencia TIS y utilización posterior se muestran separadas. La utilización relativa usa TIS canónico del casco, no FT, ni engine runtime, TSN, TSO, Hobbs o tacómetro. La referencia desconocida sigue NULL aunque se muestren horas registradas desde inicio; un vuelo sin fecha queda fuera del tramo nuevo y TIS faltante deja utilización desconocida. Corrección/VOID reconstruyen desde las revisiones operativas vigentes, sin acumular versiones. Los ajustes anteriores a una referencia nueva no se suman de nuevo. Instalaciones sin tracking_started_on conservan la proyección V1 previa: sin backfill ni fechas deducidas.

## Evidencia canónica / solo lecturas (2026-10-27)

Se consultaron ambos Sheets: Product & Data Model, D-053–D-059, D-207, D-307, D-311; Schema Catalog, component_installations. D-207 exige fecha física en altas normales anteriores; esta nueva instrucción funcional autoriza fecha desconocida en el alta CURRENT_REFERENCE con ancla explícita separada. No se edita el registro histórico de D-207 ni se declara aprobada una migración por esta implementación.

Neon TEST red-pine-78283204 / br-billowing-band-b62jj1ab / app_horas:
LV-SIM 96d849aa-2827-4aa3-b02b-6671577444a7 = Piper / PA-34 Seneca; configuraciones 0, instalaciones 0, vuelos 0; OWNER ACTIVE 1, titulares legales 0, personas autorizadas 0, baseline existente 1 (no alterado). Faltan los dos campos nuevos. Ledger 001–008, sin 009/010. Ninguna escritura ejecutada.

008 oficial copiado byte por byte desde codex/reconcile-migration-008: SHA-256 30df860f6ba51617e93c55be21e8d2355aba734977dfb3db6bf0776b5c07c160. No se ejecuta ni se modifica Costs. 009 sigue reservado. Runner ordena versiones presentes, no exige continuidad: 010 es admitida con 009 ausente; 008 coincidente se omite, mismatch bloquea (test sobre función real del runner).

## Migración / gates

010_component_tracking_reference_v1.sql: únicamente dos columnas nullable y CHECK, sin tablas nuevas, UPDATE/backfill ni GRANT. Requiere consentimiento explícito de la sesión de migración mediante app.v1_tracking_migration=approved_test. No hay defaults que inventen fechas/horas. El API rechaza antes de cualquier INSERT cuando faltan columnas; las lecturas usan proyección JSON compatible con 001–008 y no dejan indisponible LV-MHZ.

Preparado preflight.sql, NO EJECUTADO. Ejecutar únicamente en clon descartable TEST con rol de migración autorizado, después del gate independiente. Verifica numeración, aplica 010 dentro de transacción, usa fixtures TEMP, prueba CHECKs, muestra privilegios/ledger y fuerza ROLLBACK. Readback debe tener 0 campos agregados y ledger intacto. El runner no se usa para este preflight porque realiza COMMIT por migración. Precisión textual se valida antes de conversión en cliente/servidor; PostgreSQL numeric(10,1) por sí solo puede redondear literales de mayor escala y no sustituye esa validación.

Rollback antes de uso: ROLLBACK del preflight. Después de DDL persistente autorizado, rollback de aplicación conserva columnas y datos. No eliminar columnas con referencias ya registradas; cualquier reversión DDL requiere nueva revisión, comprobación de ausencia de uso y coordinación del ledger. No ejecutar DROP ni alterar el ledger automáticamente.

## Validación y aceptación pendiente

Suite completa y gates consignados en la entrega. Nuevos tests: 2+2, NULL/0, modo explícito, fechas/precisión, inicio y reemplazos, FT 0.8 distinto de TIS 1.2, corrección/VOID en proyección, referencias conocidas/desconocidas, schema gate, Audit/intermediate failure, lectura posterior obligatoria y artefacto 008/runner. Se conservan las pruebas existentes OWNER/PILOT/VIEWER, canary UUID y aislamientos HTTP. Los mocks no acreditan una transacción PostgreSQL real.

Smoke.mjs reproduce UI real con fixtures y PATCH/GET interceptados: desktop claro y móvil oscuro 390 px; N=2+2, referencia 100.1 y tres desconocidas, instalación NULL, cancelación/revisión, readback, sin overflow ni pageerror. Capturas desktop-review.png, mobile-review.png, mobile-readback.png. Solo son datos ficticios locales. No prueba persistencia Neon ni vuelo real.

Para aceptación real falta, en orden:
1. Preflight SQL independiente en clon, rollback/readback/privilegios/ledger PASS, revisión del contrato y autorización de DDL TEST padre.
2. Aplicación autorizada de 010, sin ejecutar 008 otra vez; verificación de columnas y ledger.
3. Overrides específicos de esta nueva rama y Preview TEST; no se copiaron secretos ni se cambiaron flags/entornos. El scope nuevo falla cerrado sin pin UUID; no hereda habilitación global.
4. Sesión OWNER autenticada accesible; fecha(s) de seguimiento expresas, referencias opcionales; revisión y guardado 2+2, GET fresco y SELECT de cuatro instalaciones/un único Audit.
5. Declarar partes/titulares/porcentajes ficticios y piloto autorizado explícitos mediante flujos canónicos. OWNER no crea ownership legal. No hay titulares ni piloto todavía.
6. Vuelo sintético por Registro con FT=0.8 y TIS=1.2 (datos de prueba revisados, sin convertirlos); comprobar root/revisión inmutable/Audit y una fila en aeronave y cada instalación aplicable; confirmar 409 si se repite configuración y aislamiento de LV-MHZ. No se ha ejecutado.

No se declara aceptación autenticada. Sin cambios de Neon, Vercel, Production, main, flags, datos LV-MHZ ni permisos generales.
