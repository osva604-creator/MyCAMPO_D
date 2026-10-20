import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Bell,
  ClipboardList,
  House,
  LogOut,
  MessageCircle,
  Plus,
  MapPinned,
  RefreshCw,
  ShieldCheck,
  Sprout,
  UserRound,
} from "lucide-react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useAccess } from "../../context/AccessContext";
import {
  TeamContext,
  useTeam as useContextTeam,
} from "../../context/TeamContext";
import { directory, platform, watchTeam } from "../../lib/teamApi";
import { useResource } from "../../lib/useResource";
import {
  drafts,
  draftPreviews,
  downloadJson,
  saveDraft,
  syncDrafts,
  exportLegacy,
} from "../../lib/teamDrafts";
import CreatePost from "../CreatePost";
import { LocalLink, PageHeading, ResourceState, roleName } from "./Common";
import TeamFeed from "./TeamFeed";
import Tasks from "./Tasks";
import TeamMessages from "./TeamMessages";
import TeamAccount from "./TeamAccount";
import AdminPanel from "./AdminPanel";
import PullToRefresh from '../PullToRefresh';
import { offlineResource, accessSignature, protectStorage } from '../../lib/offlineStore';
import { useSyncLifecycle } from '../../lib/useSyncLifecycle';
import { syncUserMaps } from '../../lib/mapApi';
const TeamMap = lazy(() => import('../map/MapPage').then(module => ({default:module.TeamMap})));

function ExitButton() {
  const { signOut } = useAuth();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function exit() {
    setBusy(true);
    setError("");
    try {
      await signOut();
    } catch {
      setError("No se pudo cerrar la sesión. Reintentá.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button disabled={busy} onClick={exit} className="btn-secondary">
        <LogOut size={16} />
        Salir
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
export default function TeamGate() {
  const access = useAccess();
  const { user } = useAuth();
  const [exportError, setExportError] = useState("");
  if (access.status === "loading")
    return (
      <p role="status" className="p-8">
        Verificando acceso al equipo…
      </p>
    );
  if (
    access.data?.status === "active" &&
    ["active", "offline"].includes(access.status)
  )
    return (
      <TeamShell
        key={`${user.id}:${access.data.member_id || access.data.role}`}
      />
    );
  return (
    <main className="mx-auto my-10 max-w-xl px-4">
      <section className="panel space-y-5">
        <PageHeading
          title={
            access.status === "awaiting_approval"
              ? "Tu acceso está pendiente"
              : access.status === "offline"
                ? "Estás sin conexión"
                : "No pudimos verificar tu acceso"
          }
          description={
            access.status === "awaiting_approval"
              ? "Tu cuenta está autenticada. El propietario debe aprobar tu ingreso y habilitar una membresía."
              : "Podés continuar trabajando en el modo local y volver a intentar cuando el equipo esté disponible."
          }
        />
        <p className="text-sm text-stone-500">{user?.email}</p>
        {access.error && (
          <p
            role="alert"
            className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
          >
            {access.error}
          </p>
        )}
        {access.data?.invitations?.map((invite) => (
          <Link
            key={invite.id}
            to={`/activar-cuenta?invitacion=${invite.id}`}
            className="btn-primary"
          >
            Activar invitación aprobada · {roleName[invite.role]}
          </Link>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-secondary" onClick={access.reload}>
            Verificar nuevamente
          </button>
          <LocalLink />
          <ExitButton />
        </div>
        <details className="border-t pt-4 text-sm">
          <summary className="cursor-pointer font-semibold text-stone-600">
            Respaldos de este dispositivo
          </summary>
          <p className="my-3 text-stone-500">
            Los pendientes anteriores siguen guardados. Estos respaldos no se
            suben automáticamente al equipo.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="btn-secondary"
              onClick={async () => {
                try {
                  await exportLegacy(user.id);
                } catch {
                  setExportError(
                    "No se pudo abrir el almacenamiento anterior.",
                  );
                }
              }}
            >
              Exportar registros anteriores
            </button>
            <button
              className="btn-secondary"
              onClick={async () => {
                try {
                  downloadJson(
                    "mycampo-d-borradores-equipo.json",
                    await drafts(user.id, null),
                  );
                } catch {
                  setExportError("No se pudieron exportar los borradores.");
                }
              }}
            >
              Exportar borradores
            </button>
          </div>
          {exportError && <p role="alert">{exportError}</p>}
        </details>
      </section>
    </main>
  );
}
function TeamShell() {
  const auth = useAuth(),
    authorization = useAccess(),
    rawAccess = authorization.data;
  const multiOrg = rawAccess.role === "GERENTE_GENERAL";
  const [selectedOrg, setSelectedOrg] = useState("");
  const membership = rawAccess.memberships?.find(m => m.organization_id === selectedOrg) || rawAccess.memberships?.[0];
  const access = multiOrg && membership ? { ...rawAccess, ...membership } : rawAccess;
  const owner = access.role === "SUPER_ADMIN";
  const online = authorization.status !== 'offline' && !auth.offlineSession && navigator.onLine;
  const connected = useRef(online);
  connected.current = online;
  const activeIdentity = useRef(auth.user.id), session = useRef(auth.session);
  session.current = auth.session;
  useEffect(() => {
    activeIdentity.current = auth.user.id;
    return () => { activeIdentity.current = null; };
  }, [auth.user.id]);
  const [org, setOrg] = useState(access.organization_id || "");
  const orgId = owner ? org : access.organization_id;
  const directoryOrg = owner || multiOrg ? null : orgId;
  const infoResource = useResource(
    useCallback(() => offlineResource(auth.user.id, `directory:${accessSignature(rawAccess)}:${directoryOrg || 'all'}`,
      () => directory(directoryOrg), { offline: !connected.current }), [directoryOrg, auth.user.id, accessSignature(rawAccess)]),
    { poll: 30000 },
  );
  const info = infoResource.data;
  const inbox = useResource(
    useCallback(() => online ? platform({ action: "messages.inbox" }) : Promise.resolve({ conversations: [], unread_total: 0 }), [auth.user.id, online]),
    { poll: 15000, events: ["messages", "message_reads"] },
  );
  const [creating, setCreating] = useState(false),
    [draftError, setDraftError] = useState(""),
    [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState(null);
  const syncLock = useRef(null);
  const pending = useResource(
    useCallback(
      () => draftPreviews(auth.user.id, orgId || null),
      [auth.user.id, orgId],
    ),
  );
  const canCreate = Boolean(
    orgId &&
    info?.organizations.find((o) => o.id === orgId)?.active &&
    info?.teams.some(
      (t) =>
        t.organization_id === orgId &&
        t.active &&
        (owner || access.teams.some((a) => a.id === t.id)),
    ),
  );
  useEffect(() => {
    const changed = () => pending.reload();
    window.addEventListener("mycampo-d:drafts", changed);
    return () => window.removeEventListener("mycampo-d:drafts", changed);
  }, [pending.reload]);
  useEffect(
    () =>
      watchTeam(auth.user.id, (table) =>
        window.dispatchEvent(
          new CustomEvent("mycampo-d:team-change", { detail: { table } }),
        ),
      ),
    [auth.user.id],
  );
  function synchronize() {
    if (syncLock.current) return syncLock.current;
    if (!navigator.onLine) return Promise.resolve(false);
    const run = async () => {
    setSyncing(true);
    setDraftError("");
    try {
      const fresh = await authorization.reload();
      if (activeIdentity.current !== auth.user.id) return false;
      if (fresh?.status !== "active")
        throw new Error(
          "No se pudo verificar la membresía. Los borradores siguen guardados.",
        );
      const ownDrafts = await drafts(auth.user.id, null);
      const errors = [];
      try { await syncUserMaps(fresh, () => activeIdentity.current === auth.user.id); }
      catch (error) { errors.push(error.message); }
      for (const organization of new Set(
        ownDrafts.map((d) => d.organization_id),
      )) {
        if (
          fresh.role === "SUPER_ADMIN" ||
          fresh.organization_id === organization ||
          fresh.memberships?.some(m => m.organization_id === organization)
        ) {
          try {
            const assigned = fresh.memberships?.find(m => m.organization_id === organization);
            await syncDrafts(assigned ? { ...fresh, ...assigned } : fresh, organization, {
              token: session.current?.access_token,
              isCurrent: () => activeIdentity.current === auth.user.id,
            });
          } catch (error) {
            errors.push(error.message);
          }
        }
      }
      window.dispatchEvent(
        new CustomEvent("mycampo-d:team-change", { detail: {} }),
      );
      await pending.reload();
      await Promise.all([infoResource.reload(), inbox.reload()]);
      if (errors.length) { setDraftError(errors.join(" ")); return false; }
      setLastSync(new Date());
      return true;
    } catch (error) {
      setDraftError(error.message);
      return false;
    } finally {
      syncLock.current = null;
      setSyncing(false);
    }
    };
    syncLock.current = run();
    return syncLock.current;
  }
  useSyncLifecycle(synchronize);
  async function publish(post) {
    await saveDraft(access, post, orgId, post.teamId);
    await pending.reload();
    protectStorage();
    if (navigator.onLine) void synchronize();
  }
  const unread = Number(inbox.data?.unread_total || 0);
  const links = [
    { to: "/dashboard", end: true, label: "Inicio", Icon: House },
    { to: "/dashboard/tareas", label: "Tareas", Icon: ClipboardList },
    { to: "/dashboard/mensajes", label: "Mensajes", Icon: MessageCircle },
    { to: "/dashboard/cuenta", label: "Mi cuenta", Icon: UserRound },
  ];
  const scope = {
    access,
    user: auth.user,
    orgId,
    info: multiOrg && info ? { ...info, organization: info.organizations.find(o => o.id === orgId) } : info,
    online,
    inbox,
    pending,
    synchronize,
    syncing,
    lastSync,
    canCreate,
    openCreate: () => {
      if (canCreate) setCreating(true);
    },
    refreshInfo: infoResource.reload,
  };
  return (
    <TeamContext.Provider value={scope}>
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/dashboard" className="flex items-center gap-2">
            <span className="grid size-10 place-items-center rounded-2xl bg-green-800 text-white">
              <Sprout size={24} />
            </span>
            <span className="text-xl font-extrabold">
              My<span className="text-green-700">CAMPO_D</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-48 truncate text-xs text-stone-500 lg:block" title={auth.user.email}>{auth.user.email}</span>
            <button aria-label="Sincronizar ahora" title={lastSync ? `Última sincronización: ${lastSync.toLocaleTimeString('es-AR')}` : 'Sincronizar publicaciones'}
              disabled={!online || syncing} onClick={synchronize} className="btn-secondary hidden sm:inline-flex">
              <RefreshCw size={17} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Sincronizando…' : 'Sincronizar'}
            </button>
            <Link
              to="/dashboard/notificaciones"
              aria-label={`Notificaciones${unread ? `, ${unread} mensajes sin leer` : ""}`}
              className="relative grid size-11 place-items-center rounded-full bg-stone-50"
            >
              <Bell size={21} />
              {unread > 0 && (
                <span className="absolute right-0 top-0 rounded-full bg-green-800 px-1.5 text-[10px] text-white">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <button
              disabled={!canCreate}
              onClick={() => setCreating(true)}
              className="btn-primary hidden sm:inline-flex"
            >
              <Plus size={18} />
              Publicar
            </button>
            <Link to="/dashboard/mapa" className="btn-secondary hidden sm:inline-flex"><MapPinned size={18}/>Mapa</Link>
          </div>
        </div>
        <nav
          aria-label="Navegación del equipo"
          className="mx-auto hidden max-w-6xl gap-2 px-4 pb-3 sm:flex"
        >
          {links.map(({ to, end, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-2 rounded-full px-4 text-sm ${isActive ? "bg-green-50 font-semibold text-green-800" : "text-stone-500"}`
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
          {owner && (
            <NavLink
              to="/dashboard/admin"
              className="ml-auto flex items-center gap-2 text-sm font-semibold text-green-800"
            >
              <ShieldCheck size={17} />
              Administración
            </NavLink>
          )}
        </nav>
      </header>
      <main className="mobile-content mx-auto max-w-6xl px-4 pt-6">
        <PullToRefresh onRefresh={synchronize} refreshing={syncing} disabled={!online || creating}>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-green-700">
              {roleName[access.role]}
            </p>
            {owner || multiOrg ? (
              <label className="sr-only" htmlFor="organization-scope">
                Organización del panel
              </label>
            ) : (
              <p className="mt-1 text-sm font-semibold">
                {info?.organization?.name || "Tu organización"}
              </p>
            )}
          </div>
          {(owner || multiOrg) && (
            <select
              id="organization-scope"
              aria-label="Organización del panel"
              className="max-w-full rounded-xl border border-stone-200 bg-white p-3 text-sm"
              value={orgId}
              onChange={(e) => {
                if (multiOrg) setSelectedOrg(e.target.value);
                else setOrg(e.target.value);
                setCreating(false);
              }}
            >
              {owner && <option value="">Todas las organizaciones</option>}
              {info?.organizations.filter(o => owner || rawAccess.memberships?.some(m => m.organization_id === o.id)).map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.active ? "" : " · deshabilitada"}
                </option>
              ))}
            </select>
          )}
          <div className="flex items-center gap-3 text-xs text-stone-500">
            <span>
              {online
                ? "Con conexión"
                : "Sin conexión · cambios locales pendientes"}
            </span>
            <button
              onClick={synchronize}
              disabled={!online || syncing}
              className="min-h-11 font-semibold text-green-800"
            >
              {syncing
                ? "Sincronizando…"
                : `${pending.data?.length || 0} pendientes · Sincronizar`}
            </button>
          </div>
        </div>
        {!online && (
          <p
            role="status"
            className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
          >
            Sin conexión: podés capturar y guardar publicaciones en este dispositivo.
            Los pendientes se enviarán al volver a conectarte. Se muestran las publicaciones descargadas.
          </p>
        )}
        {draftError && (
          <p
            role="alert"
            className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
          >
            {draftError}
          </p>
        )}
        <ResourceState resource={infoResource} />
        {info && (
          <div key={orgId || "global"}>
            <Routes>
              <Route index element={<TeamFeed />} />
              <Route path="mapa" element={<Suspense fallback={<p role="status">Abriendo mapa…</p>}><TeamMap/></Suspense>} />
              <Route path="tareas" element={<Tasks />} />
              <Route path="mensajes" element={<TeamMessages />} />
              <Route path="cuenta" element={<TeamAccount />} />
              <Route path="notificaciones" element={<Notifications />} />
              <Route
                path="admin/*"
                element={
                  owner ? (
                    <AdminPanel />
                  ) : (
                    <section className="panel">
                      <h1 className="text-xl font-bold">Acceso restringido</h1>
                      <p className="mt-3 text-sm">
                        Solo el propietario puede administrar la plataforma.
                      </p>
                    </section>
                  )
                }
              />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </div>
        )}
        </PullToRefresh>
      </main>
      <nav
        aria-label="Navegación móvil del equipo"
        className="mobile-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t bg-white px-2 pt-2 sm:hidden"
      >
        {links.slice(0, 2).map(({ to, end, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] ${isActive ? "font-semibold text-green-800" : "text-stone-500"}`
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
        <button
          disabled={!canCreate}
          aria-label="Nueva publicación"
          className="flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] text-green-800 disabled:opacity-40"
          onClick={() => setCreating(true)}
        >
          <span className="-mt-5 grid size-12 place-items-center rounded-2xl border-4 border-white bg-green-800 text-white shadow">
            <Plus size={26} />
          </span>
          Publicar
        </button>
        <NavLink to="/dashboard/mapa" className={({isActive})=>`flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] ${isActive?'font-semibold text-green-800':'text-stone-500'}`}><MapPinned size={22}/>Mapa</NavLink>
        {links.slice(2).map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] ${isActive ? "font-semibold text-green-800" : "text-stone-500"}`
            }
          >
            <Icon size={22} />
            {label}
          </NavLink>
        ))}
      </nav>
      {creating && info && (
        <CreatePost
          key={orgId}
          actor={{ id: auth.user.id, name: access.name || "Propietario" }}
          members={info.members.filter((m) => m.organization_id === orgId)}
          teams={info.teams.filter(
            (t) =>
              t.organization_id === orgId &&
              t.active &&
              (owner || access.teams.some((a) => a.id === t.id)),
          )}
          requirePhoto={false}
          allowAttachments
          draftKey={`team:${auth.user.id}:${orgId}:${access.member_id || access.role}`}
          onPublish={publish}
          onClose={() => setCreating(false)}
        />
      )}
    </TeamContext.Provider>
  );
}
function Notifications() {
  const { inbox, info, user } = useContextTeam();
  return (
    <section className="mx-auto max-w-2xl">
      <PageHeading
        title="Notificaciones"
        description="Actividad de tus conversaciones dentro de MyCAMPO_D."
      />
      <ResourceState resource={inbox} />
      <div className="space-y-3">
        {inbox.data?.conversations
          .filter((c) => Number(c.unread) > 0)
          .map((c) => {
            const other = c.user_a === user.id ? c.user_b : c.user_a;
            return (
              <Link
                key={c.id}
                to={`/dashboard/mensajes?conversacion=${c.id}`}
                className="panel block"
              >
                <p className="font-semibold">
                  {info.people.find((p) => p.user_id === other)?.name ||
                    "Integrante del equipo"}
                </p>
                <p className="mt-1 text-sm text-stone-500">
                  {c.unread} mensajes sin leer
                </p>
              </Link>
            );
          })}
        {inbox.data && Number(inbox.data.unread_total) === 0 && (
          <p className="panel text-sm text-stone-500">
            Estás al día con tus mensajes.
          </p>
        )}
      </div>
      <Link to="/dashboard/tareas" className="btn-secondary mt-5">
        Ver tareas asignadas
      </Link>
      <Link to="/dashboard/mensajes" className="btn-secondary ml-3 mt-5">
        Abrir bandeja de mensajes
      </Link>
    </section>
  );
}
// Kept outside the shell so notification navigation uses the same live inbox.
