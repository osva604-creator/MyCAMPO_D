import { useId, useState } from 'react';
import { CheckCircle2, ChevronDown, Clock3, Heart, MapPin, MessageCircle, Send, Share2, Wrench } from 'lucide-react';
import { preparePhoto } from '../lib/media';

const statuses = {
  Pendiente: { className: 'bg-amber-50 text-amber-800 ring-amber-200', Icon: Clock3 },
  'En Proceso': { className: 'bg-blue-50 text-blue-800 ring-blue-200', Icon: Wrench },
  Resuelto: { className: 'bg-green-50 text-green-800 ring-green-200', Icon: CheckCircle2 },
};

function MentionText({ text }) {
  return text.split(/(@[\p{L}\p{N}_]+)/gu).map((part, index) =>
    part.startsWith('@') ? <span key={index} className="font-semibold text-green-700">{part}</span> : part,
  );
}

export default function PostCard({ post, actor, onAction }) {
  const liked = post.likedBy?.includes(actor.id) ?? false;
  const [expanded, setExpanded] = useState(false);
  const comments = post.comments ?? [];
  const [draft, setDraft] = useState('');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shareNotice, setShareNotice] = useState('');
  const commentsId = useId();
  const status = statuses[post.status] ?? statuses.Pendiente;
  const StatusIcon = status.Icon;
  const location = typeof post.location === 'string' ? post.location : `${post.location.lat}, ${post.location.lng}`;

  async function sharePost() {
    const url = new URL(window.location.href);
    url.hash = `publicacion-${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Incidencia en MyCAMPO_D', text: post.caption, url: url.href });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(`${post.caption}\n${url.href}`);
        setShareNotice('Enlace y descripción copiados.');
      } else {
        setShareNotice('Este navegador no permite compartir automáticamente.');
      }
    } catch (error) {
      if (error.name !== 'AbortError') setShareNotice('No se pudo compartir. Inténtalo nuevamente.');
    }
  }

  async function action(type, payload) {
    setBusy(true); setError('');
    try { await onAction(type, { postId: post.id, ...payload }); return true; }
    catch (failure) { setError(failure.message); return false; }
    finally { setBusy(false); }
  }
  async function addComment(event) {
    event.preventDefault();
    if (!draft.trim() && !evidence) return;
    if (await action('comment', { text: draft.trim(), ...(evidence ? { image: evidence } : {}) })) { setDraft(''); setEvidence(''); }
  }
  async function selectEvidence(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try { setEvidence(await preparePhoto(file)); }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return (
    <article id={`publicacion-${post.id}`} className="scroll-mt-24 overflow-hidden rounded-3xl border border-stone-200 bg-white shadow-sm">
      <header className="flex items-center gap-3 p-4 sm:p-5">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-green-100 text-sm font-bold text-green-800">
          {post.author.name.split(' ').map((name) => name[0]).slice(0, 2).join('')}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">{post.author.name}</h2>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-stone-500"><MapPin size={13} className="shrink-0" aria-hidden="true" /><span className="truncate">{location}</span></p>
        </div>
        <time dateTime={post.createdAt} className="shrink-0 text-xs text-stone-400">{new Date(post.createdAt).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
      </header>

      <div className="relative bg-stone-100">
        <img src={post.image} alt={post.imageAlt} loading="lazy" className="aspect-[4/3] w-full object-cover sm:aspect-[5/4]" />
        <span className={`absolute bottom-4 left-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm ring-1 ring-inset ${status.className}`}>
          <StatusIcon size={14} aria-hidden="true" />{statuses[post.status] ? post.status : 'Pendiente'}
        </span>
      </div>

      <div className="p-4 sm:p-5">
        <div className="-ml-2 flex items-center gap-1">
          <button type="button" disabled={busy} aria-label={liked ? 'Quitar Me gusta' : 'Me gusta'} aria-pressed={liked} onClick={() => action('like', { liked: !liked })} className={`grid size-11 place-items-center rounded-full transition hover:bg-stone-50 ${liked ? 'text-rose-500' : 'text-stone-700'}`}><Heart size={24} fill={liked ? 'currentColor' : 'none'} aria-hidden="true" /></button>
          <button type="button" aria-label="Mostrar u ocultar comentarios" aria-expanded={expanded} aria-controls={commentsId} onClick={() => setExpanded(!expanded)} className="grid size-11 place-items-center rounded-full text-stone-700 hover:bg-stone-50"><MessageCircle size={24} aria-hidden="true" /></button>
          <button type="button" aria-label="Compartir publicación" onClick={sharePost} className="grid size-11 place-items-center rounded-full text-stone-700 hover:bg-stone-50"><Share2 size={22} aria-hidden="true" /></button>
          <span className="ml-auto text-xs text-stone-400">{post.category}</span>
        </div>
        <p className="mt-1 text-sm font-semibold">{(post.likes ?? 0) + (post.likedBy?.length ?? 0)} Me gusta</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-stone-600"><span className="mr-1.5 font-bold text-stone-900">{post.author.name}</span><MentionText text={post.caption} /></p>
        <p role="status" className="text-xs text-green-700">{shareNotice}</p>
        {post.suggestion && <p className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-900"><strong>Solución sugerida: </strong><MentionText text={post.suggestion} /></p>}
        {post.gps && <p className="mt-2 text-xs text-stone-500">GPS: {post.gps.lat.toFixed(6)}, {post.gps.lng.toFixed(6)} · ±{Math.round(post.gps.accuracy)} m</p>}
        <label className="mt-3 flex items-center gap-2 text-sm text-stone-600">Estado<select aria-label={`Estado de incidencia de ${post.author.name}`} value={post.status} disabled={busy} onChange={(event) => action('status', { status: event.target.value })} className="min-h-11 rounded-xl border border-stone-200 bg-white px-3">{Object.keys(statuses).map((value) => <option key={value}>{value}</option>)}</select></label>
        <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>

        <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls={commentsId} className="mt-3 flex min-h-11 items-center gap-1 text-sm text-stone-500 hover:text-green-800">
          {expanded ? 'Ocultar comentarios' : `Ver comentarios (${comments.length})`}<ChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        <section id={commentsId} aria-label="Comentarios" hidden={!expanded} className="border-t border-stone-100 pt-3">
          {comments.length === 0 && <p className="text-sm text-stone-500">Todavía no hay comentarios.</p>}
          <ul className="space-y-3">
            {comments.map((comment) => <li key={comment.id} className="break-words text-sm leading-6 text-stone-600"><span className="mr-1.5 font-semibold text-stone-900">{comment.author}</span><MentionText text={comment.text} />{comment.createdAt && <time dateTime={comment.createdAt} className="block text-xs text-stone-400">{new Date(comment.createdAt).toLocaleString('es-AR')}</time>}{comment.image && <img src={comment.image} alt="Evidencia de seguimiento o reparación" loading="lazy" className="mt-2 max-h-64 w-full rounded-xl object-contain" />}</li>)}
          </ul>
          <form onSubmit={addComment} className="mt-4 flex gap-2">
            <label htmlFor={`${commentsId}-input`} className="sr-only">Escribe un comentario</label>
            <input id={`${commentsId}-input`} value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1000} placeholder="Agrega un comentario…" className="min-w-0 flex-1 rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm" />
            <button type="submit" disabled={busy || (!draft.trim() && !evidence)} aria-label="Publicar comentario" className="grid size-11 shrink-0 place-items-center rounded-full bg-green-800 text-white disabled:opacity-40"><Send size={18} aria-hidden="true" /></button>
          </form>
          <label className="mt-3 block text-xs text-stone-500">Adjuntar evidencia fotográfica<input type="file" accept="image/*" capture="environment" disabled={busy} onChange={selectEvidence} className="mt-2 block w-full text-xs" /></label>
          {evidence && <div className="mt-2"><img src={evidence} alt="Vista previa de evidencia" className="max-h-32 rounded-lg" /><button type="button" onClick={() => setEvidence('')} disabled={busy} className="min-h-11 text-xs text-red-700">Quitar foto</button></div>}
        </section>
      </div>
    </article>
  );
}
