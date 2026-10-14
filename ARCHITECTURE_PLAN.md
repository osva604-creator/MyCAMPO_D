# MyCAMPO_D — Diagnóstico y plan multi-organización

## Etapa A: diagnóstico (14/10/2026)

Estado: etapas B/C/D implementadas localmente, con pruebas PostgreSQL en PGlite, endpoints, React y revisión visual responsive. Consultar `STAGE_D.md` y `backend/README.md`. Etapa E real pendiente: JWT, SMTP, Realtime, Data API y concurrencia entre conexiones. No se aplicaron migraciones ni desplegaron cambios remotamente desde esta sesión.

### Arquitectura observada al comenzar la Etapa A (referencia histórica)

- React 18.3, Vite 6, Tailwind 4, JavaScript y React Router DOM 7.18.4. Cliente Supabase único en `src/lib/supabase.js`, reexportado como `cloud`.
- `AuthContext` restaura sesiones y escucha eventos Auth. `/dashboard` usa `ProtectedRoute`; login, registro y recuperación son públicos. No hay autorización por rol o membresía.
- `App.jsx` contiene el panel con muro, cuenta y mensajes. Mantener sus componentes, estilos, cámara, GPS, filtros, comentarios, reacciones, instalación PWA y exportación.
- `useField`, `events.js` y `db.js` implementan operaciones inmutables y cola IndexedDB. La separación actual es por UUID de cuenta o `local`, sin organización ni versión de permisos.
- `cloud.js` sincroniza `members` y `events`; todas las fotos se guardan en `evidence`. La descarga incorpora nuevos eventos y no elimina registros cuya autorización haya sido revocada.
- `CreatePost` permite seleccionar un integrante, pero inserta su handle como texto. No persiste IDs de menciones.
- `Messages` consulta `direct_messages` cada cinco segundos. No hay conversaciones normalizadas, Realtime, lectura, notificaciones, adjuntos ni auditoría.
- No hay tareas normalizadas, organizaciones, equipos, roles, panel administrativo ni Edge Functions locales.
- Cloudflare está configurado con fallback SPA en `wrangler.jsonc`; no se desplegó nada durante este diagnóstico.

### Estado remoto verificado

Lecturas con el conector Supabase del proyecto `kocbcvqhzwpjhewrongf`: no hay tablas en `public` ni Edge Functions desplegadas. Esto permite preparar un esquema nuevo sin migrar filas de esas tablas, pero no permite concluir que no existan datos en otros esquemas o dispositivos. No se leyeron mensajes, credenciales ni datos privados de usuarios.

### Incompatibilidades que deben resolverse

1. `schema.sql` y `activate-team.sql` describen un único equipo por proyecto y dan visibilidad completa a sus miembros. Sus políticas de fotos también permiten ver todas las evidencias del equipo. No aplicarlos para este modelo.
2. `activate-team.sql` habilita cuentas confirmadas existentes. Esto contradice la aprobación individual exclusiva del propietario.
3. El registro público y la recomendación anterior de habilitar altas contradicen la nueva exigencia. La nueva interfaz debe ofrecer activación por invitación, sin `signUp` público; también se debe deshabilitar el registro en Auth, no solo ocultar el formulario.
4. La autorización por sesión de React no sustituye RLS. Los IDs de organización, rol, creador y equipo recibidos del navegador requieren validación independiente.
5. La cola actual permite acciones sobre cualquier publicación visible y acepta fechas del dispositivo. No reutilizarla como autoridad de permisos ni de auditoría.
6. Una caché descargada no desaparece al cambiar roles. El modo equipo deberá revalidar permisos, retirar filas que dejen de ser visibles y separar la caché por organización/cuenta. Los datos ya descargados no pueden revocarse retroactivamente en un dispositivo sin conexión; no prometer esa garantía.
7. El estado de una incidencia y el de una tarea son conceptos distintos. Conservar el primero y agregar tareas relacionadas sin reinterpretar registros antiguos.

## Decisiones confirmadas y reglas propuestas

- Confirmado por el propietario en esta conversación: mensajes solo dentro de la misma organización. Guardar configuración administrativa con valor inicial `same_organization`; no permitir al cliente anularla. Una futura modificación debe definir también el acceso a conversaciones históricas.
- Un superadministrador global activo como máximo, inicializado por UUID mediante operación del propietario, nunca por registro ni por ser el primer usuario. Impedir desactivar al último administrador sin un reemplazo transaccional autorizado.
- Una membresía activa de organización por persona, un equipo activo para USUARIO y varios equipos supervisados para ENCARGADO. Validar pertenencia y roles con restricciones y triggers transaccionales, incluyendo escrituras directas.
- Conservar filas de membresías y asignaciones con intervalos de vigencia; publicaciones y tareas conservan el equipo de origen. Cambiar el equipo no reescribe su historia.
- Permisos operativos de encargados según equipos que supervisan actualmente; autores y responsables conservan los accesos expresamente definidos. El historial no otorga permisos adicionales por sí mismo.
- Propuesta para USUARIO: puede crear tareas para sí mismo; solo puede cambiar el estado de tareas asignadas. Las reasignaciones quedan reservadas a roles autorizados.
- Directorio limitado a organización activa para menciones, asignaciones y mensajería. Una mención no incorpora personas externas a una organización.
- No habilitar acceso a una publicación vinculada solo por poder ver una tarea: validar ambos recursos de forma independiente.
- Notificaciones iniciales dentro de la app mediante eventos autorizados y lectura; push/correo requieren configuración adicional y no se consideran implementados.

## Plan de ejecución

### B — Esquema y RLS, únicamente archivos locales

Preparar migraciones versionadas con CLI, separadas del esquema anterior. Entidades: `platform_admins`, `organizations`, `organization_members`, `teams`, `team_members`, `team_supervisors`, `invitation_requests`, `invitations`, `posts`, `post_mentions`, `post_comments`, `post_reactions`, `tasks`, `task_history`, `conversations`, `conversation_members`, `messages`, `message_reads`, `audit_logs`. Agregar configuración de plataforma, referencias privadas a adjuntos y notificaciones cuando el diseño lo requiera.

Usar claves compuestas para impedir relaciones entre organizaciones, índices parciales para membresías activas y solicitudes pendientes, y triggers para invariantes entre tablas. Una restricción única limita administradores; la provisión usa un UUID confirmado de Auth y no deriva permisos del correo o metadatos editables.

Habilitar RLS con denegación inicial y privilegios mínimos. Reutilizar predicados de autorización internos sin ciclos entre políticas. Si una función SECURITY DEFINER resulta necesaria, ubicarla en esquema no expuesto, fijar `search_path`, validar `auth.uid()` y restringir EXECUTE. No usarla como atajo general para saltar RLS.

Storage privado: cada objeto debe vincularse a una publicación, comentario o conversación autorizada. Validar ruta, entidad, propietario, tamaño y MIME. Las descargas deben consultar los mismos permisos del recurso. URLs firmadas, si se usan, con vigencia corta y sin persistirlas como identidad del archivo.

### C — Backend de autorización e invitaciones

Edge Functions verifican JWT con Auth y consultan permisos vigentes en servidor. Secretos solo en el backend. Operaciones administrativas limitadas a acciones explícitas, nunca SQL o nombres de tablas arbitrarios enviados por el cliente.

Solicitar invitación requiere membresía activa y solo recibe correo y contexto. Aprobar/rechazar y definir rol/equipos corresponde exclusivamente al superadministrador. La aprobación bloquea la solicitud y valida invariantes en una transacción. El envío oficial de Auth ocurre después de aprobar, con registro durable e idempotencia; evitar mantener una transacción SQL abierta durante el envío de correo. Un fallo de envío debe poder recuperarse sin aprobar dos veces ni duplicar membresías. Reintentos y reenvíos restringidos, con vencimiento y auditoría.

La activación verifica usuario Auth, correo confirmado, invitación vigente aprobada y destinatario; consume la invitación una sola vez y habilita membresía. No asociar cuentas por un correo sin verificar ni crear permisos mediante `user_metadata`.

La consulta administrativa de mensajes no recibe un SELECT global por RLS. Usar un endpoint exclusivo que exija motivo y registre actor, conversación, alcance, hora y resultado antes de devolver contenido. Mantener `audit_logs` sin UPDATE/DELETE para clientes ni para las operaciones administrativas ordinarias. Informar supervisión en la interfaz de mensajes, sin afirmar cifrado de extremo a extremo.

### D — Integración React

Mantener AuthContext para identidad y añadir autorización separada basada en respuesta del backend. Cuenta sin membresía activa ve activación pendiente; error de red no habilita permisos por defecto. Paneles y acciones según capacidades, siempre respaldadas por servidor.

Agregar panel del superadministrador: resumen, organizaciones, usuarios, solicitudes, roles, equipos, publicaciones, tareas, auditoría y actividad. Formularios administrativos usan Edge Functions; ninguna clave privilegiada en Vite.

Adaptar muro existente a repositorio online nuevo, con IDs de menciones y tareas vinculadas. Mantener el repositorio local y sus operaciones actuales. No subir automáticamente registros locales ni pendientes antiguos: requieren asociación y validación explícita de organización/equipo antes de una importación futura.

Agregar tareas e historial; conversaciones, búsqueda limitada, Realtime, indicadores de lectura y notificaciones internas. Limpiar suscripciones al cerrar sesión o cambiar cuenta. Revalidar recursos después de cambios de permisos y no confiar en filtros del navegador como control de acceso.

### E — Verificación y entrega

1. Ejecutar migraciones en PostgreSQL de prueba y comprobar restricciones, incluso escrituras concurrentes.
2. Probar con JWT reales de usuarios de prueba: propietario, gerente, encargado de varios equipos, usuarios de dos organizaciones, cuenta pendiente y deshabilitada. Verificar SELECT/INSERT/UPDATE/DELETE, RPC y Storage; no sustituir estos casos por mocks.
3. Comprobar singleton, membresías únicas, aprobación y roles exclusivos, invitaciones concurrentes, aislamiento de publicaciones/tareas, supervisión de equipos, archivos privados, mensajes de participantes y auditoría obligatoria.
4. Probar enlaces reales de invitación/recuperación, reenvíos y expiración; SMTP requiere configuración y destinatarios controlados.
5. Mantener tests actuales, agregar integración de UI y ejecutar build PWA. Revisar advisors antes de proponer despliegue.
6. Presentar migraciones, Edge Functions, procedimiento de propietario, configuración y resultados para aprobación explícita. Solo después ejecutar migraciones o desplegar al proyecto remoto.

Las pruebas reales requieren un entorno Supabase de prueba autorizado y cuentas controladas. No crear recursos remotos ni enviar invitaciones sin la aprobación de despliegue que solicita esta tarea. Hasta entonces, informar esos casos como pendientes.

## Línea base verificada

`npm test`: 22 pruebas en 6 archivos pasan, incluyendo persistencia local, interfaz, autenticación simulada y esquema anterior en PGlite. No verifican el nuevo modelo ni RLS real remoto. El build de producción se ejecuta como comprobación independiente.

## Datos necesarios para activar, no para preparar código

- UUID Auth del propietario que será superadministrador. No inferirlo entre las cuentas existentes.
- Entorno y cuentas de prueba autorizados para validar RLS real.
- Dominio definitivo, SMTP y texto de supervisión de mensajería.
- Aprobación explícita de las migraciones y despliegues concretos una vez preparados y revisables.
