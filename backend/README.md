# Backend multi-organización — Etapas B, C y D

Actualización: esquema y propietario inicializados; tres funciones desplegadas y comprobadas por HTTP. Configuración pública de despliegue en supabase/functions/_shared/deployment.ts, con sobreescrituras opcionales mediante CAMPO_APP_URL/CAMPO_ALLOWED_ORIGINS. Ver ../TESTING.md y ../STAGE_E.md. Las notas siguientes conservan el estado previo al despliegue.

Ver [../STAGE_E.md](../STAGE_E.md) para resultados de verificación, historial remoto existente, orden de despliegue y aceptación pendiente. `verification.sql` contiene comprobaciones de solo lectura posteriores a las migraciones.

Estado: las tres migraciones ya se aplicaron a Supabase con aprobación explícita. Backend e interfaz React integrados localmente; funciones y frontend pendientes de despliegue. Ver versiones remotas, verificaciones y pendientes en [../STAGE_E.md](../STAGE_E.md). Consultar [ADMIN_API.md](./ADMIN_API.md), [APPLICATION_API.md](./APPLICATION_API.md) y [../STAGE_D.md](../STAGE_D.md). Etapa E debe validar Auth, SMTP, Data API, Realtime y concurrencia reales.

Este directorio es una raíz CLI separada: `backend/supabase/migrations` no se combina con `supabase/migrations` del repositorio. Las migraciones antiguas pertenecen a la implementación de equipo único. La propuesta se detiene si detecta `members` o `events`; tampoco es una migración de datos para instalaciones existentes.

## Archivos

- `supabase/migrations/20261014143135_multi_organization.sql`: esquema nuevo, índices, restricciones, RLS, grants, Storage privado y consulta auditada.
- `supabase/migrations/20261014152959_administrative_workflows.sql`: operaciones administrativas, membresías, invitaciones y activación transaccional.
- `supabase/migrations/20261014163341_application_workflows.sql`: contenido, conversaciones, cuentas no leídas, adjuntos verificados, auditoría de archivos y Realtime.
- `supabase/functions/campo-platform`: Edge Function autenticada con SDK fijado y archivo de lock.
- `supabase/functions/campo-attachment` y `campo-audit-attachment`: subida privada y descarga administrativa auditada.
- `bootstrap-owner.sql`: inicialización explícita y transaccional del propietario por UUID confirmado de Auth. No contiene un UUID seleccionado.
- `../tests/multi-org.test.js`: integración PostgreSQL local con roles `anon`, `authenticated` y usuarios de prueba.
- `../PERMISSIONS.md`: matriz y límites de autorización.

La migración se creó con `supabase --workdir backend migration new multi_organization`. No se vinculó este directorio al proyecto remoto, ni se ejecutaron `db push`, migraciones remotas o despliegues.

## Comportamiento de seguridad

Todas las tablas expuestas tienen RLS y privilegios explícitos. La clave publicable por sí sola no puede administrar organizaciones, roles, equipos, membresías ni aprobaciones. Las operaciones administrativas exigen el JWT y la sesión vigente del propietario. `service_role` se usa exclusivamente en el backend para Auth Admin y resultados de envíos reclamados.

Los helpers SECURITY DEFINER están en `campo_private`, no expuesto por la Data API, con `search_path` fijo y EXECUTE restringido. Los predicados de acceso usan `auth.uid()`, no UUIDs de actor provistos por el cliente ni metadatos editables. Las funciones trigger no tienen EXECUTE concedido a clientes.

La API `audit_message_page(cid, why, page_before, before_id)` exige superadministrador vigente, un motivo de al menos diez caracteres y registra cada página consultada antes de devolver hasta cien mensajes. El superadministrador no tiene una política que permita SELECT directo a mensajes de terceros. El cursor compuesto por fecha e ID evita omitir mensajes que comparten fecha.

`audit_logs` y `task_history` son append-only, con triggers que impiden UPDATE/DELETE y sin TRUNCATE para clientes o service_role. El operador propietario de PostgreSQL puede alterar triggers o tablas; no se presenta esto como un registro inviolable frente al dueño de la infraestructura.

Los archivos de `campo-private` son privados y solo se consultan si existe metadata vinculada a un recurso autorizado. La metadata se reserva mediante una operación validada y la subida la realiza `campo-attachment`, comprobando identidad, permisos, tamaño, formato y SHA-256 para reintentos. Se aceptan JPEG, PNG y PDF de hasta 10 MiB. No se generan URLs públicas. Los adjuntos de mensajes ajenos tienen un endpoint administrativo separado con registro de acceso por descarga.

Las restricciones diferidas permiten crear o trasladar membresías en una transacción, pero impiden confirmar USUARIO sin exactamente un equipo o ENCARGADO sin equipos supervisados. Cambiar el rol requiere cerrar las asignaciones y membresía anterior y crear una nueva, conservando su historial. La pertenencia activa se valida por UUID Auth: una organización para GERENTE/ENCARGADO/USUARIO; varias organizaciones asignadas para GERENTE_GENERAL.

## Procedimiento de propietario, pendiente de ejecución

1. Identificar personalmente el UUID correcto en Authentication → Users. El código no elige al primer usuario ni deduce al propietario de un correo.
2. Revisar y aprobar migraciones, entorno de destino y permisos antes de cualquier ejecución remota.
3. Aplicar el esquema aprobado y, en una sesión administrativa de SQL, establecer `campo.owner_uuid` al UUID real con `set_config`.
4. Ejecutar `bootstrap-owner.sql` en esa misma sesión. Verifica confirmación de correo, bloqueo vigente y ausencia de un propietario previamente inicializado; registra la provisión.
5. Probar con JWT del propietario y verificar que otra cuenta no puede autoasignarse administración. No otorgar `service_role` al navegador.

## Validación y pendientes

Ejecutar desde la raíz `npm test -- tests/multi-org.test.js`, `npm test` y `npm run build`.

PGlite ejecuta PostgreSQL y políticas RLS con roles SQL reales; Auth/Storage se representan mediante tablas de prueba y claims configurados por el harness. No verifica la Data API, Realtime, SMTP ni JWT emitidos por Supabase. Las pruebas obligatorias con cuentas reales y advisors remotos quedan pendientes de un entorno y despliegue explícitamente autorizados.

Las operaciones, paneles y activación están implementados localmente; la entrega con SMTP real y el callback del dominio no se verificaron. Los reclamos evitan envíos concurrentes y exigen revisión explícita de resultados ambiguos; no prometen entrega exactamente una vez. Mantener altas públicas deshabilitadas en Supabase: la UI ya no ofrece registro, pero no modifica ese flag remoto. No enviar invitaciones reales hasta desplegar y validar el flujo aprobado de Etapa E.

Referencias: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Storage](https://supabase.com/docs/guides/storage/security/access-control).

## Gerente general (publicado el 19/10/2026)

La migración `20261019183114_general_manager.sql` agrega GERENTE_GENERAL, con los permisos de GERENTE dentro de cada organización asignada. El manager de la app asigna cada organización mediante `membership.set`; agregar una segunda conserva la primera. Cambiar a otro rol vuelve a una sola organización. La suspensión afecta todos los accesos de la cuenta. La interfaz incorpora el selector de organizaciones y la Edge Function acepta el nuevo rol. Migración aplicada en remoto como `20261019183652`, `campo-platform` versión 5 y frontend publicados. Evidencia en [../GENERAL_MANAGER.md](../GENERAL_MANAGER.md).
