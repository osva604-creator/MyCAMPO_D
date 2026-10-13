import { openDB } from 'idb';

const database = () => openDB('mycampo-d', 1, {
  upgrade(db) { db.createObjectStore('events', { keyPath: 'key' }); },
});

export async function readEvents(scope) {
  const db = await database();
  return (await db.getAll('events')).filter((event) => event.scope === scope);
}

export async function saveEvent(scope, event) {
  const db = await database();
  await db.put('events', { ...event, key: `${scope}:${event.id}`, scope });
}

export async function mergeRemote(scope, events) {
  const db = await database();
  const tx = db.transaction('events', 'readwrite');
  for (const event of events) {
    const key = `${scope}:${event.id}`;
    if (!(await tx.store.get(key))) await tx.store.put({ ...event, key, scope, synced: true });
  }
  await tx.done;
}
