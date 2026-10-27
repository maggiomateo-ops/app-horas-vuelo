# LV-SIM V1 — entrega integrada

Base b858654ac6cb85acda415b7ad69d45455b63cf02. Rama única: codex/lv-sim-v1-functional. Sin Horas V2, schema/migraciones, cambios funcionales de Costs, Production/main ni datos LV-MHZ.

Implementado:
- Acción OWNER de identidad solo LV-SIM: GET fresco → revisión → confirmación PATCH existente → GET verificado; nunca usa el estado viejo como snapshot.
- Setup 2+2 existente integrado; cada instalación tiene fecha propia, identidad/TIS desconocidos NULL. En la rama funcional exige primero identidad Piper/PA-34 Seneca; evita bloquear la corrección creando antes una configuración Cessna.
- Ownership canary sin persona/porcentaje inferidos: formulario vacío, total 0%, declaración explícita y aceptación antes del envío al flujo canónico existente. No se crea un propietario por ser OWNER.
- Registro y edición existentes condicionados por readiness y permiso efectivo de escritura de la aeronave. Canary servidor compartido para vuelos y ownership impide cambiar UUID en payload. Se reutiliza el flujo canónico de alta/autorización de pilotos como dependencia de vuelos, acotado al mismo canary y permiso de gestión existente; USER_MANAGEMENT_WRITES_ENABLED sigue false, sin habilitar usuarios/permisos generales.
- Aceite singular bloqueado en bimotor; no se asigna a un motor por inferencia. Un borrador anterior puede limpiarse con acción explícita.
- Historiales por instalación y posición ENGINE/PROPELLER, también para impresión de todos. Dashboard muestra métricas TIS V1 individuales en multiflota bimotor en vez de presentar motor #1 como total del conjunto. NULL sigue desconocido. TIS no se etiqueta como tiempo de operación/TSN/TSO. Hélice distingue TIS del casco y del componente.
- Límite de reemplazo corregido: removed_on excluye el vuelo del día de reemplazo cuando no hay boundary histórico explícito; evita doble atribución al componente viejo y nuevo.

Validación: npm test **283 PASS** (9 nuevas); lint/build/diff check **PASS**. Incluye guards HTTP de vuelos/ownership contra otro UUID, policy Production/Sheets/UUID faltante, lectura posterior de identidad, NULL y TIS vs FT (0.8 vs 1.2), borde de reemplazo y declaración legal explícita. Mantiene tests previos de revisiones inmutables/Audit/rollback. Pruebas de persistencia usan clientes simulados, no acreditan aceptación real.

Smoke navegador **local con intercepción completa**: Cessna/C182 → Piper/PA-34, serie NULL; setup 2+2 con fechas sintéticas introducidas manualmente solo en fixture 2024-02-29 / 2025-01-02 / 2023-07-03 / 2026-09-04; cuatro instalaciones con horas desconocidas; paso de propiedad vacío y confirmación deshabilitada. Capturas identity-readback.png y configuration-readback.png. Estas fechas NO se aplicaron a Neon.

Operaciones reales: consulta de ambos Sheets canónicos, GitHub, metadata Vercel y SELECT Neon. LV-SIM continúa Cessna/C182 con 0 configuraciones, 0 instalaciones, 0 vuelos y 0 eventos de corrección/configuración/vuelo. No se ejecutó ninguna mutación de negocio, revisión ni Audit real.

Bloqueos reales:
1. IAB llega a Login Vercel antes de la aplicación; intento de usar Chrome local agotó la herramienta. No hay sesión OWNER accesible. Se pidió al usuario autenticarse; no se fabricaron cookies ni se sustituyeron rutas por SQL.
2. No se recibieron cuatro fechas revisadas ni propietarios/porcentajes expresos para el canary real. Los campos siguen vacíos para revisión; no se infieren del OWNER ni de LV-TST.
3. La revisión automática rechazó el intento de configurar el entorno de esta rama: binding sensible + activación identidad/configuración/Flights/ownership; consideró insuficiente la autorización específica y evidencia de aislamiento. No se aplicaron variables (readback de esta rama: lista vacía), no se sortea el rechazo. Payload exacto sin secretos: environment-request.json. Requiere aprobación específica del usuario y nueva revisión automática; no es una instrucción ejecutable.

Sin esos overrides el Preview se niega a cargar aeronaves con 503 FUNCTIONAL_PREVIEW_NOT_CONFIGURED en lugar de caer a Sheets. Mutaciones scoped fallan cerradas; flags de otras ramas no se cambian. Una activación aprobada quedaría solo en Preview de esta rama y UUID LV-SIM. DATABASE_MIGRATION_URL no se configura. No se afirma aceptación funcional por un deployment READY.

Después de aprobar entorno y tener sesión: el usuario puede revisar/confirmar identidad, declarar fechas y configuración, declarar propiedad real del escenario de prueba y piloto explícito, y registrar un vuelo sintético por la UI. Confirmar GET/Neon/Audit/revisiones/historiales. No se declara esa secuencia ejecutada.
