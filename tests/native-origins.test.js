import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({})) }));
import { runtime } from '../backend/supabase/functions/_shared/runtime';
import { createHandler } from '../backend/supabase/functions/_shared/platform';
afterEach(() => vi.unstubAllGlobals());
function environment(extra = {}) {
  const values = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'server-only', ...extra };
  vi.stubGlobal('Deno', { env: { get: key => values[key] } });
}
it('allows the exact Android and iOS origins without allowing arbitrary native origins', async () => {
  environment(); const config = runtime(); expect(config).not.toBeNull();
  const handler = createHandler(config);
  for (const origin of ['https://localhost', 'capacitor://localhost']) {
    const response = await handler(new Request('https://example.test', { method: 'OPTIONS', headers: { origin } }));
    expect(response.status).toBe(204); expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  }
  for (const origin of ['capacitor://evil', 'https://localhost.evil.test', 'null']) {
    const response = await handler(new Request('https://example.test', { method: 'OPTIONS', headers: { origin } }));
    expect(response.status).toBe(403);
  }
});
it('retains HTTPS public redirects and rejects arbitrary custom schemes in configured origins', () => {
  environment({ CAMPO_APP_URL: 'capacitor://localhost' }); expect(runtime()).toBeNull();
  environment({ CAMPO_ALLOWED_ORIGINS: 'https://mycampo-d.conteolab.workers.dev,capacitor://evil' }); expect(runtime()).toBeNull();
});
