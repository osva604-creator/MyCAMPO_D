# Etapa E — verificación y despliegue

Fecha: 14/10/2026. Base revisada: `cb7facf`, publicada en `origin/main`.
Estado: verificación local y diagnóstico remoto terminados; aceptación con servicios reales pendiente de despliegue autorizado. No se aplicaron migraciones, desplegaron funciones ni enviaron correos durante esta etapa.

## Evidencia

| Verificación | Resultado |
| --- | --- |
| `npm.cmd test` | 77 pruebas aprobadas, 14 archivos |
| `npm.cmd run build` | Vite y PWA aprobados, 10 recursos precacheados |
| `npm.cmd audit --json` | 0 vulnerabilidades reportadas, incluyendo desarrollo |
| Deno check | Aprobado para las tres funciones con sus respectivos deno.json/lock |
| Deno lint | Aprobado, 7 archivos |
| Advisors remoto de rendimiento | Sin avisos |
| Advisor remoto de seguridad | Protección contra contraseñas filtradas deshabilitada |
| Tablas remotas de public / Edge Functions | Ninguna / ninguna |

En PowerShell se usó `npm.cmd` porque la política del sistema bloquea `npm.ps1`; no se cambió la política. Las 14 revisiones visuales de Etapa D siguen documentadas en STAGE_D.md; no se repitieron en esta etapa.

Los tests SQL ejecutan RLS, roles y restricciones en PostgreSQL mediante PGlite. Las identidades, sesiones y Storage de esos tests son fixtures. No equivalen a JWT, Data API, correo ni Realtime reales. Un advisor sin avisos sobre un esquema vacío tampoco certifica las migraciones pendientes.

## Revisión de seguridad

- Autorización por identidad y membresía vigentes, sin confiar en user_metadata ni en un actor enviado por el navegador.
- RLS y grants explícitos; helpers privilegiados en esquema privado, search_path fijo y EXECUTE restringido. Revocación explícita para funciones trigger.
- Comprobación de auth.sessions en operaciones sensibles para bloquear sesiones revocadas.
- Altas, roles, aprobaciones y asignaciones exclusivamente mediante operaciones del propietario. La UI no ofrece signup; falta comprobar/deshabilitar la opción remota de altas públicas.
- Mensajería entre integrantes de la misma organización; solo participantes leen directamente. El propietario consulta contenido ajeno únicamente por operaciones auditadas con motivo.
- Archivos privados, máximo 10 MiB, formato verificado y hash para reintentos. Descarga administrativa auditada. No hay credenciales de servicio en src.
- Envíos ambiguos no se reintentan automáticamente; requieren reconciliación explícita. Falta comprobar carreras con peticiones concurrentes contra Supabase real.
- Dependencias backend fijadas con lockfiles. El frontend usa el lockfile comprometido; instalar con npm ci.

El aviso remoto de contraseñas debe resolverse en Auth si el plan lo permite, o quedar aceptado expresamente: [remediación oficial](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Supabase documenta esta protección para Pro y superiores; no se comprobó ni cambió el plan.

## Paquete concreto para aprobar

Destino observado: proyecto `kocbcvqhzwpjhewrongf`. Confirmar que es el entorno que se desea modificar y proporcionar el UUID Auth confirmado del propietario. No se seleccionará automáticamente entre las cuentas existentes.

Aplicar, en este orden y sin ejecutar los scripts legacy de la carpeta raíz supabase:

1. `backend/supabase/migrations/20261014143135_multi_organization.sql`
2. `backend/supabase/migrations/20261014152959_administrative_workflows.sql`
3. `backend/supabase/migrations/20261014163341_application_workflows.sql`

El historial remoto ya contiene `20261014131410_restrict_public_rls_auto_enable_execution`, cuyo SQL es `REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;`. Conservarlo. No ejecutar db push ciegamente desde backend: ese historial no está en su carpeta local. Para esta entrega se puede aplicar cada archivo por MCP apply_migration con su nombre correspondiente, conservando el historial existente. Si se elige CLI, primero importar/reconciliar el historial real, revisar la lista y dry-run siguiendo la ayuda de la versión instalada; no marcar migraciones existentes como revertidas para eludir la discrepancia.

Después de las migraciones:

1. Ejecutar `backend/verification.sql` y advisors; corregir cualquier hallazgo antes de habilitar usuarios.
2. Establecer `campo.owner_uuid` y ejecutar `backend/bootstrap-owner.sql` en la misma sesión SQL administrativa, usando exclusivamente el UUID aprobado. Comprobar un único propietario y su evento de auditoría.
3. Configurar secretos de servidor con los nombres de `backend/.env.example`. CAMPO_APP_URL y CAMPO_ALLOWED_ORIGINS deben coincidir con el dominio aprobado. Nunca incluir claves de servicio en variables VITE ni en Git.
4. Desplegar campo-platform, campo-attachment y campo-audit-attachment desde backend, con sus entrypoints, imports y locks. Mantener la validación explícita getUser; verify_jwt=false no concede acceso anónimo en la aplicación.
5. Configurar Site URL y redirects de activación y recuperación, deshabilitar altas públicas y validar SMTP/plantillas. Usar buzones controlados expresamente autorizados para los ensayos.
6. Publicar el frontend del mismo commit y variables públicas aprobadas. wrangler.jsonc ya declara fallback SPA. Verificar URLs directas y actualización del service worker en una instalación anterior.
7. Ejecutar la aceptación siguiente; mantener el acceso limitado a cuentas de prueba hasta que pase.

Las migraciones crean estructuras, políticas, funciones y bucket privado. No importan IndexedDB ni contenido legacy. Antes de ejecutar, guardar un respaldo del estado remoto y de la configuración, y comprobar de nuevo que no haya aparecido un esquema incompatible. Una reversión de frontend no revierte esquema ni datos: ante fallo, detener acceso/despliegue y preparar una corrección revisada; no borrar tablas o usuarios automáticamente.

## Aceptación con servicios reales — pendiente

Preparar dos organizaciones, dos equipos en la primera y uno en la segunda; propietario, gerente por organización, encargado de ambos equipos y usuarios separados por equipo, además de una identidad confirmada sin membresía. Registrar solo IDs y resultados; nunca contraseñas, JWT o claves.

| Caso | Resultado exigido |
| --- | --- |
| Sin JWT, JWT inválido y cuenta sin membresía | Sin contenido ni operaciones privilegiadas |
| Invitación | Solicitud no concede acceso; aprobación, entrega y callback activan únicamente al destinatario; rechazo, caducidad y revocación bloquean |
| Auth | Login, recarga, logout, recuperación y enlace directo funcionan; token de sesión revocada falla también al llamar API directamente |
| Organizaciones/equipos | Gerente ve su organización; encargado solo equipos asignados; cambio de membresía elimina acceso anterior |
| Publicaciones | Usuario ve propias/mencionadas; un ID adivinado de otra organización no permite leer, comentar, reaccionar ni descargar |
| Tareas | Usuario ve creadas/asignadas y cambia estado solo si está asignado; historial conserva actor y cambios |
| Mensajes | Solo participantes de la misma organización; se rechaza destinatario externo; administrador sin motivo tampoco lee contenido ajeno |
| Auditoría | Cada página y archivo consultado administrativamente deja registro; clientes no modifican ni borran logs |
| Storage | Lectura directa, archivo sin finalizar, MIME falso, exceso de tamaño y reemplazo no autorizado fallan |
| Concurrencia | Repetir operation_id no duplica contenido; doble activación/claim no duplica membresía ni envío; fallo ambiguo requiere reconciliación |
| Realtime | Solo llegan eventos autorizados; reconexión/polling actualizan no leídos; no filtra eventos entre organizaciones |
| Offline/PWA | Cola conserva adjuntos y operation_id; cambia membresía antes del reenvío y se retiene para revisión; exportación local conserva datos |

Repetir advisors tras la aceptación y guardar los resultados. Etapa E completa requiere evidencia de esta tabla y de SMTP/callback reales; hoy está completada su parte local y de preparación.

Referencias: [migraciones](https://supabase.com/docs/guides/deployment/database-migrations), [seguridad de contraseñas](https://supabase.com/docs/guides/auth/password-security).
