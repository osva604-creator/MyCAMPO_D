import { Capacitor, registerPlugin } from '@capacitor/core';

const background = registerPlugin('BackgroundGeolocation');
export const isNative = () => Capacitor.isNativePlatform();
let watcher = null, generation = 0, busy = false;
let state = { active: false, pending: false, fix: null, error: '' };
const listeners = new Set();
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

export async function stopBackgroundLocation() {
  ++generation;
  const id = watcher;
  if (id) await background.removeWatcher({ id });
  watcher = null;
  emit({ active: false, pending: false, fix: null, error: '' });
}

export async function startBackgroundLocation() {
  if (!isNative()) throw new Error('Disponible en la aplicación nativa de Android y iPhone.');
  if (watcher || busy) return;
  busy = true;
  const version = ++generation;
  emit({ pending: true, error: '' });
  let failed = false;
  try {
    if (Capacitor.getPlatform() === 'android') {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const permission = await LocalNotifications.requestPermissions();
      if (permission.display !== 'granted') throw new Error('Permití las notificaciones para mostrar que el GPS está activo.');
    }
    if (version !== generation) return;
    const id = await background.addWatcher({
      backgroundTitle: 'MyCAMPO_D · GPS activo',
      backgroundMessage: 'Ubicación de campo activa. Abrí Tu cuenta para desactivarla.',
      requestPermissions: true, stale: false, distanceFilter: 10,
    }, (fix, error) => {
      if (version !== generation) return;
      if (error) {
        const message = error.code === 'NOT_AUTHORIZED' ? 'Habilitá el permiso de ubicación en los ajustes del dispositivo.' : 'No se recibe ubicación. Revisá el GPS y los permisos del dispositivo.';
        emit({ error: message, fix: null });
        if (error.code === 'NOT_AUTHORIZED') {
          failed = true;
          if (watcher) void stopBackgroundLocation().then(() => emit({ error: message })).catch(() => emit({ error: message }));
        }
        return;
      }
      try { emit({ fix: normalizeFix(fix, fix.time), active: true, error: '' }); }
      catch (failure) { emit({ error: failure.message }); }
    });
    if (version !== generation || failed) { await background.removeWatcher({ id }); return; }
    watcher = id;
    emit({ active: true });
  } catch (error) { emit({ error: error.message }); throw error; }
  finally { busy = false; emit({ pending: false }); }
}

export const openLocationSettings = () => background.openSettings();
