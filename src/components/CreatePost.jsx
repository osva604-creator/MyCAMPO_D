import { useEffect, useRef, useState } from 'react';
import { Camera, MapPin, X } from 'lucide-react';
import { locate, preparePhoto } from '../lib/media';

export default function CreatePost({ onClose, onPublish, members, actor }) {
  const dialog = useRef(null), video = useRef(null), stream = useRef(null), alive = useRef(true);
  const [camera, setCamera] = useState(false), [photo, setPhoto] = useState('');
  const [gps, setGps] = useState(null), [gpsBusy, setGpsBusy] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [gpsNotice, setGpsNotice] = useState('');
  const [caption, setCaption] = useState(''), [capturedAt, setCapturedAt] = useState(null);
  function stopCamera() { stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; }
  async function getGps() {
    setGpsBusy(true); setGpsNotice('');
    try { const result = await locate(); if (alive.current) setGps(result); }
    catch (failure) { if (alive.current) setGpsNotice(failure.message); }
    finally { if (alive.current) setGpsBusy(false); }
  }
  useEffect(() => {
    alive.current = true; dialog.current.showModal(); getGps();
    return () => { alive.current = false; stopCamera(); };
  }, []);
  useEffect(() => { if (camera && video.current) video.current.srcObject = stream.current; }, [camera]);
  async function openCamera() {
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('La cámara requiere HTTPS y un navegador compatible. Podés seleccionar una foto.');
      const result = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (!alive.current) { result.getTracks().forEach((track) => track.stop()); return; }
      stream.current = result; setCamera(true);
    } catch (failure) { setError(failure.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Podés seleccionar una foto.' : failure.message); }
  }
  function capture() {
    const canvas = document.createElement('canvas'), width = video.current.videoWidth;
    if (!width) { setError('Esperá a que la cámara esté lista.'); return; }
    const scale = Math.min(1, 1600 / Math.max(width, video.current.videoHeight));
    canvas.width = Math.round(width * scale); canvas.height = Math.round(video.current.videoHeight * scale);
    canvas.getContext('2d').drawImage(video.current, 0, 0, canvas.width, canvas.height);
    setPhoto(canvas.toDataURL('image/jpeg', 0.8)); setCapturedAt(new Date().toISOString()); stopCamera(); setCamera(false);
  }
  async function selectPhoto(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try { const image = await preparePhoto(file); if (alive.current) { setPhoto(image); setCapturedAt(new Date().toISOString()); } }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function publish(event) {
    event.preventDefault(); setError('');
    if (!photo || !caption.trim()) { setError('Agregá una foto y una descripción.'); return; }
    const data = new FormData(event.currentTarget);
    if (!gps && !data.get('lot').trim()) { setError('Indicá el lote o solicitá la ubicación GPS.'); return; }
    setBusy(true);
    try {
      await onPublish({ id: crypto.randomUUID(), author: { name: actor.name }, image: photo, imageAlt: caption.trim(), caption: caption.trim(),
        suggestion: data.get('suggestion').trim(), location: data.get('lot').trim() || `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`, gps,
        category: data.get('category'), status: 'Pendiente', createdAt: new Date().toISOString(), capturedAt, likes: 0, comments: [] });
      onClose();
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} aria-labelledby="create-title" className="fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-1rem)] max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-xl backdrop:bg-stone-950/50">
    <form onSubmit={publish} className="space-y-4">
      <div className="flex items-center justify-between"><h2 id="create-title" className="text-xl font-bold">Nueva incidencia</h2><button type="button" disabled={busy} aria-label="Cerrar" onClick={onClose} className="grid size-11 place-items-center"><X /></button></div>
      {camera && <div><video ref={video} autoPlay playsInline muted className="max-h-64 w-full rounded-xl" /><button type="button" onClick={capture} className="mt-2 min-h-11 rounded-full bg-green-800 px-4 text-white">Tomar foto</button></div>}
      {photo && <img src={photo} alt="Vista previa de la incidencia" className="max-h-64 w-full rounded-xl object-contain" />}
      <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || camera} onClick={openCamera} className="flex min-h-11 items-center gap-2 rounded-full border px-4"><Camera size={18} />Cámara</button><label className="flex min-h-11 cursor-pointer items-center rounded-full border px-4">Seleccionar foto<input type="file" accept="image/*" capture="environment" onChange={selectPhoto} disabled={busy} className="sr-only" /></label></div>
      <label className="block text-sm font-semibold">Problema detectado<textarea autoFocus required maxLength={2000} value={caption} onChange={(event) => setCaption(event.target.value)} rows={3} placeholder="Describe el problema y menciona a @responsable" className="mt-1 w-full rounded-xl border p-3 font-normal" /></label>
      {members.length > 0 && <label className="block text-sm">Mencionar responsable<select value="" onChange={(event) => setCaption((value) => `${value} @${event.target.value} `)} className="ml-2 rounded-lg border p-2"><option value="" disabled>Seleccionar…</option>{members.map((member) => <option key={member.id} value={member.handle}>{member.name} (@{member.handle})</option>)}</select></label>}
      <label className="block text-sm">Solución sugerida<textarea name="suggestion" maxLength={1000} rows={2} className="mt-1 w-full rounded-xl border p-3" /></label>
      <label className="block text-sm">Lote o ubicación<input name="lot" maxLength={120} placeholder="Ej.: Potrero 7" className="mt-1 w-full rounded-xl border p-3" /></label>
      <button type="button" disabled={gpsBusy} onClick={getGps} className="flex min-h-11 items-center gap-2 text-sm text-green-800"><MapPin size={18} />{gpsBusy ? 'Buscando GPS…' : gps ? `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)} · precisión ±${Math.round(gps.accuracy)} m` : 'Reintentar ubicación GPS'}</button>
      <p role="status" className="text-xs text-amber-800">{gpsNotice}</p>
      <label className="block text-sm">Categoría<select name="category" className="mt-1 w-full rounded-xl border p-3">{['Infraestructura', 'Agua y hacienda', 'Sanidad vegetal', 'Tarea', 'Otra'].map((category) => <option key={category}>{category}</option>)}</select></label>
      <p role="alert" className="text-sm text-red-700">{error}</p><button disabled={busy || !photo || !caption.trim()} className="min-h-11 w-full rounded-full bg-green-800 px-5 text-white disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar incidencia'}</button>
    </form>
  </dialog>;
}
