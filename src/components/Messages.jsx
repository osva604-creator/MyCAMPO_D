import { useEffect, useState } from 'react';
import { cloud } from '../lib/cloud';

export default function Messages({ actor, members }) {
  const [recipient, setRecipient] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!cloud || !recipient) return;
    let active = true;
    setMessages([]); setLoading(true); setError('');
    async function refresh() {
      const { data, error: failure } = await cloud.from('direct_messages').select('*').or(`and(sender_id.eq.${actor.id},recipient_id.eq.${recipient}),and(sender_id.eq.${recipient},recipient_id.eq.${actor.id})`).order('created_at', { ascending: false }).limit(200);
      if (!active) return;
      setLoading(false);
      if (failure) setError('No se pudieron cargar los mensajes. Verificá la conexión y que la migración de mensajes esté aplicada.');
      else { setMessages(data.reverse()); setError(''); }
    }
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [actor.id, recipient]);
  async function send(event) {
    event.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const { data, error: failure } = await cloud.from('direct_messages').insert({ sender_id: actor.id, recipient_id: recipient, body: text.trim() }).select().single();
      if (failure) throw failure;
      setMessages((previous) => [...previous.filter((message) => message.id !== data.id), data]); setText('');
    } catch { setError('No se pudo enviar el mensaje. Intentá nuevamente.'); }
    finally { setBusy(false); }
  }
  return <section><h1 className="text-2xl font-bold">Mensajes</h1><p className="mt-2 text-sm text-stone-500">Conversaciones privadas con tu equipo.</p>
    {!cloud ? <p className="mt-5 rounded-xl bg-white p-4">Ingresá con una cuenta de tu organización para enviar mensajes. El modo local no permite mensajes directos.</p> : <>
      <label className="mt-5 block text-sm font-semibold">Conversar con<select value={recipient} onChange={(event) => setRecipient(event.target.value)} className="mt-2 w-full rounded-xl border border-stone-200 bg-white p-3"><option value="">Elegí un integrante</option>{members.filter((member) => member.id !== actor.id).map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
      {recipient && <><div aria-label="Conversación" aria-live="polite" className="my-4 flex max-h-[45dvh] min-h-40 flex-col gap-3 overflow-y-auto rounded-2xl border border-stone-200 bg-white p-4">{loading ? <p role="status">Cargando mensajes…</p> : !messages.length && <p className="text-sm text-stone-500">Todavía no hay mensajes. Iniciá la conversación.</p>}{messages.map((message) => <div key={message.id} className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2 text-sm ${message.sender_id === actor.id ? 'self-end bg-green-800 text-white' : 'self-start bg-stone-100'}`}><p>{message.body}</p><time className="mt-1 block text-[10px] opacity-70" dateTime={message.created_at}>{new Date(message.created_at).toLocaleString('es-AR')}</time></div>)}</div><form onSubmit={send} className="flex gap-2"><input aria-label="Mensaje" value={text} onChange={(event) => setText(event.target.value)} maxLength={2000} placeholder="Escribí un mensaje…" className="min-w-0 flex-1 rounded-xl border bg-white p-3" /><button disabled={busy || loading || !text.trim()} className="rounded-xl bg-green-800 px-4 text-white disabled:opacity-50">{busy ? 'Enviando…' : 'Enviar'}</button></form></>}
    </>}
  </section>;
}
