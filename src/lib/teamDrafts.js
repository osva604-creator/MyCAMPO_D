import { openDB } from "idb";
import { contentOperation, executeContent } from "./teamApi";
import { readEvents } from "./db";
import { asDataUrl } from './media';
import { saveLocally } from './offlineStore';

const database = () =>
  openDB("mycampo-d-team-v2", 1, {
    upgrade(db) {
      db.createObjectStore("drafts", { keyPath: "id" });
    },
  });
export const revision = (access) =>
  `${access.user_id}:${access.organization_id}:${access.member_id || access.role}`;
let lastCreatedAt = 0;
export async function drafts(user, org) {
  const db = await database();
  return (await db.getAll("drafts"))
    .filter((d) => d.user_id === user && (!org || d.organization_id === org))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}
export async function draftPreviews(user, org) {
  const urls = [];
  const records = (await drafts(user, org)).map(draft => {
    const media = draft.operation.media;
    const mediaUrl = media instanceof Blob ? URL.createObjectURL(media) : media;
    if (media instanceof Blob) urls.push(mediaUrl);
    return { ...draft, mediaUrl };
  });
  records.dispose = () => urls.forEach(url => URL.revokeObjectURL(url));
  return records;
}
export async function saveDraft(access, post, org, team) {
  return saveContentDraft(
    access,
    "post.create",
    {
      organization_id: org,
      team_id: team,
      body: post.caption,
      location: post.location,
      latitude: post.gps?.lat ?? null,
      longitude: post.gps?.lng ?? null,
      gps_accuracy: Number.isFinite(post.gps?.accuracy)
        ? post.gps.accuracy
        : null,
      gps_source: post.gps?.source || null,
      suggestion: post.suggestion,
      category: post.category,
      captured_at: post.capturedAt,
      mention_ids: post.mentionIds || [],
    },
    post.image || null,
    org,
    post.caption,
    post.id,
  );
}
export async function saveContentDraft(
  access,
  action,
  payload,
  media,
  org,
  title,
  operationId = null,
) {
  const operation = contentOperation(action, payload, media);
  if (operationId) {
    operation.operation_id = operationId;
    if (operation.payload.attachment) operation.payload.attachment.id = operationId;
  }
  const record = {
    id: operation.operation_id,
    user_id: access.user_id,
    organization_id: org,
    revision: revision({ ...access, organization_id: org }),
    operation,
    created_at: new Date(lastCreatedAt = Math.max(Date.now(), lastCreatedAt + 1)).toISOString(),
    title,
  };
  const db = await database();
  await saveLocally(() => db.put("drafts", record));
  window.dispatchEvent(new Event("mycampo-d:drafts"));
  return record;
}
export async function removeDraft(id) {
  const db = await database();
  await db.delete("drafts", id);
  window.dispatchEvent(new Event("mycampo-d:drafts"));
}
const syncing = new Map();
export function syncDrafts(access, org, options = null) {
  const key = `${access.user_id}:${org}`;
  if (syncing.has(key)) return syncing.get(key);
  const run = async () => {
   try {
    const pending = await drafts(access.user_id, org);
    pending.sort(
      (a, b) =>
        (a.operation.action === "post.create" ? 0 : 1) -
          (b.operation.action === "post.create" ? 0 : 1) ||
        a.created_at.localeCompare(b.created_at),
    );
    const errors = [];
    for (const draft of pending) {
      if (options?.isCurrent && !options.isCurrent()) break;
      if (draft.revision !== revision({ ...access, organization_id: org }))
        continue;
      try {
        const execute = () => options ? executeContent(draft.operation, options) : executeContent(draft.operation);
        if (navigator.locks?.request) {
          await navigator.locks.request(`mycampo-d:upload:${draft.id}`, async () => {
            if (!(await (await database()).get('drafts', draft.id))) return;
            await execute();
            await removeDraft(draft.id);
          });
        } else {
          await execute();
          await removeDraft(draft.id);
        }
      } catch (error) {
        errors.push(error.message);
        if (!navigator.onLine) break;
      }
    }
    if (errors.length) throw new Error([...new Set(errors)].join(' '));
  } finally {
    syncing.delete(key);
  }
  };
  const promise = run();
  syncing.set(key, promise);
  return promise;
}
async function exportable(value) {
  if (value instanceof Blob) return asDataUrl(value);
  if (Array.isArray(value)) return Promise.all(value.map(exportable));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).filter(([k, v]) => k !== 'mediaUrl' && typeof v !== 'function').map(async ([k, v]) => [k, await exportable(v)])));
  return value;
}
export async function downloadJson(name, value) {
  const data = await exportable(value);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function exportLegacy(userId) {
  const events = await readEvents(userId);
  downloadJson("mycampo-d-registros-anteriores.json", {
    user_id: userId,
    exportedAt: new Date().toISOString(),
    events,
  });
}
