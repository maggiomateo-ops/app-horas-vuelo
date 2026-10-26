> Preparación vigente de permisos, purga y concurrencia: [hours-v2-preflight-preparation.md](hours-v2-preflight-preparation.md). SQL fuera del runner; no ejecutado ni desplegado.

# Horas V2 — contrato técnico F2/F4/F6

2026-10-26. Base verificada `d7e1e5a17d0aefad394a326cf30aed33d2dc4e71`. **PROPOSED para congelación técnica; no aprobación funcional, DDL ni provisión.** Complementa y prevalece sobre la precisión/tolerancia preliminar de la revisión anterior. D-307 permanece CONFIRMED solo como intención de producto. D-308 permanece PROPOSED. Ningún resultado de tests cambia esos estados.

## Canon y alcance verificados

Se releyeron ambos Sheets, D-024, D-098, D-307, D-308 y Settings Matrix. Migraciones 001–007 y la evidencia de catálogo de la revisión base describen revisiones inmutables, instalación por componente, baseline/ajustes, batch/hash y Audit separado. No se abrió conexión Neon en esta revisión: el catálogo almacenado no demuestra que la base remota siga idéntica. Revalidar metadatos, ledger, región y privilegios efectivos antes del futuro preflight. No se consultaron ni modificaron registros de aeronaves.

D-024/D-098 ya CONFIRMED: FT/TIS canónicos son décimas, ROUND_HALF_UP **por Flight Record antes de sumar**; CLOCK/TACH conservan fuente. D-121 separa runtime motor. D-059/D-244 y V1 no se reinterpretan. Esta revisión no modifica src, api, migraciones, permisos, dependencias, flags ni datos.

## F2 — representación exacta y autoridad de base

Contrato `hours-units-v2.1` propuesto: transportar números como strings decimales; nunca IEEE-754. Conservar lexema original (incluidos ceros finales), unidad, representación, decimales observados y resolución física declarada (NULL si no consta), campo/archivo/hoja/fila, versión de mapeo y conversión. Un número XLSX requiere además lexema XML y formato de celda: ExcelJS Number por sí solo no garantiza recuperar la precisión original. Fuentes ambiguas, fórmula, fecha serial confundible con duración o coma decimal sin locale explícito quedan en staging. No ejecutar fórmulas ni usar cached results como evidencia confiable.

DTO numérico propuesto (todos los números de duración como strings, NULL explícito):

```json
{"raw":"1.50","unit":"HOURS","decimalPlaces":2,"resolution":null,"normalizedSeconds":"5400.000000","canonicalHours":null,"roundingDeltaSeconds":null,"conversionVersion":"hours-units-v2.1","cellRef":"mapped-sheet-1!C12"}
```

En `duration_evidence`, claves de campos permitidos (`flight_time`, `time_in_service`, runtimes por instalación UUID), sin celdas no mapeadas. Para FT/TIS, `canonicalHours` contiene la décima HALF_UP y `roundingDeltaSeconds = canonicalHours*3600 - normalizedSeconds`; ambos NULL si no se puede convertir. `decimalPlaces` conserva incluso precisión no soportada y `normalizedSeconds` queda NULL en ese caso. HH_MM declara resolución temporal si consta y no inventa decimales físicos. Hash de evidencia: UTF-8, claves ordenadas, números de duración en strings sin exponente, NULL conservado y arrays ordenados por identidad canónica; preservar lexema en `raw`. La serialización completa de manifests y pruebas cruzadas servidor/cliente sigue siendo gate de implementación.

Normalización exacta: segundos `numeric(24,6)`; ejemplos offline en microsegundos BigInt. Entrada soportada: hasta 12 dígitos enteros y 6 decimales de HOURS/MINUTES/SECONDS, o H+:MM con minutos 00–59. 1 h = 3600 s; 0.01 h = 36 s; 0:01 = 60 s exactamente. Ese almacenamiento cubre las bitácoras solicitadas; microsegundos son resolución de representación, **no exactitud física atribuida al instrumento**. Precisión mayor o representación no soportada conserva fuente y bloquea normalización; no se trunca. Validar límites/escala antes del cast SQL, porque numeric(p,s) puede redondear. Un resultado en horas se presenta exacto en h:mm/segundos o con marca explícita de aproximación; no ocultar fracciones periódicas como 1/60 h. Nunca sumar cadenas formateadas.

| Contador / dato | Fuente admisible | Acumulación y bloqueos |
| --- | --- | --- |
| TIS casco | Flight Record TIS canónico ACTIVE y revisión vigente; referencia AIRFRAME_TIS documentada | Sumar décimas canónicas en el intervalo anclado; no FT ni runtime motor como fallback. Mostrar diferencias fuente→canónico |
| Flight Time | FT canónico por vuelo, DIRECT/CLOCK según contrato V1 | Métrica independiente; nunca alimenta TIS/TSN/TSO automáticamente |
| Engine Running Time | Runtime del motor físico/instalación correspondiente, timestamps/contador y base documentados | V1 numeric(8,1) conserva su resolución; no fabricar centésimas. Fuente histórica de mayor precisión solo por contrato V2 aprobado; no escribirla en V1 perdiendo escala |
| Motor TSN/TSO | Observación explícita al instalar o iniciar seguimiento; incremento ENGINE_RUNTIME, o TIS únicamente con equivalencia operacional documentada por fabricante/bitácora y aprobada para esa instalación/período | Sin equivalencia aprobada, TIS no sustituye runtime. TSN no se reinicia; TSO requiere episodio overhaul y lectura explícita. Reemplazo conserva identidad e historia de cada componente |
| Hélice TSN/TSO | Lectura propia; uso de hélice documentado, o TIS/runtime de motor vinculado mediante equivalencia aprobada y cobertura de acople real | No asumir que toda hélice gira durante todo runtime del motor ni usar el motor de otra posición. Hasta aprobar esa atribución, DECLARED_ONLY |
| DECLARED_ONLY / base desconocida | Lectura original válida, base sin compatibilidad probada | Se muestra observación con fecha/precisión; absoluto derivado NULL. Seguimiento relativo independiente solo si tiene cobertura confiable |

`TIS`/`ENGINE_RUNTIME` en SQL identifican la base matemática; su mera igualdad no demuestra compatibilidad física. DTO/manifiesto debe incluir autoridad, documento, componente, período, vínculo motor-hélice, versión de regla y aprobación. No se propone una equivalencia global por clase. Sin evidencia, resolución UNKNOWN/AMBIGUOUS y resultado NULL. Cada instalación conserva fecha propia; referencias de instalación y seguimiento distintas. Referencia 1200.25 TSN + uso compatible 1.20 h = 1201.45; lectura 1200.25 sin cobertura no permite deducir ese total. NULL no equivale a cero.

## F4 — conciliación versionada sin banda de tolerancia

Política propuesta `hours-reconcile-exact-v2.1`: tolerancia 0 segundos, sin epsilon relativo/absoluto y sin autoaceptación. Política aprobada identificada por referencia de decisión del servidor, algoritmo y hash del manifiesto; nunca por aprobación o tolerancia enviada por cliente. SQL solo admite cero o NULL (política pendiente). Las fixtures offline no constituyen esa autoridad.

| Clase | Ejemplo | Tratamiento |
| --- | --- | --- |
| Conversión exacta | 1:30 y 1.50 h → 5400 s; diferencia 0 s | Equivalentes si base, período y componente coinciden. Aun así requieren revisión/confirmación explícita |
| Redondeo documentado | Dos vuelos fuente 0.05 h: 180+180 s; canónico HALF_UP 0.1+0.1 h: 720 s | Mostrar +360 s / +0.10 h fuente→canónico por vuelo y suma. No reemplazar por redondear la suma (0.1 h), ni clasificar la pérdida como coincidencia |
| Diferencia real | Derivado 100.01 h vs observado 100.00 h | +36 s, original +0.01 h, causa REAL_DIFFERENCE; bloquea. Resolución física 0.1 h no autoriza tolerancia de 0.05 h |
| Tramo desconocido | Falta fecha/instalación o contador del intervalo | Diferencia NULL, período visible, cobertura pendiente. No cero ni MATCH aunque extremos parezcan iguales |

Cada comparación retiene los dos originales/unidades/resoluciones, segundos exactos, delta con signo, proyección canónica y delta por redondeo, causa y evidencia. `roundingEvidence` en el ejemplo solo clasifica, nunca autoriza. Una diferencia de redondeo sigue bloqueando el absoluto comparado hasta aclarar una referencia compatible mediante evidencia y nueva revisión; no crear ajuste compensatorio sin causa documentada. Si un dominio relativo es válido, puede mantenerse visible sin certificar el absoluto pendiente.

Autoridad: OWNER ACTIVE declara/transcribe y confirma, pero su rol no prueba equivalencia técnica. Referencia identificable de bitácora/contador/documento técnico y su aplicabilidad; sin jerarquía inventada entre fuentes contradictorias. Conflicto requiere resolución documentada y nueva versión, no selección automática del mayor/menor valor. Correcciones de vuelos producen revisiones; VOID, nuevos retroactivos, cambios de instalaciones/episodios/mapeo/política invalidan la aceptación sin alterarla. Audit registra actor/acción/IDs/hash separado de la evidencia de negocio.

No doble conteo: identidad canónica por vuelo/revisión/instalación/base dentro de run; candidato verificado como duplicado se excluye y enlaza a revisión existente. Similitud no basta. Una aceptación sucesora sustituye la vista vigente, **no suma el total de la anterior**. Vuelo cubierto antes de la referencia no se suma después. Si nuevo histórico cambia el intervalo cubierto, reconstruir el snapshot completo y conciliar, sin sumar el lote ciegamente.

## F6 — proveedor, límites y ciclo de datos

**Proveedor propuesto: Vercel Blob PRIVATE, store exclusivo TEST/Preview en São Paulo `gru1`.** Compatible con hosting existente; no está contratado, creado, conectado ni verificado en la cuenta. La documentación oficial ofrece región São Paulo, cifrado AES-256 en reposo, acceso privado y URLs firmadas. TLS en tránsito. No asumir residencia integral: revisar DPA, subprocesadores, soporte, backups y tránsito/CDN antes de aprobar datos personales. No prometer borrado físico inmediato de backups del proveedor.

10 MiB (10,485,760 bytes) comprimidos, 10,000 filas de datos **globales entre todas las hojas**, 20 hojas incluidas ocultas; no 10k por hoja. Límites de admisión propuestos, no evidencia de capacidad del runtime. Añadir máximo 200,000 celdas no vacías, 2,000 entradas ZIP, 100 MiB expandidos y 1 MiB por celda. Rechazar relaciones externas, macros/OLE, ZIP cifrado, traversal, duplicados de pathname ZIP y estructuras XML no permitidas; fórmulas requieren reemplazo con valores respaldados. No confiar en usedRange ni tamaños declarados: contar bytes expandidos en streaming y abortar al superar presupuesto. Presupuesto inicial parser 20 s y 256 MiB; debe medirse con corpus adversarial antes de habilitar. No se ha hecho benchmark ni implementado parser seguro en esta revisión.

La carga de 10 MiB no debe atravesar un body de Function (límite documentado de 4.5 MB). Futuro upload directo privado con autorización previa: sesión canónica, OWNER ACTIVE, TEST+Preview+UUID canary exacto, batch creado del lado servidor y clave aleatoria `test/<aircraft_uuid>/<batch_uuid>/<nonce>` sin matrícula/nombres. Token corto de upload 60 s y límite de tamaño/MIME, sin overwrite; verificar tamaño real, hash SHA-256 y ownership de la clave al completar. Callbacks firmados no reemplazan sesión ni grants. Revalidar actor, scope y expiración antes de parsear/descargar/confirmar. No instalar SDK ni crear endpoints hasta aprobar contrato.

Lectura raw preferentemente por endpoint autenticado con `private, no-store`, attachment/nosniff; no guardar raw en logs, localStorage, Audit ni CDN de aplicación. URL GET temporal firmada máximo 60 s solo si aprobada para descarga explícita: es bearer y sigue utilizable hasta expirar tras revocación, riesgo que debe aceptarse; no emitir URL DELETE/HEAD/PUT genérica al usuario. Token store servidor nunca cliente. Para canary inicial, deshabilitar descarga raw y usar proxy autenticado si se necesita inspección. TLS y criptografía del proveedor no sustituyen controles de autorización.

| Capa | Contenido y retención propuesta | Eliminación / evidencia |
| --- | --- | --- |
| Archivo temporal | XLSX raw privado, máximo 24 h desde upload; cancelación/expiración bloquea acceso inmediatamente | Trabajo servidor idempotente de limpieza, DELETE y verificación origin sin cache, reintentos/alarma ante fallo. Rechazar acceso aunque falle eliminación. Manifest mínimo registra hash/tamaño/expiración/borrado verificado; no filename personal en Audit |
| Staging no confirmado | Solo campos mapeados necesarios; no hojas/columnas completas ni PII irrelevante. Expira 7 días desde upload, sin extensión silenciosa | Propuesta de borrado de candidatos sin confirmación bajo rol de mantenimiento dedicado y auditoría de purga. SQL actual no concede DELETE; requiere diseño/aprobación explícitos y orden dependiente por run antes del preflight. No activar captura persistente mientras este gate esté abierto |
| Datos confirmados | Revisiones Flight Records y snapshots mínimos de evidencia de horas: originales numéricos/unidades/precisión, IDs, hash, fila/hoja pseudónimas, mapeo, algoritmo y referencias | Append-only durante vida del registro y conservación operativa aprobada. No retener raw por este motivo. Plazo legal posterior al cierre y PII estrictamente necesaria requieren aprobación del responsable; no inventar retención legal |
| Audit | Actor interno, evento, scope, IDs y hashes; sin raw XLSX, emails, nombres o texto libre innecesario | Append-only, permisos existentes intactos. Retención/restricciones de acceso de Audit se revisan separadamente; borrar temporal no borra Audit |

Separar tablas por finalidad no elimina obligaciones sobre PII: hashes/IDs también pueden vincular personas. Minimización antes de persistir; manifiestos numéricos confirmados sin columnas personales no mapeadas. Las filas de staging referidas por una confirmación pasan a evidencia mínima confirmada, no pueden purgarse con borrado en cascada. Sanitización o cifrado por clave de lote y futura destrucción criptográfica son alternativas que requieren aprobación; no se implementan aquí. **F6 queda técnicamente especificada, pero retención final, DPA y mecanismo de purga son gates abiertos para DDL.**

Fuentes oficiales consultadas 2026-10-26: [región/store](https://vercel.com/docs/vercel-blob/manage-blob-storage), [seguridad](https://vercel.com/docs/vercel-blob/security), [privado/cache](https://vercel.com/docs/vercel-blob/private-storage), [URLs firmadas](https://vercel.com/changelog/signed-urls-are-now-available-for-vercel-blob), [upload servidor](https://vercel.com/docs/vercel-blob/server-upload). Capacidades documentadas no prueban configuración de la cuenta.

## Revisión de las 20 tablas

Se mantienen **20 propuestas**, no se autoriza crearlas. No duplicar archivo raw ni una tabla de storage: batch existente ya tiene hash/key/expiry. El agrupamiento siguiente cubre todas:

| Grupo | Tablas | Evaluación |
| --- | --- | --- |
| Plan/estado | aircraft_hours_plans, aircraft_hours_plan_revisions | Raíz estable y revisiones; fusionarlas rompe identidad o vuelve mutable el estado |
| Episodios/referencias | hours_component_overhaul_episodes, hours_counter_references | Episodio físico compartido por varias lecturas, no repetir overhaul en JSON por referencia |
| Mapeo/candidatos | hours_import_mapping_versions, hours_import_mapping_fields, hours_import_staged_rows | Se puede fusionar fields en JSON validado y bajar a 19, pero pierde restricciones relacionales/consulta por campo. Mantener para preflight; evitar almacenar filas raw completas |
| Snapshot de entrada | hours_reconciliation_runs, hours_reconciliation_flights, hours_reconciliation_installations, hours_reconciliation_staged_rows, hours_reconciliation_references | Run + cuatro conjuntos tienen FK distintas y evidencia temporal independiente. JSON único ahorra tablas pero pierde integridad de scope |
| Atribución | flight_component_utilization_attributions, hours_candidate_component_attributions | Posible unión con source_kind y XOR de FK nullable, requiere índices parciales y prueba de promoción. Mantener dos: separa claramente no operativo/operativo y reduce errores de doble conteo |
| Resultado | hours_reconciliation_differences, hours_reconciliation_issues | Métrica reconciliada vs diagnóstico por fila/run; fusionarlas produce nulos y cardinalidades ambiguas |
| Confirmación/lineage | hours_reconciliation_confirmations, hours_import_committed_rows | Confirmación idempotente y relación candidato→revisión; lineage no cabe en Audit ni en estado del batch |
| Vigencia | aircraft_hours_acceptances, hours_acceptance_invalidations | Secuencia y sustitución independiente de eventos de invalidación append-only |

Simplificación recomendada ahora: reutilizar batch/storage existentes, no tablas por contador, unidad, política o archivo, y resolver autoridad/evidencia en DTO/manifiesto versionado validado. No reducir tablas solo por número. Antes de congelar, decidir purga de staging no confirmado y exigir constraints/privilegios de inmutabilidad efectivos: el SQL por sí solo aún no los implementa.

## Gate y recomendación

F2/F4 quedan **técnicamente definidos como PROPOSED**, con pruebas offline; no quedan aprobados por el autor. F6 tiene proveedor/región/límites/seguridad propuestos; retención final y purga siguen abiertos. Recomiendo aprobar primero precisión exacta, preservación D-024/D-098 y política sin tolerancia; condicionar congelación definitiva a evidencia de equivalencia por instalación, revisión de PII/DPA/retención, diseño de purga y privilegios y protocolo de concurrencia de todos los mutadores.

Después: (1) aprobación funcional registrada con versión; (2) DTO/serialización canónica y permisos SQL completos; (3) revisión independiente de este diff y Sheets; (4) autorización separada para preflight aislado con fixtures y dos sesiones; (5) implementación runtime y Preview autenticado. SQL y escenarios preparados en `proposals/hours-start/preflight.md` y `preflight-assertions.sql`, **no ejecutados**. Ni build ni Preview equivalen a aceptación funcional ni permiso para configurar LV-SIM.
