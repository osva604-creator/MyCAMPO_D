import { openDB } from 'idb';

let connection;
const database = () => connection ||= openDB('mycampo-d-offline-v1', 1, {
  upgrade(db) {
    db.createObjectStore('access', { keyPath: 'user_id' });
    db.createObjectStore('cache', { keyPath: 'id' });
    db.createObjectStore('forms', { keyPath: 'id' });
  },
});
const MAX_CACHE_BYTES = 60 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 12;
export const accessSignature = (access) => JSON.stringify({
  role: access.role, member: access.member_id, organization: access.organization_id,
  memberships: access.memberships, teams: access.teams,
});
export async function savedAccess(user) {
  return (await database()).get('access', user);
}
export async function offlineIdentity() {
  try {
    const user = localStorage.getItem('mycampo-d:last-verified-user');
    if (!user) return null;
    const access = await savedAccess(user);
    return access?.status === 'active' ? access.offlineIdentity || null : null;
  } catch { return null; }
}
export async function rememberAccess(access) {
  const db = await database();
  const previous = await db.get('access', access.user_id);
  if (access.status !== 'active' || (previous && accessSignature(previous) !== accessSignature(access))) {
    await clearReadCache(access.user_id);
  }
  if (access.status === 'active') {
    await db.put('access', access);
    try { if (access.offlineIdentity) localStorage.setItem('mycampo-d:last-verified-user', access.user_id); } catch { /* IndexedDB capture still works when localStorage is unavailable. */ }
  }
  else await db.delete('access', access.user_id);
}
export async function clearReadCache(user, { postsOnly = false } = {}) {
  const db = await database();
  const tx = db.transaction('cache', 'readwrite');
  for (const row of await tx.store.getAll()) {
    if ((!user || row.user === user) && (!postsOnly || row.key.startsWith('feed:'))) await tx.store.delete(row.id);
  }
  await tx.done;
  if (!postsOnly && user) await db.delete('access', user);
  if (!postsOnly && user) {
    try { if (localStorage.getItem('mycampo-d:last-verified-user') === user) localStorage.removeItem('mycampo-d:last-verified-user'); } catch { /* No cached identity pointer. */ }
  }
}
export function isConnectionFailure(error) {
  return !navigator.onLine || error?.connection === true || error instanceof TypeError ||
    (!error?.status && !error?.code && /network|fetch|conectar|connection|load failed/i.test(error?.message || ''));
}
async function pack(value, files = new Map()) {
  if (typeof value === 'string' && value.startsWith('blob:')) {
    if (!files.has(value)) files.set(value, (await fetch(value)).blob());
    return { offlineFile: await files.get(value) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(v => pack(v, files)));
  if (value && typeof value === 'object' && !(value instanceof Blob)) {
    const entries = await Promise.all(Object.entries(value).filter(([, v]) => typeof v !== 'function').map(async ([k, v]) => [k, await pack(v, files)]));
    return Object.fromEntries(entries);
  }
  return value;
}
function unpack(value, urls = new Map()) {
  if (value?.offlineFile instanceof Blob) {
    if (!urls.has(value.offlineFile)) urls.set(value.offlineFile, URL.createObjectURL(value.offlineFile));
    return urls.get(value.offlineFile);
  }
  if (Array.isArray(value)) return value.map(v => unpack(v, urls));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unpack(v, urls)]));
  return value;
}
function bytes(value, seen = new Set()) {
  if (value instanceof Blob) {
    if (seen.has(value)) return 0;
    seen.add(value); return value.size;
  }
  if (typeof value === 'string') return value.length * 2;
  if (value && typeof value === 'object') return Object.values(value).reduce((n, v) => n + bytes(v, seen), 0);
  return 8;
}
async function cachePut(user, key, data) {
  const size = bytes(data);
  if (size > MAX_CACHE_BYTES) return;
  const db = await database();
  const tx = db.transaction('cache', 'readwrite');
  const previous = await tx.store.getAll();
  const updated = Math.max(Date.now(), ...previous.map(row => row.updated + 1));
  await tx.store.put({ id: `${user}:${key}`, user, key, data, size, updated });
  const entries = (await tx.store.getAll()).filter(r => r.key.startsWith('feed:')).sort((a, b) => b.updated - a.updated);
  let total = 0;
  for (let i = 0; i < entries.length; i++) {
    total += entries[i].size;
    if (i >= MAX_CACHE_ENTRIES || total > MAX_CACHE_BYTES) await tx.store.delete(entries[i].id);
  }
  await tx.done;
}
export async function offlineResource(user, key, loader, { offline = false } = {}) {
  const restore = async () => {
    const row = await (await database()).get('cache', `${user}:${key}`);
    if (!row) return null;
    const urls = new Map();
    const result = unpack(row.data, urls);
    return { ...result, offline: true, savedAt: row.updated, dispose: () => urls.forEach(url => URL.revokeObjectURL(url)) };
  };
  if (offline || !navigator.onLine) {
    const cached = await restore();
    if (cached) return cached;
    throw new Error('Todavía no hay una copia de esta pantalla en el dispositivo. Tus publicaciones pendientes siguen guardadas.');
  }
  try {
    const result = await loader();
    try { await cachePut(user, key, await pack(result)); } catch { /* A full cache must never block online work or erase pending uploads. */ }
    return result;
  } catch (error) {
    if (isConnectionFailure(error)) {
      const cached = await restore();
      if (cached) return cached;
    }
    throw error;
  }
}
export async function protectStorage() {
  if (!navigator.storage?.persist) return false;
  try { return await navigator.storage.persist(); } catch { return false; }
}
export async function storageStatus(user = null) {
  const [estimate, persistent, cache] = await Promise.all([
    navigator.storage?.estimate?.().catch(() => ({})) || {},
    navigator.storage?.persisted?.().catch(() => false) || false,
    (await database()).getAll('cache'),
  ]);
  return { ...estimate, persistent, cachedBytes: cache.filter(row => !user || row.user === user).reduce((n, r) => n + r.size, 0) };
}
export async function saveLocally(write) {
  try { return await write(); }
  catch (error) {
    if (error.name !== 'QuotaExceededError') throw error;
    await clearReadCache(null, { postsOnly: true });
    try { return await write(); }
    catch { throw new Error('No queda espacio para guardar. Liberá espacio del dispositivo o exportá tus pendientes. La foto y el formulario siguen abiertos.'); }
  }
}
let lastFormPhoto = null;
async function fileDataUrl(blob) {
  const data = new Uint8Array(await blob.arrayBuffer());
  const parts = [];
  for (let offset = 0; offset < data.length; offset += 8192) parts.push(String.fromCharCode(...data.subarray(offset, offset + 8192)));
  return `data:${blob.type};base64,${btoa(parts.join(''))}`;
}
export async function readForm(id) {
  const db = await database();
  const record = await db.get('forms', id);
  if (record?.data.photoStored) {
    const media = await db.get('forms', `${id}:media`);
    if (!(media?.file instanceof Blob)) throw new Error('No se pudo recuperar la foto del borrador.');
    record.data.photo = await fileDataUrl(media.file);
  }
  return record;
}
export async function saveForm(id, data) {
  const db = await database();
  const changed = !lastFormPhoto || lastFormPhoto.id !== id || lastFormPhoto.source !== data.photo;
  let file = null;
  if (changed && data.photo) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(data.photo);
    if (!match) throw new Error('No se pudo conservar la foto del borrador.');
    file = new Blob([Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))], { type: match[1] });
  }
  await saveLocally(async () => {
    const tx = db.transaction('forms', 'readwrite');
    const writes = [tx.done, tx.store.put({ id, data: { ...data, photo: undefined, photoStored: Boolean(data.photo) }, updated: Date.now() })];
    if (changed) writes.push(file ? tx.store.put({ id: `${id}:media`, file }) : tx.store.delete(`${id}:media`));
    await Promise.all(writes);
  });
  lastFormPhoto = { id, source: data.photo };
}
export async function removeForm(id) {
  const db = await database();
  const tx = db.transaction('forms', 'readwrite');
  await Promise.all([tx.done, tx.store.delete(id), tx.store.delete(`${id}:media`)]);
  if (lastFormPhoto?.id === id) lastFormPhoto = null;
}
