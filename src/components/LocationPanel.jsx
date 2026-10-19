import { useEffect, useState } from 'react';
import { isNative, locationState, subscribeLocation, startBackgroundLocation, stopBackgroundLocation, openLocationSettings } from '../lib/nativeLocation';

export default function LocationPanel() {
  const [state, setState] = useState(locationState);
  const [error, setError] = useState('');
  useEffect(() => subscribeLocation(setState), []);
  const native = isNative();
  async function toggle() {
    setError('');
    try { await (state.active || state.pending ? stopBackgroundLocation() : startBackgroundLocation()); }
    catch (failure) { setError(failure.message); }
  }
  return <section className="panel mt-5" aria-label="Ubicación de campo">
    <h2 className="text-lg font-bold">Ubicación de campo</h2>
    <p className="mt-2 text-sm text-stone-600">Activá el GPS mientras trabajás, incluso con la pantalla bloqueada y sin internet. Consume batería. Conservamos únicamente la última posición en memoria; cada foto solicita una posición nueva.</p>
    {!native && <p className="mt-3 text-sm text-stone-600">El segundo plano requiere la aplicación nativa de Android o iPhone. En el navegador, el GPS funciona con la app visible.</p>}
    <button disabled={!native || state.pending} onClick={toggle} className="btn-secondary mt-4">{state.pending ? 'Solicitando permisos…' : state.active ? 'Desactivar GPS en segundo plano' : 'Activar GPS en segundo plano'}</button>
    <p className="mt-2 text-sm" role="status">{state.active ? 'GPS activado' : 'GPS desactivado'}{state.fix && ` · Última posición: ${new Date(state.fix.timestamp).toLocaleTimeString()} · ±${Math.round(state.fix.accuracy)} m`}</p>
    {(error || state.error) && <p role="alert" className="mt-2 text-sm text-red-700">{error || state.error}</p>}
    {native && <button className="mt-2 min-h-11 text-sm underline" onClick={() => openLocationSettings().catch(failure => setError(failure.message))}>Abrir ajustes de ubicación</button>}
    <p className="mt-2 text-xs text-stone-500">El sistema puede interrumpir el GPS si forzás el cierre o restringís la batería. Al abrir de nuevo la app, activalo para comenzar otra jornada.</p>
    <div className="mt-5 border-t pt-4"><button className="btn-secondary" disabled>Seguimiento · Próximamente</button><p className="mt-2 text-sm text-stone-500">Reservado para futuras recorridas. No se registra un historial de movimientos.</p></div>
  </section>;
}
