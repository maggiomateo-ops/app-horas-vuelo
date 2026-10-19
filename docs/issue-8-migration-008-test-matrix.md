# Matriz propuesta — 008 y contratos de servicio

Esta matriz es un plan de pruebas, **no resultados PASS**. Niveles: S=estático sin SQL; U=unitario de servicio con dependencias inyectadas; I=integración PostgreSQL aislada con rol real, solo después de autorización. No se usa Neon compartido para esta iteración. El diseño no implementa los futuros tests U/I.

| ID | Nivel | Caso | Resultado verificable |
| --- | --- | --- | --- |
| S01 | S | Comparar HEAD/branch/status y cambios respecto del checkpoint | Rama autorizada; commit previo intacto; solo diseño nuevo |
| S02 | S | Hash 006/007 y diff contra HEAD | Sin edición de migraciones históricas |
| S03 | S | Revisar SQL sin ejecutarlo | Bloqueador incondicional antes de primer DDL; ocho tablas nuevas; sin DML de backfill, conexiones, grants DELETE o UPDATE de settlement |
| S04 | S | Tests previos y lint | Registrar resultado real, incluyendo fallos de herramientas/dependencias |
| I01 | I | Quitar bloqueo únicamente en copia aprobada y aplicar a fixture 001–007 | SQL compila; FK/grants/triggers se instalan; no se aplica aquí |
| I02 | I | Verificar rol runtime efectivo y permisos heredados | ACL/bindings/batches SELECT/INSERT donde se define; mandatos SELECT; detalles UPDATE solo retiro; snapshots/Audit append-only |
| I03 | I | Dos raíces/ninguna raíz, binding repetido, avión ajeno, target scope ajeno | CHECK/UNIQUE/FK rechazan; sin filas parciales |
| I04 | I | Grant sin targets; issuer distinto del mandato, usuario inactivo | Servicio rechaza y rollback aunque SQL acepte el encabezado |
| U01 | U | Flags absent/false/true/invalid; fuente SHEETS | Mutaciones fail-closed antes de DB; true solo POSTGRES; leer sin flag |
| U02 | U | OWNER/ADMIN actual sin mandato financiero; party legal/pilot sin mandato | Cero lecturas/mutaciones/divulgaciones; no inferencia por nombre/correo |
| U03 | U | Mandato + OWNER activo y mismo avión | Leer ámbito; modificar solo OPEN editable; otra aeronave denegada |
| U04 | U | PILOT/VIEWER o miembro revocado con mandato | Sin economía mutable; lectura/divulgación según política P1/P2 aprobada |
| U05 | U | Transferencia A→B; cuenta A fuera de membresía y cuenta B OWNER | B no hereda historial; A retiene acceso privado conforme P2; datos operativos no se divulgan por ACL financiera |
| U06 | U | Usuario receptor identificado por UUID explícito | Solo grant vigente; sin coincidencias por email/nombre; usuario ajeno no accede |
| U07 | U | Grant período/evento y nuevo gasto agregado posteriormente | Lista congelada de IDs; nuevo gasto no aparece |
| U08 | U | Grant a gasto, evento, settlement y FK fuente | No acceso transitivo a otro gasto/settlement/vuelo; proyección no filtra source_snapshot, Audit, notas o totales ocultos |
| U09 | U | Listados, búsqueda, paginación, dashboard, export/download | Mismo filtro financiero en cada consulta; no IDs/counts de registros no autorizados; no rutas laterales |
| U10 | U | Dos grants superpuestos, revocar uno | El otro mantiene su alcance explícito; UI no afirma revocación global |
| U11 | U | Revocar como emisor original tras perder OWNER/membresía/mandato | Revocación permitida conforme P2; no concede lectura ni edición; usuario ajeno denegado |
| U12 | U | Revocar con flag apagado; emisor desactivado | Resultado de política P2 cerrada; ningún bypass improvisado |
| U13 | U | Mandato organización explícito; cambia representante | Ningún grant por cargo/email; revocación del mandato previo y efecto sobre grants según P1 |
| U14 | U | Registro tardío previo a transferencia | Scope explícito autorizado; no scope inferido por fecha/payer/creador |
| U15 | U | Evento o settlement mixto y sucesor de otro scope | Denegar/cuarentena según P3; sin UPDATE de evidencia; no ampliar grant original al sucesor |
| U16 | U | Binding faltante, datos históricos ambiguos | Invisible y no modificable; sin fallback a aircraft_id o OWNER |
| I05 | I | Grant y revoke concurrentes; revoke y lectura desde otra conexión | Lock por scope; toda consulta autorizada tras commit revoke falla; consulta previa se ordena antes; sin cache ACL |
| I06 | I | SERIALIZABLE esperando revocación | try-lock falla→rollback→snapshot nuevo; nunca autoriza con snapshot pre-revoke tras esperar |
| I07 | I | Paginación/export en cola + revoke entre peticiones | Próxima página/ejecución/descarga reautoriza; archivo ya entregado no se borra retroactivamente |
| I08 | I | Dos scopes bloqueados en orden distinto por payload | Servicio ordena UUID; sin deadlock evitable; retry de transacción completa |
| U17 | U | Pago 50 A + 50 B→100 A | Valores retirados preservados, activos suman 100, ningún pago ficticio; IDs de reemplazo nuevos |
| U18 | U | CUSTOM 50/50 A/B→DIRECT A 100 | Dos retiradas, una asignación activa, nueva A no choca con retirada A |
| I09 | I | Dos asignaciones activas de misma party/gasto | UNIQUE parcial rechaza; múltiples retiradas históricas permitidas |
| I10 | I | UPDATE monto/party/porcentaje/expense_id o reactivar fila retirada | Privilegios/trigger rechazan; no modificación in-place de evidencia |
| I11 | I | Retiro parcial de metadatos, batch de otro gasto, versión/actor incorrectos | CHECK/FK/trigger rechazan y rollback |
| I12 | I | Nueva fila con batch NULL o ya retirada | Trigger rechaza; filas legacy previas conservan NULL sin actor inventado |
| U19 | U | Gasto VOID, evento SETTLED, gasto en settlement por período | Corrección denegada aunque expenses.status siga OPEN |
| I13 | I | Corrección vs settlement simultáneos | Ambos bloquean expense; solo una secuencia coherente se confirma; ninguna evidencia parcial |
| I14 | I | Dos correcciones con misma expected version | Una confirma; otra 409; UNIQUE batch y CAS evitan doble avance |
| U20 | U/I | Replay mismo request; request reutilizado con distinto payload | Replay devuelve resultado original sin nueva auditoría; distinto contenido/actor => 409 |
| U21 | U | Retirar todos sin reemplazo; suma pagos≠importe; porcentajes≠100 | Rollback total de retiros, inserciones, batch, versión y Audit |
| U22 | U | NULL/faltantes, cero/negativo, límites numeric, muchas parties, monedas | Rechazo explícito; enteros decimales exactos, sin float; no conversión FX |
| U23 | U | Residuo de un centavo y porcentaje a cuatro decimales | Regla aprobada determinista; suma exacta y sin contribución positiva ficticia |
| U24 | U/I | Falla Audit tras todos los cambios; falla trigger/constraint/COMMIT 40001 | Rollback íntegro; sin respuesta de éxito; retry idempotente |
| I15 | I | UPDATE/DELETE de grants, revokes, bindings, batches y snapshots como runtime | Rechazado por privilegios; solo inserts permitidos previstos |
| I16 | I | Fixtures legacy vacíos/no vacíos/mixtos y manifiesto incompleto | Sin defaults ACL; ambiguous queda inaccesible; no modificación de snapshots; rollback sin permisos parciales |
| I17 | I | UNIQUE nombres aircraft globales y split de settlement por scopes | Confirmar compatibilidad real con elección P3; no afirmar soporte multiámbito con índices de 007 intactos |

Después de aprobar P1–P5: convertir casos U/I en tests ejecutables, validar compilación SQL y grants reales en entorno aislado autorizado, y obtener revisión independiente antes de cualquier TEST apply. Esto no sustituye la matriz completa de liquidaciones de Issue #8.
