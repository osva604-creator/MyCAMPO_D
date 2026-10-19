# Gerente general

Publicado el 19/10/2026 con aprobación del usuario.

Jerarquía: manager de la app (SUPER_ADMIN) > gerente general > gerente > encargado > usuario. GERENTE_GENERAL tiene los permisos de GERENTE en cada organización asignada. Solo SUPER_ADMIN asigna organizaciones y roles.

## Despliegue

- Proyecto Supabase existente: `kocbcvqhzwpjhewrongf`.
- Archivo local: `backend/supabase/migrations/20261019183114_general_manager.sql`.
- Migración remota: `20261019183652`, nombre `general_manager`. No volver a aplicarla.
- Edge Function `campo-platform`: activa, versión 5; conserva autenticación propia mediante `getUser` y `verify_jwt=false`.
- Frontend: https://mycampo-d.conteolab.workers.dev.
- Versión Cloudflare: `d2212c8c-1761-4efd-bb5a-30f701687da6`.

## Uso

En Administración → Usuarios, asignar la cuenta con rol Gerente general y una organización. Repetir la asignación con la misma cuenta y otra organización para conservar ambas. El gerente general dispone de un selector de organizaciones en su panel. Cambiar a un rol común deja una sola organización activa. Suspender todos los accesos afecta todas las membresías de esa cuenta.

No se ascendieron ni se modificaron las asignaciones de cuentas existentes durante el despliegue.

## Verificación

- 91 pruebas locales aprobadas en 16 archivos; compilación Vite/PWA aprobada.
- Prueba SQL remota con rol `authenticated` y datos temporales: dos membresías, contexto con dos organizaciones y equipos, publicaciones en ambas y creación de tareas; rechazo de organización ajena, administración global, duplicados y mezcla de roles. Transacción revertida íntegramente, sin cuentas ni organizaciones de prueba persistentes.
- Constraints remotos admiten GERENTE_GENERAL; cero funciones SECURITY DEFINER con EXECUTE para PUBLIC. Se conservó la membresía activa preexistente.
- HTTP: `/login`, `/dashboard` y `/activar-cuenta` devuelven 200 con el bundle actual; módulo publicado contiene GERENTE_GENERAL. Son comprobaciones del despliegue y fallback SPA; no una sesión de navegador autenticada.
- Edge Function: 401 sin token o con token inválido; CORS 204 para el dominio publicado.
- Advisor de seguridad sin hallazgos nuevos. Persiste el aviso previo de [protección de contraseñas filtradas deshabilitada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) y el aviso informativo del caché privado con RLS sin políticas, deliberadamente inaccesible de forma directa.

La aceptación desde el navegador con una cuenta real asignada queda disponible para el usuario. No se enviaron correos.
