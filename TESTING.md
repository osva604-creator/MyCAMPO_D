# Pruebas de aceptación

Aplicación: https://mycampo-d.conteolab.workers.dev/login

## Primera prueba con el propietario

1. Abrir el sitio e ingresar con la cuenta existente elegida como SUPER_ADMIN. Si estaba instalada como PWA, cerrar y volver a abrir para actualizarla.
2. Confirmar que aparece Administración. Crear una organización de prueba y dos equipos identificados como pruebas.
3. Recargar: la sesión y los registros deben mantenerse. Cerrar sesión: abrir /dashboard debe llevar a /login.
4. Entrar al modo local y comprobar que conserva los datos anteriores. No borrar el almacenamiento del navegador.

El despliegue técnico está disponible. El login autenticado con la contraseña del propietario debe probarlo el usuario; no se cambió su contraseña ni se extrajo su sesión.

## Antes de probar correos

En Supabase Dashboard del proyecto kocbcvqhzwpjhewrongf:

- Revisar Site URL y las redirecciones de /activar-cuenta y /reset-password para el dominio publicado, incluyendo la query de invitación.
- Configurar o verificar SMTP y las plantillas. Usar únicamente buzones controlados para pruebas y comprobar la entrega real.
- Activar la protección contra contraseñas filtradas si el plan lo permite. El advisor sigue indicando que está deshabilitada; esta conexión no permite modificar Auth.

Las altas públicas ya están deshabilitadas y la confirmación de correo habilitada, comprobado mediante /auth/v1/settings. No enviar invitaciones en lote antes de verificar una entrega y activación completas.

## Luego de verificar el correo

Crear usuarios de prueba con los roles GERENTE, ENCARGADO y USUARIO en dos organizaciones. Ejecutar la matriz de STAGE_E.md: activación, aislamiento por organización/equipo, menciones, tareas, mensajes, archivos, auditoría, revocación de sesiones y reintentos offline. Usar perfiles de navegador separados para evitar confundir sesiones.

Anotar para cada caso: fecha, rol, resultado esperado/obtenido e ID del recurso. No guardar contraseñas, JWT ni claves. Los registros de prueba no se eliminan automáticamente.
