import { useEffect, useRef, useState } from 'react';
import { Camera, MapPin, X } from 'lucide-react';
import { locate, preparePhoto } from '../lib/media';
import { mapsUrl, validCoordinates } from '../lib/location';

export default function CreatePost({ onClose, onPublish, members, actor }) {
  const dialog = useRef(null), video = useRef(null), stream = useRef(null), alive = useRef(true);
  const [camera, setCamera] = useState(false), [photo, setPhoto] = useState('');
  const [gps, setGps] = useState(null), [gpsBusy, setGpsBusy] = useState(false);
  const [latitude, setLatitude] = useState(''), [longitude, setLongitude] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const manualLocation = useRef(false);
  const hasCoordinates = latitude.trim() !== '' || longitude.trim() !== '';
  const selectedGps = latitude.trim() !== '' && longitude.trim() !== '' ? {
    lat: Number(latitude), lng: Number(longitude), accuracy: manualLocation.current ? null : gps?.accuracy ?? null,
    source: manualLocation.current ? 'manual' : 'device',
  } : null;
  const previewMap = mapsUrl(selectedGps);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [gpsNotice, setGpsNotice] = useState('');
  const [caption, setCaption] = useState(''), [capturedAt, setCapturedAt] = useState(null);
  function stopCamera() { stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; }
  async function getGps(replaceManual = false) {
    setGpsBusy(true); setGpsNotice('');
    try { const result = await locate(); if (alive.current && (replaceManual || !manualLocation.current)) {
      manualLocation.current = false; setGps(result); setLatitude(String(result.lat)); setLongitude(String(result.lng)); setConfirmed(false);
    } }
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
    setPhoto(canvas.toDataURL('image/jpeg', 0.8)); setCapturedAt(new Date().toISOString()); setConfirmed(false); stopCamera(); setCamera(false);
  }
  async function selectPhoto(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    setBusy(true); setError('');
    try { const image = await preparePhoto(file); if (alive.current) { setPhoto(image); setCapturedAt(new Date().toISOString()); setConfirmed(false); } }
    catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function publish(event) {
    event.preventDefault(); setError('');
    if (!photo || !caption.trim()) { setError('Agregá una foto y una descripción.'); return; }
    const data = new FormData(event.currentTarget);
    if (hasCoordinates && !validCoordinates(selectedGps)) { setError('Ingresá latitud entre -90 y 90 y longitud entre -180 y 180. Completá ambos campos.'); return; }
    if (hasCoordinates && !confirmed) { setError('Confirmá que las coordenadas corresponden al lugar de la foto.'); return; }
    if (!hasCoordinates && !data.get('lot').trim()) { setError('Indicá el lote o solicitá la ubicación GPS.'); return; }
    const locationGps = hasCoordinates ? selectedGps : null;
    setBusy(true);
    try {
      await onPublish({ id: crypto.randomUUID(), author: { name: actor.name }, image: photo, imageAlt: caption.trim(), caption: caption.trim(),
        suggestion: data.get('suggestion').trim(), location: data.get('lot').trim() || `${locationGps.lat.toFixed(6)}, ${locationGps.lng.toFixed(6)}`, gps: locationGps,
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
      <fieldset className="space-y-3 rounded-2xl border border-stone-200 p-3">
        <legend className="px-1 text-sm font-semibold">Ubicación de la foto</legend>
        <p className="text-xs leading-5 text-stone-500">El GPS indica dónde estás ahora. Si elegís una foto de la galería, verificá o corregí el lugar donde fue tomada.</p>
        <button type="button" disabled={gpsBusy || busy} onClick={() => getGps(true)} className="flex min-h-11 items-center gap-2 text-sm text-green-800"><MapPin size={18} aria-hidden="true" />{gpsBusy ? 'Buscando GPS…' : 'Usar mi ubicación actual'}</button>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">Latitud<input type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => { manualLocation.current = true; setLatitude(event.target.value); setConfirmed(false); }} placeholder="-34.610000" className="mt-1 w-full min-w-0 rounded-xl border p-2" /></label>
          <label className="text-sm">Longitud<input type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => { manualLocation.current = true; setLongitude(event.target.value); setConfirmed(false); }} placeholder="-60.920000" className="mt-1 w-full min-w-0 rounded-xl border p-2" /></label>
        </div>
        {previewMap && <a href={previewMap} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm font-semibold text-green-800">Verificar punto en Google Maps ↗</a>}
        {hasCoordinates && <><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Confirmo que este es el lugar de la foto</label><button type="button" onClick={() => { manualLocation.current = true; setLatitude(''); setLongitude(''); setConfirmed(false); }} className="min-h-11 text-xs text-stone-500">Guardar solo el lote, sin GPS</button></>}
      </fieldset>
      <p role="status" className="text-xs text-amber-800">{gpsNotice}</p>
      <label className="block text-sm">Categoría<select name="category" className="mt-1 w-full rounded-xl border p-3">{['Infraestructura', 'Agua y hacienda', 'Sanidad vegetal', 'Tarea', 'Otra'].map((category) => <option key={category}>{category}</option>)}</select></label>
      <p role="alert" className="text-sm text-red-700">{error}</p><button disabled={busy || !photo || !caption.trim()} className="min-h-11 w-full rounded-full bg-green-800 px-5 text-white disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar incidencia'}</button>
    </form>
  </dialog>;
}
