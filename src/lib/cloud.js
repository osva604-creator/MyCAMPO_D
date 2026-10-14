import { supabase } from './supabase';
import { asDataUrl } from './media';
import { mergeRemote, readEvents, saveEvent } from './db';

export const cloud = supabase;

export async function getMembers() {
  const { data, error } = await cloud.from('members').select('id, name, handle').eq('active', true);
  if (error) throw error;
  return data;
}

export async function synchronize(scope, actor) {
  const events = await readEvents(scope);
  for (const event of events.filter((item) => !item.synced).sort((a, b) => (a.type === 'post' ? 0 : 1) - (b.type === 'post' ? 0 : 1) || a.createdAt.localeCompare(b.createdAt))) {
    const payload = { ...event.payload };
    if (payload.image?.startsWith('data:')) {
      const path = `${actor.id}/${event.id}.jpg`;
      const blob = await (await fetch(payload.image)).blob();
      const { error } = await cloud.storage.from('evidence').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
      // A response can be lost after a successful upload. Reuse its deterministic path.
      if (error && String(error.statusCode) !== '409' && error.error !== 'Duplicate') throw error;
      payload.image = path;
    }
    const { error } = await cloud.from('events').upsert({ id: event.id, actor_id: actor.id, type: event.type, payload, created_at: event.createdAt }, { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw error;
    await saveEvent(scope, { ...event, synced: true });
  }
  // Paginate: Supabase responses are capped; never silently truncate the field history.
  const remote = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await cloud.from('events').select('*, members!actor_id(name)').order('created_at').order('id').range(offset, offset + 499);
    if (error) throw error;
    for (const row of data) {
      const payload = { ...row.payload };
      if (payload.image && !payload.image.startsWith('data:')) {
        const local = events.find((event) => event.id === row.id);
        if (local?.payload.image?.startsWith('data:')) payload.image = local.payload.image;
        else {
          const { data: blob, error: downloadError } = await cloud.storage.from('evidence').download(payload.image);
          if (downloadError) throw downloadError;
          payload.image = await asDataUrl(blob);
        }
      }
      if (row.type === 'post') payload.author = { name: row.members.name };
      remote.push({ id: row.id, actor: { id: row.actor_id, name: row.members.name }, type: row.type, payload, createdAt: new Date(row.created_at).toISOString(), synced: true });
    }
    if (data.length < 500) break;
  }
  await mergeRemote(scope, remote);
}
