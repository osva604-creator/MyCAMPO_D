import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { clearReadCache, offlineResource, rememberAccess, savedAccess, saveForm, readForm, removeForm, saveLocally } from '../src/lib/offlineStore';
import { contentOperation, mediaBlob } from '../src/lib/teamApi';

beforeEach(() => vi.stubGlobal('navigator', { onLine: true }));
afterEach(() => vi.unstubAllGlobals());
const access = user => ({ user_id:user, status:'active', member_id:'membership-a', organization_id:'org-a', role:'GERENTE', teams:[] });

it('restores access and directory after a cold offline restart, isolated by account', async () => {
  await rememberAccess(access('offline-a'));
  await offlineResource('offline-a','directory:a',async()=>({members:[{name:'Ana'}]}));
  navigator.onLine=false;
  expect((await savedAccess('offline-a')).role).toBe('GERENTE');
  expect((await offlineResource('offline-a','directory:a',vi.fn())).members[0].name).toBe('Ana');
  expect(await savedAccess('offline-b')).toBeUndefined();
  await expect(offlineResource('offline-b','directory:a',vi.fn())).rejects.toThrow(/copia/);
});
it('keeps photo bytes offline and recreates disposable URLs instead of storing expired URLs', async () => {
  const blob=new Blob(['full-resolution-photo'],{type:'image/jpeg'}), url=URL.createObjectURL(blob);
  await offlineResource('offline-photos','feed:first',async()=>({posts:[{image:url,attachments:[{url}]}]}));
  URL.revokeObjectURL(url);
  navigator.onLine=false;
  const result=await offlineResource('offline-photos','feed:first',vi.fn());
  expect(result.posts[0].image).not.toBe(url);
  expect(await (await fetch(result.posts[0].image)).text()).toBe('full-resolution-photo');
  result.dispose();
  await expect(fetch(result.posts[0].image)).rejects.toThrow();
});
it('does not use cached data to hide a permission denial; revocation removes read copies', async () => {
  const a=access('offline-revoked');
  await rememberAccess(a);
  await offlineResource(a.user_id,'feed:old',async()=>({posts:[{caption:'Private'}]}));
  const denied=Object.assign(new Error('Forbidden'),{status:403,code:'42501'});
  await expect(offlineResource(a.user_id,'feed:old',async()=>{throw denied;})).rejects.toBe(denied);
  await rememberAccess({...a,status:'awaiting_approval'});
  navigator.onLine=false;
  expect(await savedAccess(a.user_id)).toBeUndefined();
  await expect(offlineResource(a.user_id,'feed:old',vi.fn())).rejects.toThrow(/copia/);
});
it('recovers cached pages on a transport failure even when the device reports online', async () => {
  await offlineResource('offline-network','feed:1',async()=>({posts:[{caption:'Saved'}]}));
  const result=await offlineResource('offline-network','feed:1',async()=>{throw new TypeError('Failed to fetch');});
  expect(result.posts[0].caption).toBe('Saved');expect(result.offline).toBe(true);
});
it('frees only downloaded posts on quota exhaustion and preserves compose forms, directory and permissions', async () => {
  await rememberAccess(access('offline-quota'));
  await offlineResource('offline-quota','feed:1',async()=>({posts:[{caption:'Downloaded'}]}));
  await offlineResource('offline-quota','directory:1',async()=>({members:[]}));
  await saveForm('offline-quota:form',{caption:'Unpublished photo',photo:'data:image/jpeg;base64,YQ=='});
  const write=vi.fn().mockRejectedValueOnce(new DOMException('Full','QuotaExceededError')).mockResolvedValueOnce('saved');
  expect(await saveLocally(write)).toBe('saved');
  expect(write).toHaveBeenCalledTimes(2);
  expect((await readForm('offline-quota:form')).data.photo).toBe('data:image/jpeg;base64,YQ==');
  expect(await savedAccess('offline-quota')).toBeTruthy();
  navigator.onLine=false;
  expect((await offlineResource('offline-quota','directory:1',vi.fn())).members).toEqual([]);
  await expect(offlineResource('offline-quota','feed:1',vi.fn())).rejects.toThrow(/copia/);
  await removeForm('offline-quota:form');
});
it('bounds downloaded feed pages independently of unpublished data', async () => {
  await clearReadCache('offline-lru');
  for(let page=0;page<14;page++) await offlineResource('offline-lru',`feed:${page}`,async()=>({posts:[{page}]}));
  navigator.onLine=false;
  await expect(offlineResource('offline-lru','feed:0',vi.fn())).rejects.toThrow(/copia/);
  expect((await offlineResource('offline-lru','feed:13',vi.fn())).posts[0].page).toBe(13);
});
it('stores new upload operations as binary Blobs, retaining byte limits and stable data',async()=>{
  const operation=contentOperation('post.create',{body:'Photo'},'data:image/jpeg;base64,YQ==');
  expect(operation.media).toBeInstanceOf(Blob);
  expect(await operation.media.text()).toBe('a');
  expect(mediaBlob(operation.media)).toBe(operation.media);
  expect(()=>mediaBlob(new Blob(['x'],{type:'text/html'}))).toThrow();
});
it('does not repopulate a signed-out account cache from a late network response',async()=>{
  let finish;const loaded=new Promise(resolve=>{finish=resolve;});
  const request=offlineResource('late-account','feed:private',()=>loaded);
  await clearReadCache('late-account');
  finish({posts:[{caption:'Private'}]});await request;
  navigator.onLine=false;
  await expect(offlineResource('late-account','feed:private',vi.fn())).rejects.toThrow(/copia/);
});
it('bounds non-feed read caches too and keeps standalone binary Blobs intact',async()=>{
  for(let i=0;i<35;i++)await offlineResource('bounded-directory',`directory:${i}`,async()=>({file:new Blob(['photo'])}));
  navigator.onLine=false;
  await expect(offlineResource('bounded-directory','directory:0',vi.fn())).rejects.toThrow(/copia/);
  const restored=await offlineResource('bounded-directory','directory:34',vi.fn());
  expect(restored.file).toBeInstanceOf(Blob);expect(await restored.file.text()).toBe('photo');
});
