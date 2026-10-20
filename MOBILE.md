# Android y iPhone

El frontend está incluido dentro de los proyectos Capacitor (`android/`, `ios/`), sin depender de cargar una web remota al iniciar. Las mediciones se inician y detienen explícitamente desde **Mapa**. En Android/iOS pueden continuar al cambiar de pantalla o bloquear el teléfono, sujeto a permisos, configuración y restricciones del sistema; la app mantiene el indicador de ubicación requerido. La web/PWA no garantiza ubicación continua en segundo plano. No hay inicio automático al abrir la app ni continuidad garantizada después de un cierre forzado.

## Desarrollo

1. `npm ci`
2. Configurar las variables públicas de `.env.example` para el backend.
3. `npm run mobile:sync` compila la web, copia sus recursos y sincroniza los plugins. También corrige separadores de rutas Swift generados desde Windows.
4. Android: `npm run mobile:android`. Instalar Android Studio, SDK de Android y JDK 21 compatible con Capacitor 7. Ejecutar en un teléfono desde Android Studio. La firma de distribución se configura antes de generar el AAB/APK de producción.
5. iPhone: en una Mac con Xcode, ejecutar de nuevo `npm ci` y `npm run mobile:sync`, luego `npm run mobile:ios`. El proyecto usa Swift Package Manager. Configurar el equipo y la firma de Apple antes de instalar o distribuir.

Identificador inicial: `com.conteolab.mycampod`. Confirmarlo antes de publicar en las tiendas. Los enlaces de activación y recuperación de cuenta continúan abriéndose en la web pública; no se implementaron enlaces universales de retorno a la app.

## GPS y datos

- Plugin de segundo plano: `@capacitor-community/background-geolocation` 1.2.26, con Capacitor 7 (versión expresamente soportada por el plugin). Android mantiene una notificación visible, usa un servicio de ubicación y el puente compatible con callbacks de segundo plano. iOS declara el modo de ubicación en segundo plano y sus descripciones de permisos.
- Los recorridos se guardan localmente y se sincronizan al recuperar conexión, evitando duplicados. El servicio de captura sobrevive a la navegación entre pantallas; detenerlo cierra el watcher. Al reabrir tras una interrupción se recupera el estado persistido y se informa la interrupción, sin inventar continuidad. Cerrar sesión detiene la ubicación.
- Cada foto hace su propia solicitud de alta precisión con `maximumAge: 0`. No usa automáticamente una posición anterior. Foto, coordenadas, precisión y fecha quedan en el borrador local y se sincronizan al recuperar conexión y actividad.
- El GPS puede funcionar sin datos móviles. No puede garantizarse una posición si el dispositivo no tiene señal GPS, permisos, batería suficiente o servicios de ubicación disponibles. El sistema puede detener la ejecución al forzar el cierre. No hay arranque automático al encender el teléfono.
- El almacenamiento de publicaciones y fotografías sigue usando IndexedDB dentro del almacenamiento privado de la aplicación. No existe un límite total fijo de 10 MB. Desinstalar o borrar los datos de la app elimina sus borradores: exportarlos antes. No se migran automáticamente los borradores del navegador a la app nativa.
- La sincronización usa eventos nativos al entrar/salir de primer plano, además de reconexión y reintentos web. Subir al cerrar es un intento; el envío pendiente se conserva si el sistema suspende la app.

## Verificación antes de distribuir

La compilación web, sincronización de proyectos y pruebas automatizadas pueden ejecutarse en Windows. No equivalen a compilar los binarios ni probar GPS real.

Validación del 20/10/2026: 150 pruebas automatizadas aprobadas, build web y sincronización de Android/iOS correctos. La web está publicada en Cloudflare, versión `8b9db64e-2764-4787-a7c4-74d0a2cee81f`; la migración de recorridos está aplicada en Supabase como `20261020120000`. No se generaron APK/AAB/IPA ni se probó seguimiento con pantalla bloqueada en un teléfono real. El funcionamiento en segundo plano sigue sujeto a la plataforma y requiere esa validación física antes de afirmarlo como verificado.

En **cada plataforma**, verificar físicamente: permisos precisos y aproximados/denegados; activación y desactivación; pantalla bloqueada durante más de 10 minutos; fotografía sin conexión, incluso iniciando la app sin red; coordenada nueva y precisión; borrador tras matar/reabrir el proceso; recuperación de conexión y publicación única con foto; cierre de sesión; restricciones de batería; primera instalación sin servicios de red. Verificar consumo de batería en una jornada real y comprobar que la notificación/indicador del sistema acompaña al GPS. Las capturas con GPS fallido requieren reintentar, coordenadas manuales o guardar explícitamente sin GPS.

Fuentes: [plugin de segundo plano](https://github.com/capacitor-community/background-geolocation), [configuración Capacitor](https://capacitorjs.com/docs/config), [entorno de compilación](https://capacitorjs.com/docs/getting-started/environment-setup).
