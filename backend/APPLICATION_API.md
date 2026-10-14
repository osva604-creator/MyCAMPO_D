# API de aplicación — Etapa D

Propuesta implementada localmente, sin despliegue. Requiere las tres migraciones de `backend/supabase/migrations`. Conserva los contratos administrativos de [ADMIN_API.md](./ADMIN_API.md) y añade operaciones usadas por React.

## JSON mediante `campo-platform`

Todas las solicitudes son POST JSON con un access token Auth verificado. El límite de cuerpo sigue siendo 16 KiB. Ninguna acepta `actor_id`, rol o permisos para suplantar al solicitante.

### `content.command`

```json
{
  "action": "content.command",
  "content_action": "post.create",
  "operation_id": "UUID-UNICO-Y-ESTABLE-PARA-REINTENTOS",
  "payload": {
    "organization_id": "UUID-ORGANIZACION",
    "team_id": "UUID-EQUIPO",
    "body": "Descripción de la recorrida",
    "location": "Lote norte",
    "mention_ids": []
  }
}
```

Los UUID del ejemplo son marcadores a reemplazar. El recurso creado usa el UUID de operación, y la combinación actor/operación guarda un resultado idempotente. Reutilizar el UUID con otro payload falla; recuperar un resultado anterior vuelve a verificar visibilidad actual.

| content_action | Payload |
|---|---|
| `post.create` | `organization_id`, `team_id`, `body`, `mention_ids`; opcionales `location`, `latitude`, `longitude`, `gps_accuracy`, `gps_source` (`device`/`manual`), `suggestion`, `category`, `captured_at`, `attachment` |
| `post.status` | `post_id`, `status` |
| `comment.create` | `post_id`, `body` y/o `attachment` |
| `reaction.set` | `post_id`, `liked` booleano |
| `task.create` | `organization_id`, `team_id`, `assignee_id`, `title`; opcionales `post_id`, `description`, `priority`, `due_at` |
| `task.update` | `task_id`; campos autorizados `status`, `assignee_id`, `title`, `description`, `priority`, `due_at` |
| `conversation.open` | `recipient_id` de Auth; organización derivada de las membresías activas |
| `message.send` | `conversation_id`, `body` y/o `attachment` |

`attachment`, si corresponde: `{ "id": "UUID", "mime_type": "image/jpeg", "size_bytes": 12345 }`. El servidor reserva la ruta `organization_id/id`; no recibe una URL o path elegido libremente. Solo JPEG, PNG y PDF, hasta 10 MiB. Comentarios y mensajes pueden tener texto vacío si incluyen un adjunto reservado. Todos los cambios son transaccionales en PostgreSQL y aplican las restricciones de rol, organización y recursos padre.

Estados de incidencias: `Pendiente`, `En Proceso`, `Resuelto`. Solo autor autorizado o supervisión correspondiente los modifica; el cambio agrega historial como comentario. Estados de tareas: `Pendiente`, `En progreso`, `Completada`, `Cancelada`. Prioridades: `low`, `normal`, `high`, `urgent`. Los usuarios comunes solo modifican el estado de las tareas asignadas, no título, responsable o permisos.

### Consultas adicionales

- `messages.inbox`: `before` y `before_id` opcionales juntos. Devuelve hasta cincuenta conversaciones autorizadas con vista previa y cantidad no leída, más `unread_total` de todas las conversaciones accesibles. Orden por última actividad e ID. Nunca ofrece mensajes ajenos al propietario como bandeja ordinaria.
- `audit.conversations`: cursor opcional por `before`/`before_id`. Solo propietario; devuelve cincuenta IDs, organización, participantes y fechas, sin mensajes ni previews.
- `audit.messages`: conserva campos de Etapa C; ahora usa `campo_audit_message_page` y devuelve hasta cien mensajes con metadata de adjuntos listos. Cada consulta registra motivo y cursor. El RPC anterior de texto `audit_message_page` permanece protegido por compatibilidad.
- `admin.accounts`: `search` opcional, cursor `before_email`/`before_id` opcionales juntos. Solo propietario; hasta cincuenta UUID/correos, confirmación y bloqueo. No devuelve contraseñas, tokens o metadatos de autorización editables.

Lecturas ordinarias usan Data API con RLS y paginación. `message_reads` permite insertar solo lecturas propias de conversaciones autorizadas; el cliente usa `ignoreDuplicates`. La tercera migración revoca inserciones/actualizaciones directas de contenido y subidas directas de clientes a `campo-private`.

## Subida mediante `campo-attachment`

POST binario, `Authorization` con access token, `x-attachment-id` con el UUID reservado y `Content-Type` con su MIME. No se envía service key desde el cliente.

1. Auth verifica JWT; una consulta del solicitante a `attachments` pasa RLS y comprueba propiedad.
2. Se lee un máximo de 10 MiB y se comprueban tamaño real y firma JPEG/PNG/PDF. No se considera análisis antivirus.
3. Se revalidan permisos antes de escribir y antes de finalizar. El cliente privilegiado sube con `upsert:false` a la ruta reservada.
4. Si el objeto ya existe, se compara su SHA-256 con el archivo enviado. Una diferencia produce conflicto; nunca se reemplaza evidencia distinta.
5. `campo_finish_attachment`, ejecutable solo por service_role, confirma `ready` y checksum. Solo entonces Storage permite descargas ordinarias autorizadas.

Si falla después de escribir Storage, el mismo archivo/operación puede reintentarse. Si se revocan permisos durante la subida, no se publica como listo. PostgreSQL y Storage no comparten una transacción: el recurso y metadata pueden existir mientras se completa el archivo; React lo indica y conserva el pendiente.

## Descarga auditada mediante `campo-audit-attachment`

POST JSON `{ "attachment_id": "UUID", "reason": "Motivo de 10 a 1000 caracteres" }`, máximo 4 KiB. Verifica Auth y ejecuta `campo_audit_attachment` con el JWT del solicitante. El RPC exige propietario vigente, verifica que el archivo sea un adjunto listo de un mensaje y agrega `messages.attachment_read` a auditoría. Solo después el backend descarga el objeto con privilegios de servidor.

Respuesta binaria `application/octet-stream` con `Cache-Control: no-store`, sin URL pública o firmada. Cada descarga/reintento registra una nueva consulta. Un fallo de Storage puede dejar registrado el intento; no se afirma que el navegador haya recibido el archivo.

## Configuración y verificación pendientes

Las tres funciones comparten variables de `backend/.env.example`, SDK 2.117.3, orígenes exactos y autenticación explícita. `verify_jwt=false` del gateway no elimina el guard Auth de cada handler.

Revisar y aprobar las tres migraciones y funciones antes de desplegar. Deshabilitar altas públicas en Auth, configurar SMTP y callback, inicializar propietario por UUID y probar con cuentas reales de cada rol. Realtime agrega tablas al publication existente cuando está disponible; el polling sigue funcionando como respaldo.

Pruebas locales: PostgreSQL/PGlite, endpoints simulados, React y revisión visual; ver [STAGE_D.md](../STAGE_D.md). No se verificaron SMTP, JWT emitidos, Data API, Realtime ni concurrencia remotos.
