# Jerarquías y permisos — propuesta de base de datos

Cambio adicional publicado: catálogo de equipos compartidos y vínculos por organización, descrito en [SHARED_TEAMS.md](./SHARED_TEAMS.md). Solo SUPER_ADMIN administra el catálogo. Compartir la identidad de un equipo no comparte integrantes ni recursos entre organizaciones; la nueva migración se aplicó con aprobación explícita.

La matriz corresponde a las migraciones e interfaz locales de Etapas B/C/D. Las operaciones administrativas, activación y contenido están implementadas localmente, sin despliegue remoto. Consultar [STAGE_D.md](./STAGE_D.md), [backend/ADMIN_API.md](./backend/ADMIN_API.md) y [backend/APPLICATION_API.md](./backend/APPLICATION_API.md). La validación real remota sigue pendiente.

| Recurso o acción | SUPER_ADMIN | GERENTE_GENERAL | GERENTE | ENCARGADO | USUARIO |
|---|---|---|---|---|---|
| Publicaciones | Todas | Organizaciones asignadas | Su organización | Equipos supervisados | Propias o menciones por ID |
| Crear publicación | Organización/equipo activos | Organizaciones asignadas | Su organización | Equipos supervisados | Su equipo activo |
| Comentar y reaccionar | Publicación visible | Publicación visible | Publicación visible | Publicación visible | Publicación visible |
| Ver tareas | Todas | Organizaciones asignadas | Su organización | Equipos supervisados | Creadas o asignadas |
| Crear/asignar tareas | Organización válida | Dentro de cada organización asignada | Dentro de su organización | Integrantes de sus equipos | Solo para sí mismo |
| Actualizar tareas | Todas | Organizaciones asignadas | Su organización | Equipos supervisados | Solo estado de las asignadas |
| Solicitar invitación | Mediante endpoint autorizado | Sí | Sí | Sí | Sí |
| Aprobar/rechazar y decidir roles | Exclusivo, endpoint administrativo | No | No | No | No |
| Organizaciones, roles y equipos | Exclusivo, endpoint administrativo | No | No | No | No |
| Mensajes directos | Participante; auditoría separada | Solo participante | Solo participante | Solo participante | Solo participante |
| Leer archivos | Según publicación o conversación | Según publicación o conversación | Según publicación o conversación | Según publicación o conversación | Según publicación o conversación |
| Auditoría de mensajes | Motivo obligatorio y registro por consulta | No | No | No | No |

Jerarquía: manager de la app (SUPER_ADMIN) > gerente general > gerente > encargado > usuario. GERENTE_GENERAL tiene los mismos permisos de GERENTE en cada organización asignada. La migración `20261019183114_general_manager.sql` fue aplicada en remoto como `20261019183652`; backend y frontend publicados el 19/10/2026. Ver [GENERAL_MANAGER.md](./GENERAL_MANAGER.md).

## Membresías e historia

- GERENTE_GENERAL puede tener varias organizaciones activas asignadas, siempre con ese rol y una membresía por organización. Los demás roles tienen una sola organización activa por UUID. USUARIO: un único equipo activo; ENCARGADO: uno o varios equipos supervisados; GERENTE: acceso organizacional sin asignaciones de equipo necesarias.
- No existe el rol SUPER_ADMIN en `organization_members`. Es una identidad global separada en `platform_admins`, con un índice que impide más de uno activo.
- No hay asignación automática del propietario ni de membresías por registrar o confirmar correo.
- Un traslado cierra asignaciones anteriores; no modifica el equipo de origen de publicaciones o tareas. Los cambios de rol cierran la membresía anterior y crean otra.
- La pertenencia activa determina permisos vigentes; ser exencargado no concede acceso histórico a todas las publicaciones del equipo.
- Cuentas sin membresía activa o con organización deshabilitada no tienen acceso operativo. El propietario conserva sus capacidades globales sobre publicaciones/tareas.
- Al cambiar roles o equipos, el frontend deberá retirar datos ya no autorizados de su caché. Ninguna RLS puede borrar copias descargadas en un dispositivo desconectado.

## Invitaciones

Los solicitantes envían correo y organización autorizada; la identidad se obtiene del JWT. No deciden rol definitivo, aprobación o equipos. La aprobación se realiza exclusivamente en backend tras verificar al propietario. El registro de invitación requiere solicitud aprobada coincidente y equipos adecuados al rol, sin solicitudes pendientes o invitaciones vigentes duplicadas por correo. La activación exige destinatario confirmado, sesión vigente y aprobación no vencida ni revocada. Los reclamos de envío, cooldown y reconciliación auditada se implementaron en Etapa C; la entrega real con SMTP sigue sin verificar.

## Mensajería y supervisión

Solo entre personas de la misma organización, conforme a la decisión del propietario. Configuración inicial `same_organization`; también se puede deshabilitar. No existe un modo entre organizaciones implementado ni habilitado. Las conversaciones tienen exactamente dos participantes y no se pueden agregar terceros desde el cliente.

La supervisión administrativa debe informarse a los usuarios antes de habilitar mensajería. No se presenta como cifrado de extremo a extremo. La consulta ordinaria del administrador tampoco tiene acceso global a contenido: debe usar el flujo auditado con motivo. Cada página se registra de forma transaccional.

## Límite entre cliente y backend

La tercera migración revoca escrituras directas de contenido y subidas directas de clientes a Storage. Publicaciones, menciones, comentarios, reacciones, tareas, conversaciones y mensajes usan operaciones transaccionales del backend con permisos vigentes. Las lecturas de mensajes se registran solo para la identidad actual. Las invitaciones oficiales siguen un flujo administrativo separado. Un booleano o rol local de React no autoriza operaciones.

Los scripts antiguos `supabase/schema.sql` y `supabase/activate-team.sql` no implementan esta matriz y no deben aplicarse para activar la nueva arquitectura.

## Historial de recorridos del mapa

- Cada integrante puede consultar únicamente sus propios recorridos. SUPER_ADMIN puede consultar los recorridos de todos los usuarios dentro de la organización/equipo autorizado que esté seleccionado.
- El indicador `shared` de los registros anteriores se conserva como columna por compatibilidad, pero la migración `20261020120000_map_track_measurements_and_private_access.sql` lo limpia y las políticas RLS ya no lo usan. Se conservan los recorridos y sus puntos; los recorridos que antes se compartían dejan de ser visibles para otros integrantes. Esto evita exponer recorridos anteriormente privados.
- Las operaciones de escritura de recorridos siguen pasando por comandos backend autenticados y verifican que el actor sea su propietario. SUPER_ADMIN no puede modificar recorridos ajenos.
- Antes de iniciar una medición se informa del registro de ubicación y del acceso del SUPER_ADMIN. La ubicación solo comienza tras la acción explícita de inicio. La app nativa muestra el indicador/aviso del sistema cuando el plugin está activo; la continuidad depende de los permisos y restricciones de Android/iOS. Web/PWA no garantiza ubicación en segundo plano.
- La migración de mediciones y acceso privado se aplicó en Supabase de producción el 20/10/2026 y se registró como versión `20261020120000`. Se verificaron las columnas y RPC nuevas, las dos políticas RLS de recorridos y muestras, y que el RPC no es ejecutable por `anon`: propietario o SUPER_ADMIN dentro del alcance autorizado.
