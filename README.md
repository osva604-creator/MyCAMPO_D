# MyCAMPO_D

Estado verificado el 14/10/2026: frontend actualizado en https://mycampo-d.conteolab.workers.dev/ (Cloudflare, versión `b7fe1e7e-f405-4daa-bee2-4ce92c99c5fc`). El Supabase configurado responde pero su API devuelve `PGRST205` para `members`, `events` y `direct_messages`: la activación del backend sigue pendiente. No se ha confirmado la recuperación de publicaciones anteriores.

Para ese proyecto sin tablas, ejecutar `supabase/activate-team.sql` desde su SQL Editor. Crea el esquema base y mensajes privados en una transacción, y habilita como miembros a las cuentas Auth existentes con correo confirmado y sin bloqueo vigente. Requiere mantener deshabilitado el registro público y usar un solo proyecto por organización. El script se detiene si detecta tablas existentes. Después, abrir la app en el mismo navegador donde se publicaron los registros y pulsar **Sincronizar ahora**. Los pendientes por cuenta se conservan en IndexedDB; no borrar el almacenamiento del navegador. Las publicaciones del modo local siguen separadas de las cuentas autenticadas.

PWA de gestión agropecuaria con React, Vite, Tailwind CSS, IndexedDB y Supabase opcional.

## Probar en la computadora

```sh
npm install
npm run dev
```

En PowerShell usar `npm.cmd` si la ejecución de `npm.ps1` está bloqueada.

Sin variables de Supabase funciona en **modo local**, con tres publicaciones ilustrativas. Las incidencias nuevas, fotos, Me gusta, comentarios y estados se conservan al recargar mediante IndexedDB. El nombre local es editable; no es una cuenta autenticada. Los ejemplos no se suben al activar el backend y las fotos ilustrativas remotas requieren conexión.

## Funciones implementadas

1. Feed con autor, lote, GPS cuando está disponible, fecha, categorías, estados, búsqueda y filtros.
   El botón **Ver en mapa** abre Google Maps con las coordenadas guardadas. Sin GPS válido se muestra **Sin coordenadas GPS**. Antes de publicar se pueden corregir latitud/longitud, verificar el punto y confirmar que corresponde a la foto; también se puede guardar solo el lote. No se interpreta un nombre de lote ni se extrae GPS EXIF de la galería. Integración basada en [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).
2. Captura con cámara trasera (MediaDevices), selector de fotos y compresión JPEG hasta 1600 px. Se guarda la fecha de captura/selección y la de publicación; no se extrae la fecha EXIF de fotos de galería.
3. GPS automático al abrir el formulario, precisión estimada y reintento. Si se deniega o no hay señal, se permite registrar el lote manualmente.
4. Problema, solución sugerida y menciones resaltadas. Con Supabase se puede seleccionar un miembro real; las menciones no envían notificaciones push o correo.
5. Comentarios con texto y/o evidencia fotográfica, Me gusta persistentes y cambios de estado con historial del operario y fecha.
6. Manifest e iconos instalables, service worker con app precacheada, IndexedDB y cola de sincronización persistente.
7. Backend preparado: acceso con correo/contraseña, directorio de miembros habilitados, eventos y fotos privadas.
8. Respaldo JSON descargable con fotos incluidas. Es una exportación; esta versión no tiene importador de respaldos.

## Configurar Supabase y habilitar al equipo

Esta parte requiere que el propietario cree un proyecto; no se han creado recursos de Supabase desde esta sesión.

1. Crear un proyecto en [Supabase](https://supabase.com/dashboard). **Usar un proyecto por campo/equipo**: este esquema comparte registros entre todos sus miembros y no implementa múltiples empresas en un proyecto.
2. En SQL Editor ejecutar una sola vez `supabase/schema.sql` en ese proyecto nuevo. Crea tablas, validación, políticas RLS y el bucket privado `evidence`. No ejecutarlo sobre un esquema de producción existente sin revisar una migración.
3. En Authentication → Providers → Email deshabilitar el registro público de usuarios. Crear cada operario desde Authentication → Users con correo y contraseña asignados de forma privada. Copiar su UUID.
4. En SQL Editor habilitar cada usuario en el directorio (cambiar los valores):

```sql
insert into public.members (id, name, handle)
values ('UUID-DEL-USUARIO', 'Carlos Díaz', 'Carlos');
```

El handle admite letras ASCII, números y guion bajo, sin `@`. Un usuario autenticado sin registro en `members` no tiene acceso a los registros ni a las fotos. Los miembros pueden crear publicaciones, comentar y cambiar estados de cualquier incidencia del equipo. Solo el administrador del proyecto puede administrar miembros; no hay pantalla de roles en la app.

5. Copiar `.env.example` a `.env.local` y completar con Project URL y la clave **publishable** (o anon pública) desde la configuración API:

```env
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=TU-CLAVE-PUBLICA
```

**Nunca poner `service_role`, secret keys o contraseñas en variables `VITE_*`**: esas variables forman parte del frontend. No subir archivos `.env` a Git.

6. Reiniciar Vite o volver a compilar. Ingresar con un usuario habilitado. El modo equipo tiene un feed separado de los ejemplos y registros del modo local; estos últimos no se transfieren automáticamente.
7. Para deshabilitar un operario, ejecutar `update public.members set active = false where id = 'UUID-DEL-USUARIO';` y bloquear su acceso en Auth. No borrar la identidad si tiene historial asociado. Los datos ya descargados pueden continuar disponibles sin conexión en el dispositivo; proteger el equipo y su sesión del navegador.

Documentación: [Auth](https://supabase.com/docs/guides/auth), [seguridad de Storage](https://supabase.com/docs/guides/storage/security/access-control), [Vite PWA](https://vite-pwa-org.netlify.app/guide/).

## Cómo funciona la sincronización

Se guarda cada operación en IndexedDB **antes** de intentar enviarla. Las fotos se suben con rutas deterministas a Storage y luego se agrega el evento; solo se confirma la operación local al recibir respuesta del servidor. Los reintentos reutilizan IDs, evitando duplicados. Las fotos descargadas también se guardan localmente para consultar sin señal.

La app sincroniza al abrirla, recuperar conexión, recuperar foco, cada 30 segundos y mediante el botón manual. Debe estar abierta; si se cierra, la cola se procesa la próxima vez que se abre. Un fallo de red, permisos o cuota mantiene los cambios pendientes y muestra un mensaje. Los comentarios de distintos dispositivos se combinan; estados y Me gusta se resuelven por fecha de la operación, con ID como desempate. Mantener los relojes de los dispositivos correctos.

Los datos locales se separan por cuenta, aunque siguen almacenados en ese perfil de navegador. No usar dispositivos compartidos sin controles de acceso. El almacenamiento del navegador puede ser eliminado por el usuario o el sistema; conviene exportar respaldos y sincronizar regularmente.

## Probar PWA y modo offline

El service worker se genera en producción, no en `npm run dev`:

```sh
npm run build
npm run preview -- --host 0.0.0.0
```

1. Abrir `http://localhost:4173` con conexión y esperar el aviso de disponibilidad offline.
2. Crear una incidencia con foto y lote; recargar y comprobar que sigue visible.
3. En DevTools → Network activar Offline, recargar y crear una segunda incidencia; añadir evidencia y resolverla.
4. Recuperar conexión. Con Supabase configurado comprobar que desaparecen los pendientes y que otro usuario del equipo ve los cambios (hasta 30 s o Sincronizar ahora).
5. Denegar cámara/GPS y verificar que se puede seleccionar foto e ingresar lote manualmente.
6. Instalar desde el botón cuando el navegador lo ofrezca. En iOS usar Safari → Compartir → Agregar a inicio.

Cámara, GPS y service worker necesitan HTTPS o localhost. Una dirección HTTP de la red local puede mostrar el feed pero no habilitar esas APIs. No se ha verificado hardware móvil real ni una conexión real a Supabase todavía.

## Publicar

Importar el repositorio en Vercel o Netlify: build `npm run build`, salida `dist`. Agregar ambas variables de entorno si se desea modo equipo, y recompilar después de modificarlas. El hosting debe servir `sw.js` y `manifest.webmanifest` desde la raíz. Usar HTTPS. GitHub almacena el código; no implica que el sitio esté desplegado.

## Validación y estructura

```sh
npm test
npm run build
```

- `src/components`: navegación, autenticación, formulario, tarjetas y aviso PWA.
- `src/lib/db.js`: persistencia IndexedDB y separación por cuenta.
- `src/lib/events.js`: reconstrucción del feed desde operaciones inmutables.
- `src/lib/cloud.js`: sincronización, Storage privado y consulta paginada.
- `src/lib/useField.js`: estado de la app, cola, reconexión y sincronización periódica.
- `supabase/schema.sql`: esquema y políticas del backend.
  `members` contiene id de Auth, name, handle único y active. `events` expone user_id, image_url, caption, latitude, longitude, status y created_at, además de los campos de sincronización. Los primeros seis son columnas generadas desde actor_id/payload: se escriben usando eventos de la app. Cada fila representa una operación; el estado actual de una incidencia se reconstruye desde sus eventos, no actualizando la publicación original. image_url guarda una ruta privada en Storage. El esquema es para proyectos nuevos; si ya está aplicado se necesita una migración ALTER TABLE para incorporar estas columnas.
- `tests`: persistencia, fusión de cambios, reintentos de sincronización y flujo de interfaz.

La activación del backend y publicación en un hosting son pasos externos pendientes. Las pruebas locales no sustituyen la validación final de dos usuarios contra tu proyecto Supabase.


### Mensajes directos y navegaci?n m?vil

El men? inferior m?vil permite abrir el muro, crear publicaciones, conversar con integrantes activos y acceder a la cuenta. La miniatura usa `avatar_url` o `picture` de los metadatos de la sesi?n, con una inicial como alternativa.

En proyectos existentes y nuevos, ejecutar `supabase/migrations/20261014_direct_messages.sql` en el editor SQL despu?s del esquema base para habilitar los mensajes. Cada proyecto Supabase representa una organizaci?n. Las pol?ticas RLS restringen la lectura a los dos participantes activos y el env?o a integrantes activos. La conversaci?n muestra los ?ltimos 200 mensajes y se actualiza cada 5 segundos mientras est? abierta. Requiere conexi?n; no hay env?o local ni notificaciones de mensajes sin leer.
