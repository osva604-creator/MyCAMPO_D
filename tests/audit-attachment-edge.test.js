import { expect,it,vi } from 'vitest';
import { createAuditAttachmentHandler } from '../backend/supabase/functions/_shared/auditAttachment';
const aid='00000000-0000-4000-8000-000000000001';
function fixture(){
  const caller={auth:{getUser:vi.fn(async()=>({data:{user:{email_confirmed_at:'2026-01-01'}}}))},rpc:vi.fn(async()=>({data:{object_path:'org/file',mime_type:'image/jpeg'}}))};
  const download=vi.fn(async()=>({data:new Blob(['private content'])}));
  const handler=createAuditAttachmentHandler({clients:()=>({caller,privileged:{storage:{from:()=>({download})}}}),allowedOrigins:['https://campo.example']});
  const send=body=>handler(new Request('https://edge.example',{method:'POST',headers:{authorization:'Bearer access','content-type':'application/json',origin:'https://campo.example'},body:JSON.stringify(body)}));
  return{caller,download,send};
}
it('downloads only after an owner-authorized logged RPC and never trusts a client object path',async()=>{
  const f=fixture();const response=await f.send({attachment_id:aid,reason:'Supervisión autorizada del incidente'});
  expect(response.status).toBe(200);expect(await response.text()).toBe('private content');expect(response.headers.get('cache-control')).toBe('no-store');
  expect(f.caller.rpc).toHaveBeenCalledWith('campo_audit_attachment',{aid,why:'Supervisión autorizada del incidente'});
  expect(f.caller.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.download.mock.invocationCallOrder[0]);
  expect((await f.send({attachment_id:aid,reason:'Motivo suficiente',object_path:'other/secret'})).status).toBe(400);expect(f.download).toHaveBeenCalledTimes(1);
});
it('blocks non-owner downloads and missing reasons without reaching privileged Storage',async()=>{
  const f=fixture();expect((await f.send({attachment_id:aid,reason:''})).status).toBe(400);
  f.caller.rpc.mockResolvedValue({error:{code:'42501'}});expect((await f.send({attachment_id:aid,reason:'Intento de acceso no autorizado'})).status).toBe(403);expect(f.download).not.toHaveBeenCalled();
});
