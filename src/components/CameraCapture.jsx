import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, RotateCcw, X } from 'lucide-react';
import { photoFromSource, preparePhoto } from '../lib/media';

export default function CameraCapture({ onCapture, onShutter, onClose, profile, setProfile }) {
  const video = useRef(null), stream = useRef(null), generation = useRef(0);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const stop = useCallback(() => {
    generation.current++;
    stream.current?.getTracks().forEach(track => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setReady(false);
  }, []);
  const start = useCallback(async () => {
    stop();
    const request = generation.current;
    setError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('La cámara requiere HTTPS y un navegador compatible. Volvé para elegir una foto de la galería.');
      const portrait = window.innerHeight > window.innerWidth;
      const result = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: portrait ? 1920 : 2560 }, height: { ideal: portrait ? 2560 : 1920 },
          aspectRatio: { ideal: window.innerWidth / window.innerHeight } }, audio: false,
      });
      if (generation.current !== request) { result.getTracks().forEach(track => track.stop()); return; }
      stream.current = result;
      video.current.srcObject = result;
      video.current.play()?.catch(() => {});
    } catch (failure) {
      if (generation.current === request) setError(failure.name === 'NotAllowedError' ? 'Permiso de cámara denegado. Podés volver y seleccionar una foto.' : failure.message);
    }
  }, [stop]);
  useEffect(() => {
    start();
    const visibility = () => { if (document.visibilityState === 'hidden') stop(); else start(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', stop);
    return () => { stop(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', stop); };
  }, [start, stop]);
  async function capture() {
    if (!ready || busy) return;
    setBusy(true); setError('');
    const request = generation.current;
    const capturedAt = new Date().toISOString();
    const locationTicket = onShutter?.(capturedAt);
    try {
      let photo;
      const aspectRatio = video.current.clientHeight > 0 ? video.current.clientWidth / video.current.clientHeight : null;
      const track = stream.current?.getVideoTracks()[0];
      if (typeof window.ImageCapture === 'function' && track) {
        try { photo = await preparePhoto(await new window.ImageCapture(track).takePhoto(), profile, { aspectRatio }); }
        catch { /* Browsers without still-photo support use the full video frame. */ }
      }
      if (!photo) photo = photoFromSource(video.current, video.current.videoWidth, video.current.videoHeight, profile, aspectRatio);
      if (generation.current !== request) return;
      await onCapture(photo, { capturedAt, locationTicket });
      stop();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  return <section className="camera-screen" aria-label="Cámara a pantalla completa" data-no-pull>
    <video ref={video} autoPlay playsInline muted onLoadedData={() => setReady(Boolean(stream.current))} className="camera-view" />
    <div className="camera-topbar">
      <button type="button" onClick={onClose} disabled={busy} className="camera-control" aria-label="Volver al formulario"><X /></button>
      <label className="text-sm">Calidad
        <select aria-label="Calidad de foto" value={profile} onChange={e => setProfile(e.target.value)} className="ml-2 rounded-full bg-black/60 px-3 py-2 text-white">
          <option value="high">Alta · 2560 px</option><option value="balanced">Ahorro · 1600 px</option>
        </select>
      </label>
    </div>
    {error && <div role="alert" className="absolute inset-x-5 top-28 rounded-2xl bg-black/80 p-4 text-center text-sm text-white">{error}</div>}
    <div className="camera-bottom">
      <p className="mb-2 text-center text-xs text-white/80">Se solicita la ubicación GPS al tomar la foto</p>
      <p className="mb-5 text-center text-sm text-white/90">{busy ? 'Procesando foto…' : ready ? 'Encuadrá la foto y tocá el disparador' : 'Preparando cámara…'}</p>
      <div className="flex items-center justify-center gap-8">
        <button type="button" disabled={busy} onClick={start} className="camera-control" aria-label="Reabrir cámara"><RotateCcw /></button>
        <button type="button" onClick={capture} disabled={!ready || busy} aria-label="Tomar foto" className="camera-shutter"><Camera size={30} /></button>
        <span className="size-12" aria-hidden="true" />
      </div>
    </div>
  </section>;
}
