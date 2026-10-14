import { expect, it, vi } from 'vitest';
import { createHandler } from '../backend/supabase/functions/_shared/platform';

const uuid = '00000000-0000-4000-8000-000000000001';
function setup() {
  const caller = {
    auth: { getUser: vi.fn(async () => ({ data: { user: { id:uuid,email_confirmed_at:'2026-01-01',is_anonymous:false } } })) },
    rpc: vi.fn(async () => ({ data:{status:'active'} })),
  };
  const privileged = {
    auth: { admin: { inviteUserByEmail: vi.fn(async () => ({ data:{user:{id:uuid}} })) } },
    rpc: vi.fn(async () => ({ data:{status:'sent'} })),
  };
  const clients = vi.fn(() => ({caller,privileged}));
  const handler = createHandler({clients,allowedOrigins:['https://campo.example'],redirectBase:'https://campo.example'});
  const request = (body, extra = {}) => handler(new Request('https://edge.example/campo-platform', {
    method:'POST',headers:{authorization:'Bearer user-access-token','content-type':'application/json',origin:'https://campo.example',...extra},body:JSON.stringify(body),
  }));
  return {caller,privileged,clients,handler,request};
}

it('rejects missing or invalid JWTs before running any command', async () => {
  const f=setup();
  expect((await f.request({action:'access.context'},{authorization:''})).status).toBe(401);
  expect(f.caller.rpc).not.toHaveBeenCalled();
  f.caller.auth.getUser.mockResolvedValue({error:{message:'invalid token'}});
  expect((await f.request({action:'access.context'})).status).toBe(401);
  expect(f.caller.rpc).not.toHaveBeenCalled(); expect(f.privileged.rpc).not.toHaveBeenCalled();
});
it('supports an exact CORS allowlist and denies anonymous Auth accounts', async () => {
  const f=setup();
  const rejected=await f.request({action:'access.context'},{origin:'https://evil.example'});
  expect(rejected.status).toBe(403); expect(f.clients).not.toHaveBeenCalled();
  f.caller.auth.getUser.mockResolvedValue({data:{user:{id:uuid,is_anonymous:true,email_confirmed_at:'2026-01-01'}}});
  expect((await f.request({action:'access.context'})).status).toBe(401);
  const preflight=await f.handler(new Request('https://edge.example',{method:'OPTIONS',headers:{origin:'https://campo.example'}}));
  expect(preflight.status).toBe(204); expect(preflight.headers.get('access-control-allow-origin')).toBe('https://campo.example');
});
it('validates fields and never accepts actor IDs, permissions or arbitrary admin actions', async () => {
  const f=setup();
  expect((await f.request({action:'membership.set',operation_id:uuid,payload:{user_id:uuid,organization_id:uuid,role:'SUPER_ADMIN',team_ids:[],name:'Ana',reason:'Cambio autorizado'}})).status).toBe(400);
  expect((await f.request({action:'organization.create',operation_id:uuid,payload:{name:'Campo',reason:'Cambio autorizado',actor_id:uuid}})).status).toBe(400);
  expect((await f.request({action:'execute_sql',sql:'select * from auth.users'})).status).toBe(400);
  expect(f.caller.rpc).not.toHaveBeenCalled();
});
it('preserves caller context for admin RPC and hides internal error details', async () => {
  const f=setup();
  const body={action:'organization.create',operation_id:uuid,payload:{name:'Campo',reason:'Creación autorizada'}};
  expect((await f.request(body)).status).toBe(200);
  expect(f.caller.rpc).toHaveBeenCalledWith('campo_admin_command',{action:body.action,payload:body.payload,operation_id:uuid});
  expect(f.privileged.rpc).not.toHaveBeenCalled();
  f.caller.rpc.mockResolvedValue({error:{code:'42501',message:'secret SQL data'}});
  const response=await f.request(body); expect(response.status).toBe(403); expect(await response.text()).not.toContain('secret SQL');
});
it('sends only after a durable claim and never trusts email or redirect from the browser', async () => {
  const f=setup();
  f.caller.rpc.mockResolvedValue({data:{send:true,claim:uuid,email:'approved@example.com'}});
  const response=await f.request({action:'invitation.send',invitation_id:uuid});
  expect(response.status).toBe(200);
  expect(f.privileged.auth.admin.inviteUserByEmail).toHaveBeenCalledExactlyOnceWith('approved@example.com',{
    redirectTo:`https://campo.example/activar-cuenta?invitacion=${uuid}`,
  });
  expect(f.privileged.rpc).toHaveBeenCalledWith('campo_finish_invitation',{iid:uuid,claim:uuid,outcome:'sent',recipient:uuid,error_code:null});
  expect((await f.request({action:'invitation.send',invitation_id:uuid,email:'other@example.com'})).status).toBe(400);
});
it('does not send when denied, already sent, or tied to an existing account', async () => {
  const f=setup();
  f.caller.rpc.mockResolvedValue({error:{code:'42501'}});
  expect((await f.request({action:'invitation.send',invitation_id:uuid})).status).toBe(403);
  for (const status of ['sent','existing_account']) {
    f.caller.rpc.mockResolvedValue({data:{send:false,status}});
    expect((await f.request({action:'invitation.send',invitation_id:uuid})).status).toBe(200);
  }
  expect(f.privileged.auth.admin.inviteUserByEmail).not.toHaveBeenCalled();
});
it('records uncertain delivery after transport failure without retrying Auth', async () => {
  const f=setup();
  f.caller.rpc.mockResolvedValue({data:{send:true,claim:uuid,email:'approved@example.com'}});
  f.privileged.auth.admin.inviteUserByEmail.mockRejectedValue(new Error('network timeout'));
  f.privileged.rpc.mockResolvedValue({data:{status:'uncertain'}});
  const response=await f.request({action:'invitation.send',invitation_id:uuid});
  expect((await response.json()).data).toEqual({status:'uncertain',requires_review:true});
  expect(f.privileged.auth.admin.inviteUserByEmail).toHaveBeenCalledTimes(1);
  expect(f.privileged.rpc).toHaveBeenCalledWith('campo_finish_invitation',expect.objectContaining({outcome:'uncertain',error_code:'transport_unknown'}));
});
it('distinguishes an explicit email rate limit and returns sanitized backend failures', async () => {
  const f=setup();
  f.caller.rpc.mockResolvedValue({data:{send:true,claim:uuid,email:'approved@example.com'}});
  f.privileged.auth.admin.inviteUserByEmail.mockResolvedValue({error:{code:'over_email_send_rate_limit',message:'private data'}});
  f.privileged.rpc.mockResolvedValue({data:{status:'failed'}});
  expect((await f.request({action:'invitation.send',invitation_id:uuid})).status).toBe(200);
  expect(f.privileged.rpc).toHaveBeenCalledWith('campo_finish_invitation',expect.objectContaining({outcome:'failed'}));
  f.privileged.rpc.mockRejectedValue(new Error('sensitive backend detail'));
  const failure=await f.request({action:'invitation.send',invitation_id:uuid});
  expect(failure.status).toBe(503); expect(await failure.text()).not.toContain('sensitive');
});
it('bounds request size and accepts only JSON POST requests', async () => {
  const f=setup();
  expect((await f.request({action:'x',data:'x'.repeat(17000)})).status).toBe(413);
  expect((await f.request({action:'access.context'},{'content-type':'text/plain'})).status).toBe(415);
  expect((await f.handler(new Request('https://edge.example',{method:'GET'}))).status).toBe(405);
});
it('validates audit cursors and forwards reason without administrative SELECT bypass', async () => {
  const f=setup();
  expect((await f.request({action:'audit.messages',conversation_id:uuid,reason:'Supervisión autorizada',before:'2026-01-01'})).status).toBe(400);
  expect((await f.request({action:'audit.messages',conversation_id:uuid,reason:'Supervisión autorizada'})).status).toBe(200);
  expect(f.caller.rpc).toHaveBeenCalledWith('campo_audit_message_page',{cid:uuid,why:'Supervisión autorizada',page_before:null,before_id:null});
  expect(f.privileged.rpc).not.toHaveBeenCalled();
});
