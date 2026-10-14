import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const titles = {
  login: "Ingresá a MyCAMPO_D",
  register: "Creá tu cuenta",
  forgot: "Recuperá tu contraseña",
  reset: "Elegí una nueva contraseña",
};
function friendly(error) {
  const messages = {
    invalid_credentials: "Correo o contraseña incorrectos.",
    email_not_confirmed: "Confirmá tu correo antes de ingresar.",
    signup_disabled:
      "El registro está deshabilitado. Contactá al administrador.",
    weak_password: "La contraseña no cumple los requisitos de seguridad.",
    over_email_send_rate_limit:
      "Se alcanzó el límite de correos. Intentá más tarde.",
    user_already_exists:
      "No se pudo registrar la cuenta. Probá ingresar o recuperar tu contraseña.",
  };
  return (
    messages[error.code] ||
    "No se pudo completar la operación. Revisá los datos y la conexión e intentá nuevamente."
  );
}
export default function Auth({ mode = "login" }) {
  const auth = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const from = location.state?.from;
  const destination =
    typeof from === "string" &&
    from.startsWith("/") &&
    !from.startsWith("//") &&
    !/^\/(login|registro|recuperar-password|reset-password)([/?#]|$)/.test(from)
      ? from
      : "/dashboard";
  if (auth.loading)
    return (
      <p role="status" className="p-8">
        Cargando sesión…
      </p>
    );
  if (auth.recovery && mode !== "reset")
    return <Navigate to="/reset-password" replace />;
  if (auth.user && (mode === "login" || mode === "register"))
    return <Navigate to={destination} replace />;
  if (mode === "register")
    return (
      <main className="mx-auto my-12 max-w-sm rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-semibold text-green-800">MyCAMPO_D</p>
        <h1 className="mt-3 text-2xl font-bold">Ingreso por invitación</h1>
        <p className="mt-4 text-sm leading-6 text-stone-600">
          Solicitá a un integrante del equipo que proponga tu ingreso. El
          propietario debe aprobarlo y asignar tu organización y equipo antes de
          habilitar el acceso.
        </p>
        <p className="mt-3 text-sm text-stone-600">
          Si recibiste una invitación, abrí el enlace de ese correo para activar
          tu cuenta.
        </p>
        <div className="mt-5 flex flex-wrap gap-4 text-sm text-green-800">
          <Link to="/login">Ingresar</Link>
          <Link to="/local">Usar modo local</Link>
        </div>
      </main>
    );
  async function submit(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email") || "").trim();
    const password = String(fields.get("password") || "");
    if (
      (mode === "register" || mode === "reset") &&
      password !== fields.get("confirm")
    ) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      if (mode === "login") {
        await auth.signIn(email, password);
        navigate(destination, { replace: true });
      }
      if (mode === "forgot") {
        await auth.forgotPassword(email);
        setMessage(
          "Si existe una cuenta con ese correo, recibirás un enlace para recuperar la contraseña.",
        );
      }
      if (mode === "reset") {
        await auth.resetPassword(password);
        setMessage("Contraseña actualizada. Ya podés volver al panel.");
      }
    } catch (failure) {
      setError(friendly(failure));
    } finally {
      setBusy(false);
    }
  }
  const passwordFields = mode !== "forgot";
  const validReset = mode !== "reset" || Boolean(auth.user);
  return (
    <main className="mx-auto my-12 w-[calc(100%-2rem)] max-w-sm rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-green-800">MyCAMPO_D</p>
      <h1 className="text-2xl font-bold">{titles[mode]}</h1>
      {mode === "register" && (
        <p className="mt-2 text-sm text-stone-500">
          Crear una cuenta no habilita automáticamente el acceso a los registros
          del equipo.
        </p>
      )}
      {!validReset ? (
        <p role="alert" className="mt-4">
          El enlace no es válido o venció. Solicitá uno nuevo.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          {mode !== "reset" && (
            <label className="block text-sm">
              Correo
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                className="mt-1 w-full rounded-xl border p-3"
              />
            </label>
          )}
          {passwordFields && (
            <label className="block text-sm">
              Contraseña
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "login" ? 1 : 8}
                required
                className="mt-1 w-full rounded-xl border p-3"
              />
            </label>
          )}
          {(mode === "register" || mode === "reset") && (
            <label className="block text-sm">
              Confirmar contraseña
              <input
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
                className="mt-1 w-full rounded-xl border p-3"
              />
            </label>
          )}
          {(error || auth.error) && (
            <p role="alert" className="text-sm text-red-700">
              {error || auth.error}
            </p>
          )}
          {message && (
            <p role="status" className="text-sm text-green-800">
              {message}
            </p>
          )}
          <button
            disabled={busy}
            className="min-h-11 w-full rounded-full bg-green-800 px-5 text-white disabled:opacity-50"
          >
            {busy
              ? "Procesando…"
              : {
                  login: "Ingresar",
                  register: "Registrarme",
                  forgot: "Enviar enlace",
                  reset: "Guardar contraseña",
                }[mode]}
          </button>
        </form>
      )}
      <nav
        aria-label="Acceso a tu cuenta"
        className="mt-5 flex flex-wrap gap-4 text-sm text-green-800"
      >
        <Link to="/login" state={location.state}>
          Ingresar
        </Link>
        <Link to="/registro" state={location.state}>
          Cómo ingresar
        </Link>
        <Link to="/recuperar-password">Recuperar contraseña</Link>
        <Link to="/local">Modo local</Link>
        {mode === "reset" && auth.user && !auth.recovery && (
          <Link to="/dashboard">Volver al panel</Link>
        )}
      </nav>
    </main>
  );
}
