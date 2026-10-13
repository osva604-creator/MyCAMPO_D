import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { readEvents, saveEvent } from '../src/lib/db';
import { createEvent } from '../src/lib/events';

const mocks = vi.hoisted(() => ({ upload: vi.fn(), upsert: vi.fn(), range: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({
  storage: { from: () => ({ upload: mocks.upload }) },
  from: () => ({ upsert: mocks.upsert, select: () => ({ order: () => ({ order: () => ({ range: mocks.range }) }) }) }),
}) }));
let synchronize;
beforeEach(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-key');
  ({ synchronize } = await import('../src/lib/cloud'));
  mocks.upload.mockReset().mockResolvedValue({ error: null });
  mocks.upsert.mockReset().mockResolvedValue({ error: null });
  mocks.range.mockReset().mockResolvedValue({ data: [], error: null });
});

it('sube fotos antes del evento y confirma solo después del servidor', async () => {
  const event = createEvent('post', { id: 'p', image: 'data:image/jpeg;base64,YQ==' }, { id: 'a', name: 'Ana' });
  await saveEvent('upload', event);
  await synchronize('upload', { id: 'a' });
  expect(mocks.upload).toHaveBeenCalledWith(`a/${event.id}.jpg`, expect.any(Blob), { contentType: 'image/jpeg', upsert: false });
  expect(mocks.upsert.mock.calls[0][0].payload.image).toBe(`a/${event.id}.jpg`);
  expect((await readEvents('upload'))[0].synced).toBe(true);
});

it('retiene la cola si se cae la conexión después de subir la foto', async () => {
  const event = createEvent('post', { id: 'p', image: 'data:image/jpeg;base64,YQ==' }, { id: 'a', name: 'Ana' });
  await saveEvent('retry', event);
  mocks.upsert.mockResolvedValueOnce({ error: new Error('Sin conexión') });
  await expect(synchronize('retry', { id: 'a' })).rejects.toThrow('Sin conexión');
  expect((await readEvents('retry'))[0].synced).toBe(false);
  mocks.upload.mockResolvedValueOnce({ error: { statusCode: '409' } });
  await synchronize('retry', { id: 'a' });
  expect((await readEvents('retry'))[0].synced).toBe(true);
});

it('no confirma operaciones cuando Storage rechaza una foto', async () => {
  await saveEvent('reject', createEvent('post', { image: 'data:image/jpeg;base64,YQ==' }, { id: 'a', name: 'Ana' }));
  mocks.upload.mockResolvedValueOnce({ error: new Error('Permiso denegado') });
  await expect(synchronize('reject', { id: 'a' })).rejects.toThrow('Permiso denegado');
  expect((await readEvents('reject'))[0].synced).toBe(false);
  expect(mocks.upsert).not.toHaveBeenCalled();
});
