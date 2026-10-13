import { useEffect, useRef, useState } from 'react';
import { Camera, Sprout } from 'lucide-react';
import Navbar from './components/Navbar';
import PostCard from './components/PostCard';

const initialPosts = [
  {
    id: 'molino', author: { name: 'Juan Pérez' }, location: 'Lote Norte · Molino 3',
    image: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=85',
    imageAlt: 'Paisaje rural de referencia para la incidencia del molino',
    caption: 'El molino dejó de bombear esta mañana. Se observa una rotura en la transmisión. @Carlos revisar el mecanismo antes de mover la hacienda al lote.',
    status: 'Pendiente', category: 'Infraestructura', likes: 12, createdAt: '2026-10-13T09:20:00-03:00', timeLabel: '13 oct · 09:20',
    comments: [{ id: 'm1', author: 'Carlos Díaz', text: 'Recibido, voy con herramientas después de la recorrida.' }],
  },
  {
    id: 'bebedero', author: { name: 'Lucía Fernández' }, location: 'Potrero 7 · -34.61, -60.92',
    image: 'https://images.unsplash.com/photo-1516467508483-a7212febe31a?auto=format&fit=crop&w=1200&q=85',
    imageAlt: 'Ganado en el campo, imagen de referencia del potrero',
    caption: 'Bebedero sin agua en el potrero 7. Ya cerramos la llave para revisar la pérdida. @Martin está reemplazando el flotante; verificar el nivel al finalizar.',
    status: 'En Proceso', category: 'Agua y hacienda', likes: 8, createdAt: '2026-10-13T08:10:00-03:00', timeLabel: '13 oct · 08:10',
    comments: [{ id: 'b1', author: 'Martín López', text: 'Flotante nuevo instalado. Estoy comprobando que vuelva a llenar.' }, { id: 'b2', author: 'Lucía Fernández', text: 'Gracias @Martin, aviso al equipo.' }],
  },
  {
    id: 'soja', author: { name: 'Diego Ramírez' }, location: 'Lote 12 · Soja',
    image: 'https://images.unsplash.com/photo-1500937386664-56d1dfef3854?auto=format&fit=crop&w=1200&q=85',
    imageAlt: 'Cultivo agrícola, imagen de referencia para el lote de soja',
    caption: 'Seguimiento del foco de plaga detectado en la cabecera del lote. @Ana completó la evaluación y confirmó el cierre de la incidencia. Continuamos con el monitoreo habitual.',
    status: 'Resuelto', category: 'Sanidad vegetal', likes: 21, createdAt: '2026-10-12T17:45:00-03:00', timeLabel: '12 oct · 17:45',
    comments: [{ id: 's1', author: 'Ana Torres', text: 'Recorrida finalizada y registro actualizado. Seguimos atentos a la evolución.' }],
  },
];

export default function App() {
  const [posts, setPosts] = useState(initialPosts);
  const [photo, setPhoto] = useState(null);
  const [caption, setCaption] = useState('');
  const fileInput = useRef(null);
  const dialog = useRef(null);
  const photoUrls = useRef([]);

  useEffect(() => () => photoUrls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  function selectPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { event.target.value = ''; return; }
    const url = URL.createObjectURL(file);
    photoUrls.current.push(url);
    setPhoto(url);
    dialog.current.showModal();
    event.target.value = '';
  }

  function publish(event) {
    event.preventDefault();
    if (!photo || !caption.trim()) return;
    const now = new Date();
    setPosts((current) => [{
      id: crypto.randomUUID(), author: { name: 'Operario MyCAMPO_D' }, location: 'Ubicación sin registrar',
      image: photo, imageAlt: caption.trim(), caption: caption.trim(), status: 'Pendiente',
      category: 'Nueva incidencia', likes: 0, comments: [], createdAt: now.toISOString(), timeLabel: 'Ahora',
    }, ...current]);
    dialog.current.close();
    setPhoto(null);
    setCaption('');
  }

  return (
    <>
      <Navbar onCreatePost={() => fileInput.current.click()} />
      <input ref={fileInput} type="file" accept="image/*" capture="environment" onChange={selectPhoto} className="hidden" aria-label="Seleccionar foto de la incidencia" />
      <main id="inicio" className="mx-auto max-w-xl px-3 pb-12 pt-7 sm:px-0 sm:pt-10">
        <div className="mb-6 px-1">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-green-700"><Sprout size={15} aria-hidden="true" />La vida en el campo</p>
          <h1 className="text-3xl font-bold tracking-tight">Tu campo, conectado.</h1>
          <p className="mt-2 text-sm leading-6 text-stone-500">Cada recorrida cuenta. Compartí, coordiná y resolvé.</p>
          <p className="mt-3 text-xs text-stone-400">Feed de demostración · Fotos ilustrativas · Cambios guardados solo durante esta sesión</p>
        </div>
        <div className="space-y-6">{posts.map((post) => <PostCard key={post.id} post={post} />)}</div>
      </main>
      <dialog ref={dialog} aria-labelledby="create-title" onClose={() => { setPhoto(null); setCaption(''); }} className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-3xl bg-white p-6 shadow-xl backdrop:bg-stone-950/50">
        <form onSubmit={publish}>
          <h2 id="create-title" className="flex items-center gap-2 text-xl font-bold"><Camera size={22} aria-hidden="true" />Nueva incidencia</h2>
          {photo && <img src={photo} alt="Vista previa de la foto seleccionada" className="mt-4 max-h-64 w-full rounded-2xl object-contain" />}
          <label htmlFor="caption" className="mb-2 mt-4 block text-sm font-semibold">¿Qué detectaste?</label>
          <textarea id="caption" autoFocus required maxLength={2000} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="Describe la incidencia y menciona a @responsable…" rows={4} className="w-full rounded-xl border border-stone-200 p-3 text-sm" />
          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={() => dialog.current.close()} className="min-h-11 rounded-full px-4 text-sm text-stone-600">Cancelar</button>
            <button type="submit" disabled={!caption.trim()} className="min-h-11 rounded-full bg-green-800 px-5 text-sm font-semibold text-white disabled:opacity-40">Publicar</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
