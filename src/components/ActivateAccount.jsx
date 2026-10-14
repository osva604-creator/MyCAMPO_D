import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useAccess } from "../context/AccessContext";
import { platform } from "../lib/teamApi";

export default function ActivateAccount() {
  const auth = useAuth(),
    access = useAccess(),
    location = useLocation(),
    navigate = useNavigate();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [passwordSaved, setPasswordSaved] = useState(false);
  const invitation = new URLSearchParams(location.search).get("invitacion");
  const valid =
    typeof invitation === "string" &&
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(invitation);
  const approved = access.data?.invitations?.find(
    (i) =>
      i.id === invitation &&
      ["sent", "existing_account"].includes(i.delivery_status),
  );
  async function activate(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    if (data.get("password") !== data.get("confirm")) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      if (!approved)
        throw new Error(
          "No se pudo verificar una aprobación vigente para esta cuenta.",
        );
      if (!passwordSaved) {
        await auth.resetPassword(data.get("password"));
        setPasswordSaved(true);
      }
      await platform({
        action: "invitation.activate",
        invitation_id: invitation,
        name: String(data.get("name")).trim(),
      });
      await access.reload();
      navigate("/dashboard", { replace: true });
    } catch (failure) {
      setError(failure.message || "No se pudo completar la activación.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto my-12 w-[calc(100%-2rem)] max-w-md rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
      <p className="text-sm font-semibold text-green-800">MyCAMPO_D</p>
      <h1 className="mt-3 text-2xl font-bold">Activá tu cuenta</h1>
      {auth.loading ? (
        <p role="status" className="mt-5">
          Verificando el enlace…
        </p>
      ) : !valid ? (
        <p role="alert" className="mt-5">
          El enlace no tiene una invitación válida. Abrí el correo original o
          contactá al administrador.
        </p>
      ) : !auth.user ? (
        <div className="mt-5 space-y-4 text-sm">
          <p>
            El enlace no inició una sesión o venció. Si ya tenés cuenta, ingresá
            para activar la invitación; si no, pedí al propietario que revise el
            envío.
          </p>
          <Link
            to="/login"
            state={{ from: location.pathname + location.search }}
            className="btn-primary inline-flex"
          >
            Ingresar con mi cuenta
          </Link>
        </div>
      ) : access.status === "loading" ? (
        <p role="status" className="mt-5">
          Verificando la aprobación…
        </p>
      ) : access.data?.status === "active" ? (
        <div className="mt-5 space-y-4">
          <p className="text-sm text-green-800">
            Tu cuenta ya tiene acceso al equipo.
          </p>
          <Link to="/dashboard" className="btn-primary">
            Abrir mi panel
          </Link>
        </div>
      ) : !approved ? (
        <div className="mt-5 space-y-4">
          <p role="alert" className="text-sm text-amber-900">
            No pudimos verificar una invitación vigente para esta cuenta. Puede
            haber vencido, estar pendiente de envío o corresponder a otra
            persona.
          </p>
          {access.error && (
            <p className="text-sm text-stone-500">{access.error}</p>
          )}
          <button className="btn-secondary" onClick={access.reload}>
            Verificar invitación nuevamente
          </button>
        </div>
      ) : (
        <>
          <p className="mt-4 text-sm text-stone-600">
            Estás activando la invitación para{" "}
            <strong>{auth.user.email}</strong>. Elegí tu nombre y la contraseña
            que usarás para ingresar. Si ya tenías cuenta, esta contraseña
            reemplazará la anterior.
          </p>
          <form onSubmit={activate} className="mt-5 space-y-4">
            <label className="form-label">
              Tu nombre
              <input
                name="name"
                required
                maxLength={80}
                className="form-input"
                autoComplete="name"
              />
            </label>
            <label className="form-label">
              Contraseña
              <input
                name="password"
                type="password"
                required
                minLength={8}
                className="form-input"
                autoComplete="new-password"
                disabled={passwordSaved}
                defaultValue={passwordSaved ? "********" : undefined}
              />
            </label>
            <label className="form-label">
              Confirmar contraseña
              <input
                name="confirm"
                type="password"
                required
                minLength={8}
                className="form-input"
                autoComplete="new-password"
                disabled={passwordSaved}
                defaultValue={passwordSaved ? "********" : undefined}
              />
            </label>
            {passwordSaved && (
              <p role="status" className="text-sm text-green-800">
                Contraseña guardada. Falta completar la activación del equipo.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <button disabled={busy} className="btn-primary w-full">
              {busy ? "Activando…" : "Activar acceso al equipo"}
            </button>
          </form>
        </>
      )}
      <Link to="/local" className="mt-5 inline-block text-sm text-green-800">
        Continuar en modo local
      </Link>
    </main>
  );
}
