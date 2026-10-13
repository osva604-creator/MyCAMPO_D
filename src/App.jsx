import { useEffect, useState } from 'react';
import { CloudUpload, Download, LogOut, Sprout, WifiOff } from 'lucide-react';
import Navbar from './components/Navbar';
import PostCard from './components/PostCard';
import CreatePost from './components/CreatePost';
import Auth from './components/Auth';
import { cloud } from './lib/cloud';
import { useField } from './lib/useField';

function Field({ user }) {
  const field = useField(user);
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState('Todos');
  const [search, setSearch] = useState('');
  const [installPrompt, setInstallPrompt] = useState(null);
  useEffect(() => {
    const install = (event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener('beforeinstallprompt', install);
    return () => window.removeEventListener('beforeinstallprompt', install);
  }, []);
  const filtered = field.posts.filter((post) => (status === 'Todos' || post.status === status) && `${post.caption} ${post.location} ${post.author.name}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  useEffect(() => {
    if (field.ready && location.hash.startsWith('#publicacion-')) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
  }, [field.ready, field.posts.length]);
  function exportData() {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), posts: field.posts }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'mycampo-d-respaldo.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <>
    <Navbar onCreatePost={() => setCreating(true)} />
    <main id="inicio" className="mx-auto max-w-xl px-3 pb-12 pt-7 sm:px-0">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-green-700"><Sprout size={15} />La vida en el campo</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">Tu campo, conectado.</h1><p className="mt-2 text-sm text-stone-500">Cada recorrida cuenta. Compartí, coordiná y resolvé.</p>
      <div className="my-5 space-y-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm">
        <p role="status" className="flex items-center gap-2">{!field.online ? <WifiOff size={18} /> : <CloudUpload size={18} />}{!cloud ? 'Modo local · guardado en este dispositivo' : field.busy ? 'Sincronizando…' : `${field.pending} cambios pendientes · ${field.online ? 'Con conexión' : 'Sin conexión'}`}</p>
        {!cloud && <><p className="text-xs text-stone-500">Los ejemplos son ilustrativos. Configurá Supabase para compartir registros con tu equipo.</p><label className="flex items-center gap-2">Tu nombre<input value={field.localName} maxLength={80} onChange={(event) => field.setLocalName(event.target.value)} className="min-w-0 flex-1 rounded-lg border p-2" /></label></>}
        <div className="flex flex-wrap gap-3">{cloud && <button onClick={field.sync} disabled={field.busy || !field.online} className="min-h-11 text-green-800 disabled:opacity-50">Sincronizar ahora</button>}<button onClick={exportData} className="flex min-h-11 items-center gap-1 text-green-800"><Download size={16} />Exportar respaldo</button>{installPrompt && <button onClick={async () => { await installPrompt.prompt(); setInstallPrompt(null); }} className="min-h-11 text-green-800">Instalar app</button>}{cloud && <button onClick={() => cloud.auth.signOut()} className="flex min-h-11 items-center gap-1"><LogOut size={16} />Salir</button>}</div>
      </div>
      {field.error && <p role="alert" className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{field.error}</p>}
      <label className="sr-only" htmlFor="search">Buscar incidencias</label><input id="search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por lote, problema o responsable…" className="mb-3 w-full rounded-xl border border-stone-200 bg-white p-3 text-sm" />
      <div aria-label="Filtrar por estado" className="mb-5 flex flex-wrap gap-2">{['Todos', 'Pendiente', 'En Proceso', 'Resuelto'].map((value) => <button key={value} aria-pressed={status === value} onClick={() => setStatus(value)} className={`min-h-11 rounded-full px-3 text-xs font-semibold ${status === value ? 'bg-green-800 text-white' : 'border border-stone-200 bg-white text-stone-600'}`}>{value}</button>)}</div>
      {!field.ready ? <p role="status">Cargando registros…</p> : <div className="space-y-6">{filtered.map((post) => <PostCard key={post.id} post={post} actor={field.actor} onAction={field.dispatch} />)}{!filtered.length && <p className="py-10 text-center text-stone-500">No hay incidencias para mostrar. Creá una nueva o cambiá los filtros.</p>}</div>}
    </main>
    {creating && <CreatePost onClose={() => setCreating(false)} onPublish={(post) => field.dispatch('post', post)} members={field.members} actor={field.actor} />}
  </>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(cloud));
  const [error, setError] = useState('');
  useEffect(() => {
    if (!cloud) return;
    let active = true;
    cloud.auth.getSession().then(({ data, error: failure }) => {
      if (!active) return;
      if (failure) setError('No se pudo recuperar la sesión. Intentá ingresar nuevamente.');
      setUser(data.session?.user ?? null); setLoading(false);
    }).catch(() => { if (active) { setError('No se pudo recuperar la sesión.'); setLoading(false); } });
    const { data } = cloud.auth.onAuthStateChange((_event, session) => { setUser(session?.user ?? null); setLoading(false); });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  if (loading) return <p className="p-8" role="status">Cargando sesión…</p>;
  if (cloud && !user) return <>{error && <p role="alert" className="p-4 text-red-700">{error}</p>}<Auth /></>;
  return <Field key={user?.id || 'local'} user={user} />;
}
