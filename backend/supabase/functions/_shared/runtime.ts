import { createClient } from "@supabase/supabase-js";
import { deployment } from "./deployment.ts";

export function runtime() {
  const url = Deno.env.get("SUPABASE_URL");
  const key =
    Deno.env.get("CAMPO_SUPABASE_PUBLISHABLE_KEY") ||
    Deno.env.get("SUPABASE_ANON_KEY");
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const appUrl = Deno.env.get("CAMPO_APP_URL") ?? deployment.appUrl;
  const origins = (Deno.env.get("CAMPO_ALLOWED_ORIGINS") ?? deployment.allowedOrigins)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const valid = (value: string) => {
    try {
      const u = new URL(value);
      return (
        u.origin === value &&
        (u.protocol === "https:" ||
          (u.protocol === "http:" &&
            ["localhost", "127.0.0.1"].includes(u.hostname)))
      );
    } catch {
      return false;
    }
  };
  if (
    !url ||
    !key ||
    !secret ||
    !appUrl ||
    !valid(appUrl) ||
    !origins.length ||
    !origins.every(origin => origin === 'capacitor://localhost' || valid(origin)) ||
    !origins.includes(appUrl)
  )
    return null;
  const boundedFetch: typeof fetch = (input, init) =>
    fetch(input, {
      ...init,
      signal: init?.signal
        ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
  const auth = {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  };
  const privileged = createClient(url, secret, {
    auth,
    global: { fetch: boundedFetch },
  });
  return {
    allowedOrigins: origins,
    redirectBase: appUrl,
    clients: (authorization: string) => ({
      caller: createClient(url, key, {
        auth,
        global: {
          headers: { Authorization: authorization },
          fetch: boundedFetch,
        },
      }),
      privileged,
    }),
  };
}
export const notConfigured = () =>
  new Response(JSON.stringify({ error: "server_not_configured" }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
