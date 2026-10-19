import { supabase } from "./supabase";

export function apiError(error) {
  const failure = new Error(
    error?.message ||
      "No se pudo completar la operación. Revisá la conexión e intentá nuevamente.",
  );
  failure.code = error?.code;
  failure.status = error?.status;
  failure.connection = error?.connection === true;
  return failure;
}
export async function platform(body, { token = null } = {}) {
  if (!supabase) throw new Error("El modo equipo no está configurado.");
  const { data, error } = await supabase.functions.invoke("campo-platform", {
    body,
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  });
  if (error) {
    let detail;
    try {
      detail = await error.context?.clone().json();
    } catch {
      /* No raw server errors in the UI. */
    }
    throw apiError({
      code: detail?.error,
      status: error.context?.status,
      connection: !error.context && /fetch|network|relay/i.test(error.name || error.message || ''),
      message:
        detail?.message ||
        "No se pudo conectar con el equipo. El administrador debe verificar la configuración online.",
    });
  }
  if (data?.error) throw apiError({ code: data.error, message: data.message });
  return data?.data;
}
export const adminCommand = (action, payload, operation_id) =>
  platform({ action, payload, operation_id });
export async function rows(query) {
  const { data, error } = await query;
  if (error)
    throw apiError({
      code: error.code,
      connection: !error.code && /fetch|network/i.test(error.message || ''),
      message:
        error.code === "42501"
          ? "No tenés acceso a estos datos."
          : "No se pudieron cargar los datos del equipo.",
    });
  return data || [];
}
export async function allRows(factory) {
  const result = [];
  for (let offset = 0; ; offset += 500) {
    const page = await rows(factory().range(offset, offset + 499));
    result.push(...page);
    if (page.length < 500) return result;
  }
}
export async function directory(org) {
  const scoped = (query) => (org ? query.eq("organization_id", org) : query);
  const [people, teams, organizations, assignments, supervisors, workTeams] =
    await Promise.all([
      allRows(() =>
        scoped(
          supabase
            .from("organization_members")
            .select("id,user_id,organization_id,name,role,ended_at,joined_at"),
        )
          .order("joined_at", { ascending: false })
          .order("id"),
      ),
      allRows(() => scoped(supabase.from("teams").select("*")).order("id")),
      allRows(() => {
        const q = supabase.from("organizations").select("id,name,active");
        return (org ? q.eq("id", org) : q).order("id");
      }),
      allRows(() =>
        scoped(supabase.from("team_members").select("id,member_id,team_id"))
          .is("ended_at", null)
          .order("id"),
      ),
      allRows(() =>
        scoped(supabase.from("team_supervisors").select("id,member_id,team_id"))
          .is("ended_at", null)
          .order("id"),
      ),
      allRows(() => supabase.from("work_teams").select("id,name").order("id")),
    ]);
  return {
    people,
    teams,
    workTeams,
    organizations,
    organization: org ? organizations[0] : { name: "Todas las organizaciones" },
    members: people.filter((p) => !p.ended_at),
    assignments,
    supervisors,
  };
}
function privateMedia() {
  const urls = [];
  let disposed = false;
  return {
    async get(file) {
      if (!file.ready || disposed) return null;
      const { data, error } = await supabase.storage
        .from("campo-private")
        .download(file.object_path);
      if (error)
        throw new Error(
          "No se pudo descargar un adjunto autorizado. Reintentá la carga.",
        );
      if (disposed) return null;
      const url = URL.createObjectURL(data);
      urls.push(url);
      return url;
    },
    dispose() {
      disposed = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    },
  };
}
export async function feed(org, info, page = 0, author = null, target = null) {
  let query = supabase
    .from("posts")
    .select("*")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(page * 20, page * 20 + 19);
  if (org) query = query.eq("organization_id", org);
  if (author) query = query.eq("author_id", author);
  let posts = await rows(query);
  if (target && page === 0 && !posts.some((p) => p.id === target)) {
    let linkQuery = supabase.from("posts").select("*").eq("id", target);
    if (org) linkQuery = linkQuery.eq("organization_id", org);
    const linked = await rows(linkQuery);
    if (linked.length && (!author || linked[0].author_id === author))
      posts = [linked[0], ...posts];
  }
  const ids = posts.map((p) => p.id);
  if (!ids.length) return { posts: [], hasMore: false };
  const [comments, reactions, mentions, tasks, files] = await Promise.all([
    allRows(() =>
      supabase.from("post_comments").select("*").in("post_id", ids).order("id"),
    ),
    allRows(() =>
      supabase
        .from("post_reactions")
        .select("*")
        .in("post_id", ids)
        .order("post_id")
        .order("user_id"),
    ),
    allRows(() =>
      supabase
        .from("post_mentions")
        .select("*")
        .in("post_id", ids)
        .order("post_id")
        .order("member_id"),
    ),
    allRows(() =>
      supabase
        .from("tasks")
        .select("id,post_id,title,status")
        .in("post_id", ids)
        .order("id"),
    ),
    allRows(() =>
      supabase.from("attachments").select("*").in("post_id", ids).order("id"),
    ),
  ]);
  const commentFiles = [];
  for (let offset = 0; offset < comments.length; offset += 100) {
    const part = await allRows(() =>
      supabase
        .from("attachments")
        .select("*")
        .in(
          "comment_id",
          comments.slice(offset, offset + 100).map((c) => c.id),
        )
        .order("id"),
    );
    commentFiles.push(...part);
  }
  const media = privateMedia();
  try {
    const hydrated = await Promise.all(
      [...files, ...commentFiles].map(async (file) => ({
        ...file,
        url: await media.get(file),
      })),
    );
    const name = (user) =>
      info.people.find((p) => p.user_id === user)?.name ||
      "Integrante del equipo";
    return {
      dispose: media.dispose,
      hasMore: posts.length >= 20,
      posts: posts.map((p) => {
        const attached = hydrated.filter((a) => a.post_id === p.id);
        return {
          ...p,
          author: { id: p.author_id, name: name(p.author_id) },
          caption: p.body,
          createdAt: p.created_at,
          gps:
            p.latitude !== null && p.longitude !== null
              ? {
                  lat: p.latitude,
                  lng: p.longitude,
                  accuracy: p.gps_accuracy,
                  source: p.gps_source,
                }
              : null,
          image: attached.find((a) => a.mime_type.startsWith("image/"))?.url,
          imageAlt: p.body,
          attachments: attached,
          organizationName: info.organizations.find(
            (o) => o.id === p.organization_id,
          )?.name,
          teamName:
            info.teams.find((t) => t.id === p.team_id)?.name ||
            "Equipo de origen",
          likedBy: reactions
            .filter((r) => r.post_id === p.id)
            .map((r) => r.user_id),
          likes: 0,
          mentions: mentions
            .filter((m) => m.post_id === p.id)
            .map((m) => info.people.find((person) => person.id === m.member_id))
            .filter(Boolean),
          tasks: tasks.filter((t) => t.post_id === p.id),
          comments: comments
            .filter((c) => c.post_id === p.id)
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .map((c) => ({
              id: c.id,
              text: c.body,
              author: name(c.author_id),
              createdAt: c.created_at,
              image: hydrated.find((a) => a.comment_id === c.id)?.url,
            })),
        };
      }),
    };
  } catch (error) {
    media.dispose();
    throw error;
  }
}
export async function conversationMessages(cid, page = 0) {
  const allowed = await rows(
    supabase.from("conversations").select("id").eq("id", cid),
  );
  if (!allowed.length)
    throw new Error(
      "La conversación no está disponible con tus permisos actuales.",
    );
  const messages = await rows(
    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", cid)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * 50, page * 50 + 49),
  );
  const files = messages.length
    ? await allRows(() =>
        supabase
          .from("attachments")
          .select("*")
          .in(
            "message_id",
            messages.map((m) => m.id),
          )
          .order("id"),
      )
    : [];
  const media = privateMedia();
  try {
    const attached = await Promise.all(
      files.map(async (f) => ({ ...f, url: await media.get(f) })),
    );
    return {
      messages: messages.map((m) => ({
        ...m,
        attachment: attached.find((a) => a.message_id === m.id),
      })),
      hasMore: messages.length === 50,
      dispose: media.dispose,
    };
  } catch (error) {
    media.dispose();
    throw error;
  }
}
export function mediaBlob(source) {
  if (!source) return null;
  if (source instanceof Blob) {
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(source.type) || !source.size || source.size > 10485760)
      throw new Error('Usá un archivo JPG, PNG o PDF de hasta 10 MB.');
    return source;
  }
  const match =
    /^data:(image\/jpeg|image\/png|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(
      source,
    );
  if (!match) throw new Error("Usá un archivo JPG, PNG o PDF.");
  const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
  if (bytes.length > 10485760 || !bytes.length)
    throw new Error("El archivo debe tener entre 1 byte y 10 MB.");
  return new Blob([bytes], { type: match[1] });
}
export function contentOperation(action, payload, media = null) {
  const blob = mediaBlob(media);
  const operation_id = crypto.randomUUID();
  return {
    action,
    operation_id,
    payload: {
      ...payload,
      ...(blob
        ? {
            attachment: {
              id: crypto.randomUUID(),
              mime_type: blob.type,
              size_bytes: blob.size,
            },
          }
        : {}),
    },
    media: blob,
  };
}
export async function executeContent(operation, { token = null, isCurrent = () => true } = {}) {
  if (!isCurrent()) throw new Error('Cambió la sesión. El pendiente se conserva en el dispositivo.');
  const result = await platform({
    action: "content.command",
    content_action: operation.action,
    payload: operation.payload,
    operation_id: operation.operation_id,
  }, { token });
  if (!isCurrent()) throw new Error('Cambió la sesión. El pendiente se conserva para confirmar su subida.');
  if (operation.media) {
    const blob = mediaBlob(operation.media);
    const { data, error } = await supabase.functions.invoke(
      "campo-attachment",
      {
        body: blob,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "x-attachment-id": operation.payload.attachment.id,
          "Content-Type": blob.type,
        },
      },
    );
    if (error || data?.error)
      throw new Error(
        "El registro quedó creado, pero falta subir su adjunto. Reintentá con el mismo archivo.",
      );
  }
  return result;
}
export function watchTeam(userId, onChange) {
  const channel = supabase.channel(`team-${userId}-${crypto.randomUUID()}`);
  for (const table of [
    "posts",
    "post_comments",
    "post_reactions",
    "tasks",
    "messages",
    "message_reads",
    "attachments",
  ])
    for (const event of ["INSERT", "UPDATE"])
      channel.on("postgres_changes", { event, schema: "public", table }, () =>
        onChange(table),
      );
  channel.subscribe();
  return () => {
    supabase.removeChannel(channel).catch(() => {});
  };
}
