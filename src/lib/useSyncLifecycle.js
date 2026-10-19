import { useEffect, useRef } from 'react';
import { onNativeAppState } from './nativeLifecycle';

// Closing/suspending a page may abort the request. Durable drafts, not this
// best-effort flush, are the guarantee; every foreground/reconnect retries them.
export function useSyncLifecycle(synchronize, enabled = true) {
  const latest = useRef(synchronize);
  latest.current = synchronize;
  useEffect(() => {
    if (!enabled) return;
    const run = () => {
      if (navigator.onLine) Promise.resolve(latest.current()).catch(() => {});
    };
    const tick = () => { if (document.visibilityState !== 'hidden') run(); };
    run();
    window.addEventListener('online', run);
    window.addEventListener('focus', run);
    window.addEventListener('pageshow', run);
    window.addEventListener('pagehide', run);
    document.addEventListener('visibilitychange', run);
    const interval = setInterval(tick, 30000);
    const stopNative = onNativeAppState(run);
    return () => {
      stopNative();
      clearInterval(interval);
      window.removeEventListener('online', run);
      window.removeEventListener('focus', run);
      window.removeEventListener('pageshow', run);
      window.removeEventListener('pagehide', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [enabled]);
}
