# Costs 3.3 V1 — implementación para revisión

Base: `719d3de0b3629573df22e42bac5b90f92bd31a0a`, rama `review/issue-8-migration-008-design`. D-042 y D-297–D-306, Roadmap 3.3 y Schema Catalog se consultaron de nuevo antes de editar. D-306 conserva el núcleo V1 y difiere sharing, delegaciones y ámbitos mixtos.

## Entrega

Repositorio PostgreSQL `api/_postgresCostsRepository.js`, dominio decimal `api/_costsDomain.js`, handler interno `api/_costsHttp.js` y routing en `api/settings.js`. No hay función serverless nueva: continúan las doce existentes. Interfaz `CostsPanel` integrada como **Gastos**, con acceso al archivo incluso si ya no hay aeronaves con membresía activa. No consulta Settings/ownership operativo para inferir autoridad financiera.

Incluye conceptos, tipos de evento, eventos, gastos con pagos reales y cuatro métodos de reparto, correcciones abiertas con historial, liquidaciones por evento/período y consulta de snapshots. Los pagos y responsabilidades siguen siendo entidades separadas. Una sola party responsable/pagadora produce saldo cero, sin deuda consigo misma. No hay conversión de monedas, edición de snapshots, divulgación ni aprovisionamiento desde UI.

Las escrituras pasan por capacidad fail-closed antes de abrir PostgreSQL, luego usuario ACTIVE + mandato financiero vigente + OWNER/membresía/aeronave ACTIVE. Lecturas requieren usuario activo y mandato explícito; no membresía aeronáutica activa. Usuario deshabilitado, mandato ausente/revocado, UUID de otro archivo o aeronave => denegación. Las respuestas usan Cache-Control private,no-store.

## Contrato API

GET `/api/settings?resource=costs&action=archives`: `{ok:true,costs:{archives:[{financial_scope_id,aircraft_id,label}]}}`. No requiere aircraft_id; no devuelve archivos no autorizados.

GET `/api/settings?resource=costs&aircraft_id=<uuid>&financial_scope_id=<uuid>`: `{ok:true,costs:{scope,writes_enabled,concepts,types,events,expenses,settlements,parties}}`. Gastos incluyen pagos/asignaciones activos y retirados, lotes de corrección, indicador frozen y cálculo actual del reparto abierto (o un error explícito de fuentes faltantes). Settlements incluyen líneas agregadas y el conjunto de gastos congelado; no se expone source_snapshot bruto ni Audit.

POST `/api/settings` (PATCH también aceptado) con:

```json
{
  "resource": "costs",
  "aircraft_id": "<UUID canónico>",
  "financial_scope_id": "<UUID de archivo autorizado>",
  "request_id": "<UUID estable del comando>",
  "action": "create_expense",
  "reason": "Registro o motivo de corrección",
  "data": {}
}
```

Respuesta 200 `{ok:true,result:...}`. El actor se toma de la sesión firmada, no del body.

| action | data |
| --- | --- |
| create_concept | name, cost_class FIXED/VARIABLE, default_allocation_method |
| create_event_type | name, boundary_basis NONE/FLIGHT_TIME/LANDINGS/PRESSURIZATION_CYCLES/ENGINE_CYCLES; component_position entero positivo solo para ENGINE_CYCLES |
| create_event | cost_event_type_id, title, event_date, previous_cost_event_id opcional, boundary_after_flight_id opcional |
| correct_event | mismos campos + cost_event_id; solo OPEN; reason obligatorio |
| create_expense | cost_concept_id, expense_date, description opcional, amount string decimal, currency_code ISO de tres mayúsculas, cost_event_id opcional, allocation_method, payments[] y campos de reparto |
| correct_expense | conjunto completo corregido + expense_id + expected_details_version; reason obligatorio; rechaza toda fuente congelada |
| settle_event | cost_event_id OPEN del mismo archivo |
| settle_period | period_start_date, period_end_date inclusivos; solo gastos independientes de ese archivo |

Cada pago: `{payer_party_id,amount}`. CUSTOM: `allocations:[{party_id,allocation_percent}]`, suma 100.0000. DIRECT: `direct_party_id`. OWNERSHIP no acepta porcentajes derivados como autoridad; usa intereses efectivos a la fecha, siguiendo la semántica de fecha de Flight Records. UTILIZATION: `utilization_metric` y, solo para ENGINE_CYCLES, `utilization_component_position` entero positivo. Usa cada current_revision_id canónico y la instalación referenciada por su contador, con aeronave, posición y fechas verificadas. No asume un solo motor.

UTILIZATION requiere un evento y un límite anterior SETTLED explícito. No se inventa un intervalo para un gasto independiente: si faltan límites/atribución/contadores/instalación, el comando falla. Un evento real sin gastos puede cerrarse como límite operativo sin crear gasto, deuda ni settlement monetario ficticios. boundary_basis identifica la familia del límite; el intervalo real se expresa por fechas y, opcionalmente, vuelo de corte. La métrica económica sigue independiente por gasto. Cortes dentro del día sin orden temporal inequívoco se rechazan.

Dinero en centavos BigInt; porcentajes a cuatro decimales, cantidades de utilización a tres. Reparto por mayor resto, desempate por UUID. La suma de pagos debe coincidir con el importe; no se convierte ausencia en cero. Participaciones menores que la precisión admitida se rechazan sin inventar mínimos positivos.

Errores: 400 UUID/acción inválidos; 401 sesión; 403 lectura autorizada pero sin escritura OWNER; 404 sin mandato/ámbito/objeto autorizado; 409 contención, versión obsoleta, request reutilizado con otro contenido o cierre existente; 422 datos/reglas/fuentes faltantes; 503 flag OFF o esquema aún no listo; 500 errores internos sanitizados. No se exponen datos del objeto ajeno ni SQL.

## Transacciones, correcciones y snapshots

SERIALIZABLE en mutaciones; try-locks por aeronave y scope, luego locks de raíces. Contención => rollback/409, sin reusar snapshot obsoleto. Corrección registra lote y avanza details_version con CAS; conserva valores originales retirando filas e insertando reemplazos, sin DELETE. Audit y business state se confirman juntos. Un request repetido, mismo actor/archivo/contenido, devuelve el resultado previo sin duplicar filas/Audit; otro contenido => 409. La UI conserva el UUID de reintento.

Antes de liquidar se validan fuentes y todo gasto seleccionado; se agrupa por moneda. Se insertan header, expense_lines, party_lines, owner_lines y utilization_lines normalizados y binding, con procedencia complementaria. Solo después se cierra el evento y se inserta Audit. Gastos congelados por período también quedan inmodificables aunque expenses.status siga OPEN. Las lecturas de resultados SETTLED usan evidencia congelada; no recalculan historia.

No se agrega corrección especial de liquidaciones cerradas en V1. Cualquier ajuste futuro requiere sucesor explícito conforme D-298/D-302; nunca UPDATE del original. Tampoco se cambia la unicidad original evento/período/moneda de 007 para sortear conflictos entre archivos. Casos mixtos/conflictivos fallan cerrados.

## Preflight real y rollback

Target único autorizado: proyecto `red-pine-78283204`, temporal `br-fancy-hall-b6h6g74f`, endpoint directo `ep-ancient-recipe-b6cjj1qz`, DB app_horas. Se verificó que la temporal no es primary/default y deriva del TEST indicado. No se modificó TEST original ni Production.

La migración oficial mantiene el guard incondicional y su SHA256 **30df860f6ba51617e93c55be21e8d2355aba734977dfb3db6bf0776b5c07c160**. El ejecutor retira exclusivamente ese primer statement en memoria, fija el target y separa sentencias respetando strings/comentarios/dollar bodies. El conector `run_sql_transaction` acepta la lista; no se envían varios comandos como una sentencia preparada.

Preflight de esquema: 008 compiló y ejecutó sus constraints, función, triggers y comprobaciones has_table_privilege/has_column_privilege para app_runtime, app_horas_runtime y PUBLIC. Alcanzó el error terminal esperado `COSTS_008_PREFLIGHT_VALIDATED_ROLLBACK`. Una lectura independiente confirmó 008 ausente, ledger 001–007, columnas/funciones/triggers/ACL y conteos originales intactos.

Se ejecutó además el **repositorio real** mediante pg en la misma temporal, con fixture sintética dentro de la transacción, sin COMMIT. El ejecutor no puede retargetearse al TEST original. Conexión por stdin sin eco, nunca en argv/env/archivos/logs. Se ejecutaron:

- Alta, lectura, reparto CUSTOM/DIRECT/OWNERSHIP y corrección real; request replay y versión obsoleta.
- Dos administraciones con mandatos explícitos: aislamiento de archivos y conceptos homónimos privados; usuario deshabilitado denegado.
- Contención de advisory lock entre dos conexiones, denegada antes de mutar.
- Fallo de Audit inyectado en el cliente tras DML real: rollback del savepoint revierte filas de negocio.
- Handler API → repositorio → PostgreSQL → respuesta.
- Tres métricas en un mismo evento: FLIGHT_TIME, LANDINGS y ENGINE_CYCLES posición 3, con instalación y revisión exactas.
- Liquidaciones reales por evento y período, monedas separadas, party/owner lines y rechazo de correcciones congeladas.
- Lectura del titular financiero sin membresía activa; revocación financiera posterior deniega.
- Error SQL terminal obligatorio, ROLLBACK y verificación independiente desde otra conexión.

Fingerprint final (catálogos + ACL + conteos) **4dc61813ae41b37c9e2f8bc0fb5dbdf0**, igual antes/después. Resultado persistente: **cero escrituras lógicas**. No se registró 008 en el ledger. El WAL/actividad transitoria de la prueba no se presenta como ausencia de ejecución.

Se corrigió además un fallo de la fixture de contención: una operación previa retenía el advisory lock de la transacción exterior. El probe ahora usa try-lock y timeouts, antes de esa operación; la ejecución final completó diez grupos de comprobaciones y rollback.

Clasificación del fallo observado: **permiso de infraestructura**, app_horas_migration no puede SET ROLE ni al LOGIN ni al grupo runtime. No se ampliaron membresías. DML/trigger tests y repositorio corrieron como migrador; permisos efectivos de ambos runtime se comprobaron en PostgreSQL mediante has_* y el validador independiente. **No se declara probado DML directo como app_horas_runtime.** Ese smoke queda para un target con 008 aplicada autorizado por separado. No bloquea demostrar el rollback ni implementar el backend.

Reproductores: scripts/lib/costs-008-preflight.mjs (plan/ejecutor inyectado para conector o pg); scripts/costs-008-repository-preflight.mjs --stdin-temporary-target (requiere URL temporal por stdin seguro, siempre rollback). No ejecutarlos con una URL de otro branch. No usar db/migrate.js para esta prueba.

## Verificación local/UI

`npm test`: **199/199 PASS**. `npm run lint`: PASS sin warnings. `npm run build`: PASS. Checks de sintaxis de ejecutores/provisión y `git diff --check`: PASS. 006/007 conservan sus hashes y 008 su guard. No se añadieron dependencias.

Los 16 tests nuevos de test/postgres-costs.test.js cubren dominio, precisión, privacidad/roles/flag, corrección/idempotencia, snapshots, monedas, Audit/rollback, conflictos, router autenticado y servicio de UI. No se confunden mocks con PostgreSQL real: la prueba real anterior es una ejecución separada, no un test npm que escriba en una base compartida.

Fixture visual reproducible: `node scripts/costs-ui-fixture.mjs --synthetic-only`, solo 127.0.0.1:4449/costs-fixture y sin conexión a DB. Se verificaron estado vacío, alta con payer distinto del responsable, detalle, formulario de corrección precargado y confirmación/cierre por período con saldos. Detectado y corregido el manejo del período antes de confirmar. La fixture es explícitamente sintética y no acredita autenticación/canary Preview. La captura local queda como evidencia de UI, no evidencia de datos TEST.

## Autorización financiera inicial — procedimiento separado, NO ejecutado

1. Después de aprobar/aplicar 008 en un target expresamente autorizado, un responsable financiero aprueba **fuera del endpoint** el archivo, aeronave, usuarios y facultades. No deducirlos por OWNER, nombres, emails o propiedad legal.
2. Resolver UUID existentes mediante consultas read-only: aircraft.aircraft_id; users.user_id y status; user_person_links verificado si sirve para identificar a la persona. Esa resolución identifica, no autoriza. El aprobador también debe tener user_id canónico y autoridad humana verificable. Si falta, detener provisión, sin crear identidades ficticias.
3. Preparar manifiesto con aircraft_id; financial_scope_id nuevo; label; approved_by_user_id; approval_reference verificable; request_id; mandates[{financial_authority_id nuevo,user_id existente}]; approval_verified=true **solo después de revisión real**. Ese booleano no es prueba criptográfica ni permiso suministrable por clientes.
4. `buildCostsAuthorityPlan(manifest)` de scripts/lib/costs-authority-provisioning.mjs **solo genera** el plan parametrizado. No lee env, conecta o ejecuta; no existe ruta HTTP para invocarlo. Revisar UUID y evidencia humana antes de aprobar ejecución.
5. Ejecución privilegiada autorizada aparte: verificar target/rol/esquema; una transacción SERIALIZABLE; exigir requireLocked=true y cardinalidades requireRows del plan; insertar scope, mandatos y Audit juntos. Cualquier discrepancia => rollback. No auto-backfill, copiar historia o reasignar datos previos. Grants duplicados/identificadores reutilizados fallan sin sobrescribir.
6. Verificar por readback el mandato exacto y la denegación de otro usuario/archivo. El runtime conserva SELECT-only sobre ACL, sin capacidad de autoconcederse autoridad.

Revocación financiera, distinta de retiro de membresía: procedimiento privilegiado aprobado y auditado, lock del scope, INSERT en authority_revocations con actor/motivo; no borrar mandato ni historia. Perder membresía mantiene lectura del archivo propio según D-305. No existe UI de delegación/sharing en V1.

## Gates restantes y Preview

Actualización del gate LOGIN sobre base `239c75b7`: **BLOCKED**, no PASS de DML runtime. La conexión directa real sí funciona. Ver [resultado reproducible y bloqueo de visibilidad](issue-8-costs-runtime-gate.md) y [salida verificable](evidence/costs-008-runtime-gate.json). No se modificó la implementación Costs ni la migración para sortearlo.

El código está disponible para revisión; **no equivale a aceptar Preview ni a haber habilitado Costs**. Restan acciones deliberadamente separadas:

1. ChatGPT revisa commit y evidencia del preflight; autoriza aplicar la versión exacta 008 al target elegido. El guard oficial no se quitó aquí.
2. Aprobar manifiesto financiero inicial con UUID concretos y ejecutarlo con Audit. En las fuentes revisadas no hay tal mandato verificado: mientras falte, no se debe inventar acceso; la aplicación devuelve archivo vacío/denegación.
3. En Preview autorizada, con 008 y mandato ya presentes: flag OFF, usuario válido puede leer; POST devuelve 503 sin DML; usuario ajeno/revocado/deshabilitado no accede; anterior titular lee sin membresía. Verificar privilegios del LOGIN runtime real, no solo del grupo.
4. Solo tras autorización distinta de ésta, habilitar escritura en el entorno Preview seleccionado y ejecutar el canary económico aprobado. Verificar UI→API→DB→Audit, tres métodos manuales y utilización con fuentes completas, cierre por moneda y rechazo de corrección SETTLED. No hacerlo en Production ni sobre datos reales sin autorización específica.

No se habilitaron flags, ejecutaron migraciones sobre TEST original, hicieron deploys de Production, modificó main ni realizó cutover. Sharing, representantes y ámbitos mixtos permanecen fuera de V1; no requieren nuevas discusiones para esta entrega.
