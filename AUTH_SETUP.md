# Autenticación de MyCAMPO_D

La verificación de Etapa E y el procedimiento de despliegue pendiente están en [STAGE_E.md](./STAGE_E.md).

Actualización de Etapa E: las tres migraciones están aplicadas en el remoto con autorización del usuario y el propietario está inicializado y auditado; las funciones y configuración Auth siguen pendientes. Las referencias siguientes a implementación local describen el estado previo al despliegue del esquema. La protección contra contraseñas filtradas continúa deshabilitada porque esta conexión no permite modificar configuración Auth.

Se reutiliza el proyecto `kocbcvqhzwpjhewrongf` y el cliente Supabase único de `src/lib/supabase.js`. Las variables existentes no se modificaron:

```env
VITE_SUPABASE_URL=https://kocbcvqhzwpjhewrongf.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU_CLAVE_PUBLICABLE
```

`.env.local` ya está excluido de Git. Nunca usar claves secretas o `service_role` en estas variables.

## Rutas

- Públicas: `/login`, `/recuperar-password`, `/reset-password`, `/activar-cuenta` y `/local`. `/registro` explica el ingreso por invitación y no crea cuentas.
- Protegidas: `/dashboard/*`, con verificación adicional de membresía en `AccessContext`. Administración exclusiva del propietario. `/` redirige al panel.
- El formulario de nueva contraseña solo aparece con sesión. Los eventos `PASSWORD_RECOVERY` llevan a `/reset-password` antes del panel.
- `/local` conserva el modo local incluso con Supabase configurado o sin conexión. No representa autenticación ni acceso al backend.

## Configuración pendiente en Supabase Dashboard

1. Configurar Site URL con el dominio real de producción. Autorizar `/dashboard`, `/reset-password` y `/activar-cuenta` con el parámetro de invitación, para ese dominio y localhost de pruebas. Verificar la preservación de esa query en el callback.
2. Mantener Email/password habilitado y deshabilitar altas públicas en Supabase Auth. La UI ya reemplazó el registro por invitación aprobada; esto no modifica la configuración remota de Auth. Las invitaciones oficiales se envían desde backend solo después de aprobación del superadministrador.
3. Configurar SMTP y comprobar la entrega de confirmaciones y recuperación con una cuenta de prueba controlada. Las plantillas deben conservar el enlace de confirmación de Supabase y su redirección.
4. El hosting debe devolver `index.html` para rutas de la SPA, incluyendo enlaces abiertos directamente como `/reset-password`.

## Permisos y base de datos

Durante el diagnóstico remoto del 14/10/2026 no había tablas en `public`. Las etapas B/C/D prepararon tres migraciones locales en `backend/supabase/migrations`; no se aplicaron remotamente desde esta sesión. No usar los scripts anteriores `schema.sql` o `activate-team.sql` para activar organizaciones: comparten registros entre todos los integrantes de un único equipo. Una identidad Auth confirmada no recibe membresía automáticamente.

La protección de rutas es de interfaz. El backend propuesto verifica JWT, sesión vigente y políticas RLS basadas en `auth.uid()` y membresías activas. Los metadatos de usuario se usan solo para la imagen de perfil. La activación valida destinatario, correo, aprobación, vigencia y equipos antes de crear membresía. Antes de pedir contraseña, `/activar-cuenta` consulta que la aprobación corresponda a la identidad actual. Falta validar el flujo real en un entorno autorizado de Supabase.

## Verificación

Las pruebas verifican restauración, redirecciones, bloqueo del registro público, errores, logout, recuperación, permisos y activación en React, con Auth simulado. Las pruebas SQL ejecutan restricciones/RLS en PGlite. No verifican entrega real de correo ni JWT reales. Etapa E debe invitar una cuenta controlada, confirmar correo, activar membresía, ingresar, recargar, salir, probar rutas privadas y recuperar contraseña. No se crearon cuentas ni enviaron correos reales durante la implementación.

Referencia: https://supabase.com/docs/guides/auth/passwords

## Transición a organizaciones

Consultar [STAGE_D.md](./STAGE_D.md) para pantallas, integración, modo local y límites verificados; [ARCHITECTURE_PLAN.md](./ARCHITECTURE_PLAN.md) conserva el diagnóstico inicial. Las jerarquías se implementaron en código local, sin desplegar. Mensajería definida: solo dentro de la misma organización.

Las etapas B/C/D están implementadas localmente en [backend/README.md](./backend/README.md), con matriz en [PERMISSIONS.md](./PERMISSIONS.md), contratos administrativos en [backend/ADMIN_API.md](./backend/ADMIN_API.md) y operaciones de aplicación en [backend/APPLICATION_API.md](./backend/APPLICATION_API.md). Antes de enviar invitaciones reales, aprobar y desplegar las tres migraciones/funciones, configurar SMTP y verificar el callback de activación en el dominio elegido.
