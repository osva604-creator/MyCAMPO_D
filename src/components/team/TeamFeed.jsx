import { useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTeam, canManage } from "../../context/TeamContext";
import { feed } from "../../lib/teamApi";
import { useResource } from "../../lib/useResource";
import { offlineResource, accessSignature } from '../../lib/offlineStore';
import { asDataUrl } from "../../lib/media";
import { downloadJson, revision, saveContentDraft } from "../../lib/teamDrafts";
import PostCard from "../PostCard";
import { Feedback, PageHeading, ResourceState } from "./Common";

export default function TeamFeed({ own = false }) {
  const {
    orgId,
    info,
    access,
    user,
    openCreate,
    canCreate,
    pending,
    synchronize,
    online,
  } = useTeam();
  const location = useLocation();
  const [page, setPage] = useState(0),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState("Todos"),
    [exporting, setExporting] = useState(false),
    [exportError, setExportError] = useState("");
  const target =
    /^#publicacion-([0-9a-f-]{36})$/i.exec(location.hash)?.[1] || null;
  const infoKey = JSON.stringify({
    people: info.people,
    teams: info.teams,
    organizations: info.organizations,
  });
  const resource = useResource(
    useCallback(
      () => offlineResource(user.id, `feed:${accessSignature(access)}:${orgId || 'all'}:${own}:${page}:${target || ''}`,
        () => feed(orgId || null, info, page, own ? user.id : null, target), { offline: online === false }),
      [orgId, infoKey, page, own, user.id, target, accessSignature(access), online],
    ),
    {
      poll: 30000,
      events: [
        "posts",
        "post_comments",
        "post_reactions",
        "attachments",
        "tasks",
      ],
    },
  );
  const visible = new Map(
    (resource.data?.posts || []).map((p) => [
      p.id,
      { ...p, comments: [...p.comments], likedBy: [...p.likedBy] },
    ]),
  );
  const queued = (pending.data || []).filter(
    (d) =>
      d.revision ===
      revision({ ...access, organization_id: d.organization_id }),
  );
  if (page === 0)
    for (const draft of queued.filter(
      (d) => d.operation.action === "post.create",
    )) {
      const p = draft.operation.payload;
      if (visible.has(draft.id)) continue;
      visible.set(draft.id, {
        id: draft.id,
        organization_id: draft.organization_id,
        team_id: p.team_id,
        author: { id: user.id, name: access.name || "Propietario" },
        caption: p.body,
        location: p.location,
        status: "Pendiente",
        createdAt: draft.created_at,
        gps:
          p.latitude !== null
            ? {
                lat: p.latitude,
                lng: p.longitude,
                accuracy: p.gps_accuracy,
                source: p.gps_source,
              }
            : null,
        image: (draft.operation.payload.attachment?.mime_type?.startsWith('image/') || (typeof draft.operation.media === 'string' && draft.operation.media.startsWith('data:image/')))
          ? draft.mediaUrl || draft.operation.media
          : null,
        imageAlt: p.body,
        suggestion: p.suggestion,
        category: p.category,
        comments: [],
        likedBy: [],
        pending: true,
        organizationName: info.organizations.find(
          (o) => o.id === draft.organization_id,
        )?.name,
        teamName: info.teams.find((t) => t.id === p.team_id)?.name,
        attachments: (draft.operation.payload.attachment?.mime_type === 'application/pdf' || (typeof draft.operation.media === 'string' && draft.operation.media.startsWith('data:application/pdf')))
          ? [
              {
                id: draft.id,
                mime_type: "application/pdf",
                ready: true,
                url: draft.mediaUrl || draft.operation.media,
              },
            ]
          : [],
      });
    }
  for (const draft of queued) {
    const payload = draft.operation.payload,
      post = visible.get(payload.post_id);
    if (!post) continue;
    if (
      draft.operation.action === "comment.create" &&
      !post.comments.some((c) => c.id === draft.id)
    )
      post.comments.push({
        id: draft.id,
        text: payload.body,
        author: access.name || "Propietario",
        createdAt: draft.created_at,
        image: draft.mediaUrl || draft.operation.media,
        pending: true,
      });
    if (draft.operation.action === "post.status") post.status = payload.status;
    if (draft.operation.action === "reaction.set") {
      post.likedBy = post.likedBy.filter((id) => id !== user.id);
      if (payload.liked) post.likedBy.push(user.id);
    }
  }
  const displayed = [...visible.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  const filtered = displayed.filter(
    (p) =>
      (status === "Todos" || p.status === status) &&
      `${p.caption} ${p.location} ${p.author.name}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  useEffect(() => {
    if (target && resource.data)
      document
        .getElementById(`publicacion-${target}`)
        ?.scrollIntoView?.({ block: "start" });
  }, [target, resource.data]);
  async function action(type, payload) {
    const mapping = {
      status: [
        "post.status",
        { post_id: payload.postId, status: payload.status },
      ],
      like: ["reaction.set", { post_id: payload.postId, liked: payload.liked }],
      comment: [
        "comment.create",
        { post_id: payload.postId, body: payload.text },
      ],
    };
    const [name, data] = mapping[type];
    const parent = visible.get(payload.postId);
    await saveContentDraft(
      access,
      name,
      data,
      payload.image || null,
      parent.organization_id,
      type === "comment"
        ? `Comentario: ${payload.text || "Evidencia fotográfica"}`
        : type === "status"
          ? `Estado: ${payload.status}`
          : "Reacción a una publicación",
    );
    await pending.reload();
    if (navigator.onLine) {
      await synchronize();
      await resource.reload();
    }
  }
  async function backup() {
    setExporting(true);
    setExportError("");
    try {
      const toData = async (url) =>
        url ? asDataUrl(await (await fetch(url)).blob()) : null;
      const posts = await Promise.all(
        displayed.map(async (p) => ({
          ...p,
          image: await toData(p.image),
          attachments: await Promise.all(
            (p.attachments || []).map(async (a) => ({
              ...a,
              url: undefined,
              data: await toData(a.url),
            })),
          ),
          comments: await Promise.all(
            p.comments.map(async (c) => ({
              ...c,
              image: await toData(c.image),
            })),
          ),
        })),
      );
      await downloadJson("mycampo-d-publicaciones.json", {
        exportedAt: new Date().toISOString(),
        page: page + 1,
        posts,
      });
    } catch {
      setExportError(
        "No se pudo preparar el respaldo. Reintentá antes de cerrar esta pantalla.",
      );
    } finally {
      setExporting(false);
    }
  }
  return (
    <section className="mx-auto max-w-xl">
      <PageHeading
        title={own ? "Mis publicaciones" : "Tu campo, conectado."}
        description={
          own
            ? "Publicaciones de tu cuenta que siguen disponibles con tus permisos actuales."
            : "Cada recorrida cuenta. Compartí, coordiná y resolvé con tu equipo."
        }
      />
      {!orgId && (
        <p className="mb-4 rounded-xl bg-green-50 p-3 text-sm text-green-900">
          Estás viendo todas las organizaciones. Seleccioná una arriba para
          crear una publicación.
        </p>
      )}
      <div className="mb-5 flex flex-wrap gap-3">
        <button
          className="btn-secondary"
          disabled={!canCreate}
          onClick={openCreate}
        >
          Nueva publicación
        </button>
        <Link to="/dashboard/mapa" className="btn-secondary">Mapa</Link>
        <button
          disabled={!resource.data || exporting}
          onClick={backup}
          className="btn-secondary"
        >
          {exporting ? "Preparando respaldo…" : "Exportar esta página"}
        </button>
      </div>
      <label className="sr-only" htmlFor="team-search">
        Buscar en esta página
      </label>
      <input
        id="team-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar en esta página por lote, texto o autor…"
        className="form-input mb-4"
      />
      <div
        aria-label="Filtrar publicaciones por estado"
        className="mb-5 flex flex-wrap gap-2"
      >
        {["Todos", "Pendiente", "En Proceso", "Resuelto"].map((value) => (
          <button
            key={value}
            aria-pressed={status === value}
            onClick={() => setStatus(value)}
            className={`min-h-11 rounded-full px-3 text-xs font-semibold ${status === value ? "bg-green-800 text-white" : "border border-stone-200 bg-white text-stone-600"}`}
          >
            {value}
          </button>
        ))}
      </div>
      <ResourceState
        resource={resource}
        empty={resource.data && !filtered.length}
      />
      <Feedback error={exportError} />
      <div className="space-y-6">
        {filtered.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            actor={{ id: user.id, name: access.name || "Propietario" }}
            sharePath="/dashboard"
            canChangeStatus={
              post.author.id === user.id ||
              canManage(access, post.organization_id, post.team_id)
            }
            onAction={action}
          />
        ))}
      </div>
      <div className="my-6 flex items-center justify-between gap-3">
        <button
          className="btn-secondary"
          disabled={page === 0 || resource.busy}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </button>
        <span className="text-sm text-stone-500">Página {page + 1}</span>
        <button
          className="btn-secondary"
          disabled={!resource.data?.hasMore || resource.busy}
          onClick={() => setPage((p) => p + 1)}
        >
          Siguiente
        </button>
      </div>
    </section>
  );
}
