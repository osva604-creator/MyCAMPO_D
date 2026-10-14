# Etapa D — Interfaz e integración del equipo

Implementación local del 14/10/2026. No se aplicaron migraciones, configuraron secretos, enviaron invitaciones ni desplegaron funciones o frontend remoto. La validación contra Supabase real corresponde a Etapa E y requiere autorización explícita del entorno y despliegue.

## Pantallas

| Ruta | Comportamiento |
|---|---|
| `/login` | Ingreso con Supabase Auth y regreso a la ruta solicitada |
| `/registro` | Explica el ingreso por invitación; no crea cuentas públicas |
| `/recuperar-password`, `/reset-password` | Recuperación y cambio de contraseña existentes |
| `/activar-cuenta?invitacion=UUID` | Verifica aprobación vigente para la identidad antes de pedir contraseña y activar membresía |
| `/local` | Modo local independiente de Supabase, incluso si está configurado o no hay conexión |
| `/dashboard` | Muro autorizado de publicaciones, comentarios, reacciones y estados |
| `/dashboard/tareas` | Creación, asignación, prioridades, fechas, estados e historial |
| `/dashboard/mensajes` | Bandeja, búsqueda, conversaciones, adjuntos y lecturas |
| `/dashboard/notificaciones` | Avisos internos de mensajes sin leer |
| `/dashboard/cuenta` | Perfil, invitaciones solicitadas, pendientes, respaldos e instalación PWA |
| `/dashboard/admin/*` | Resumen, organizaciones, usuarios, solicitudes, roles, equipos, publicaciones, tareas, auditoría y actividad; exclusivo del propietario |

`AccessContext` obtiene permisos desde `access.context`. Una sesión autenticada sin membresía ve acceso pendiente; una respuesta rechazada o inválida retira el panel. El estado se separa por cuenta y se revalida al recuperar foco/conexión y cada treinta segundos. Las respuestas de cuentas o consultas anteriores se descartan. Los permisos almacenados en el navegador no autorizan escrituras remotas: SQL y las funciones comprueban identidad, sesión y permisos en cada operación.

El propietario puede consultar el muro/tareas de todas las organizaciones o elegir una. Para publicar elige organización y equipo activos. Gerentes, encargados y usuarios obtienen directorio y recursos mediante RLS; la UI ofrece solo acciones compatibles con su rol. Cambios administrativos exigen motivo y conservan IDs de operación para reintentos.

## Muro y tareas

Se reutilizan `CreatePost` y `PostCard`, conservando cámara, compresión, GPS, lote, filtros, comentarios, reacciones y enlaces. El muro online agrega equipo/organización, menciones seleccionadas por ID, publicaciones de texto con foto/PDF opcional y tareas vinculadas. Escribir `@nombre` sin seleccionar a la persona no concede acceso.

El muro consulta páginas de veinte publicaciones. La búsqueda de texto/lote/autor filtra la página visible y así lo indica la interfaz. El respaldo del muro exporta esa página con archivos descargados incluidos; no pretende ser un exportador administrativo global.

Las tareas tienen responsable, prioridad, fecha límite opcional, estado e historial. La selección de publicación vinculada consulta recursos autorizados, sin pedir UUID manual al usuario. Usuarios comunes crean para sí mismos y cambian solo estados de tareas asignadas; gerentes/encargados/propietario tienen las asignaciones permitidas por el servidor. Poder leer una tarea no concede acceso a su publicación vinculada.

## Mensajes y notificaciones

Conversaciones uno a uno dentro de la misma organización. El directorio no ofrece destinatarios externos. Realtime escucha INSERT/UPDATE de tablas autorizadas y vuelve a consultar datos; no usa payloads como permiso ni suscribe DELETE globales. Hay polling de respaldo cada quince segundos para mensajes y treinta para otros recursos. Las suscripciones se eliminan al cambiar cuenta/salir. La publicación SQL habilita las tablas cuando existe `supabase_realtime`.

Los indicadores de lectura registran al usuario actual para los mensajes cargados al abrir la conversación. Las notificaciones son **internas mientras la app está abierta**; no se implementaron push del sistema, correo de actividad o ejecución con la app cerrada.

La interfaz informa la supervisión administrativa y no afirma cifrado de extremo a extremo. El propietario ve primero un directorio sin contenido; debe escribir motivo para consultar una página. Cada página y cada descarga de adjunto genera su propio registro. Los mensajes ajenos no son accesibles mediante SELECT/Storage ordinario del propietario.

## Offline y transición

- El modo local mantiene la base IndexedDB original `mycampo-d` y sus funcionalidades. No depende de consultar permisos online.
- El equipo guarda operaciones pendientes en `mycampo-d-team-v2`, separadas por UUID, organización y membresía. Incluyen publicaciones, comentarios, reacciones y cambios de estado, con sus fotos/archivos.
- La sincronización conserva IDs para reintentos y procesa publicaciones antes de sus operaciones hijas. El servidor revalida permisos. Si cambia la membresía, las operaciones anteriores se retienen para revisión y exportación; no se reenvían con el nuevo rol/equipo.
- Con una sesión ya abierta, la app puede mostrar datos en memoria y capturar pendientes sin conexión. Al abrir desde cero sin poder verificar permisos, ofrece modo local y respaldos, no habilita una organización basándose en una copia persistente de roles.
- No se persisten copias nuevas de publicaciones/mensajes descargados del equipo. Los adjuntos se descargan con RLS a URLs `blob:` temporales y se revocan al cambiar alcance, fallar una consulta o desmontar la vista. Lo ya descargado no puede revocarse retroactivamente en un dispositivo desconectado.
- Los eventos antiguos por cuenta permanecen en su base anterior y se pueden exportar desde cuenta o acceso pendiente. No se borran ni se importan automáticamente al esquema nuevo. No hay importador de JSON en esta versión.
- Una publicación/comentario/mensaje se crea en una transacción con reserva de adjunto, y luego se sube el archivo. Si la subida falla, el recurso puede existir con adjunto pendiente; el reintento conserva operación y archivo. Eliminar un pendiente local no elimina un recurso ya creado online.

## Extensiones locales del backend

La tercera migración es `backend/supabase/migrations/20261014163341_application_workflows.sql`. Agrega operaciones transaccionales de contenido y conversaciones, cuenta no leída, directorio Auth exclusivo del propietario, descarga auditada de mensajes/adjuntos, confirmación de archivos y publicación Realtime. Revoca escrituras directas de contenido y subidas directas a Storage de clientes, manteniendo RLS.

Se usa `campo-platform` para JSON y se agregan:

- `campo-attachment`: verifica JWT, propiedad, permisos actuales, tamaño real y firma de formato JPEG/PNG/PDF. Sube con clave del servidor y ruta reservada, nunca con un path arbitrario del navegador. Reintentos de objetos existentes comparan SHA-256; no reemplazan archivos distintos.
- `campo-audit-attachment`: verifica propietario y registra motivo mediante SQL antes de descargar el archivo privado. No genera URL pública o firmada reutilizable.

La validación de firma identifica formato y tamaño; no es antivirus ni inspección completa de documentos. Los PDF se descargan, no se insertan como HTML.

No se agregaron dependencias al frontend. El módulo del equipo se carga con `React.lazy`; la PWA incluye sus assets en el precache. SDK de las tres funciones fijado a 2.117.3 con `deno.json`/locks.

## Verificación

Las pruebas cubren restricciones/RLS en PGlite, endpoints con Auth/HTTP simulado, autorización y activación en React, navegación administrativa, auditoría explícita, respuestas atrasadas de otras cuentas, modo local con backend configurado y retención/reintento de pendientes.

Resultado local verificado: **77 pruebas pasan en 14 archivos**, build Vite/PWA correcto y chequeo de tipos/lint de las tres funciones correctos. La prueba de privilegios inspecciona catálogos PostgreSQL, exige entradas públicas SECURITY INVOKER y ausencia de EXECUTE anónimo en funciones privadas. Se corrigió el permiso PUBLIC por defecto de `validate_team_state` mediante revocación explícita.

Revisión visual automatizada en Edge headless con fixtures de prueba aislados: siete pantallas (muro, tareas, mensajes, usuarios, solicitudes, auditoría y activación), a 390 y 1440 px. Se inspeccionaron capturas; catorce comprobaciones sin desbordamiento horizontal ni errores JavaScript. Los fixtures están excluidos de Git/producción y no autentican usuarios reales.

No se verificaron JWT reales, SMTP, callbacks de invitación reales, Realtime remoto, RLS vía Data API, hardware móvil ni concurrencia entre conexiones de PostgreSQL servidor. Estos casos siguen pendientes para Etapa E. No habilitar envíos reales hasta probar el callback y la configuración del dominio.

## Antes de activar un entorno

1. Revisar y aprobar las **tres** migraciones de `backend`, sin mezclarlas con `supabase/schema.sql` o `activate-team.sql` antiguos.
2. Identificar el UUID real del propietario y ejecutar el procedimiento de inicialización aprobado.
3. Configurar las variables del backend documentadas en `backend/.env.example`, dominio/orígenes exactos, SMTP y redirecciones `/activar-cuenta`, `/dashboard` y `/reset-password`.
4. Deshabilitar altas públicas en Supabase Auth. Eliminar el formulario del frontend no cambia esa configuración remota.
5. Desplegar las tres Edge Functions y frontend solo con aprobación explícita, y ejecutar la matriz real de Etapa E con cuentas de prueba controladas.

El frontend conserva `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`; no requiere ni acepta claves privilegiadas en variables Vite.
