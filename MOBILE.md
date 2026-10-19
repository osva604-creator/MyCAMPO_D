# Android y iPhone

El frontend está incluido dentro de los proyectos Capacitor (`android/`, `ios/`), sin depender de cargar una web remota al iniciar. El GPS de segundo plano se activa desde **Tu cuenta → Ubicación de campo**. No se inicia automáticamente: al volver a abrir después de finalizar el proceso, hay que activarlo otra vez. El botón **Seguimiento · Próximamente** está reservado y deshabilitado.

## Desarrollo

1. `npm ci`
2. Configurar las variables públicas de `.env.example` para el backend.
3. `npm run mobile:sync` compila la web, copia sus recursos y sincroniza los plugins. También corrige separadores de rutas Swift generados desde Windows.
4. Android: `npm run mobile:android`. Instalar Android Studio, SDK de Android y JDK 21 compatible con Capacitor 7. Ejecutar en un teléfono desde Android Studio. La firma de distribución se configura antes de generar el AAB/APK de producción.
5. iPhone: en una Mac con Xcode, ejecutar de nuevo `npm ci` y `npm run mobile:sync`, luego `npm run mobile:ios`. El proyecto usa Swift Package Manager. Configurar el equipo y la firma de Apple antes de instalar o distribuir.

Identificador inicial: `com.conteolab.mycampod`. Confirmarlo antes de publicar en las tiendas. Los enlaces de activación y recuperación de cuenta continúan abriéndose en la web pública; no se implementaron enlaces universales de retorno a la app.

## GPS y datos

- Plugin de segundo plano: `@capacitor-community/background-geolocation` 1.2.26, con Capacitor 7 (versión expresamente soportada por el plugin). Android mantiene una notificación visible, usa un servicio de ubicación y el puente compatible con callbacks de segundo plano. iOS declara el modo de ubicación en segundo plano y sus descripciones de permisos.
- Solo se conserva el último punto **en memoria**, sin escribir historial ni enviar movimientos al servidor. Cerrar sesión detiene el watcher y elimina ese punto. Los errores de permisos se muestran; se puede abrir Ajustes.
- Cada foto hace su propia solicitud de alta precisión con `maximumAge: 0`. No usa automáticamente una posición anterior. Foto, coordenadas, precisión y fecha quedan en el borrador local y se sincronizan al recuperar conexión y actividad.
- El GPS puede funcionar sin datos móviles. No puede garantizarse una posición si el dispositivo no tiene señal GPS, permisos, batería suficiente o servicios de ubicación disponibles. El sistema puede detener la ejecución al forzar el cierre. No hay arranque automático al encender el teléfono.
- El almacenamiento de publicaciones y fotografías sigue usando IndexedDB dentro del almacenamiento privado de la aplicación. No existe un límite total fijo de 10 MB. Desinstalar o borrar los datos de la app elimina sus borradores: exportarlos antes. No se migran automáticamente los borradores del navegador a la app nativa.
- La sincronización usa eventos nativos al entrar/salir de primer plano, además de reconexión y reintentos web. Subir al cerrar es un intento; el envío pendiente se conserva si el sistema suspende la app.

## Verificación antes de distribuir

La compilación web, sincronización de proyectos y pruebas automatizadas pueden ejecutarse en Windows. No equivalen a compilar los binarios ni probar GPS real.

Validación del 19/10/2026: 124 pruebas en 23 archivos aprobadas, build y sincronización de Android/iOS correctos. Prueba de navegador con cámara y backend simulados aprobada, incluida foto offline y reintento sin duplicados. Los tres endpoints publicados aceptan los orígenes nativos exactos, rechazan un origen ajeno y siguen exigiendo autenticación. La web publicada corresponde a la versión Cloudflare `dd74d234-354d-405a-8416-e08d91b8c8fc`. En este equipo hay Java 8 y no hay Android SDK ni Xcode; no se generaron APK/AAB/IPA ni se probó ubicación física.

En **cada plataforma**, verificar físicamente: permisos precisos y aproximados/denegados; activación y desactivación; pantalla bloqueada durante más de 10 minutos; fotografía sin conexión, incluso iniciando la app sin red; coordenada nueva y precisión; borrador tras matar/reabrir el proceso; recuperación de conexión y publicación única con foto; cierre de sesión; restricciones de batería; primera instalación sin servicios de red. Verificar consumo de batería en una jornada real y comprobar que la notificación/indicador del sistema acompaña al GPS. Las capturas con GPS fallido requieren reintentar, coordenadas manuales o guardar explícitamente sin GPS.

Fuentes: [plugin de segundo plano](https://github.com/capacitor-community/background-geolocation), [configuración Capacitor](https://capacitorjs.com/docs/config), [entorno de compilación](https://capacitorjs.com/docs/getting-started/environment-setup).
