import { useEffect, useRef, useState } from "react";
import { Camera, MapPin, X } from "lucide-react";
import { asDataUrl, locate, preparePhoto } from "../lib/media";
import CameraCapture from './CameraCapture';
import { readForm, saveForm, removeForm } from '../lib/offlineStore';
import { mapsUrl, validCoordinates } from "../lib/location";

export default function CreatePost({
  onClose,
  onPublish,
  members,
  actor,
  teams = [],
  requirePhoto = true,
  allowAttachments = false,
  draftKey = null,
}) {
  const dialog = useRef(null),
    alive = useRef(true);
  const [camera, setCamera] = useState(false),
    [photo, setPhoto] = useState("");
  const [gps, setGps] = useState(null),
    [gpsBusy, setGpsBusy] = useState(false);
  const [latitude, setLatitude] = useState(""),
    [longitude, setLongitude] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const manualLocation = useRef(false);
  const gpsRequest = useRef(0);
  const [cameraPhoto, setCameraPhoto] = useState(false), [locationState, setLocationState] = useState('idle'),
    [withoutGps, setWithoutGps] = useState(false);
  const hasCoordinates = latitude.trim() !== "" || longitude.trim() !== "";
  const selectedGps =
    latitude.trim() !== "" && longitude.trim() !== ""
      ? {
          lat: Number(latitude),
          lng: Number(longitude),
          accuracy: manualLocation.current ? null : (gps?.accuracy ?? null),
          source: manualLocation.current ? "manual" : "device",
          ...(manualLocation.current || !gps?.timestamp ? {} : { timestamp: gps.timestamp }),
        }
      : null;
  const previewMap = mapsUrl(selectedGps);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [gpsNotice, setGpsNotice] = useState("");
  const [caption, setCaption] = useState(""),
    [capturedAt, setCapturedAt] = useState(null);
  const [mentionIds, setMentionIds] = useState([]),
    [teamId, setTeamId] = useState(teams.length === 1 ? teams[0].id : ""),
    [fileName, setFileName] = useState("");
  const [profile, setProfile] = useState('high');
  const [lot, setLot] = useState(''), [suggestion, setSuggestion] = useState(''), [category, setCategory] = useState('Infraestructura');
  const [postId, setPostId] = useState(() => crypto.randomUUID());
  const [formReady, setFormReady] = useState(!draftKey), [saved, setSaved] = useState(false), [restored, setRestored] = useState(false);
  const saveChain = useRef(Promise.resolve()), saveVersion = useRef(0);
  async function closeForm() {
    if (busy) return;
    if (camera) { setCamera(false); return; }
    try { await saveChain.current; onClose(); }
    catch { setError('No se pudo conservar el borrador. No cierres esta pantalla hasta guardar o liberar espacio.'); }
  }
  async function getGps(replaceManual = false) {
    const request = ++gpsRequest.current;
    setGpsBusy(true);
    setGpsNotice("");
    try {
      const result = await locate();
      if (alive.current && request === gpsRequest.current && (replaceManual || !manualLocation.current)) {
        manualLocation.current = false;
        setGps(result);
        setLatitude(String(result.lat));
        setLongitude(String(result.lng));
        setConfirmed(false);
        setLocationState('manual'); setWithoutGps(false);
      }
    } catch (failure) {
      if (alive.current && request === gpsRequest.current) { setGpsNotice(failure.message); setLocationState('failed'); }
    } finally {
      if (alive.current && request === gpsRequest.current) setGpsBusy(false);
    }
  }
  function editCoordinate(setValue, value) {
    gpsRequest.current++; setGpsBusy(false); manualLocation.current = true;
    setValue(value); setConfirmed(false); setWithoutGps(false); setLocationState('manual'); setGpsNotice('');
  }
  function omitGps() {
    gpsRequest.current++; setGpsBusy(false); manualLocation.current = true;
    setLatitude(''); setLongitude(''); setGps(null); setConfirmed(false);
    setWithoutGps(true); setLocationState('omitted');
    setGpsNotice('Esta publicación se guardará sin coordenadas. Indicá el lote para identificar el lugar.');
  }
  useEffect(() => {
    alive.current = true;
    dialog.current.showModal();
    const restore = async () => {
      try {
        const previous = draftKey ? await readForm(draftKey) : null;
        if (!alive.current) return;
        if (previous?.data) {
          const d = previous.data;
          setPostId(d.postId || crypto.randomUUID()); setCaption(d.caption || ''); setPhoto(d.photo || '');
          setLot(d.lot || ''); setSuggestion(d.suggestion || ''); setCategory(d.category || 'Infraestructura');
          setLatitude(d.latitude || ''); setLongitude(d.longitude || ''); setConfirmed(Boolean(d.confirmed));
          setGps(d.gps || null); setMentionIds(d.mentionIds || []); setTeamId(d.teamId || (teams.length === 1 ? teams[0].id : ''));
          setCapturedAt(d.capturedAt || null); setFileName(d.fileName || ''); setProfile(d.profile || 'high');
          manualLocation.current = d.manualLocation ?? !d.gps;
          setCameraPhoto(Boolean(d.cameraPhoto)); setWithoutGps(Boolean(d.withoutGps));
          setLocationState(d.locationState === 'pending' ? 'failed' : d.locationState || 'idle');
          if (d.locationState === 'pending') setGpsNotice('La foto se recuperó, pero el GPS no había terminado. Reintentá o indicá el lugar manualmente.');
          setRestored(true);
        } else getGps();
      } catch { if (alive.current) setError('No se pudo recuperar el borrador del dispositivo.'); }
      finally { if (alive.current) setFormReady(true); }
    };
    restore();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { alive.current = false; gpsRequest.current++; document.body.style.overflow = previousOverflow; };
  }, []);
  useEffect(() => {
    if (!draftKey || !formReady) return;
    if (!(photo || caption || lot || suggestion)) {
      saveChain.current = saveChain.current.catch(() => {}).then(() => removeForm(draftKey));
      saveChain.current.catch(failure => { if (alive.current) setError(failure.message); });
      return;
    }
    const version = ++saveVersion.current;
    setSaved(false);
    const data = { postId, photo, caption, lot, suggestion, category, latitude, longitude, confirmed, gps, mentionIds, teamId, capturedAt, fileName, profile,
      manualLocation: manualLocation.current, cameraPhoto, locationState, withoutGps };
    saveChain.current = saveChain.current.catch(() => {}).then(() => saveForm(draftKey, data));
    saveChain.current.then(() => {
      if (alive.current && version === saveVersion.current) setSaved(true);
    }).catch(failure => { if (alive.current) setError(failure.message); });
  }, [draftKey, formReady, postId, photo, caption, lot, suggestion, category, latitude, longitude, confirmed, gps, mentionIds, teamId, capturedAt, fileName, profile, cameraPhoto, locationState, withoutGps]);
  function locateAtShutter() {
    const request = ++gpsRequest.current;
    setGpsBusy(false);
    return { request, result: locate({ timeout: 30000 }).then(value => ({ value }), error => ({ error })) };
  }
  async function captured(image, { capturedAt: takenAt, locationTicket } = {}) {
    const ticket = locationTicket || locateAtShutter();
    setPhoto(image); setCapturedAt(takenAt || new Date().toISOString()); setConfirmed(false); setFileName('');
    setCameraPhoto(true); setWithoutGps(false); setLocationState('pending'); setGpsNotice('');
    setLatitude(''); setLongitude(''); setGps(null); manualLocation.current = false; setGpsBusy(true);
    ticket.result.then(({ value, error }) => {
      if (!alive.current || ticket.request !== gpsRequest.current) return;
      setGpsBusy(false);
      if (error) { setLocationState('failed'); setGpsNotice(error.message); return; }
      setGps(value); setLatitude(String(value.lat)); setLongitude(String(value.lng));
      setConfirmed(true); setLocationState('captured');
    });
    setCamera(false);
    requestAnimationFrame(() => { if (dialog.current) dialog.current.scrollTop = 0; });
  }
  async function selectPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const image = await preparePhoto(file, profile);
      if (alive.current) {
        gpsRequest.current++; setGpsBusy(false); setCameraPhoto(false); setLocationState('manual'); setWithoutGps(false);
        setPhoto(image);
        setFileName("");
        setCapturedAt(new Date().toISOString());
        setConfirmed(false);
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function selectAttachment(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (file.type !== "application/pdf" || file.size > 10485760)
        throw new Error("Seleccioná un PDF de hasta 10 MB.");
      setPhoto(await asDataUrl(file));
      gpsRequest.current++; setGpsBusy(false); setCameraPhoto(false); setLocationState('manual'); setWithoutGps(false);
      setFileName(file.name);
      setCapturedAt(new Date().toISOString());
      setConfirmed(false);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function publish(event) {
    event.preventDefault();
    setError("");
    if (gpsBusy) { setError('Esperá a que termine la búsqueda de ubicación. La foto ya está guardada en el dispositivo.'); return; }
    if ((requirePhoto && !photo) || !caption.trim()) {
      setError(
        requirePhoto
          ? "Agregá una foto y una descripción."
          : "Agregá una descripción.",
      );
      return;
    }
    if (teams.length && !teamId) {
      setError("Seleccioná el equipo de origen.");
      return;
    }
    const data = new FormData(event.currentTarget);
    if (cameraPhoto && !hasCoordinates && !withoutGps) {
      setError('Esta foto todavía no tiene coordenadas. Reintentá el GPS, indicá las coordenadas o elegí guardar sin GPS con un lote.');
      return;
    }
    if (hasCoordinates && !validCoordinates(selectedGps)) {
      setError(
        "Ingresá latitud entre -90 y 90 y longitud entre -180 y 180. Completá ambos campos.",
      );
      return;
    }
    if (hasCoordinates && !confirmed) {
      setError(
        "Confirmá que las coordenadas corresponden al lugar de la foto.",
      );
      return;
    }
    if (!hasCoordinates && !data.get("lot").trim()) {
      setError("Indicá el lote o solicitá la ubicación GPS.");
      return;
    }
    const locationGps = hasCoordinates ? selectedGps : null;
    setBusy(true);
    try {
      await saveChain.current.catch(() => {});
      await onPublish({
        id: postId,
        author: { name: actor.name },
        image: photo,
        imageAlt: caption.trim(),
        caption: caption.trim(),
        suggestion: data.get("suggestion").trim(),
        location:
          data.get("lot").trim() ||
          `${locationGps.lat.toFixed(6)}, ${locationGps.lng.toFixed(6)}`,
        gps: locationGps,
        category: data.get("category"),
        status: "Pendiente",
        createdAt: new Date().toISOString(),
        capturedAt,
        likes: 0,
        comments: [],
        mentionIds,
        teamId,
      });
      if (draftKey) await removeForm(draftKey);
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) closeForm();
      }}
      aria-labelledby="create-title"
      className={camera ? "camera-dialog" : "capture-return fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%-1rem)] max-w-lg overflow-y-auto rounded-3xl bg-white p-5 shadow-xl backdrop:bg-stone-950/50"}
    >
      {camera && <CameraCapture onCapture={captured} onShutter={locateAtShutter} onClose={() => setCamera(false)} profile={profile} setProfile={setProfile} />}
      <form hidden={camera} onSubmit={publish} className="space-y-4">
        <fieldset disabled={!formReady || busy} className="space-y-4 min-w-0">
        <div className="flex items-center justify-between">
          <h2 id="create-title" className="text-xl font-bold">
            Nueva incidencia
          </h2>
          <button
            type="button"
            disabled={busy}
            aria-label="Cerrar"
            onClick={closeForm}
            className="grid size-11 place-items-center"
          >
            <X />
          </button>
        </div>
        {photo &&
          (photo.startsWith("data:application/pdf") ? (
            <p className="rounded-xl bg-green-50 p-3 text-sm">
              PDF adjunto: {fileName}
            </p>
          ) : (
            <img
              src={photo}
              alt="Vista previa de la incidencia"
              className="max-h-64 w-full rounded-xl object-contain"
            />
          ))}
        {allowAttachments && (
          <label className="block text-sm text-green-800">
            Adjuntar PDF
            <input
              type="file"
              accept="application/pdf"
              disabled={busy}
              onChange={selectAttachment}
              className="mt-2 block w-full text-xs"
            />
          </label>
        )}
        {photo && allowAttachments && (
          <button
            type="button"
            className="min-h-11 text-sm text-stone-500"
            onClick={() => {
              setPhoto("");
              setFileName("");
            }}
          >
            Quitar adjunto
          </button>
        )}
        {teams.length > 0 && (
          <label className="form-label">
            Equipo de origen
            <select
              required
              value={teamId}
              onChange={(e) => setTeamId(e.target.value)}
              className="form-input"
            >
              <option value="">Seleccionar equipo</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy || camera}
            onClick={() => { document.activeElement?.blur(); setError(""); setCamera(true); }}
            className="flex min-h-11 items-center gap-2 rounded-full border px-4"
          >
            <Camera size={18} />
            Cámara
          </button>
          <label className="flex min-h-11 cursor-pointer items-center rounded-full border px-4">
            Seleccionar foto
            <input
              type="file"
              accept="image/*"
              onChange={selectPhoto}
              disabled={busy}
              className="sr-only"
            />
          </label>
        </div>
        <label className="block text-sm font-semibold">
          Problema detectado
          <textarea
            autoFocus
            required
            maxLength={2000}
            value={caption}
            onChange={(event) => setCaption(event.target.value)}
            rows={3}
            placeholder="Describe el problema y menciona a @responsable"
            className="mt-1 w-full rounded-xl border p-3 font-normal"
          />
        </label>
        {members.length > 0 && (
          <label className="block text-sm">
            Mencionar responsable
            <select
              value=""
              onChange={(event) => {
                const member = members.find((m) => m.id === event.target.value);
                if (member) {
                  setMentionIds((ids) =>
                    ids.includes(member.id) ? ids : [...ids, member.id],
                  );
                  setCaption(
                    (value) =>
                      `${value} @${member.handle || member.name.replace(/\s+/g, "_")} `,
                  );
                }
              }}
              className="ml-2 rounded-lg border p-2"
            >
              <option value="" disabled>
                Seleccionar…
              </option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {mentionIds.length > 0 && (
          <div
            aria-label="Personas mencionadas"
            className="flex flex-wrap gap-2"
          >
            {mentionIds.map((id) => (
              <button
                type="button"
                key={id}
                onClick={() =>
                  setMentionIds((ids) => ids.filter((value) => value !== id))
                }
                className="min-h-11 rounded-full bg-green-50 px-3 text-xs text-green-800"
              >
                {members.find((m) => m.id === id)?.name} ×
              </button>
            ))}
          </div>
        )}
        {members.length > 0 && allowAttachments && (
          <p className="text-xs leading-5 text-stone-500">
            Para vincular una mención, seleccioná a la persona. Escribir @nombre
            sin seleccionarla no le da acceso a la publicación.
          </p>
        )}
        <label className="block text-sm">
          Solución sugerida
          <textarea
            name="suggestion"
            value={suggestion}
            onChange={e => setSuggestion(e.target.value)}
            maxLength={1000}
            rows={2}
            className="mt-1 w-full rounded-xl border p-3"
          />
        </label>
        <label className="block text-sm">
          Lote o ubicación
          <input
            name="lot"
            value={lot}
            onChange={e => setLot(e.target.value)}
            maxLength={120}
            placeholder="Ej.: Potrero 7"
            className="mt-1 w-full rounded-xl border p-3"
          />
        </label>
        <fieldset className="space-y-3 rounded-2xl border border-stone-200 p-3">
          <legend className="px-1 text-sm font-semibold">
            Ubicación de la foto
          </legend>
          <p className="text-xs leading-5 text-stone-500">
            {cameraPhoto ? 'La cámara solicita una ubicación nueva al tomar cada foto. Funciona sin internet si el dispositivo puede obtener GPS.' :
              'El GPS indica dónde estás ahora. Si elegís una foto de la galería, verificá o corregí el lugar donde fue tomada.'}
          </p>
          {locationState === 'captured' && <p role="status" className="text-sm font-semibold text-green-800">
            Ubicación capturada con la foto{Number.isFinite(gps?.accuracy) ? ` · precisión aproximada ±${Math.round(gps.accuracy)} m` : ''}
          </p>}
          {cameraPhoto && gpsBusy && <p role="status" className="text-sm text-amber-800">Foto guardada. Buscando coordenadas GPS… Podés completar la descripción mientras espera.</p>}
          <button
            type="button"
            disabled={gpsBusy || busy}
            onClick={() => getGps(true)}
            className="flex min-h-11 items-center gap-2 text-sm text-green-800"
          >
            <MapPin size={18} aria-hidden="true" />
            {gpsBusy ? "Buscando GPS…" : "Usar mi ubicación actual"}
          </button>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              Latitud
              <input
                type="number"
                step="any"
                min="-90"
                max="90"
                value={latitude}
                onChange={(event) => editCoordinate(setLatitude, event.target.value)}
                placeholder="-34.610000"
                className="mt-1 w-full min-w-0 rounded-xl border p-2"
              />
            </label>
            <label className="text-sm">
              Longitud
              <input
                type="number"
                step="any"
                min="-180"
                max="180"
                value={longitude}
                onChange={(event) => editCoordinate(setLongitude, event.target.value)}
                placeholder="-60.920000"
                className="mt-1 w-full min-w-0 rounded-xl border p-2"
              />
            </label>
          </div>
          {previewMap && (
            <a
              href={previewMap}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-green-800"
            >
              Verificar punto en Google Maps ↗
            </a>
          )}
          {hasCoordinates && (
            <>
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                Confirmo que este es el lugar de la foto
              </label>
            </>
          )}
          {(hasCoordinates || (cameraPhoto && !withoutGps)) && <button type="button" onClick={omitGps} className="min-h-11 text-xs text-stone-500">
            Guardar solo el lote, sin GPS
          </button>}
        </fieldset>
        <p role="status" className="text-xs text-amber-800">
          {gpsNotice}
        </p>
        <label className="block text-sm">
          Categoría
          <select name="category" value={category} onChange={e => setCategory(e.target.value)} className="mt-1 w-full rounded-xl border p-3">
            {[
              "Infraestructura",
              "Agua y hacienda",
              "Sanidad vegetal",
              "Tarea",
              "Otra",
            ].map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        {draftKey && <p role="status" className="text-xs text-stone-500">{!formReady ? 'Recuperando borrador…' : saved ? (restored ? 'Borrador recuperado y guardado en este dispositivo' : 'Borrador guardado en este dispositivo') : (photo || caption) ? 'Guardando borrador…' : 'Tu captura se guarda mientras completás el formulario.'}</p>}
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
        <button
          disabled={busy || gpsBusy || (requirePhoto && !photo) || !caption.trim()}
          className="min-h-11 w-full rounded-full bg-green-800 px-5 text-white disabled:opacity-50"
        >
          {busy ? "Guardando…" : gpsBusy && cameraPhoto ? 'Esperando coordenadas…' : "Guardar incidencia"}
        </button>
        </fieldset>
      </form>
    </dialog>
  );
}
