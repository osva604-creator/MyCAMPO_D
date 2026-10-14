// Immutable operations avoid overwriting another operator's comments while offline.
export function projectEvents(events, seed = []) {
  const posts = new Map(seed.map((post) => [post.id, { ...post, comments: [...post.comments], likedBy: [] }]));
  const ordered = [...events].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const { type, payload, actor } of ordered) {
    if (type === 'post') posts.set(payload.id, { ...payload, author: { ...payload.author, ...actor }, comments: [], likedBy: [] });
  }
  for (const event of ordered) {
    const { payload, actor, type } = event;
    const post = posts.get(payload.postId);
    if (!post) continue;
    if (type === 'comment') post.comments.push({ ...payload, id: event.id, author: actor.name, createdAt: event.createdAt });
    if (type === 'status') {
      post.status = payload.status;
      post.comments.push({ id: event.id, author: actor.name, text: `Cambió el estado a ${payload.status}.`, createdAt: event.createdAt });
    }
    if (type === 'like') {
      post.likedBy = post.likedBy.filter((id) => id !== actor.id);
      if (payload.liked) post.likedBy.push(actor.id);
    }
  }
  return [...posts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createEvent(type, payload, actor) {
  return { id: crypto.randomUUID(), type, payload, actor, createdAt: new Date().toISOString(), synced: false };
}
