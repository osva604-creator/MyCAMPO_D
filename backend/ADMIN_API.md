# Etapa C — API administrativa y activación

Estado: implementación local, extendida e integrada con React en Etapa D. Requiere las tres migraciones y funciones de `backend`, la provisión explícita del propietario y configuración del dominio/SMTP. No se aplicaron migraciones ni desplegaron funciones remotamente desde esta sesión. Ver [APPLICATION_API.md](./APPLICATION_API.md) y [../STAGE_D.md](../STAGE_D.md).

## Archivos y arquitectura

- `supabase/migrations/20261014152959_administrative_workflows.sql`: operaciones SQL transaccionales, aprobación, membresías, historial, idempotencia, auditoría y estados de entrega.
- `supabase/functions/campo-platform/index.ts`: entrada Deno, cliente público por solicitud y cliente privilegiado separado. SDK Supabase fijado a 2.117.3 en `deno.json` y `deno.lock`.
- `supabase/functions/_shared/platform.js`: autenticación del endpoint, CORS exacto, validación, despacho de acciones y envío oficial de invitaciones.
- `supabase/config.toml`: configuración local independiente de los scripts antiguos.
- `../tests/platform-db.test.js` y `../tests/platform-edge.test.js`: pruebas de operaciones SQL y del handler HTTP.

El cliente debe llamar a `POST /functions/v1/campo-platform`, usando `Authorization: Bearer <access_token>` y `Content-Type: application/json`. El SDK enviará también la API key publicable. No enviar service keys desde React.

La función llama a `auth.getUser(token)` antes de ejecutar acciones. Las operaciones SQL usan el JWT original del solicitante y vuelven a comprobar identidad, sesión en `auth.sessions`, bloqueo Auth y permisos actuales. La administración requiere el propietario global activo. El cliente privilegiado solo interviene en Auth Admin y en finalizar el resultado de un envío ya reclamado.

Las operaciones privilegiadas se realizan en funciones internas SECURITY DEFINER con `search_path` fijo, permisos EXECUTE mínimos y esquema no expuesto. Las entradas RPC públicas son SECURITY INVOKER. No hay endpoints para ejecutar SQL arbitrario, elegir un actor administrativo o asignar SUPER_ADMIN.

`verify_jwt=false` deshabilita la verificación antigua del gateway para este endpoint, **no la autenticación implementada por la función**. Sin token Auth válido y correo confirmado la función responde 401. Esto permite usar claves publicables y tokens con firma asimétrica. Mantener siempre el guard del handler.

## Acciones

Las acciones administrativas llevan `operation_id` (UUID único) y `payload` con `reason` de 10–1000 caracteres. Reutilizar el mismo UUID con la misma acción y payload al reintentar una solicitud con respuesta perdida. Reutilizarlo con otros datos devuelve conflicto. La autorización se comprueba también al devolver resultados de reintentos.

| Acción | Campos de payload además de reason | Acceso |
|---|---|---|
| `organization.create` | `name` | Propietario |
| `organization.update` | `id`, `name` y/o `active` | Propietario |
| `team.create` | `organization_id`, `name` | Propietario |
| `team.update` | `id`, `name` y/o `active` | Propietario |
| `membership.set` | `user_id`, `organization_id`, `role`, `team_ids`, `name` | Propietario |
| `membership.suspend` | `user_id` | Propietario |
| `invitation.approve` | `request_id`, `organization_id`, `role`, `team_ids` | Propietario |
| `invitation.reject` | `request_id` | Propietario |
| `invitation.revoke` | `invitation_id` | Propietario |
| `invitation.resolve` | `invitation_id`, `outcome`, `recipient_id` solo para confirmar envío | Propietario |
| `settings.update` | `messaging_scope` (`same_organization` o `disabled`) | Propietario |

Ejemplo estructural; reemplazar los UUID de ejemplo por valores reales del entorno autorizado:

```json
{
  "action": "invitation.approve",
  "operation_id": "00000000-0000-4000-8000-000000000100",
  "payload": {
    "request_id": "00000000-0000-4000-8000-000000000101",
    "organization_id": "00000000-0000-4000-8000-000000000102",
    "role": "USUARIO",
    "team_ids": ["00000000-0000-4000-8000-000000000103"],
    "reason": "Ingreso del operario aprobado por el propietario"
  }
}
```

Estas acciones usan campos de primer nivel, sin `payload` ni `operation_id`:

| Acción | Campos | Acceso |
|---|---|---|
| `access.context` | Ninguno | Identidad confirmada y sesión vigente |
| `invitation.request` | `organization_id`, `email` | Miembro activo de esa organización o propietario |
| `invitation.send` | `invitation_id` | Propietario |
| `invitation.activate` | `invitation_id`, `name` | Destinatario confirmado de la aprobación |
| `audit.messages` | `conversation_id`, `reason`, opcionales `before` y `before_id` juntos | Propietario |

Las respuestas exitosas tienen forma `{ "data": ... }`. Errores: 400 por campos inválidos, 401 por identidad inválida, 403 por permisos, 404 por recurso ausente, 409 por conflicto y 503 por backend no disponible. No se devuelven detalles internos de SQL, tokens o Auth. POST JSON limitado a 16 KiB. Solo se aceptan campos conocidos.

## Flujo de invitación

1. `invitation.request` normaliza el correo, comprueba la organización y registra la solicitud pendiente. Limita a veinte solicitudes por usuario por hora; no envía correo ni define rol.
2. El propietario ejecuta `invitation.approve`: decide organización, rol y equipos. La transacción bloquea la solicitud, valida asignaciones, crea una aprobación de siete días y registra auditoría. Solicitudes ya decididas no pueden aprobarse otra vez. La organización definitiva puede diferir de la propuesta y se registra separadamente.
3. `invitation.send` reclama el envío en PostgreSQL antes de llamar a `auth.admin.inviteUserByEmail`. El destinatario se toma de la aprobación guardada y la redirección de configuración del servidor, nunca del navegador.
4. La respuesta de Auth se registra usando la clave privada y un UUID de reclamo. Solo se puede finalizar ese intento. Si Auth responde correctamente, se vincula su UUID al correo aprobado; esto no crea membresía.
5. El invitado sigue el enlace, obtiene sesión y confirma correo. `/activar-cuenta`, implementada en Etapa D, valida que exista una aprobación vigente para esa identidad antes de pedir contraseña y activar. No enviar invitaciones reales hasta probar el callback con el backend y dominio autorizados.
6. `invitation.activate` verifica sesión, identidad, correo, destinatario, vigencia, revocación y asignaciones. Crea membresía y consume la aprobación en una única transacción. Repetir la activación devuelve el mismo resultado, sin crear otra membresía.

### Cuentas existentes

Si el correo ya corresponde a una cuenta Auth confirmada y sin bloqueo, no se recrea la identidad ni se cambia su contraseña. El envío queda `existing_account`: el titular ingresa con su cuenta y activa la aprobación. La UI debe explicar este caso. No se afirma que se envió un correo oficial nuevo a esa cuenta.

Si una cuenta ya tiene membresía activa, no se la mueve con una invitación. El propietario usa `membership.set`, con un motivo y auditoría. La aprobación no habilita un segundo equipo u organización por accidente.

### Fallos y reenvíos

Supabase Auth y PostgreSQL no comparten una transacción de correo ni una clave de idempotencia común. El sistema impide enviar dos veces ante un reclamo concurrente, pero no promete entrega de correo exactamente una vez.

- `pending`: aprobación sin intento de envío.
- `sending`: un intento tiene el reclamo; otro no puede enviarlo.
- `sent`: Auth aceptó el envío y devolvió la identidad destinataria. No prueba entrega a la bandeja del correo.
- `failed`: límite explícito de envío de correo de Auth o intento reconciliado como no enviado. Reintento manual con al menos cinco minutos entre intentos, máximo tres intentos.
- `uncertain`: fallo de red o error ambiguo; no se reenvía automáticamente.
- `existing_account`: aprobación vinculada a una cuenta confirmada, sin correo nuevo.

Si el proceso termina después del envío y antes de finalizar SQL, permanece `sending` y bloquea reenvíos. Para `sending` o `uncertain` con al menos cinco minutos, el propietario debe consultar logs de Auth/correo y ejecutar `invitation.resolve`, con motivo y evidencia externa:

- `outcome: confirmed_sent`, `recipient_id` verificado: registra aceptación y destinatario coincidente con el correo.
- `outcome: confirmed_not_sent`: permite un nuevo reclamo dentro del límite. No usarlo basándose solo en un timeout o en que el invitado no vio el correo.

La reconciliación queda auditada. Un resultado tardío del reclamo anterior se rechaza después de reconciliar. Revocar durante un envío no puede retirar un correo ya en tránsito, pero impide activar la aprobación.

## Roles, equipos y bloqueo

`membership.set` acepta GERENTE_GENERAL, GERENTE, ENCARGADO o USUARIO. Exige UUID Auth existente, correo confirmado y ausencia de bloqueo vigente. Para GERENTE_GENERAL conserva las otras organizaciones asignadas y reemplaza solo la membresía de destino (cierra cualquier membresía de otro rol). Para los demás roles cierra todas las membresías anteriores. `membership.suspend` suspende todos los accesos de la cuenta. Conserva los recursos históricos.

Las asignaciones validan organización activa y equipos activos de esa organización. No se puede desactivar un equipo con integrantes, supervisores o invitaciones vigentes: se deben trasladar o cerrar primero. La validación también es un trigger PostgreSQL.

`membership.suspend` retira permisos de organización y equipo; no borra publicaciones, tareas o cuentas Auth. Es distinto de bloquear Auth globalmente, función que aquí no se expone. Los cambios administrativos y suspensiones revocan aprobaciones pendientes del destinatario para impedir que una invitación anterior restaure sus permisos. `access.context` muestra `awaiting_approval` para una cuenta sin membresía activa y no concede permisos por defecto.

## Auditoría

Todas las operaciones administrativas registran actor real, motivo, recurso, operación y resultado. `audit.messages` usa el RPC auditado de Etapa B con cursor compuesto y límite de cien mensajes; el propietario no recibe SELECT irrestricto al contenido. Debe informarse a los usuarios la política de supervisión antes de habilitar mensajería.

## Configuración pendiente

- Secretos/variables exclusivamente del backend: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CAMPO_SUPABASE_PUBLISHABLE_KEY` (o fallback `SUPABASE_ANON_KEY`), `CAMPO_APP_URL` y `CAMPO_ALLOWED_ORIGINS`. El hosting administrado proporciona las dos primeras; completar las variables CAMPO. No sobrescribir los `.env` existentes.
- Orígenes exactos separados por comas. URL de aplicación sin path ni barra final. HTTPS salvo localhost de pruebas. La función falla cerrada si falta configuración o hay orígenes inválidos.
- Supabase Auth: registro público deshabilitado, Email habilitado, SMTP configurado y plantilla de invitación que conserve el enlace Auth.
- Autorizar `/activar-cuenta` y sus parámetros de invitación en Redirect URLs, para los dominios exactos usados. Verificar que el proveedor preserve la query de la redirección. No habilitar comodines de dominios arbitrarios.
- UUID confirmado del propietario para `bootstrap-owner.sql`.
- Verificar la integración de Etapa D, recuperación de contraseña y callback reales antes de enviar invitaciones fuera del entorno de prueba autorizado.

No se establecieron secretos, configuraron proveedores, crearon cuentas ni enviaron correos en esta etapa.

## Pruebas locales y límites

```sh
npm test
npm run build
npx deno check --config backend/supabase/functions/campo-platform/deno.json backend/supabase/functions/campo-platform/index.ts
npx deno lint --config backend/supabase/functions/campo-platform/deno.json backend/supabase/functions/campo-platform/index.ts backend/supabase/functions/_shared/platform.js
```

Las pruebas SQL ejecutan ambas migraciones en PGlite con roles reales de PostgreSQL y claims de prueba. Comprueban permisos, historial, idempotencia, destinatarios, caducidad, revocación, sesiones eliminadas, reclamos, cooldown y límite de intentos. Las del handler simulan Auth/HTTP; no sustituyen un envío real.

Resultado verificado el 14/10/2026: 47 pruebas pasan en 9 archivos (14 pruebas SQL de Etapa C y 10 del handler, además de las anteriores). Build Vite/PWA correcto; `deno check` y `deno lint` correctos. No se agregaron dependencias al frontend en esta etapa.

Pendiente: JWT emitidos por Supabase, Data API/gateway, SMTP, callbacks reales, advisors y concurrencia con conexiones simultáneas en PostgreSQL servidor. Los bloqueos SQL y restricciones se ejercitan secuencialmente en PGlite; no se afirma que se hayan ejecutado pruebas concurrentes reales. Para probarlas se necesita un entorno autorizado, tras aprobar migraciones y despliegue. No se modificó producción.

Referencias oficiales: [Invitaciones Auth](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [seguridad de Edge Functions](https://supabase.com/docs/guides/functions/auth), [sesiones y cierre de sesión](https://supabase.com/docs/guides/auth/sessions).
