import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { rows } from "../../lib/teamApi";
import { useTeam, canManage } from "../../context/TeamContext";
import { useResource } from "../../lib/useResource";
import { useMutation } from "../../lib/useMutation";
import {
  Feedback,
  PageHeading,
  ResourceState,
  TeamSelect,
  date,
} from "./Common";

const states = ["Pendiente", "En progreso", "Completada", "Cancelada"];
const priorities = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};
export default function Tasks() {
  const { orgId, access, info, user, online } = useTeam();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(0),
    [status, setStatus] = useState(""),
    [creating, setCreating] = useState(Boolean(searchParams.get("post")));
  const linkedPost = searchParams.get("post");
  useEffect(() => {
    if (linkedPost) setCreating(true);
  }, [linkedPost]);
  const resource = useResource(
    useCallback(async () => {
      let q = supabase
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(page * 30, page * 30 + 29);
      if (orgId) q = q.eq("organization_id", orgId);
      if (status) q = q.eq("status", status);
      const tasks = await rows(q);
      const postIds = tasks.map((t) => t.post_id).filter(Boolean);
      const posts = postIds.length
        ? await rows(supabase.from("posts").select("id").in("id", postIds))
        : [];
      return {
        tasks,
        visiblePostIds: new Set(posts.map((p) => p.id)),
        hasMore: tasks.length === 30,
      };
    }, [orgId, page, status]),
    { poll: 30000, events: ["tasks"] },
  );
  return (
    <section className="mx-auto max-w-3xl">
      <PageHeading
        title="Tareas del equipo"
        description="Responsables, fechas y avances con historial de cada cambio."
      >
        <button
          disabled={!online}
          onClick={() => setCreating((c) => !c)}
          className="btn-primary"
        >
          {creating ? "Cerrar formulario" : "Crear tarea"}
        </button>
      </PageHeading>
      {creating && (
        <TaskForm
          onSaved={() => {
            setCreating(false);
            resource.reload();
          }}
        />
      )}
      <label className="form-label mb-5">
        Filtrar por estado
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="form-input"
        >
          <option value="">Todos los estados</option>
          {states.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <ResourceState
        resource={resource}
        empty={resource.data && !resource.data.tasks.length}
      />
      <div className="space-y-4">
        {resource.data?.tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            highlighted={searchParams.get("task") === task.id}
            access={access}
            info={info}
            user={user}
            online={online}
            linkedVisible={resource.data.visiblePostIds.has(task.post_id)}
            reload={resource.reload}
          />
        ))}
      </div>
      <div className="my-6 flex justify-between">
        <button
          className="btn-secondary"
          disabled={!page || resource.busy}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </button>
        <p className="self-center text-sm">Página {page + 1}</p>
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
function eligible(info, org, team, access, user) {
  if (access.role === "USUARIO")
    return info.members.filter((m) => m.user_id === user.id);
  const membershipIds = new Set(
    [...info.assignments, ...info.supervisors]
      .filter((a) => a.team_id === team)
      .map((a) => a.member_id),
  );
  return info.members.filter(
    (m) =>
      m.organization_id === org &&
      (access.role === "SUPER_ADMIN" ||
        ["GERENTE", "GERENTE_GENERAL"].includes(access.role) ||
        membershipIds.has(m.id)),
  );
}
function TaskForm({ task, onSaved }) {
  const { orgId, access, info, user, online } = useTeam();
  const [org, setOrg] = useState(task?.organization_id || orgId || ""),
    [team, setTeam] = useState(task?.team_id || ""),
    [assignee, setAssignee] = useState(
      task?.assignee_id || (access.role === "USUARIO" ? user.id : ""),
    );
  const [postSearch, setPostSearch] = useState(""),
    [post, setPost] = useState(
      new URLSearchParams(window.location.search).get("post") || "",
    );
  const publications = useResource(
    useCallback(async () => {
      if (task || !org) return [];
      const result = await rows(
        supabase
          .from("posts")
          .select("id,body")
          .eq("organization_id", org)
          .ilike("body", `%${postSearch}%`)
          .order("created_at", { ascending: false })
          .limit(30),
      );
      if (post && !result.some((p) => p.id === post)) {
        const linked = await rows(
          supabase
            .from("posts")
            .select("id,body")
            .eq("id", post)
            .eq("organization_id", org),
        );
        result.unshift(...linked);
      }
      return result;
    }, [org, postSearch, post, task?.id]),
  );
  const mutation = useMutation(onSaved);
  const canAssign = task
    ? canManage(access, task.organization_id, task.team_id)
    : access.role !== "USUARIO";
  const teams = info.teams.filter(
    (t) =>
      t.organization_id === org &&
      t.active &&
      (access.role === "SUPER_ADMIN" ||
        access.teams.some((a) => a.id === t.id)),
  );
  const members = eligible(info, org, team, access, user);
  async function submit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      title: String(form.get("title")).trim(),
      description: String(form.get("description")).trim(),
      priority: form.get("priority"),
      due_at: form.get("due") ? new Date(form.get("due")).toISOString() : null,
      assignee_id: assignee,
    };
    if (task) {
      payload.task_id = task.id;
      await mutation.run("task.update", payload);
    } else {
      payload.organization_id = org;
      payload.team_id = team;
      payload.post_id = post || null;
      await mutation.run("task.create", payload);
    }
  }
  return (
    <form onSubmit={submit} className="panel mb-5 space-y-4">
      <h2 className="text-lg font-bold">
        {task ? "Editar tarea" : "Nueva tarea"}
      </h2>
      {!task && access.role === "SUPER_ADMIN" && (
        <label className="form-label">
          Organización
          <select
            required
            value={org}
            onChange={(e) => {
              setOrg(e.target.value);
              setTeam("");
              setAssignee("");
            }}
            className="form-input"
          >
            <option value="">Seleccionar organización</option>
            {info.organizations
              .filter((o) => o.active)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {!task && (
        <TeamSelect
          teams={teams}
          value={team}
          onChange={(value) => {
            setTeam(value);
            if (access.role !== "USUARIO") setAssignee("");
          }}
        />
      )}
      <label className="form-label">
        Título
        <input
          name="title"
          defaultValue={task?.title}
          required
          maxLength={160}
          className="form-input"
        />
      </label>
      <label className="form-label">
        Descripción
        <textarea
          name="description"
          defaultValue={task?.description}
          maxLength={4000}
          rows={3}
          className="form-input"
        />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="form-label">
          Prioridad
          <select
            name="priority"
            defaultValue={task?.priority || "normal"}
            className="form-input"
          >
            {Object.entries(priorities).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Fecha límite
          <input
            name="due"
            type="datetime-local"
            defaultValue={
              task?.due_at
                ? new Date(
                    new Date(task.due_at).getTime() -
                      new Date(task.due_at).getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16)
                : ""
            }
            className="form-input"
          />
        </label>
      </div>
      <label className="form-label">
        Responsable
        <select
          required
          disabled={!canAssign}
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          className="form-input"
        >
          <option value="">Seleccionar responsable</option>
          {members.map((m) => (
            <option key={m.id} value={m.user_id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {!task && (
        <fieldset className="space-y-3 rounded-xl border p-3">
          <legend className="px-1 text-sm font-semibold">
            Publicación vinculada (opcional)
          </legend>
          <label className="form-label">
            Buscar publicación
            <input
              type="search"
              value={postSearch}
              onChange={(e) => setPostSearch(e.target.value)}
              className="form-input"
            />
          </label>
          <ResourceState resource={publications} />
          <select
            aria-label="Publicación vinculada"
            className="form-input"
            value={post}
            onChange={(e) => setPost(e.target.value)}
          >
            <option value="">Sin publicación vinculada</option>
            {publications.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.body.slice(0, 100)}
              </option>
            ))}
          </select>
        </fieldset>
      )}
      <Feedback {...mutation} />
      <button
        disabled={mutation.busy || !online || !assignee}
        className="btn-primary"
      >
        Guardar tarea
      </button>
    </form>
  );
}
function TaskCard({
  task,
  access,
  info,
  user,
  online,
  linkedVisible,
  reload,
  highlighted,
}) {
  const [history, setHistory] = useState(false),
    [editing, setEditing] = useState(false);
  const mutation = useMutation(reload);
  const manages = canManage(access, task.organization_id, task.team_id);
  const canUpdate = manages || task.assignee_id === user.id;
  const name = (id) =>
    info.people.find((p) => p.user_id === id)?.name || "Integrante";
  return (
    <article
      id={`tarea-${task.id}`}
      className={`panel ${highlighted ? "ring-2 ring-green-700" : ""}`}
    >
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="font-bold">{task.title}</h2>
          <p className="mt-1 text-xs text-green-800">
            {
              info.organizations.find((o) => o.id === task.organization_id)
                ?.name
            }{" "}
            · {info.teams.find((t) => t.id === task.team_id)?.name}
          </p>
        </div>
        <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold">
          {priorities[task.priority]}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-stone-600">
        {task.description}
      </p>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-stone-500">Responsable</dt>
          <dd className="font-semibold">{name(task.assignee_id)}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Fecha límite</dt>
          <dd>{date(task.due_at)}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">Creada por</dt>
          <dd>
            {name(task.created_by)} · {date(task.created_at)}
          </dd>
        </div>
      </dl>
      {task.post_id &&
        (linkedVisible ? (
          <Link
            className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-green-800"
            to={`/dashboard#publicacion-${task.post_id}`}
          >
            Ver publicación vinculada
          </Link>
        ) : (
          <p className="mt-3 text-xs text-stone-500">
            La publicación vinculada no está disponible con tus permisos.
          </p>
        ))}
      <label className="form-label mt-4">
        Estado de la tarea
        <select
          aria-label={`Estado de ${task.title}`}
          value={task.status}
          disabled={!canUpdate || !online || mutation.busy}
          onChange={(e) =>
            mutation.run("task.update", {
              task_id: task.id,
              status: e.target.value,
            })
          }
          className="form-input"
        >
          {states.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <Feedback {...mutation} />
      <div className="mt-3 flex flex-wrap gap-3">
        {manages && (
          <button
            disabled={!online}
            onClick={() => setEditing((v) => !v)}
            className="btn-secondary"
          >
            Editar asignación
          </button>
        )}
        <button onClick={() => setHistory((v) => !v)} className="btn-secondary">
          {history ? "Ocultar historial" : "Ver historial"}
        </button>
      </div>
      {editing && (
        <div className="mt-5">
          <TaskForm
            task={task}
            onSaved={() => {
              setEditing(false);
              reload();
            }}
          />
        </div>
      )}
      {history && <TaskHistory taskId={task.id} info={info} />}
    </article>
  );
}
function TaskHistory({ taskId, info }) {
  const [page, setPage] = useState(0);
  const resource = useResource(
    useCallback(
      () =>
        rows(
          supabase
            .from("task_history")
            .select("*")
            .eq("task_id", taskId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .range(page * 20, page * 20 + 19),
        ),
      [taskId, page],
    ),
  );
  return (
    <section className="mt-4 border-t pt-4">
      <h3 className="text-sm font-bold">Historial de cambios</h3>
      <ResourceState resource={resource} />
      <ol className="mt-3 space-y-3">
        {resource.data?.map((item) => (
          <li
            key={item.id}
            className="border-l-2 border-green-200 pl-3 text-xs text-stone-500"
          >
            <p className="font-semibold text-stone-700">
              {!item.old_values
                ? "Tarea creada"
                : item.old_values.status !== item.new_values.status
                  ? `${item.old_values.status} → ${item.new_values.status}`
                  : "Datos o responsable actualizados"}
            </p>
            <p>
              {info.people.find((p) => p.user_id === item.actor_id)?.name ||
                "Administrador"}{" "}
              · {date(item.created_at)}
            </p>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex gap-3">
        <button
          className="btn-secondary"
          disabled={!page}
          onClick={() => setPage((p) => p - 1)}
        >
          Anterior
        </button>
        <button
          className="btn-secondary"
          disabled={resource.data?.length !== 20}
          onClick={() => setPage((p) => p + 1)}
        >
          Más cambios
        </button>
      </div>
    </section>
  );
}
