# Equipos vinculados a varias organizaciones

Estado: aprobado por el usuario, migración aplicada y backend/frontend publicados el 14/10/2026.

Migración remota shared_work_teams: versión 20261014191910 (archivo local 20261014191345_shared_work_teams.sql). Campo-platform activo, versión 3. Versión Cloudflare cb351305-9fd3-4c54-898c-18117abbfc20. No volver a ejecutar esta migración.

Verificación remota: work_teams con RLS, sin EXECUTE para PUBLIC en los helpers nuevos y sin vínculos huérfanos. Al migrar todavía no había equipos creados. Advisors sin hallazgos nuevos; se conservan los avisos anteriores sobre protección de contraseñas y bloqueo deliberado del caché privado. El flujo autenticado de creación/vinculación queda disponible para la aceptación del usuario.

## Flujo

1. Crear la organización en Administración → Organizaciones.
2. Desde su tarjeta, usar Agregar equipos. Abre Equipos con la organización seleccionada.
3. Crear un equipo nuevo y vincularlo al guardar, o elegir uno del catálogo en Vincular equipo existente.
4. Para crear primero los equipos, usar Crear equipo → Crear sin organización. Más adelante se pueden vincular desde cualquier organización.
5. El catálogo muestra las organizaciones vinculadas a cada equipo. Un mismo equipo puede aparecer en varias; se evita duplicar el vínculo con una organización.

Editar el nombre actualiza todos sus vínculos. Deshabilitar un vínculo afecta solo esa organización y exige resolver integrantes, supervisores e invitaciones vigentes antes. No se ofrece borrar historial ni transferir automáticamente integrantes.

## Modelo y permisos

`work_teams` representa la identidad compartida del equipo. `teams` conserva los vínculos operativos por organización, con su ID existente y añade work_team_id. Cada vínculo tiene organización, estado, integrantes y recursos propios. Unir organizaciones a un equipo no comparte sus publicaciones, tareas, mensajes ni miembros.

El catálogo global es visible y administrable solo por SUPER_ADMIN. Las personas conservan una organización activa, y sus asignaciones usan el ID del vínculo correspondiente a esa organización. No se amplían los permisos de GERENTE, ENCARGADO o USUARIO.

La migración `backend/supabase/migrations/20261014191345_shared_work_teams.sql` crea el catálogo, genera una identidad para cada equipo existente y conserva IDs, asignaciones y recursos. No fusiona equipos preexistentes por coincidencia de nombre. Agrega FK e índice único por equipo compartido/organización, RLS, trigger de compatibilidad con el API anterior y comandos auditados/idempotentes work_team.create, work_team.update y team.link. Todos exigen propietario y sesión vigente. La API anterior team.create continúa funcionando.

## Validación

- 86 pruebas aprobadas en 15 archivos; build Vite/PWA aprobado.
- Deno check y lint de las funciones aprobados.
- Pruebas PostgreSQL: compatibilidad de equipos existentes, creación independiente, vínculos a dos organizaciones, reintentos idempotentes, duplicados rechazados, cambio global de nombre, rollback ante organización inválida, aislamiento y denegación a usuarios comunes.
- Pruebas React: creación sin organización, vínculo de equipo existente a una segunda organización y acceso Agregar equipos desde la tarjeta de organización.
- Validación de API: acciones nuevas aceptadas y actor_id del cliente rechazado.

## Procedimiento de publicación realizado

1. Aplicar únicamente la nueva migración shared_work_teams al proyecto kocbcvqhzwpjhewrongf; conservar el historial existente y no volver a aplicar las anteriores.
2. Revisar constraints, permisos y advisors remotos.
3. Redesplegar campo-platform con las tres acciones nuevas.
4. Publicar frontend; no publicarlo antes de crear work_teams porque el directorio lo consulta.
5. Prueba real: crear una organización y un equipo, vincular ese mismo equipo a otra organización, confirmar ambos vínculos y comprobar aislamiento con cuentas de ambas organizaciones.

La aprobación explícita de esta migración y de la publicación fue recibida antes de ejecutarlas. Las pruebas HTTP y de acceso público del frontend se repitieron después del despliegue; no se crearon organizaciones ni equipos de prueba persistentes.
