import { expect,it,vi } from 'vitest';
import { createAttachmentHandler,validFile } from '../backend/supabase/functions/_shared/attachment';
const uid='00000000-0000-4000-8000-000000000001',aid='00000000-0000-4000-8000-000000000002';
const bytes=new Uint8Array([255,216,255,1]);
function fixture() {
  const file={id:aid,object_path:`${uid}/${aid}`,mime_type:'image/jpeg',size_bytes:4,uploaded_by:uid,ready:false};
  const read=vi.fn(async()=>({data:file}));
  const builder={select(){return this;},eq(){return this;},maybeSingle:read};
  const caller={auth:{getUser:vi.fn(async()=>({data:{user:{id:uid,email_confirmed_at:'2026-01-01'}}}))},from:vi.fn(()=>builder)};
  const storage={upload:vi.fn(async()=>({})),download:vi.fn(async()=>({data:new Blob([bytes])}))};
  const privileged={storage:{from:vi.fn(()=>storage)},rpc:vi.fn(async()=>({data:{status:'ready'}}))};
  const handler=createAttachmentHandler({clients:()=>({caller,privileged}),allowedOrigins:['https://campo.example']});
  const send=(data=bytes,headers={})=>handler(new Request('https://edge.example',{method:'POST',headers:{authorization:'Bearer access','x-attachment-id':aid,'content-type':'image/jpeg',origin:'https://campo.example',...headers},body:data}));
  return {file,read,caller,privileged,storage,send};
}
it('validates authentication, ownership and actual file bytes before privileged upload',async()=>{
  const f=fixture();expect((await f.send()).status).toBe(200);
  expect(f.storage.upload).toHaveBeenCalledWith(f.file.object_path,bytes,{contentType:'image/jpeg',upsert:false});
  expect(f.privileged.rpc).toHaveBeenCalledWith('campo_finish_attachment',expect.objectContaining({aid,checksum:expect.stringMatching(/^[a-f0-9]{64}$/)}));
  f.file.uploaded_by='other';expect((await f.send()).status).toBe(403);
  expect(f.storage.upload).toHaveBeenCalledTimes(1);
});
it('rejects spoofed file formats, sizes and revoked permissions without uploading',async()=>{
  const f=fixture();expect((await f.send(new Uint8Array([1,2,3,4]))).status).toBe(400);
  expect((await f.send(new Uint8Array([255,216,255]))).status).toBe(400);
  f.read.mockResolvedValueOnce({data:f.file}).mockResolvedValueOnce({data:null});
  expect((await f.send()).status).toBe(403);expect(f.storage.upload).not.toHaveBeenCalled();
  expect(validFile(new TextEncoder().encode('<svg/>'),'image/png')).toBe(false);
});
it('reconciles an existing immutable object only when its checksum matches',async()=>{
  const f=fixture();f.storage.upload.mockResolvedValue({error:{statusCode:'409'}});
  expect((await f.send()).status).toBe(200);
  f.storage.download.mockResolvedValue({data:new Blob(['different'])});
  expect((await f.send()).status).toBe(409);
  expect(f.privileged.rpc).toHaveBeenCalledTimes(1);
});
it('does not publish an upload when permissions were withdrawn during the operation',async()=>{
  const f=fixture();f.read.mockResolvedValueOnce({data:f.file}).mockResolvedValueOnce({data:f.file}).mockResolvedValueOnce({data:null});
  expect((await f.send()).status).toBe(403);expect(f.storage.upload).toHaveBeenCalledTimes(1);expect(f.privileged.rpc).not.toHaveBeenCalled();
});
