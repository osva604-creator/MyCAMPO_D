# Revisión de memoria y almacenamiento — 21/10/2026

Se conservaron las bases IndexedDB existentes y sus versiones. No se borraron
publicaciones, borradores, fotos pendientes ni registros locales originales.

## Cambios

- Conexiones IndexedDB compartidas, recuperables después de errores y cerradas
  ante una actualización de esquema desde otra pestaña.
- Lectura de eventos por rango de cuenta. Lectura de GPS por ámbito y por día;
  la exportación sigue leyendo todos los puntos para el respaldo completo.
- Caché de lectura limitada globalmente a 60 MiB, 12 entradas de contenido y
  32 entradas auxiliares. El cálculo de tamaño y la limpieza recorren metadatos
  sin retener todas las fotos simultáneamente en memoria. La limpieza por cuota
  conserva permisos, directorios, formularios y operaciones pendientes.
- Las respuestas que llegan después de limpiar la caché o cerrar sesión no la
  vuelven a poblar. Los rechazos de autorización no se ocultan con datos viejos.
- Escritura atómica de formulario y foto. Se eliminó la referencia global que
  mantenía una foto base64 viva después de abandonar el formulario.
- Descargas de adjuntos limitadas a cuatro simultáneas; las ráfagas de foco o
  reconexión comparten una consulta. Una invalidación por cambios pide una
  lectura nueva después de la que esté en curso. Las URL blob se liberan al
  reemplazar datos, abandonar pantallas o recibir respuestas obsoletas.
- Las fotos del mapa confirmadas dejan de duplicarse en los registros locales.
  Las copias de recorridos remotos finalizados y confirmados caducan tras 30
  días; se conservan recorridos activos, pendientes, locales y tombstones.
  Los originales remotos siguen disponibles por fecha con conexión.
- Los KMZ temporales nativos de la carpeta propia de exportación se limpian en
  el siguiente envío cuando superan 24 horas.
- Las consultas incrementales de GPS se paginan para superar el límite de
  respuesta de Supabase sin truncar recorridos. Las respuestas de otra selección
  se descartan. Las API privadas usan `cache: no-store`; el modo offline usa
  exclusivamente la caché acotada por cuenta.
- El service worker precachea recursos estáticos y limpia versiones antiguas.
  HTML/manifest se revalidan, `sw.js` no se almacena en caché HTTP y los recursos
  con hash tienen caché inmutable. La actualización sigue siendo explícita para
  permitir guardar formularios antes de recargar.
- El aviso de instalación y el aviso inicial de disponibilidad offline duran
  dos segundos. La invitación a actualizar permanece hasta la acción del usuario.

## Supabase

Proyecto revisado: `kocbcvqhzwpjhewrongf`. Tablas públicas con RLS, ambos buckets
privados y sin grants directos de cliente al esquema privado. Las tres Edge
Functions están activas y mantienen su validación interna de identidad.
Auth confirma altas públicas deshabilitadas y confirmación automática desactivada.

Migraciones aplicadas y verificadas localmente con PostgreSQL/PGlite:

- `20261021172928_storage_and_rls_performance.sql`, historial remoto
  `20261021173216`: índices de claves foráneas, historial/fotos de mapa y checks
  de identidad constantes por solicitud en las políticas existentes.
- `20261021173320_map_track_team_lookup.sql`, historial remoto
  `20261021173430`: reorganiza el índice previo de
  recorridos por equipo, aprovechando el nuevo índice de organización/fecha.

El historial remoto asigna su propio timestamp: comparar por nombre y contenido;
no ejecutar `db push` sin reconciliar el historial documentado en STAGE_E.md.
No se eliminaron datos, políticas ni índices por falta de uso reciente.

Después de aplicar ambas migraciones: cero advertencias de rendimiento de RLS y
cero claves foráneas sin índice según advisors. Los índices aún sin uso son
informativos en un proyecto con poca actividad. `command_results` conserva
intencionalmente RLS sin políticas de cliente y sin permisos directos.

Queda el aviso de protección contra contraseñas filtradas: el proyecto usa Free y
esa función requiere Pro o superior. No se cambió la suscripción.
[Documentación oficial](https://supabase.com/docs/guides/auth/password-security).

## Alcance de validación

Pruebas automatizadas de persistencia, cuota, aislamiento, limpieza de recursos,
instalación de dos segundos, permisos SQL y mapas; flujo real de navegador con
escritorio/móvil y recarga offline. Android/iOS se sincronizan con Capacitor;
compilar/distribuir binarios y validar GPS/WhatsApp en teléfonos físicos continúa
siendo una verificación separada del despliegue web.

Resultado de esta revisión: 167 pruebas aprobadas en 31 archivos, build y
sincronización Capacitor aprobados, flujo de mapas con navegador móvil/escritorio
sin errores. Una prueba de 25 ciclos de apertura/cierre del mapa, después de cinco
ciclos de calentamiento y recolección de basura, midió 395.828 bytes de crecimiento
de heap y cuatro nodos DOM menos. Es una comprobación puntual de estabilidad,
no una garantía sobre todos los dispositivos o tamaños de datos.
