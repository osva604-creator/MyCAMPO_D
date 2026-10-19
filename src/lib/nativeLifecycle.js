import { isNative } from './nativeLocation';

export function onNativeAppState(callback) {
  if (!isNative()) return () => {};
  let disposed = false, handle;
  import('@capacitor/app').then(({ App }) => App.addListener('appStateChange', callback))
    .then(listener => { if (disposed) void listener.remove(); else handle = listener; })
    .catch(() => {});
  return () => { disposed = true; if (handle) void handle.remove(); };
}
