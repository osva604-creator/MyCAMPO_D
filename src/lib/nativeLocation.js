import { Capacitor, registerPlugin } from '@capacitor/core';

const background = registerPlugin('BackgroundGeolocation');
export const isNative = () => Capacitor.isNativePlatform();
let watcher = null, generation = 0, busy = false;
let state = { active: false, pending: false, fix: null, error: '' };
const listeners = new Set();
const consumers = new Map();
async function releaseConsumer(token) {
  consumers.delete(token);
  if(!consumers.size)await stopBackgroundLocation({notify:false});
}
const emit = (next) => { state = { ...state, ...next }; listeners.forEach(fn => fn(state)); };
export const locationState = () => state;
export const subscribeLocation = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function normalizeFix(coords, timestamp) {
  const { latitude: lat, longitude: lng, accuracy } = coords;
  if (![lat, lng, accuracy, timestamp].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || accuracy < 0 || timestamp <= 0)
    throw new Error('El dispositivo no entregó una ubicación válida.');
  return { lat, lng, accuracy, timestamp: new Date(timestamp).toISOString() };
}

export async function nativePosition(timeout) {
  const { Geolocation } = await import('@capacitor/geolocation');
  const fix = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, maximumAge: 0, timeout });
  return normalizeFix(fix.coords, fix.timestamp);
}

export async function stopBackgroundLocation({notify=true}={}) {
  ++generation;
  const id = watcher||globalThis.localStorage?.getItem('mycampo-d-background-location-watcher');
  const message='La ubicación en segundo plano se detuvo.';
  if(notify)for(const consumer of consumers.values())consumer.onError(message);
  consumers.clear();
  if (id) await background.removeWatcher({ id });
  watcher = null;
  globalThis.localStorage?.removeItem('mycampo-d-background-location-watcher');
  emit({ active: false, pending: false, fix: null, error: '' });
}

export async function startBackgroundLocation({onFix=()=>{},onError=()=>{}}={}) {
  if (!isNative()) throw new Error('Disponible en la aplicación nativa de Android y iPhone.');
  const token=Symbol('location-consumer');
  consumers.set(token,{onFix,onError});
  if(watcher)return ()=>releaseConsumer(token);
  if(busy){consumers.delete(token);throw new Error('La ubicación ya se está iniciando. Esperá un momento y reintentá.');}
  busy = true;
  const version = ++generation;
  emit({ pending: true, error: '' });
  let failed = false;
  try {
    const previous=globalThis.localStorage?.getItem('mycampo-d-background-location-watcher');
    if(previous)await background.removeWatcher({id:previous});
    if (version !== generation) {consumers.delete(token);return;}
    if (Capacitor.getPlatform() === 'android') {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const permission = await LocalNotifications.requestPermissions();
      if (permission.display !== 'granted') throw new Error('Permití las notificaciones para mostrar que el GPS está activo.');
    }
    if (version !== generation) {consumers.delete(token);return;}
    const id = await background.addWatcher({
      backgroundTitle: 'MyCAMPO_D · GPS activo',
      backgroundMessage: 'Ubicación activa. Detené la medición desde Mapa.',
      requestPermissions: true, stale: false, distanceFilter: 0,
    }, (fix, error) => {
      if (version !== generation) return;
      if (error) {
        const message = error.code === 'NOT_AUTHORIZED' ? 'Habilitá el permiso de ubicación en los ajustes del dispositivo.' : 'No se recibe ubicación. Revisá el GPS y los permisos del dispositivo.';
        for(const consumer of consumers.values())consumer.onError(message);
        emit({ error: message, fix: null });
        if (error.code === 'NOT_AUTHORIZED') {
          failed = true;
          if (watcher) void stopBackgroundLocation({notify:false}).then(() => emit({ error: message })).catch(() => emit({ error: message }));
        }
        return;
      }
      try {
        const normalized=normalizeFix(fix, fix.time);
        emit({ fix: normalized, active: true, error: '' });
        for(const consumer of consumers.values())consumer.onFix(normalized);
      } catch (failure) { emit({ error: failure.message });for(const consumer of consumers.values())consumer.onError(failure.message); }
    });
    if (version !== generation || failed) { await background.removeWatcher({ id });consumers.delete(token);return; }
    watcher = id;
    globalThis.localStorage?.setItem('mycampo-d-background-location-watcher',id);
    emit({ active: true });
    return ()=>releaseConsumer(token);
  } catch (error) { consumers.delete(token);emit({ error: error.message }); throw error; }
  finally { busy = false; emit({ pending: false }); }
}

export const openLocationSettings = () => background.openSettings();
