# Matriz de verificación — Costs V1 / 008

> Matriz base del diseño 719d3de. Ver [resultados actuales de implementación y preflight](issue-8-costs-v1-delivery.md): tests npm y ejecución PostgreSQL se distinguen expresamente. El SQL oficial sigue bloqueado.

D-306. Se retiran de V1 los casos de divulgación/delegación/mixtos; no se implementan workflows futuros. S=estático ejecutable; U=unitario offline; I=integración futura en PostgreSQL aislado y autorizado. Solo S/U de diseño y del validador de permisos se ejecutan en este commit; las pruebas de servicios económicos listadas son pendientes, no PASS.

## Tests ejecutables añadidos

`test/costs-v1-migration-design.test.js`:

| Test | Evidencia |
| --- | --- |
| Bloqueo anterior a DDL; cinco tablas; sin seeds de autoridad/sharing | Contrato estático SQL |
| FK tipadas/aircraft, corrección trazable, UNIQUE parcial, congelamiento | Regresión estática |
| REVOKE de tabla y columnas de ambos roles y PUBLIC; uso de has_* | Regresión del defecto detectado |
| Evidencia completa y segura de grupo/login/PUBLIC | Validador unitario |
| Grupo seguro + login con UPDATE directo; columna indebida; PUBLIC; snapshot mutable | Rechazo obligatorio |
| Superuser/roles extra/ownership/CREATE/INHERIT ausente/evidencia incompleta | Rechazo fail-closed |
| Colector SELECT-only inyectado | Sin conexión/DDL, sin efectos ni falsos PASS |

El fixture no representa privilegios observados en Neon. `readCostsV1PrivilegeEvidence(query)` no tiene conexión automática; la ejecución futura usa transacción read-only aprobada después de 008. Tests existentes de capability y hashes 006/007 siguen siendo obligatorios.

## Gates pendientes de la implementación / preflight

| ID | Nivel | Caso | Resultado requerido |
| --- | --- | --- | --- |
| A1 | U/I | OWNER ACTIVE sin mandato, ADMIN, propietario legal, payer o piloto | Sin acceso financiero ni mutación |
| A2 | U/I | OWNER + mandato del ámbito correcto vs otro avión/scope | Solo acceso/operación al ámbito autorizado |
| A3 | U/I | Anterior titular autorizado sin membresía | Lee su archivo D-305; no escribe ni ve comprador/operaciones |
| A4 | U/I | Usuario DISABLED, mandato ausente/revocado/ambiguo, binding ausente | Denegar, sin fallback por nombres/email/fechas |
| A5 | U/I | Transferencia/captura tardía/archivo previo | Ningún grant automático; OWNER actual no hereda datos |
| A6 | U/I | Dos administraciones con mismo concepto/tipo activo | Permitido en scopes distintos; duplicado dentro del mismo scope denegado |
| A7 | U/I | Catálogos, búsquedas, totales, paginación, referencias/source_snapshot | No filtrar datos/counts/IDs de ámbito ajeno |
| A8 | I | Revocación vs lectura/escritura concurrente | Locks compartidos de protocolo; snapshot nuevo tras try-lock fallido; acceso posterior al commit denegado |
| C1 | U/I | Pago A50+B50→A100, CUSTOM A/B→DIRECT A | Retirar conservando evidencia, activos exactos, sin deudas ficticias |
| C2 | I | UPDATE amount/party/expense_id/porcentaje o reactivar retirada | Rechazo por grants/trigger; UNIQUE solo sobre asignaciones activas |
| C3 | U/I | Gasto VOID, evento SETTLED, fuente en settlement de período | Sin corrección/VOID de evidencia congelada |
| C4 | U/I | Headers OPEN corregidos, versión obsoleta/replay/request conflict | Versión conjunta; idempotencia; 409 sin nuevas filas/Audit |
| C5 | U/I | Totales/porcentajes incorrectos, missing, cero, redondeo, monedas | Decimal exacto; no mezclar monedas; rollback completo |
| C6 | I | Corrección vs settle; dos correcciones misma versión | Solo secuencia coherente confirma; sin snapshots parciales |
| S1 | U/I | SETTLE evento/período, distintas métricas por gasto, instalación motor | Fuentes canónicas y evidencia exacta; matriz original Issue #8 sigue obligatoria |
| S2 | U/I | Snapshot cerrado, corrección posterior, sucesor explícito | Sin UPDATE/DELETE de originales; autoridad validada sobre nuevas fuentes |
| S3 | U/I | Evento/gastos/settlement multiscoped, colisión de original 007 | Bloquear ámbito mixto/conflicto; no cambiar unicidad silenciosamente |
| T1 | U/I | Falla Audit, constraint, trigger, COMMIT 40001 | Rollback de negocio+lote+versión+Audit |
| P1 | I | Compilar copia aprobada 008 en target aislado | SQL/PLpgSQL válido y transaccional; bloqueo retirado solo con autorización posterior |
| P2 | I | Grants directos login, heredados, PUBLIC de tabla y columnas | Normalizados; has_table_privilege/has_column_privilege seguros para ambos roles |
| P3 | I | Ownership, superuser, roles extra, CREATE, grants dependientes | Abort/Rollback; sin alterar roles globales para sortear el problema |
| P4 | I | UPDATE/DELETE/TRUNCATE en snapshots/Audit; UPDATE valores de detalles | Denegado en grupo y LOGIN; ningún privilegio PUBLIC |
| P5 | I | Backfill vacío/no vacío/ambiguo y autoridad no verificada | Sin seeds/default ACL; manifiesto aprobado; snapshots intactos |

El alcance de esta revisión es diseño+SQL bloqueado+tests pertinentes, no implementación completa del backend ni aceptación de Preview.
