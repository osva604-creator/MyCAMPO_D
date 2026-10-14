import { openDB } from "idb";
import { contentOperation, executeContent } from "./teamApi";
import { readEvents } from "./db";

const database = () =>
  openDB("mycampo-d-team-v2", 1, {
    upgrade(db) {
      db.createObjectStore("drafts", { keyPath: "id" });
    },
  });
export const revision = (access) =>
  `${access.user_id}:${access.organization_id}:${access.member_id || access.role}`;
export async function drafts(user, org) {
  const db = await database();
  return (await db.getAll("drafts"))
    .filter((d) => d.user_id === user && (!org || d.organization_id === org))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
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
  );
}
export async function saveContentDraft(
  access,
  action,
  payload,
  media,
  org,
  title,
) {
  const operation = contentOperation(action, payload, media);
  const record = {
    id: operation.operation_id,
    user_id: access.user_id,
    organization_id: org,
    revision: revision({ ...access, organization_id: org }),
    operation,
    created_at: new Date().toISOString(),
    title,
  };
  const db = await database();
  await db.put("drafts", record);
  window.dispatchEvent(new Event("mycampo-d:drafts"));
  return record;
}
export async function removeDraft(id) {
  const db = await database();
  await db.delete("drafts", id);
  window.dispatchEvent(new Event("mycampo-d:drafts"));
}
const syncing = new Set();
export async function syncDrafts(access, org) {
  const key = `${access.user_id}:${org}`;
  if (syncing.has(key)) return;
  syncing.add(key);
  try {
    const pending = await drafts(access.user_id, org);
    pending.sort(
      (a, b) =>
        (a.operation.action === "post.create" ? 0 : 1) -
          (b.operation.action === "post.create" ? 0 : 1) ||
        a.created_at.localeCompare(b.created_at),
    );
    for (const draft of pending) {
      if (draft.revision !== revision({ ...access, organization_id: org }))
        continue;
      await executeContent(draft.operation);
      await removeDraft(draft.id);
    }
  } finally {
    syncing.delete(key);
  }
}
export function downloadJson(name, value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
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
