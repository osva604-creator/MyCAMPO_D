import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createEvent, projectEvents } from '../src/lib/events';
import { mergeRemote, readEvents, saveEvent } from '../src/lib/db';

const actor = { id: 'operario-a', name: 'Ana' };
const post = { id: 'post-1', caption: 'Molino detenido @Carlos', createdAt: '2026-10-13T09:00:00.000Z', status: 'Pendiente', comments: [], image: 'data:image/jpeg;base64,a' };

describe('Registros de campo', () => {
  it('conserva fotos y comentarios después de volver a abrir IndexedDB', async () => {
    const event = createEvent('post', post, actor);
    await saveEvent('persistencia', event);
    const restored = await readEvents('persistencia');
    expect(restored[0].payload.image).toBe(post.image);
    expect(projectEvents(restored)[0].caption).toBe(post.caption);
  });
  it('aísla los registros locales y las cuentas del equipo', async () => {
    await saveEvent('usuario-a', createEvent('post', post, actor));
    expect(await readEvents('usuario-b')).toEqual([]);
  });
  it('fusiona reintentos remotos sin duplicar operaciones ni perder fotos locales', async () => {
    const event = createEvent('post', post, actor);
    await saveEvent('fusion', event);
    await mergeRemote('fusion', [{ ...event, payload: { ...post, image: 'remote-path' } }]);
    await mergeRemote('fusion', [event]);
    const events = await readEvents('fusion');
    expect(events).toHaveLength(1);
    expect(events[0].payload.image).toBe(post.image);
    expect(events[0].synced).toBe(false);
  });
  it('preserva comentarios concurrentes y su evidencia aunque lleguen desordenados', () => {
    const first = { ...createEvent('post', post, actor), createdAt: '2026-10-13T10:00:00.000Z' };
    const a = { ...createEvent('comment', { postId: post.id, text: 'Revisando', image: 'data:foto' }, actor), createdAt: '2026-10-13T09:00:00.000Z' };
    const b = createEvent('comment', { postId: post.id, text: 'Llevo repuesto' }, { id: 'b', name: 'Carlos' });
    const result = projectEvents([b, first, a]);
    expect(result[0].comments.map((comment) => comment.text)).toEqual(['Revisando', 'Llevo repuesto']);
    expect(result[0].comments[0].image).toBe('data:foto');
  });
  it('resuelve estados por fecha y registra el historial del responsable', () => {
    const seed = createEvent('post', post, actor);
    const pending = { ...createEvent('status', { postId: post.id, status: 'En Proceso' }, actor), createdAt: '2026-10-14T09:00:00.000Z' };
    const done = { ...createEvent('status', { postId: post.id, status: 'Resuelto' }, actor), createdAt: '2026-10-14T10:00:00.000Z' };
    expect(projectEvents([done, seed, pending])[0].status).toBe('Resuelto');
    expect(projectEvents([done, seed, pending])[0].comments).toHaveLength(2);
  });
  it('Me gusta es idempotente y se puede quitar sin afectar a otro operario', () => {
    const seed = createEvent('post', post, actor);
    const like = { ...createEvent('like', { postId: post.id, liked: true }, actor), createdAt: '2026-10-14T09:00:00.000Z' };
    const unlike = { ...createEvent('like', { postId: post.id, liked: false }, actor), createdAt: '2026-10-14T10:00:00.000Z' };
    expect(projectEvents([seed, like, like])[0].likedBy).toEqual([actor.id]);
    expect(projectEvents([seed, like, unlike])[0].likedBy).toEqual([]);
  });
});
