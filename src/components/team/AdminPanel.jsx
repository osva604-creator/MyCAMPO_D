import { useCallback, useEffect, useState } from "react";
import { NavLink, useParams, useSearchParams } from "react-router-dom";
import { useTeam } from "../../context/TeamContext";
import { supabase } from "../../lib/supabase";
import { platform, rows } from "../../lib/teamApi";
import { useResource } from "../../lib/useResource";
import { useMutation } from "../../lib/useMutation";
import TeamFeed from "./TeamFeed";
import Tasks from "./Tasks";
import {
  Feedback,
  PageHeading,
  ResourceState,
  RoleFields,
  date,
  roleName,
} from "./Common";

const sections = {
  resumen: "Resumen global",
  organizaciones: "Organizaciones",
  usuarios: "Usuarios",
  solicitudes: "Solicitudes",
  roles: "Roles y permisos",
  equipos: "Equipos",
  publicaciones: "Publicaciones",
  tareas: "Tareas",
  auditoria: "Auditoría de mensajes",
  actividad: "Registro de actividad",
};
const deliveryNames = {
  pending: "Sin enviar",
  sending: "Envío en curso",
  sent: "Aceptado por Auth",
  failed: "Envío fallido",
  uncertain: "Requiere revisión",
  existing_account: "Cuenta existente",
};
export default function AdminPanel() {
  const { access, info, orgId, refreshInfo } = useTeam();
  const params = useParams();
  const section = params["*"] || "resumen";
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [section, orgId]);
  const resource = useResource(
    useCallback(async () => {
      if (section === "solicitudes") {
        let requests = supabase
          .from("invitation_requests")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(page * 30, page * 30 + 29);
        let invitations = supabase
          .from("invitations")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(page * 30, page * 30 + 29);
        if (orgId) {
          requests = requests.eq("organization_id", orgId);
          invitations = invitations.eq("organization_id", orgId);
        }
        const [r, i] = await Promise.all([rows(requests), rows(invitations)]);
        return {
          requests: r,
          invitations: i,
          hasMore: r.length === 30 || i.length === 30,
        };
      }
      if (section === "actividad")
        return {
          logs: await rows(
            supabase
              .from("audit_logs")
              .select("*")
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .range(page * 50, page * 50 + 49),
          ),
        };
      if (section === "resumen") {
        const counts = await Promise.all(
          [
            "organizations",
            "organization_members",
            "work_teams",
            "posts",
            "tasks",
            "invitation_requests",
          ].map(async (table) => {
            let q = supabase
              .from(table)
              .select("id", { count: "exact", head: true });
            if (table === "organization_members") q = q.is("ended_at", null);
            if (table === "invitation_requests") q = q.eq("status", "pending");
            const { count, error } = await q;
            if (error) throw new Error("No se pudo cargar el resumen global.");
            return count;
          }),
        );
        return { counts };
      }
      return {};
    }, [section, page, orgId]),
    { poll: 30000 },
  );
  const updated = async () => {
    await refreshInfo();
    await resource.reload();
  };
  if (access.role !== "SUPER_ADMIN")
    return <p role="alert">No tenés acceso a la administración.</p>;
  return (
    <section>
      <PageHeading
        eyebrow="Administración de la plataforma"
        title={sections[section] || "Administración"}
        description="Solo el propietario puede modificar jerarquías y aprobar ingresos. Los cambios quedan registrados."
      />
      <nav
        aria-label="Secciones administrativas"
        className="mb-6 flex gap-2 overflow-x-auto pb-2 sm:flex-wrap sm:overflow-visible"
      >
        {Object.entries(sections).map(([key, label]) => (
          <NavLink
            key={key}
            to={
              key === "resumen" ? "/dashboard/admin" : `/dashboard/admin/${key}`
            }
            end
            className={({ isActive }) =>
              `inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-xs font-semibold ${isActive ? "bg-green-800 text-white" : "border bg-white text-stone-600"}`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>
      <ResourceState resource={resource} />
      {section === "resumen" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {resource.data?.counts?.map((value, index) => (
              <div key={index} className="panel">
                <p className="text-sm text-stone-500">
                  {
                    [
                      "Organizaciones",
                      "Miembros activos",
                      "Equipos",
                      "Publicaciones",
                      "Tareas",
                      "Solicitudes pendientes",
                    ][index]
                  }
                </p>
                <p className="mt-3 text-3xl font-bold text-green-800">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm text-stone-500">
            El resumen cuenta toda la plataforma. Usá el selector superior para
            consultar publicaciones y tareas de una organización.
          </p>
        </>
      )}
      {section === "organizaciones" && (
        <Organizations info={info} updated={updated} />
      )}
      {(section === "usuarios" || section === "roles") && (
        <>
          <Members info={info} updated={updated} />
          {section === "roles" && <MessagingSettings updated={updated} />}
        </>
      )}
      {section === "equipos" && <Teams info={info} updated={updated} />}
      {section === "solicitudes" && resource.data && (
        <Invitations data={resource.data} info={info} updated={updated} />
      )}
      {section === "publicaciones" && <TeamFeed />}
      {section === "tareas" && <Tasks />}
      {section === "auditoria" && <Audit info={info} />}
      {section === "actividad" && (
        <div className="space-y-3">
          {resource.data?.logs?.map((log) => (
            <article key={log.id} className="panel">
              <p className="font-semibold">{activityName(log.action)}</p>
              <p className="mt-2 text-sm leading-6 text-stone-600">
                {log.reason}
              </p>
              <p className="mt-2 text-xs text-stone-500">
                {date(log.created_at)} ·{" "}
                {info.people.find((p) => p.user_id === log.actor_id)?.name ||
                  "Propietario / cuenta verificada"}
              </p>
            </article>
          ))}
        </div>
      )}
      {["solicitudes", "actividad"].includes(section) && (
        <div className="my-5 flex justify-between">
          <button
            className="btn-secondary"
            disabled={!page || resource.busy}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </button>
          <span className="self-center text-sm">Página {page + 1}</span>
          <button
            className="btn-secondary"
            disabled={
              resource.busy ||
              !(resource.data?.hasMore || resource.data?.logs?.length === 50)
            }
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </button>
        </div>
      )}
    </section>
  );
}
function Reason({ label = "Motivo del cambio" }) {
  return (
    <label className="form-label">
      {label}
      <textarea
        name="reason"
        required
        minLength={10}
        maxLength={1000}
        rows={2}
        className="form-input"
        placeholder="Explicá por qué se realiza esta operación"
      />
    </label>
  );
}
function ReasonAction({ label, action, payload, after, danger = false }) {
  const [expanded, setExpanded] = useState(false);
  const mutation = useMutation(async (result) => {
    setExpanded(false);
    await after?.(result);
  });
  return (
    <div>
      {!expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className={`btn-secondary ${danger ? "text-red-700" : ""}`}
        >
          {label}
        </button>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.run(
              action,
              {
                ...payload,
                reason: new FormData(e.currentTarget).get("reason"),
              },
              null,
              true,
            );
          }}
          className="mt-3 space-y-3 rounded-xl border p-3"
        >
          <Reason />
          <Feedback {...mutation} />
          <div className="flex flex-wrap gap-2">
            <button disabled={mutation.busy} className="btn-primary">
              Confirmar: {label}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setExpanded(false)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
function Organizations({ info, updated }) {
  const [selected, setSelected] = useState(null);
  const mutation = useMutation(async () => {
    setSelected(null);
    await updated();
  });
  async function submit(event) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const result = await mutation.run(
      selected ? "organization.update" : "organization.create",
      {
        ...(selected
          ? { id: selected.id, active: f.get("active") === "on" }
          : {}),
        name: String(f.get("name")).trim(),
        reason: f.get("reason"),
      },
      null,
      true,
    );
    if (result) event.target.reset();
  }
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        {info.organizations.map((org) => (
          <article
            key={org.id}
            className="panel flex flex-wrap items-center justify-between gap-3"
          >
            <div>
              <h2 className="font-bold">{org.name}</h2>
              <p className="mt-1 text-xs text-stone-500">
                {org.active ? "Activa" : "Deshabilitada"}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-stone-600">
                {info.teams.filter((team) => team.organization_id === org.id).map((team) => (
                  <li key={team.id}>{team.name}{!team.active && " · Vínculo deshabilitado"}</li>
                ))}
              </ul>
              {!info.teams.some((team) => team.organization_id === org.id) && (
                <p className="mt-2 text-sm text-stone-500">Todavía no tiene equipos vinculados.</p>
              )}
              {org.active && <NavLink className="btn-secondary mt-3" to={`/dashboard/admin/equipos?organizacion=${org.id}`}>
                Agregar equipos
              </NavLink>}
            </div>
            <button className="btn-secondary" onClick={() => setSelected(org)}>
              Editar organización
            </button>
          </article>
        ))}
      </div>
      <form
        key={selected?.id || "new"}
        onSubmit={submit}
        className="panel space-y-4"
      >
        <h2 className="font-bold">
          {selected ? "Editar organización" : "Crear organización"}
        </h2>
        <label className="form-label">
          Nombre
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={selected?.name}
            className="form-input"
          />
        </label>
        {selected && (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              defaultChecked={selected.active}
            />
            Organización activa
          </label>
        )}
        <Reason />
        <Feedback {...mutation} />
        <div className="flex gap-3">
          <button disabled={mutation.busy} className="btn-primary">
            Guardar organización
          </button>
          {selected && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSelected(null)}
            >
              Nueva
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
function Teams({ info, updated }) {
  const [params] = useSearchParams();
  const initialOrg = params.get("organizacion") || "";
  const [selected, setSelected] = useState(null);
  const [org, setOrg] = useState(initialOrg);
  const [linkOrg, setLinkOrg] = useState(initialOrg);
  const [teamId, setTeamId] = useState("");
  const workTeams = info.workTeams || [];
  useEffect(() => { setOrg(initialOrg); setLinkOrg(initialOrg); }, [initialOrg]);
  const mutation = useMutation(async () => { setSelected(null); await updated(); });
  const linking = useMutation(async () => { setTeamId(""); await updated(); });
  const available = workTeams.filter(team => !info.teams.some(link =>
    link.work_team_id === team.id && link.organization_id === linkOrg));
  const organizationOptions = info.organizations.filter(o => o.active).map(o =>
    <option key={o.id} value={o.id}>{o.name}</option>);
  return <div className="space-y-5">
    <p className="text-sm leading-6 text-stone-600">
      Creá los equipos de forma independiente y vinculalos a una o varias organizaciones.
      Cada vínculo mantiene sus propios integrantes, publicaciones y tareas.
    </p>
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <form key={selected?.id || "new"} className="panel space-y-4" onSubmit={async event => {
        event.preventDefault();
        const form = event.currentTarget, fields = new FormData(form);
        const result = await mutation.run(selected ? "work_team.update" : "work_team.create", {
          ...(selected ? {id:selected.id} : org ? {organization_id:org} : {}),
          name: String(fields.get("name")).trim(), reason:fields.get("reason"),
        }, null, true);
        if(result) form.reset();
      }}>
        <h2 className="font-bold">{selected ? "Editar nombre del equipo" : "Crear equipo"}</h2>
        <label className="form-label">Nombre del equipo
          <input name="name" required maxLength={120} defaultValue={selected?.name} className="form-input" />
        </label>
        {!selected && <label className="form-label">Vincular al crear (opcional)
          <select value={org} onChange={e=>setOrg(e.target.value)} className="form-input">
            <option value="">Crear sin organización</option>{organizationOptions}
          </select>
        </label>}
        {selected && <p className="text-sm text-stone-500">El nuevo nombre se aplica en todas las organizaciones vinculadas.</p>}
        <Reason /><Feedback {...mutation}/>
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" disabled={mutation.busy}>Guardar equipo</button>
          {selected && <button type="button" className="btn-secondary" onClick={()=>setSelected(null)}>Cancelar edición</button>}
        </div>
      </form>
      <form className="panel space-y-4" onSubmit={async event => {
        event.preventDefault();const form=event.currentTarget;
        const result=await linking.run("team.link",{work_team_id:teamId,organization_id:linkOrg,
          reason:new FormData(form).get("reason")},null,true);
        if(result)form.reset();
      }}>
        <h2 className="font-bold">Vincular equipo existente</h2>
        <label className="form-label">Organización del vínculo
          <select required value={linkOrg} onChange={e=>{setLinkOrg(e.target.value);setTeamId("");}} className="form-input">
            <option value="">Seleccionar organización</option>{organizationOptions}
          </select>
        </label>
        <label className="form-label">Equipo existente
          <select required value={teamId} onChange={e=>setTeamId(e.target.value)} className="form-input" disabled={!linkOrg}>
            <option value="">Seleccionar equipo</option>
            {available.map(team=><option key={team.id} value={team.id}>{team.name}</option>)}
          </select>
        </label>
        {linkOrg && !available.length && <p className="text-sm text-stone-500">No hay equipos disponibles para agregar. Podés crear uno nuevo.</p>}
        <Reason /><Feedback {...linking}/>
        <button className="btn-primary" disabled={linking.busy || !linkOrg || !teamId}>Vincular equipo</button>
      </form>
    </div>
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {!workTeams.length && <p className="panel text-sm text-stone-500">Todavía no hay equipos creados.</p>}
      {workTeams.map(team=>{
        const links=info.teams.filter(link=>link.work_team_id===team.id);
        return <article className="panel space-y-3" key={team.id}>
          <h2 className="font-bold">{team.name}</h2>
          <button className="btn-secondary" onClick={()=>setSelected(team)}>Editar nombre</button>
          {!links.length && <p className="text-sm text-stone-500">Sin organizaciones vinculadas.</p>}
          {links.map(link=><div className="space-y-2 rounded-xl border p-3" key={link.id}>
            <p className="text-sm">{info.organizations.find(o=>o.id===link.organization_id)?.name} · {link.active ? "Vinculado" : "Vínculo deshabilitado"}</p>
            <ReasonAction label={link.active ? "Deshabilitar vínculo" : "Reactivar vínculo"} action="team.update"
              payload={{id:link.id,active:!link.active}} after={updated} danger={link.active}/>
          </div>)}
        </article>;
      })}
    </div>
    <p className="text-xs text-stone-500">Para deshabilitar un vínculo, trasladá antes sus integrantes y supervisores y cerrá sus invitaciones vigentes. Los demás vínculos del equipo se conservan.</p>
  </div>;
}
function Members({ info, updated }) {
  const [selected, setSelected] = useState(null),
    [search, setSearch] = useState(""),
    [org, setOrg] = useState(""),
    [role, setRole] = useState("USUARIO"),
    [teams, setTeams] = useState([]),
    [account, setAccount] = useState(null),
    [more, setMore] = useState([]),
    [moreBusy, setMoreBusy] = useState(false),
    [moreError, setMoreError] = useState("");
  const accounts = useResource(
    useCallback(() => platform({ action: "admin.accounts", search }), [search]),
  );
  const mutation = useMutation(async () => {
    setSelected(null);
    setAccount(null);
    await updated();
  });
  const accountList = [...(accounts.data || []), ...more].filter(
    (a, i, all) => all.findIndex((v) => v.id === a.id) === i,
  );
  useEffect(() => setMore([]), [search]);
  function select(member) {
    setSelected(member);
    setAccount({
      id: member.user_id,
      email:
        accountList.find((a) => a.id === member.user_id)?.email || member.name,
    });
    setOrg(member.organization_id);
    setRole(member.role);
    setTeams(
      [...info.assignments, ...info.supervisors]
        .filter((a) => a.member_id === member.id)
        .map((a) => a.team_id),
    );
  }
  async function moreAccounts() {
    const last = accountList.at(-1);
    if (!last) return;
    setMoreBusy(true);
    try {
      const result = await platform({
        action: "admin.accounts",
        search,
        before_email: last.email,
        before_id: last.id,
      });
      setMore((old) => [...old, ...result]);
    } catch (failure) {
      setMoreError(failure.message);
    } finally {
      setMoreBusy(false);
    }
  }
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <div className="space-y-3">
        <p className="text-sm leading-6 text-stone-500">
          El gerente general puede pertenecer a varias organizaciones. Los demás roles tienen una organización activa. Un encargado puede
          supervisar varios equipos. Solo el propietario cambia estas
          asignaciones.
        </p>
        {info.members.map((member) => (
          <article key={member.id} className="panel">
            <h2 className="font-bold">{member.name}</h2>
            <p className="mt-1 text-xs text-stone-500">
              {roleName[member.role]} ·{" "}
              {
                info.organizations.find((o) => o.id === member.organization_id)
                  ?.name
              }
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn-secondary" onClick={() => select(member)}>
                Cambiar rol o equipos
              </button>
              <ReasonAction
                label="Suspender todos los accesos"
                action="membership.suspend"
                payload={{ user_id: member.user_id }}
                after={updated}
                danger
              />
            </div>
          </article>
        ))}
      </div>
      <form
        key={selected?.id || account?.id || "new"}
        onSubmit={async (e) => {
          e.preventDefault();
          await mutation.run(
            "membership.set",
            {
              user_id: account?.id,
              organization_id: org,
              role,
              team_ids: teams,
              name: String(new FormData(e.currentTarget).get("name")).trim(),
              reason: new FormData(e.currentTarget).get("reason"),
            },
            null,
            true,
          );
        }}
        className="panel space-y-4"
      >
        <h2 className="font-bold">
          {selected
            ? "Cambiar membresía"
            : "Asignar acceso a una cuenta existente"}
        </h2>
        {!selected && (
          <>
            <label className="form-label">
              Buscar cuenta por correo
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="form-input"
                type="search"
                placeholder="Correo de una cuenta Auth existente"
              />
            </label>
            <ResourceState resource={accounts} />
            <label className="form-label">
              Cuenta
              <select
                required
                value={account?.id || ""}
                onChange={(e) =>
                  setAccount(accountList.find((a) => a.id === e.target.value))
                }
                className="form-input"
              >
                <option value="">Seleccionar cuenta confirmada</option>
                {accountList.map((a) => (
                  <option
                    key={a.id}
                    value={a.id}
                    disabled={!a.email_confirmed_at || a.banned}
                  >
                    {a.email}
                    {!a.email_confirmed_at
                      ? " · Sin confirmar"
                      : a.banned
                        ? " · Bloqueada"
                        : ""}
                  </option>
                ))}
              </select>
            </label>
            {accountList.length >= 50 && (
              <button
                type="button"
                disabled={moreBusy}
                className="btn-secondary"
                onClick={moreAccounts}
              >
                Más cuentas
              </button>
            )}
            <Feedback error={moreError} />
          </>
        )}
        <label className="form-label">
          Nombre en el equipo
          <input
            required
            name="name"
            maxLength={80}
            defaultValue={selected?.name}
            className="form-input"
          />
        </label>
        <RoleFields
          organizations={info.organizations}
          teams={info.teams}
          org={org}
          setOrg={setOrg}
          role={role}
          setRole={setRole}
          selected={teams}
          setSelected={setTeams}
        />
        <p className="text-xs leading-5 text-stone-500">
          El cambio cierra las asignaciones anteriores y conserva su historial.
          Revoca invitaciones pendientes de esta cuenta.
        </p>
        <Reason />
        <Feedback {...mutation} />
        <div className="flex flex-wrap gap-2">
          <button
            disabled={
              mutation.busy || !account || (!["GERENTE", "GERENTE_GENERAL"].includes(role) && !teams.length)
            }
            className="btn-primary"
          >
            Guardar membresía
          </button>
          {selected && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                setSelected(null);
                setAccount(null);
                setTeams([]);
              }}
            >
              Otra cuenta
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
function Invitations({ data, info, updated }) {
  const [selected, setSelected] = useState(null),
    [org, setOrg] = useState(""),
    [role, setRole] = useState("USUARIO"),
    [teams, setTeams] = useState([]),
    [sendBusy, setSendBusy] = useState(null),
    [sendError, setSendError] = useState(""),
    [sendNotice, setSendNotice] = useState("");
  const mutation = useMutation(async () => {
    setSelected(null);
    await updated();
  });
  async function send(id) {
    setSendBusy(id);
    setSendError("");
    setSendNotice("");
    try {
      const result = await platform({
        action: "invitation.send",
        invitation_id: id,
      });
      setSendNotice(
        result.status === "existing_account"
          ? "La cuenta ya existe. Su titular debe ingresar y activar la aprobación."
          : result.status === "sent"
            ? "Supabase Auth aceptó el envío; falta que el destinatario active su cuenta."
            : "El envío requiere revisión antes de reintentar.",
      );
      await updated();
    } catch (error) {
      setSendError(error.message);
    } finally {
      setSendBusy(null);
    }
  }
  return (
    <div className="space-y-6">
      <Feedback error={sendError} notice={sendNotice} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="text-lg font-bold">Solicitudes de ingreso</h2>
          {data.requests.map((r) => (
            <article key={r.id} className="panel">
              <p className="break-all font-semibold">{r.email}</p>
              <p className="mt-1 text-xs text-stone-500">
                {
                  info.organizations.find((o) => o.id === r.organization_id)
                    ?.name
                }{" "}
                ·{" "}
                {
                  {
                    pending: "Pendiente",
                    approved: "Aprobada",
                    rejected: "Rechazada",
                  }[r.status]
                }{" "}
                · {date(r.created_at)}
              </p>
              {r.status === "pending" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="btn-primary"
                    onClick={() => {
                      setSelected(r);
                      setOrg(r.organization_id);
                      setRole("USUARIO");
                      setTeams([]);
                    }}
                  >
                    Revisar aprobación
                  </button>
                  <ReasonAction
                    label="Rechazar"
                    action="invitation.reject"
                    payload={{ request_id: r.id }}
                    after={updated}
                    danger
                  />
                </div>
              )}
            </article>
          ))}
          {!data.requests.length && (
            <p className="panel text-sm text-stone-500">
              No hay solicitudes en esta página.
            </p>
          )}
        </section>
        {selected && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              mutation.run(
                "invitation.approve",
                {
                  request_id: selected.id,
                  organization_id: org,
                  role,
                  team_ids: teams,
                  reason: new FormData(e.currentTarget).get("reason"),
                },
                null,
                true,
              );
            }}
            className="panel space-y-4"
          >
            <h2 className="font-bold">Aprobar: {selected.email}</h2>
            <RoleFields
              organizations={info.organizations}
              teams={info.teams}
              org={org}
              setOrg={setOrg}
              role={role}
              setRole={setRole}
              selected={teams}
              setSelected={setTeams}
            />
            <Reason label="Motivo de la aprobación" />
            <Feedback {...mutation} />
            <button
              disabled={mutation.busy || (!["GERENTE", "GERENTE_GENERAL"].includes(role) && !teams.length)}
              className="btn-primary"
            >
              Aprobar ingreso sin enviar todavía
            </button>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="btn-secondary ml-2"
            >
              Cancelar
            </button>
          </form>
        )}
      </div>
      <section>
        <h2 className="mb-4 text-lg font-bold">Invitaciones aprobadas</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {data.invitations.map((i) => (
            <article key={i.id} className="panel">
              <p className="break-all font-semibold">{i.email}</p>
              <p className="mt-1 text-xs text-stone-500">
                {roleName[i.role]} ·{" "}
                {
                  info.organizations.find((o) => o.id === i.organization_id)
                    ?.name
                }
              </p>
              <p className="mt-3 text-sm">
                {i.consumed_at
                  ? "Activada"
                  : i.revoked_at
                    ? "Revocada"
                    : deliveryNames[i.delivery_status]}
              </p>
              <p className="mt-1 text-xs text-stone-500">
                Vence: {date(i.expires_at)} · {i.delivery_attempts} intentos
              </p>
              {!i.consumed_at && !i.revoked_at && (
                <div className="mt-4 space-y-3">
                  {["pending", "failed"].includes(i.delivery_status) && (
                    <button
                      disabled={Boolean(sendBusy)}
                      onClick={() => send(i.id)}
                      className="btn-primary"
                    >
                      {sendBusy === i.id
                        ? "Procesando envío…"
                        : i.delivery_status === "failed"
                          ? "Reintentar envío"
                          : "Enviar invitación oficial"}
                    </button>
                  )}
                  <ReasonAction
                    label="Revocar invitación"
                    action="invitation.revoke"
                    payload={{ invitation_id: i.id }}
                    after={updated}
                    danger
                  />
                  {["sending", "uncertain"].includes(i.delivery_status) && (
                    <DeliveryReview invitation={i} updated={updated} />
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
function DeliveryReview({ invitation, updated }) {
  const [outcome, setOutcome] = useState("confirmed_not_sent"),
    [recipient, setRecipient] = useState(""),
    [search, setSearch] = useState(invitation.email);
  const accounts = useResource(
    useCallback(() => platform({ action: "admin.accounts", search }), [search]),
  );
  const mutation = useMutation(updated);
  return (
    <details className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-amber-900">
        Revisar envío incierto
      </summary>
      <p className="mt-3 text-xs leading-5 text-amber-900">
        Consultá primero los logs de Auth y correo. Un timeout o la ausencia del
        correo en la bandeja no prueban que no se envió. La reconciliación
        requiere al menos cinco minutos desde el intento y queda auditada.
      </p>
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.run(
            "invitation.resolve",
            {
              invitation_id: invitation.id,
              outcome,
              ...(outcome === "confirmed_sent"
                ? { recipient_id: recipient }
                : {}),
              reason: new FormData(e.currentTarget).get("reason"),
            },
            null,
            true,
          );
        }}
      >
        <label className="form-label">
          Resultado verificado
          <select
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="form-input"
          >
            <option value="confirmed_not_sent">
              Confirmé en logs que no se envió
            </option>
            <option value="confirmed_sent">
              Confirmé en logs que se envió
            </option>
          </select>
        </label>
        {outcome === "confirmed_sent" && (
          <>
            <label className="form-label">
              Correo verificado
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="form-input"
              />
            </label>
            <label className="form-label">
              Destinatario de Auth
              <select
                required
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                className="form-input"
              >
                <option value="">Seleccionar cuenta</option>
                {accounts.data
                  ?.filter((a) => a.email === invitation.email)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email}
                    </option>
                  ))}
              </select>
            </label>
          </>
        )}
        <Reason label="Evidencia y motivo de la revisión" />
        <Feedback {...mutation} />
        <button disabled={mutation.busy} className="btn-primary">
          Registrar resultado verificado
        </button>
      </form>
    </details>
  );
}
function MessagingSettings({ updated }) {
  const resource = useResource(
    useCallback(
      () => rows(supabase.from("platform_settings").select("messaging_scope")),
      [],
    ),
  );
  const mutation = useMutation(async () => {
    await resource.reload();
    await updated();
  });
  return (
    <section className="panel mt-6">
      <h2 className="text-lg font-bold">Alcance de mensajería</h2>
      <p className="mt-2 text-sm text-stone-500">
        Se permiten conversaciones solo dentro de la misma organización. Podés
        deshabilitar el servicio, pero no habilitar mensajes entre
        organizaciones.
      </p>
      <ResourceState resource={resource} />
      {resource.data && (
        <form
          key={resource.data[0]?.messaging_scope}
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            mutation.run(
              "settings.update",
              { messaging_scope: f.get("scope"), reason: f.get("reason") },
              null,
              true,
            );
          }}
        >
          <label className="form-label">
            Servicio
            <select
              name="scope"
              defaultValue={resource.data[0]?.messaging_scope}
              className="form-input"
            >
              <option value="same_organization">
                Dentro de cada organización
              </option>
              <option value="disabled">Deshabilitado</option>
            </select>
          </label>
          <Reason />
          <Feedback {...mutation} />
          <button disabled={mutation.busy} className="btn-primary">
            Guardar configuración
          </button>
        </form>
      )}
    </section>
  );
}
function Audit({ info }) {
  const [cursor, setCursor] = useState(null),
    [selected, setSelected] = useState(null),
    [messages, setMessages] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState("");
  const directory = useResource(
    useCallback(
      () =>
        platform({
          action: "audit.conversations",
          ...(cursor
            ? { before: cursor.created_at, before_id: cursor.id }
            : {}),
        }),
      [cursor],
    ),
  );
  const name = (id) =>
    info.people.find((p) => p.user_id === id)?.name ||
    "Cuenta de la plataforma";
  async function inspect(older = false) {
    if (!selected) return;
    setBusy(true);
    setError("");
    const last = messages.at(-1);
    try {
      const result = await platform({
        action: "audit.messages",
        conversation_id: selected.id,
        reason,
        ...(older && last
          ? { before: last.created_at, before_id: last.id }
          : {}),
      });
      setMessages(result);
    } catch (failure) {
      setMessages([]);
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function download(file) {
    setBusy(true);
    setError("");
    try {
      const { data, error } = await supabase.functions.invoke(
        "campo-audit-attachment",
        { body: { attachment_id: file.id, reason } },
      );
      if (error || !(data instanceof Blob))
        throw new Error("No se pudo consultar el adjunto.");
      const url = URL.createObjectURL(data);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        file.mime_type === "application/pdf"
          ? "adjunto-auditado.pdf"
          : "adjunto-auditado.jpg";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <section className="panel">
        <h2 className="font-bold">Directorio de conversaciones</h2>
        <p className="mt-2 text-sm leading-6 text-stone-500">
          Este listado no incluye contenido ni vistas previas. Cada consulta de
          mensajes exige motivo y registra el acceso.
        </p>
        <ResourceState resource={directory} />
        <div className="mt-4 space-y-2">
          {directory.data?.map((c) => (
            <button
              key={c.id}
              disabled={busy}
              className={`block w-full rounded-xl border p-3 text-left text-sm ${selected?.id === c.id ? "bg-green-50" : "bg-white"}`}
              onClick={() => {
                setSelected(c);
                setMessages([]);
                setReason("");
                setError("");
              }}
            >
              <span className="font-semibold">
                {name(c.user_a)} ↔ {name(c.user_b)}
              </span>
              <span className="mt-1 block text-xs text-stone-500">
                {
                  info.organizations.find((o) => o.id === c.organization_id)
                    ?.name
                }{" "}
                · {date(c.created_at)}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="btn-secondary"
            disabled={!cursor}
            onClick={() => setCursor(null)}
          >
            Volver al inicio
          </button>
          <button
            className="btn-secondary"
            disabled={directory.data?.length !== 50}
            onClick={() => setCursor(directory.data.at(-1))}
          >
            Más conversaciones
          </button>
        </div>
      </section>
      <section className="panel">
        <h2 className="font-bold">Consulta supervisada</h2>
        {selected ? (
          <>
            <p className="mt-2 text-sm text-stone-500">
              {name(selected.user_a)} ↔ {name(selected.user_b)}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                inspect();
              }}
              className="mt-4 space-y-3"
            >
              <label className="form-label">
                Motivo de la consulta
                <textarea
                  disabled={busy}
                  required
                  minLength={10}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                    setMessages([]);
                  }}
                  rows={3}
                  className="form-input"
                />
              </label>
              <button disabled={busy} className="btn-primary">
                Consultar y registrar acceso
              </button>
            </form>
            <Feedback busy={busy} error={error} />
            <ol className="mt-4 space-y-3">
              {messages.map((m) => (
                <li key={m.id} className="rounded-xl bg-stone-50 p-3">
                  <p className="text-xs font-semibold text-green-800">
                    {name(m.sender_id)} · {date(m.created_at)}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                    {m.body || "Mensaje con adjunto"}
                  </p>
                  {m.attachments?.map((file) => (
                    <button
                      key={file.id}
                      disabled={busy}
                      onClick={() => download(file)}
                      className="btn-secondary mt-2"
                    >
                      Descargar adjunto y registrar acceso
                    </button>
                  ))}
                </li>
              ))}
            </ol>
            {messages.length === 100 && (
              <button
                disabled={busy}
                onClick={() => inspect(true)}
                className="btn-secondary mt-4"
              >
                Consultar página anterior y registrar
              </button>
            )}
          </>
        ) : (
          <p className="mt-4 text-sm text-stone-500">
            Elegí una conversación para registrar una consulta.
          </p>
        )}
      </section>
    </div>
  );
}
function activityName(action) {
  return (
    {
      "organization.create": "Organización creada",
      "organization.update": "Organización actualizada",
      "team.create": "Equipo creado",
      "work_team.create": "Equipo creado en el catálogo",
      "work_team.update": "Nombre del equipo actualizado",
      "team.link": "Equipo vinculado a una organización",
      "team.update": "Equipo actualizado",
      "membership.set": "Membresía asignada",
      "membership.suspend": "Acceso suspendido",
      "invitation.approve": "Ingreso aprobado",
      "invitation.reject": "Solicitud rechazada",
      "invitation.revoke": "Invitación revocada",
      "invitation.resolve": "Envío reconciliado",
      "invitation.request": "Invitación solicitada",
      "invitation.activate": "Cuenta activada",
      "messages.read": "Consulta administrativa de mensajes",
      "messages.attachment_read": "Consulta administrativa de adjunto",
      "settings.update": "Configuración actualizada",
      "invitation.delivery_claim": "Intento de envío iniciado",
      "invitation.delivery_result": "Resultado de envío registrado",
      "invitation.existing_account": "Aprobación vinculada a cuenta existente",
      "owner.bootstrap": "Propietario inicializado",
      "invitation.revoked_by_membership":
        "Invitación revocada por cambio de membresía",
    }[action] || "Actividad administrativa"
  );
}
