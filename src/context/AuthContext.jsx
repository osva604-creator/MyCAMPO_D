import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let changed = false;
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (!active) return;
      changed = true;
      setSession(next); setLoading(false);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
    });
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active || changed) return;
      if (error) { setError('No se pudo recuperar la sesión. Ingresá nuevamente.'); setSession(null); }
      else setSession(data.session);
      setLoading(false);
    }).catch(() => {
      if (active && !changed) { setError('No se pudo recuperar la sesión.'); setLoading(false); }
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  async function call(method, ...args) {
    if (!supabase) throw new Error('La autenticación no está configurada en este entorno.');
    const result = await supabase.auth[method](...args);
    if (result.error) throw result.error;
    return result.data;
  }
  const value = { session, user: session?.user ?? null, loading, error, recovery,
    signIn: (email, password) => call('signInWithPassword', { email, password }),
    signOut: () => call('signOut'),
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
