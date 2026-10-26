# Hours V2 — corrección de ownership para preflight

Estado: PROPOSED; security preflight pendiente de repetición independiente. Base: 449c0a603f0d35e38a5bde98e39e6df9c004b2f4. No SQL ejecutado en esta revisión.

## Evidencia y autoridad

Se releyeron ambos Sheets canónicos, D-310 (preparación propuesta) y D-311 (identidad de 008 y reserva de 009). Ninguna de esas decisiones acredita security PASS. El usuario reporta, en br-icy-truth-b6m2x15p, schema/retention transaccionales y rollback/readback PASS, y security FAIL en ALTER FUNCTION OWNER: `must be able to SET ROLE "hours_v2_security_owner"`. Esta revisión no reproduce ni convierte ese reporte en una verificación independiente.

## Causa y corrección

[PostgreSQL ALTER FUNCTION](https://www.postgresql.org/docs/18/sql-alterfunction.html) exige capacidad SET ROLE al nuevo dueño y CREATE del nuevo dueño sobre el schema. NOLOGIN impide login directo; no impide ser propietario. NOINHERIT no concede SET. Desde PostgreSQL 16, el creador no superusuario obtiene normalmente ADMIN TRUE, SET FALSE, INHERIT FALSE sobre el rol nuevo ([atributos de roles](https://www.postgresql.org/docs/18/role-attributes.html)). ADMIN permite administrar membresías, pero no satisface por sí solo la transferencia.

El bootstrap exige PostgreSQL >=16, sesión directa `app_horas_migration`, CREATEROLE sin SUPERUSER y reconocimiento transaccional explícito. El nombre está contrastado con el snapshot de metadata existente, no con una conexión nueva. Si el coordinador real usa otra identidad, detener y revisar el contrato: no usar current_user como autoridad implícita ni degradar las comprobaciones.

Se normaliza LOCAL createrole_self_grant a vacío antes de crear los seis roles. Se concede SET TRUE, INHERIT FALSE a ese migrador para los dos dueños; nunca al runtime. Los ACL de las funciones se completan antes de las 14 transferencias (10 security_owner, 4 cleanup_owner). CREATE temporal del schema se mantiene hasta la última transferencia. Después se revocan CREATE y SET concedido por ese migrador, con RESTRICT. Las dos funciones de guards siguen siendo SECURITY INVOKER y propiedad del migrador.

Un chequeo final aborta ante rutas SET/USAGE restantes, membresías ajenas al migrador, acceso del runtime, CREATE residual, ownership o SECURITY DEFINER/search_path/PUBLIC EXECUTE inesperados. Las funciones y políticas RLS están fijadas mediante hashes del checkpoint: no se modifican sus cuerpos, scope por aeronave, permisos de negocio ni FORCE RLS.

## Matriz de bootstrap y privilegios

| Actor / rol | Durante transferencia | Estado final esperado |
|---|---|---|
| app_horas_migration → security_owner/cleanup_owner | ADMIN nativo; SET temporal; INHERIT FALSE | ADMIN nativo; SET FALSE; INHERIT FALSE |
| app_horas_migration → reader/writer/maintenance/invalidator | ADMIN nativo; SET/INHERIT FALSE | igual |
| app_runtime / app_horas_runtime → cualquiera de los seis roles | ninguna membresía | ninguna membresía ni privilegio nuevo |
| security_owner / cleanup_owner | CREATE temporal en hours_v2_private | sin CREATE; permisos mínimos originales y funciones propias |
| maintenance | EXECUTE limitado original; sin SET a dueños | igual |

Los seis roles nuevos permanecen NOLOGIN, NOINHERIT, NOBYPASSRLS; no se concede SUPERUSER. La membresía ADMIN nativa del migrador es una facultad privilegiada de migración, capaz de reautorizar SET: no es una barrera contra el propio administrador. No se afirma ausencia total de membresías. Esa confianza es inevitable al permitir crear/gestionar roles y debe quedar restringida al operador de migración. No se concede a usuarios, workers ni runtime. El marcador LOCAL es reconocimiento del operador, no autenticación, autorización de aplicación ni flag de Vercel.

## Matriz de repetición y rollback

Solo en rama descartable autorizada, con una conexión directa y una única transacción: BEGIN; SET LOCAL hours_v2.owner_bootstrap='approved-disposable-only'; schema.sql; retention.sql; security.sql; fixtures y consultas de privilegios. forced-rollback.sql ya incluye el marcador. No usar el runner de migraciones ni registrar 009.

| Prueba independiente | Resultado requerido |
|---|---|
| Identidad distinta, sesión SET ROLE, marcador ausente, PG <16 o sin CREATEROLE | error 42501 antes de crear roles |
| Transferencias | 14 dueños correctos; 2 guards INVOKER; search_path pg_catalog; PUBLIC EXECUTE ausente |
| Membresías finales | creator MEMBER/ADMIN permitido; SET/USAGE FALSE; runtime y worker sin membresía a dueños |
| RLS y permisos | aislamiento por aeronave, OWNER ACTIVE, evidencia append-only y limpieza limitada; pruebas positivas/negativas originales |
| Rollback forzado | conexión termina en rollback; readback independiente sin roles, schema, columnas, objetos ni ledger nuevos |
| Teardown explícito opcional | solo fixtures vacíos descartables; SET LOCAL ROLE temporal por dueño para DROP FUNCTION y DROP OWNED RESTRICT, RESET ROLE y DROP ROLE por migrador |
| Error en cualquier etapa | abortar transacción completa; no continuar hacia COMMIT ni modificar el ledger |

rollback-security.sql también valida actor y marcador. Usa SET sin INHERIT para eliminar objetos propios de cada rol; la facultad ADMIN del creador permite finalmente DROP ROLE. El rollback transaccional normal no necesita ejecutar ese teardown. Nunca usar CASCADE para ocultar dependencias inesperadas.

## Gates

Pruebas locales comprueban orden, grants/revokes, hashes de funciones/RLS, guards y teardown; no son un motor PostgreSQL ni acreditan security PASS. La prueba real, privilegios efectivos, rollback y readback deben repetirse de forma independiente antes de aprobar. Sin migraciones aplicadas, permisos desplegados, flags modificados ni datos de aeronaves tocados. Sin cambios funcionales en Costs ni artefacto 008. Sheets consultados; no se modificaron decisiones canónicas para declarar aprobación.

Validación local de esta revisión: npm test PASS (290/290, seis nuevos); npm run lint PASS; npm run build PASS (55 módulos); git diff --check PASS. Bundle UI sin cambios. Checksum de 008 preservado: 30df860f6ba51617e93c55be21e8d2355aba734977dfb3db6bf0776b5c07c160. Security SQL real: NO EJECUTADO / preflight independiente PENDIENTE.
