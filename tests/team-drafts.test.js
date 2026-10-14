// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { expect,it,vi } from 'vitest';
import { drafts,saveContentDraft,syncDrafts,removeDraft } from '../src/lib/teamDrafts';
const api=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock('../src/lib/teamApi',()=>({contentOperation:(action,payload,media)=>({operation_id:crypto.randomUUID(),action,payload,media}),executeContent:(operation)=>api.execute(operation)}));
it('isolates queued changes by user/organization and retains them after permission changes',async()=>{
  const access={user_id:'draft-user-a',organization_id:'draft-org-a',member_id:'membership-before'};
  const record=await saveContentDraft(access,'comment.create',{post_id:'p',body:'Evidencia pendiente'},'data:image/jpeg;base64,YQ==',access.organization_id,'Comentario');
  expect(await drafts('another-user',access.organization_id)).toEqual([]);expect(await drafts(access.user_id,'other-org')).toEqual([]);
  api.execute.mockResolvedValue({});await syncDrafts({...access,member_id:'membership-after'},access.organization_id);
  expect(api.execute).not.toHaveBeenCalled();expect(await drafts(access.user_id,access.organization_id)).toHaveLength(1);
  await syncDrafts(access,access.organization_id);expect(api.execute).toHaveBeenCalledWith(record.operation);expect(await drafts(access.user_id,access.organization_id)).toEqual([]);
});
it('replays the same operation after a transport error without losing its attachment',async()=>{
  api.execute.mockReset();const access={user_id:'draft-user-b',organization_id:'draft-org-b',member_id:'same'};
  const record=await saveContentDraft(access,'post.create',{body:'Molino',team_id:'team'},'data:image/jpeg;base64,YQ==',access.organization_id,'Molino');
  api.execute.mockRejectedValueOnce(new Error('network'));await expect(syncDrafts(access,access.organization_id)).rejects.toThrow('network');
  expect((await drafts(access.user_id,access.organization_id))[0].operation).toEqual(record.operation);
  api.execute.mockResolvedValue({});await syncDrafts(access,access.organization_id);expect(api.execute.mock.calls[1][0].operation_id).toBe(record.operation.operation_id);await removeDraft(record.id);
});
