# Preflight posterior — preparado, NO ejecutado

No lanzar contra TEST padre ni Production. Crear rama descartable solo con aprobación separada; fixtures totalmente sintéticas de dos aeronaves A/B, OWNER ACTIVE e inactivo, motores N posiciones y dos episodios. Registrar endpoint/branch/rol sin secretos y verificar que no coincidan con entornos protegidos. Este documento no autoriza crear rama Neon ni ejecutar SQL.

1. Releer ledger, constraints, índices y privilegios efectivos; DDL propuesta no está en runner. Aplicar solo a rama descartable autorizada; documentar revisión y hash.
2. Preparar fixtures con IDs aleatorios, jamás LV-MHZ/LV-SIM/LV-TST. SQL preparado requiere sentinel de sesión `hours_v2.disposable_preflight=approved-synthetic-only` y fixture_aircraft_a/b, fixture_plan_b. Ejecutar `preflight-assertions.sql` con ON_ERROR_STOP; resultados esperados: conversión/ROUND_HALF_UP/PK/NULL PASS; FK cruzada rechazada; ROLLBACK.
3. Matriz SQL adicional a ejecutar con SAVEPOINT y asserts de SQLSTATE, no solo comprobar mensajes:

| Caso | Resultado esperado |
| --- | --- |
| Misma revisión/instalación/base en run1 y run2, scopes válidos | Ambos insertan; dentro del mismo run duplicado falla 23505 |
| Revisión de vuelo B en snapshot A; instalación B en run A; staged B en run A | 23503 en cada vínculo compuesto |
| TSO conocido sin episodio; resolución UNKNOWN con segundos no NULL; MATCH con diferencia no cero | 23514 |
| Política tolerance_seconds positiva o negativa | 23514; NULL política nunca confirmable |
| Confirmación de run no confirmable | 23503; rechazo aplicación previo además requerido |
| Sucesora con aeronave distinta, secuencia salteada, dos sucesoras del mismo predecessor | 23503/23514/23505 según caso |
| Reintento mismo request/payload/actor/scope | Aplicación devuelve misma aceptación; INSERT duplicado aislado 23505 |
| Mismo request con otro actor/scope/payload | 409 sin nuevas filas ni Audit de éxito |
| Confirmación fallida después de crear primeras revisiones | ROLLBACK integral: cero nuevas raíces/revisiones/lineage/aceptaciones/Audit de éxito |
| Import row candidato nunca confirmado | No Flight Records operativos; NULL desconocidos intactos |
| Rol runtime UPDATE/DELETE de snapshot, revisiones, Audit | 42501. Bloqueante hasta definir grants/defensas aprobados |
| Scale >6 o bases incompatibles | Rechazo DTO antes del cast. SQL numeric por sí solo puede redondear: no es un test positivo de protección |

Estas últimas pruebas requieren el confirmador/DTO/fixtures aún no implementados; no se presenta pseudocódigo como integración PASS.

## Dos sesiones y protocolo compartido

Todos los mutadores de vuelos, revisiones/VOID, instalaciones, ajustes, referencias y confirmaciones deben tomar lock transaccional sobre la misma fila `app.aircraft` y después operar con SERIALIZABLE. Orden determinista por UUID para operaciones multiaeronave; nunca empezar por run y luego aeronave. Leer head, sesión/membership ACTIVE, capacidades/canary, estado del batch y manifiesto completo dentro de la transacción; reconstruir hash bajo locks. El lock por sí solo no reemplaza validar ni registrar invalidación de aceptaciones. Sin participación de un solo mutador, bloquear lanzamiento V2.

| Escenario A / B | Barrera y resultado exigido |
| --- | --- |
| Dos confirmaciones del mismo head | A toma lock; B espera. A confirma. B aborta 40001 o detecta head nuevo tras retry y devuelve conflicto; una sola sucesora |
| Confirmación / vuelo retroactivo | A captura manifiesto bajo lock; B no puede insertar antes de A commit. B luego inserta e invalida aceptación atómicamente. Invertir orden: A ve nuevo vuelo y rechaza preview stale |
| Confirmación / VOID o edición | Igual protocolo; nunca aceptación vigente que referencia revisión reemplazada sin invalidación |
| Confirmación / instalación o overhaul | Cobertura/episode manifest revalidados; sin atribución a motor de otra posición o período |
| Callback duplicado / cancelación-expiración | Callback valida batch/scope/expiry; no resucita archivo/candidato cancelado. Cleanup idempotente; sin confirmación después de expiry |
| Misma clave request concurrente | Un resultado, conflicto si payload distinto; retry 40001 limitado y con revalidación completa de sesión/gates |
| Revocación OWNER / confirmación | Lock/revalidación compartida con mutación de membresía; confirmar nunca usa privilegio revocado ya comprometido. Revisar implementación de sesión antes de afirmar garantía |

Capturar SQLSTATE, tiempos de barrera, counts e IDs sintéticos, evidencia de aislamiento y readback independiente. Repetir con orden inverso. No reintentar 23505 como éxito sin comparar identidad de request. No desplegar tests destructivos ni rutas fixture a Preview.

Teardown: rollback de transacción durante pruebas; `rollback.sql` solo para rama vacía sin historia y finalmente eliminar rama descartable autorizada. Nunca CASCADE sobre historia. Si hay datos confirmados reales, corrección append-only/forward migration con aprobación propia.
