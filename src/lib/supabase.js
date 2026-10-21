import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  // Private API/media responses are cached only through our bounded,
  // account-scoped offline store, never an uncontrolled HTTP cache.
  global: { fetch: (input,init) => fetch(input,{...init,cache:'no-store'}) },
}) : null;
