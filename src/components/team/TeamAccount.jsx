import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useTeam } from "../../context/TeamContext";
import { supabase } from "../../lib/supabase";
import { platform, rows } from "../../lib/teamApi";
import { useResource } from "../../lib/useResource";
import { downloadJson, removeDraft, revision } from "../../lib/teamDrafts";
import { exportLegacy } from "../../lib/teamDrafts";
import TeamFeed from "./TeamFeed";
import { Feedback, PageHeading, ResourceState, date, roleName } from "./Common";

export default function TeamAccount() {
  const { access, user, info, orgId, pending, synchronize, online } = useTeam(),
    auth = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [deleting, setDeleting] = useState(null),
    [install, setInstall] = useState(null);
  const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture;
  const requests = useResource(
    useCallback(
      () =>
        rows(
          supabase
            .from("invitation_requests")
            .select("id,email,status,created_at")
            .eq("requested_by", user.id)
            .order("created_at", { ascending: false })
            .limit(30),
        ),
      [user.id],
    ),
    { poll: 30000 },
  );
  useEffect(() => {
    const show = (e) => {
      e.preventDefault();
      setInstall(e);
    };
    window.addEventListener("beforeinstallprompt", show);
    return () => window.removeEventListener("beforeinstallprompt", show);
  }, []);
  async function invite(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = new FormData(form).get("email");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await platform({
        action: "invitation.request",
        organization_id: orgId,
        email,
      });
      form.reset();
      setNotice(
        "Solicitud enviada. El propietario debe aprobarla antes de enviar la invitación oficial.",
      );
      await requests.reload();
    } catch (failure) {
      setError(failure.message);
      await requests.reload();
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await auth.signOut();
    } catch {
      setError("No se pudo cerrar la sesión. Reintentá.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-6">
      <div className="mx-auto max-w-2xl">
        <PageHeading
          title="Tu cuenta"
          description="Tus permisos se verifican en el equipo; el modo local conserva sus registros por separado."
        />
        <div className="panel">
          <div className="flex items-center gap-4">
            <span className="grid size-14 place-items-center rounded-full bg-green-100 text-xl font-bold text-green-800">
              {typeof avatar === "string" && /^https?:\/\//i.test(avatar) ? (
                <img
                  src={avatar}
                  referrerPolicy="no-referrer"
                  alt="Tu foto de perfil"
                  className="size-full rounded-full object-cover"
                />
              ) : (
                (access.name || user.email || "M").slice(0, 1).toUpperCase()
              )}
            </span>
            <div>
              <h2 className="font-bold">
                {access.name || "Propietario de MyCAMPO_D"}
              </h2>
              <p className="mt-1 break-all text-sm text-stone-500">
                {user.email}
              </p>
              <p className="mt-1 text-xs font-semibold text-green-800">
                {roleName[access.role]}
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm text-stone-500">
            {access.role === "SUPER_ADMIN"
              ? "Supervisión global de la plataforma"
              : `${info.organization?.name} · ${access.teams.map((t) => t.name).join(", ")}`}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button disabled={busy} onClick={logout} className="btn-secondary">
              Cerrar sesión
            </button>
            <Link to="/recuperar-password" className="btn-secondary">
              Cambiar contraseña
            </Link>
            <Link to="/local" className="btn-secondary">
              Modo local
            </Link>
            {access.role === "SUPER_ADMIN" && (
              <Link to="/dashboard/admin" className="btn-primary">
                Administración
              </Link>
            )}
            {install && (
              <button
                className="btn-secondary"
                onClick={async () => {
                  await install.prompt();
                  setInstall(null);
                }}
              >
                Instalar aplicación
              </button>
            )}
          </div>
        </div>
        <section className="panel mt-5">
          <h2 className="text-lg font-bold">Solicitar una invitación</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">
            Proponé un correo. El propietario decidirá el ingreso, el rol y los
            equipos. No se envía una invitación hasta su aprobación.
          </p>
          {orgId ? (
            <form
              onSubmit={invite}
              className="mt-4 flex flex-wrap items-end gap-3"
            >
              <label className="form-label min-w-0 flex-1">
                Correo de la persona
                <input
                  name="email"
                  type="email"
                  required
                  maxLength={254}
                  className="form-input"
                />
              </label>
              <button disabled={busy || !online} className="btn-primary">
                Solicitar ingreso
              </button>
            </form>
          ) : (
            <p className="mt-3 text-sm text-green-800">
              Seleccioná una organización arriba para proponer un ingreso.
            </p>
          )}
          <Feedback busy={busy} error={error} notice={notice} />
          <ResourceState resource={requests} />
          <ul className="mt-4 space-y-2">
            {requests.data?.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap justify-between gap-2 rounded-xl bg-stone-50 p-3 text-sm"
              >
                <span className="break-all">{r.email}</span>
                <span className="text-xs text-stone-500">
                  {
                    {
                      pending: "Pendiente",
                      approved: "Aprobada",
                      rejected: "Rechazada",
                    }[r.status]
                  }{" "}
                  · {date(r.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="panel mt-5">
          <h2 className="text-lg font-bold">Borradores de este dispositivo</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">
            Conservá un respaldo mientras haya cambios pendientes. Si cambió tu
            membresía, el borrador se retiene para revisión y no se reenvía con
            permisos nuevos.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              className="btn-secondary"
              disabled={!online}
              onClick={synchronize}
            >
              Sincronizar ahora
            </button>
            <button
              className="btn-secondary"
              onClick={() =>
                downloadJson("mycampo-d-borradores.json", pending.data || [])
              }
            >
              Exportar borradores
            </button>
            <button
              className="btn-secondary"
              onClick={async () => {
                try {
                  await exportLegacy(user.id);
                } catch {
                  setError("No se pudo abrir el respaldo anterior.");
                }
              }}
            >
              Exportar registros anteriores
            </button>
          </div>
          <ResourceState resource={pending} />
          <ul className="mt-4 space-y-3">
            {pending.data?.map((d) => (
              <li key={d.id} className="rounded-xl border p-3 text-sm">
                <p className="whitespace-pre-wrap">{d.title}</p>
                <p className="mt-2 text-xs text-stone-500">
                  {date(d.created_at)} ·{" "}
                  {d.revision ===
                  revision({ ...access, organization_id: d.organization_id })
                    ? "Pendiente de sincronización"
                    : "Retenido: cambió la membresía"}
                </p>
                {deleting === d.id ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <p className="text-xs text-red-700">
                      Se eliminará el borrador local. Exportalo primero si
                      necesitás conservarlo. Si el registro ya se creó online,
                      esta acción no lo elimina y puede dejar su adjunto
                      pendiente.
                    </p>
                    <button
                      className="btn-secondary"
                      onClick={async () => {
                        await removeDraft(d.id);
                        setDeleting(null);
                        pending.reload();
                      }}
                    >
                      Confirmar eliminación
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => setDeleting(null)}
                    >
                      Conservar
                    </button>
                  </div>
                ) : (
                  <button
                    className="mt-2 min-h-11 text-xs text-red-700"
                    onClick={() => setDeleting(d.id)}
                  >
                    Eliminar borrador local
                  </button>
                )}
              </li>
            ))}
          </ul>
          {pending.data && !pending.data.length && (
            <p className="mt-4 text-sm text-stone-500">
              No hay borradores pendientes en este alcance.
            </p>
          )}
        </section>
      </div>
      <TeamFeed own />
    </section>
  );
}
