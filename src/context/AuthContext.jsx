import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { stopBackgroundLocation } from '../lib/nativeLocation';
import { onNativeAppState } from '../lib/nativeLifecycle';
import { clearReadCache, offlineIdentity, isConnectionFailure } from '../lib/offlineStore';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [offlineUser, setOfflineUser] = useState(null);
  const identity = useRef(null);
  identity.current = session?.user?.id || offlineUser?.id;
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let changed = 0;
    const restoreOffline = async (version) => {
      const cached = await offlineIdentity();
      if (active && changed === version) { setOfflineUser(cached); setSession(null); setLoading(false); }
    };
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      if (identity.current && next?.user?.id && identity.current !== next.user.id) void stopBackgroundLocation().catch(() => {});
      const version = ++changed;
      if (!next && event !== 'SIGNED_OUT' && !navigator.onLine) {
        void restoreOffline(version);
      } else {
        setSession(next); setOfflineUser(null); setLoading(false);
      }
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') {
        void stopBackgroundLocation().catch(() => {});
        setRecovery(false);
        if (identity.current) void clearReadCache(identity.current).catch(() => {});
      }
    });
    const recover = async () => {
      const version = changed;
      if (!navigator.onLine) return restoreOffline(version);
      try {
        const result = await supabase.auth.getSession();
        if (!active || changed !== version) return;
        if (result.error) throw result.error;
        setSession(result.data.session); setOfflineUser(null); setError(''); setLoading(false);
      } catch (failure) {
        if (!active || changed !== version) return;
        if (isConnectionFailure(failure) || failure.name === 'AuthRetryableFetchError') return restoreOffline(version);
        setError('No se pudo recuperar la sesión. Ingresá nuevamente.'); setSession(null); setOfflineUser(null); setLoading(false);
      }
    };
    recover();
    const visible = () => { if (document.visibilityState === 'visible') recover(); };
    window.addEventListener('online', recover);
    window.addEventListener('pageshow', recover);
    document.addEventListener('visibilitychange', visible);
    const stopNative = onNativeAppState(({ isActive }) => { if (isActive) void recover(); });
    return () => {
      stopNative();
      active = false; data.subscription.unsubscribe();
      window.removeEventListener('online', recover); window.removeEventListener('pageshow', recover);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  async function call(method, ...args) {
    if (!supabase) throw new Error('La autenticación no está configurada en este entorno.');
    const result = await supabase.auth[method](...args);
    if (result.error) throw result.error;
    return result.data;
  }
  const value = { session, user: session?.user ?? offlineUser, offlineSession: Boolean(offlineUser && !session), loading, error, recovery,
    signIn: (email, password) => call('signInWithPassword', { email, password }),
    signOut: async () => {
      const user = session?.user?.id || offlineUser?.id;
      await call('signOut');
      await stopBackgroundLocation();
      if (user) await clearReadCache(user).catch(() => {});
    },
    forgotPassword: (email) => call('resetPasswordForEmail', email, { redirectTo: `${window.location.origin}/reset-password` }),
    resetPassword: async (password) => { await call('updateUser', { password }); setRecovery(false); },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth requiere AuthProvider');
  return value;
}
