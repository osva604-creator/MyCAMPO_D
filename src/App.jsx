import { lazy, Suspense, useEffect, useState } from "react";
import { CloudUpload, Download, LogOut, Sprout, WifiOff } from "lucide-react";
import Navbar from "./components/Navbar";
import PostCard from "./components/PostCard";
import CreatePost from "./components/CreatePost";
import { BrowserRouter, Link, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./components/Login";
import Register from "./components/Register";
import ForgotPassword from "./components/ForgotPassword";
import ResetPassword from "./components/ResetPassword";
import MobileNav from "./components/MobileNav";
import Messages from "./components/Messages";
import { cloud } from "./lib/cloud";
import { useField } from "./lib/useField";
import { AccessProvider } from "./context/AccessContext";
import ActivateAccount from "./components/ActivateAccount";
import StoragePanel from './components/StoragePanel';
import LocationPanel from './components/LocationPanel';
import PullToRefresh from './components/PullToRefresh';
const TeamGate = lazy(() => import("./components/team/TeamShell"));
const LocalMap = lazy(() => import('./components/map/MapPage'));

function LocalField() {
  const user = null;
  const backend = null;
  const field = useField(null, { local: true });
  const { signOut } = useAuth();
  const [logoutError, setLogoutError] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  async function logout() {
    setLoggingOut(true);
    setLogoutError("");
    try {
      await signOut();
    } catch {
      setLogoutError(
        "No se pudo cerrar la sesión. Revisá la conexión e intentá nuevamente.",
      );
    } finally {
      setLoggingOut(false);
    }
  }
  const [section, setSection] = useState("home");
  const avatar =
    user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState("Todos");
  const [search, setSearch] = useState("");
  const [installPrompt, setInstallPrompt] = useState(null);
  useEffect(() => {
    const install = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", install);
    return () => window.removeEventListener("beforeinstallprompt", install);
  }, []);
  const filtered = field.posts.filter(
    (post) =>
      (status === "Todos" || post.status === status) &&
      `${post.caption} ${post.location} ${post.author.name}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
  );
  useEffect(() => {
    if (field.ready && location.hash.startsWith("#publicacion-"))
      document
        .getElementById(decodeURIComponent(location.hash.slice(1)))
        ?.scrollIntoView();
  }, [field.ready, field.posts.length]);
  function exportData() {
    const blob = new Blob(
      [
        JSON.stringify(
          { exportedAt: new Date().toISOString(), posts: field.posts },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mycampo-d-respaldo.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <>
      <Navbar onCreatePost={() => setCreating(true)} onMap={() => setSection('map')} />
      <main
        id="inicio"
        className={`mobile-content mx-auto px-3 pt-7 ${section === 'map' ? 'max-w-6xl sm:px-4' : 'max-w-xl sm:px-0'}`}
      >
        <PullToRefresh onRefresh={field.refresh} disabled={creating} refreshing={field.busy}>
        {section === 'map' && <Suspense fallback={<p role="status">Abriendo mapa…</p>}><LocalMap posts={field.posts} actor={field.actor} onOpenPost={id=>{setSection('home');window.location.hash=`publicacion-${id}`;setTimeout(()=>document.getElementById(`publicacion-${id}`)?.scrollIntoView?.(),0);}}/></Suspense>}
        {section === "messages" && (
          <Messages actor={field.actor} members={field.members} />
        )}
        {section === "account" && (
          <section className="mb-5 rounded-2xl border border-stone-200 bg-white p-5">
            <h1 className="text-2xl font-bold">Tu cuenta</h1>
            <div className="my-4 flex items-center gap-3">
              {avatar && (
                <img
                  src={avatar}
                  alt="Tu foto de perfil"
                  className="size-14 rounded-full object-cover"
                />
              )}
              <div>
                <p className="font-semibold">{field.actor.name}</p>
                <p className="text-sm text-stone-500">
                  {user?.email || "Cuenta local"}
                </p>
              </div>
            </div>
          </section>
        )}
        <div hidden={section !== "home"}>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-green-700">
            <Sprout size={15} />
            La vida en el campo
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">
            Tu campo, conectado.
          </h1>
          <p className="mt-2 text-sm text-stone-500">
            Cada recorrida cuenta. Compartí, coordiná y resolvé.
          </p>
        </div>
        <div
          hidden={section === "messages" || section === 'map'}
          className="my-5 space-y-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm"
        >
          <p role="status" className="flex items-center gap-2">
            {!field.online ? <WifiOff size={18} /> : <CloudUpload size={18} />}
            {!backend
              ? "Modo local · guardado en este dispositivo"
              : field.busy
                ? "Sincronizando…"
                : `${field.pending} cambios pendientes · ${field.online ? "Con conexión" : "Sin conexión"}`}
          </p>
          {backend && field.pending > 0 && (
            <p className="text-sm text-amber-800">
              Hay cambios guardados en este navegador que todavía no están
              online. Conservá un respaldo hasta que termine la sincronización.
            </p>
          )}
          {!backend && (
            <>
              <p className="text-xs text-stone-500">
                Los ejemplos son ilustrativos. Los registros de este modo se
                guardan en este dispositivo y no se comparten con el equipo.
                {cloud && (
                  <Link
                    to="/dashboard"
                    className="ml-2 font-semibold text-green-800"
                  >
                    Entrar al equipo
                  </Link>
                )}
              </p>
              <label className="flex items-center gap-2">
                Tu nombre
                <input
                  value={field.localName}
                  maxLength={80}
                  onChange={(event) => field.setLocalName(event.target.value)}
                  className="min-w-0 flex-1 rounded-lg border p-2"
                />
              </label>
            </>
          )}
          <div className="flex flex-wrap gap-3">
            {backend && (
              <button
                onClick={field.sync}
                disabled={field.busy || !field.online}
                className="min-h-11 text-green-800 disabled:opacity-50"
              >
                Sincronizar ahora
              </button>
            )}
            <button
              onClick={exportData}
              className="flex min-h-11 items-center gap-1 text-green-800"
            >
              <Download size={16} />
              Exportar respaldo
            </button>
            {installPrompt && (
              <button
                onClick={async () => {
                  await installPrompt.prompt();
                  setInstallPrompt(null);
                }}
                className="min-h-11 text-green-800"
              >
                Instalar app
              </button>
            )}
            {backend && (
              <button
                onClick={logout}
                disabled={loggingOut}
                className="flex min-h-11 items-center gap-1"
              >
                <LogOut size={16} />
                Salir
              </button>
            )}
          </div>
        </div>
        {logoutError && (
          <p role="alert" className="mb-4 text-red-700">
            {logoutError}
          </p>
        )}
        {field.error && (
          <p
            role="alert"
            className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
          >
            {field.error}
          </p>
        )}
        {section === "account" && <StoragePanel user="local" pending={0} />}
        {section === "account" && <LocationPanel onOpenMap={() => setSection('map')} />}
        {section === "account" && (
          <section aria-label="Mis publicaciones">
            <h2 className="mb-4 text-xl font-bold">Mis publicaciones</h2>
            <div className="space-y-6">
              {field.posts
                .filter((post) => post.author.id === field.actor.id)
                .map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    actor={field.actor}
                    onAction={field.dispatch}
                  />
                ))}
              {field.ready &&
                !field.posts.some(
                  (post) => post.author.id === field.actor.id,
                ) && (
                  <p className="text-sm text-stone-500">
                    No hay publicaciones de esta cuenta disponibles en este
                    navegador. Si publicaste desde otro dispositivo, abrí allí
                    la app para sincronizarlas.
                  </p>
                )}
            </div>
          </section>
        )}
        <div hidden={section !== "home"}>
          <label className="sr-only" htmlFor="search">
            Buscar incidencias
          </label>
          <input
            id="search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por lote, problema o responsable…"
            className="mb-3 w-full rounded-xl border border-stone-200 bg-white p-3 text-sm"
          />
          <div
            aria-label="Filtrar por estado"
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
          {!field.ready ? (
            <p role="status">Cargando registros…</p>
          ) : (
            <div className="space-y-6">
              {filtered.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  actor={field.actor}
                  onAction={field.dispatch}
                />
              ))}
              {!filtered.length && (
                <p className="py-10 text-center text-stone-500">
                  No hay incidencias para mostrar. Creá una nueva o cambiá los
                  filtros.
                </p>
              )}
            </div>
          )}
        </div>
        </PullToRefresh>
      </main>
      <MobileNav
        section={section}
        avatar={avatar}
        name={field.actor.name}
        onNavigate={(next) => {
          setSection(next);
          window.scrollTo({ top: 0 });
        }}
        onCreate={() => setCreating(true)}
      />
      {creating && (
        <CreatePost
          onClose={() => setCreating(false)}
          onPublish={(post) => field.dispatch("post", post)}
          members={field.members}
          actor={field.actor}
          draftKey="local:compose"
        />
      )}
    </>
  );
}

function Dashboard() {
  return cloud ? (
    <AccessProvider>
      <Suspense
        fallback={
          <p role="status" className="p-8">
            Abriendo el equipo…
          </p>
        }
      >
        <TeamGate />
      </Suspense>
    </AccessProvider>
  ) : (
    <LocalField />
  );
}
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Register />} />
      <Route path="/recuperar-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/local" element={<LocalField />} />
      <Route
        path="/activar-cuenta"
        element={
          <AccessProvider>
            <ActivateAccount />
          </AccessProvider>
        }
      />
      <Route
        path="/dashboard/*"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route
        path="*"
        element={
          <ProtectedRoute>
            <Navigate to="/dashboard" replace />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
