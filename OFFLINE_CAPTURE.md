# Captura sin conexión, sincronización y cámara

Publicado el 19/10/2026 en https://mycampo-d.conteolab.workers.dev. Versión Cloudflare `67e810df-e33a-4dee-afe7-48fd8b12c55c`, con GPS solicitado al disparar la foto. No requirió cambios en la base de datos. Pendiente de prueba con cámaras físicas de Android/iOS.

## Guardado y reapertura

Después de un ingreso y carga con conexión, la PWA conserva la identidad verificada, el directorio autorizado y las páginas de publicaciones descargadas. Puede reabrirse sin señal, incluso si el token necesita renovarse, para continuar capturando en la organización previamente habilitada. La identidad offline solo sirve para trabajar en el dispositivo: ningún envío usa permisos cacheados como autorización del servidor.

La foto y los campos del formulario se guardan en IndexedDB mientras se completan. El indicador de guardado confirma esa escritura. Cerrar el formulario conserva la captura; volver a abrirlo recupera el contenido. La imagen se almacena como Blob separado de los campos, para no reescribir la foto con cada tecla. Al guardar la incidencia se agrega primero una operación durable y después se retira el formulario recuperable.

Los permisos y las copias descargadas están separados por cuenta y membresía. La revocación o el cambio de permisos invalida las copias de lectura. Cerrar sesión elimina esas copias y la identidad offline; conserva los pendientes para respaldo o una posterior sesión de su propietario. Los formularios conservan su ámbito original.

## Sincronización

- Apertura, recuperación de la ventana, retorno del segundo plano, reconexión, restauración de página y cada 30 segundos mientras está visible.
- Intento adicional al pasar al segundo plano o cerrar la página. El navegador puede interrumpirlo: el respaldo real es el guardado previo en IndexedDB y el reintento al volver.
- Gesto de deslizar hacia abajo desde el comienzo de la pantalla en móvil; botón junto al correo en escritorio. Realtime conserva las actualizaciones automáticas del contenido.
- Se recorren los pendientes de todas las organizaciones de la cuenta, verificando permisos vigentes antes de enviarlos. Los borradores de una membresía anterior se retienen.
- Un mismo identificador de operación y adjunto se reutiliza ante reintentos. El pendiente se borra únicamente después de confirmar contenido y archivo. Un fallo individual no bloquea el intento de otros registros independientes.
- Exclusión de reintentos simultáneos dentro de la pestaña; Web Locks, cuando existe, coordina pestañas del mismo origen. Los envíos quedan ligados al token de la cuenta validada y se detienen si cambia la sesión.

No se promete sincronización con la app completamente cerrada ni ejecución continua en segundo plano. La primera autenticación, las publicaciones todavía no descargadas, las operaciones administrativas y la renovación de permisos requieren conexión. Tareas y conversaciones no se incluyen en la copia offline de publicaciones.

## Espacio

Las fotos nuevas de la cola se almacenan como Blob, evitando la expansión de base64 en disco. Las copias descargadas conservan sus archivos binarios y recrean URLs temporales al mostrarse. Se revocan las URLs al cambiar de pantalla o recargar un recurso.

La caché de publicaciones tiene un límite de 60 MiB y 12 páginas; elimina las copias más antiguas. Esa limpieza nunca elimina fotos pendientes, formularios ni registros del modo local. Ante QuotaExceededError se liberan primero copias descargadas y se reintenta la escritura; si sigue fallando, se informa y se conserva abierto el formulario.

Mi cuenta incluye estimación de uso, margen del navegador, tamaño de copias y cantidad de pendientes, además de protección persistente y limpieza de descargas. El permiso persistente depende del navegador; borrar los datos del sitio o desinstalar con limpieza puede eliminar datos locales. Los respaldos de pendientes convierten nuevamente los Blob a base64 para conservar las fotos dentro del JSON.

## Cámara y calidad

La cámara ocupa el área visible completa, con controles propios y cámara trasera preferida. Al tomar la foto vuelve el formulario con una transición desde abajo. El encuadre de la imagen coincide con la vista previa; no se estira la foto. Se liberan las pistas al salir, suspender o desmontar la cámara, incluyendo respuestas tardías de permisos.

Al disparar se solicita una posición nueva con alta precisión y sin aceptar posiciones cacheadas, con un máximo de 30 segundos de adquisición. La foto se conserva mientras se espera el GPS. Un resultado válido se asocia a esa foto con su precisión y se confirma automáticamente; los permisos y la señal del dispositivo siguen siendo necesarios, incluso offline. Se descarta la ubicación anterior de la pantalla. Si falla el GPS, no se inventan coordenadas ni se envía silenciosamente la publicación sin ellas: se puede reintentar, indicar coordenadas manuales confirmadas o elegir explícitamente guardar solo con lote. Una respuesta tardía no sobrescribe una corrección manual. Al recuperar el formulario se conserva el origen de las coordenadas y su precisión; una adquisición interrumpida no se sustituye por la ubicación del lugar donde se reabre la app.

Calidad predeterminada: hasta 2560 px en el lado mayor y JPEG 0,92. Alternativa de ahorro: 1600 px y JPEG 0,84. No se amplían originales de menor resolución. Se usa captura fotográfica nativa cuando está disponible y el fotograma completo del vídeo como alternativa. La resolución final depende del dispositivo, del encuadre y del navegador. Las fotos de galería conservan su proporción original. La ubicación sigue siendo GPS confirmado o lote manual.

## Verificación

Pruebas automatizadas: recuperación offline, separación por cuenta, revocación de caché, conservación de bytes de fotos, liberación de URLs, límites de caché, recuperación ante cuota, formulario recuperable, reintentos estables, gestos, eventos de ciclo de vida y liberación de cámara. Ver `tests/offline-store.test.js`, `tests/camera.test.jsx`, `tests/refresh.test.jsx`, `tests/photo-quality.test.jsx` y las ampliaciones de auth, team-ui y team-drafts.

Resultado: 114 pruebas aprobadas en 21 archivos y build Vite/PWA aprobado. La prueba de navegador se ejecutó sobre el preview local y se repitió sobre el sitio publicado, con backend simulado y fallo de subida deliberado. Confirmó reapertura offline, recuperación de foto/formulario, exportación íntegra, reintento con los mismos IDs, envío de los mismos bytes, cero errores JavaScript y control de sincronización en escritorio. Se cambió la posición simulada entre abrir el formulario y disparar: se conservaron las coordenadas nuevas y su precisión al reabrir offline y se verificó su envío, junto con la actualización del feed y una única publicación tras el reintento. El envío real con una cuenta y cámara físicas sigue siendo parte de la aceptación en campo.

`scripts/check-offline-browser.cjs` prueba el build servido por `npm.cmd run preview -- --host 127.0.0.1 --port 4173`, en Chromium con cámara simulada y backend completamente interceptado. Requiere Playwright disponible mediante `require('playwright')` o `PLAYWRIGHT_MODULE`; `PLAYWRIGHT_CHROMIUM` permite indicar un ejecutable existente. Con `FAIL_UPLOAD_ONCE=1` simula un fallo entre creación y subida de foto, comprueba que el archivo se retiene y que el reintento usa la misma operación y adjunto. Incluye reapertura offline real con service worker, fotos descargadas, captura, recuperación del formulario, exportación de bytes y sincronización al reconectar. Los artefactos se guardan en `.qa/`, excluido de Git. No crea cuentas ni publicaciones en Supabase real.

Referencias: [captura fotográfica](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/takePhoto), [ciclo de visibilidad](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) y [almacenamiento persistente](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).
