import { afterEach, beforeEach, expect, it } from 'vitest';
import { platformDb, ids, id } from './helpers/platform-db';

let f;
beforeEach(async () => { f = null; f = await platformDb(); });
afterEach(async () => { await f?.db.close(); });
async function approved(email = 'new@example.com', role = 'USUARIO', teams = [ids.team]) {
  await f.as(ids.worker);
  const request = await f.rpc('campo_request_invitation',[ids.org,email]);
  await f.as(ids.admin);
  return await f.command('invitation.approve',{ request_id:request.request_id,organization_id:ids.org,role,team_ids:teams });
}

it('blocks role escalation, privileged finalization and foreign invitation requests', async () => {
  await f.as(ids.worker);
  await expect(f.command('organization.create',{name:'Intrusión'})).rejects.toThrow(/administrator/i);
  await expect(f.rpc('campo_finish_invitation',[id(90),id(91),'sent',ids.worker,null])).rejects.toThrow(/permission/i);
  await expect(f.query('select campo_private.replace_membership($1,$2,$3,$4,$5)',[ids.worker,ids.org,'GERENTE',[],'Intruso'])).rejects.toThrow(/permission/i);
  await expect(f.rpc('campo_request_invitation',[ids.otherOrg,'unknown@example.com'])).rejects.toThrow(/membership/i);
  await expect(f.query('insert into public.invitation_requests(organization_id,requested_by,email) values($1,$2,$3)',[ids.org,ids.worker,'bypass@example.com'])).rejects.toThrow(/permission/i);
  await f.db.exec('set role anon');
  await expect(f.rpc('campo_access_context')).rejects.toThrow(/permission/i);
});

it('makes admin commands idempotent and changes roles atomically with history', async () => {
  const operation = id(100);
  const first = await f.command('organization.create',{name:'Nueva'},operation);
  expect(await f.command('organization.create',{name:'Nueva'},operation)).toEqual(first);
  await expect(f.command('organization.create',{name:'Diferente'},operation)).rejects.toThrow(/reused/i);
  expect((await f.query("select * from public.audit_logs where action='organization.create'")).rows).toHaveLength(1);
  await expect(f.command('membership.set',{user_id:ids.worker,organization_id:ids.org,role:'SUPER_ADMIN',team_ids:[],name:'Intruso'})).rejects.toThrow(/role/i);
  await expect(f.command('membership.set',{user_id:ids.worker,organization_id:ids.org,role:'USUARIO',team_ids:[ids.otherTeam],name:'Inválido'})).rejects.toThrow(/Teams/i);
  await f.as(ids.worker); expect((await f.rpc('campo_access_context')).role).toBe('USUARIO');
  await f.as(ids.admin);
  await f.command('membership.set',{user_id:ids.worker,organization_id:ids.org,role:'ENCARGADO',team_ids:[ids.team,ids.team2],name:'Encargado nuevo'});
  await f.as(ids.worker); const context = await f.rpc('campo_access_context');
  expect(context.role).toBe('ENCARGADO'); expect(context.teams).toHaveLength(2);
  await f.owner();
  const history = (await f.query('select * from public.organization_members where user_id=$1 order by joined_at',[ids.worker])).rows;
  expect(history).toHaveLength(2); expect(history.filter((m) => !m.ended_at)).toHaveLength(1);
  expect(history.find((m) => m.role==='USUARIO').ended_at).not.toBeNull();
});

it('approves only once, checks assignments, and persists approval before any delivery', async () => {
  await f.as(ids.worker); const request = await f.rpc('campo_request_invitation',[ids.org,' New@Example.com ']);
  await expect(f.rpc('campo_request_invitation',[ids.org,'new@example.com'])).rejects.toThrow(/unique/i);
  await expect(f.command('invitation.approve',{request_id:request.request_id,organization_id:ids.org,role:'USUARIO',team_ids:[ids.team]})).rejects.toThrow(/administrator/i);
  await f.as(ids.admin);
  await expect(f.command('invitation.approve',{request_id:request.request_id,organization_id:ids.org,role:'USUARIO',team_ids:[ids.otherTeam]})).rejects.toThrow(/Teams/i);
  const result = await f.command('invitation.approve',{request_id:request.request_id,organization_id:ids.org,role:'USUARIO',team_ids:[ids.team]});
  expect(result.delivery_status).toBe('pending');
  await expect(f.command('invitation.approve',{request_id:request.request_id,organization_id:ids.org,role:'GERENTE',team_ids:[]})).rejects.toThrow(/decided/i);
  expect((await f.query('select * from public.invitations')).rows).toHaveLength(1);
  const claim = await f.rpc('campo_claim_invitation',[result.invitation_id]);
  expect(claim.send).toBe(true); expect(claim.email).toBe('new@example.com');
  await expect(f.rpc('campo_claim_invitation',[result.invitation_id])).rejects.toThrow(/claimed/i);
});

it('binds existing confirmed accounts and activates only the approved recipient once', async () => {
  const invite = await approved('guest@example.com');
  expect(await f.rpc('campo_claim_invitation',[invite.invitation_id])).toEqual({status:'existing_account',send:false});
  await f.as(ids.worker); await expect(f.rpc('campo_activate_invitation',[invite.invitation_id,'Suplantación'])).rejects.toThrow(/identity/i);
  await f.as(ids.guest);
  expect((await f.rpc('campo_access_context')).status).toBe('awaiting_approval');
  const activated = await f.rpc('campo_activate_invitation',[invite.invitation_id,'Invitado']);
  expect(await f.rpc('campo_activate_invitation',[invite.invitation_id,'Reintento'])).toEqual(activated);
  const context = await f.rpc('campo_access_context'); expect(context.status).toBe('active'); expect(context.role).toBe('USUARIO'); expect(context.teams[0].id).toBe(ids.team);
  await f.as(ids.admin); expect((await f.query("select * from public.audit_logs where action='invitation.activate'")).rows).toHaveLength(1);
});

it('finalizes only a valid delivery claim and blocks automatic retries after unknown results', async () => {
  const invite = await approved(); const claim = await f.rpc('campo_claim_invitation',[invite.invitation_id]);
  await f.service();
  await expect(f.rpc('campo_finish_invitation',[invite.invitation_id,id(99),'sent',ids.guest,null])).rejects.toThrow(/claim/i);
  expect(await f.rpc('campo_finish_invitation',[invite.invitation_id,claim.claim,'uncertain',null,'transport_unknown'])).toEqual({status:'uncertain'});
  await f.as(ids.admin); await expect(f.rpc('campo_claim_invitation',[invite.invitation_id])).rejects.toThrow(/uncertain/i);
  await expect(f.command('invitation.resolve',{invitation_id:invite.invitation_id,outcome:'confirmed_not_sent'})).rejects.toThrow(/stale/i);
  await f.owner(); await f.query("update public.invitations set delivery_started_at=now()-interval '6 minutes' where id=$1",[invite.invitation_id]);
  await f.as(ids.admin); await f.command('invitation.resolve',{invitation_id:invite.invitation_id,outcome:'confirmed_not_sent'});
  const next = await f.rpc('campo_claim_invitation',[invite.invitation_id]); expect(next.claim).not.toBe(claim.claim);
  await f.service(); await expect(f.rpc('campo_finish_invitation',[invite.invitation_id,claim.claim,'sent',ids.guest,null])).rejects.toThrow(/claim/i);
});

it('validates confirmed email, suspension, expiry and revocation before activation', async () => {
  const invite = await approved(); const claim = await f.rpc('campo_claim_invitation',[invite.invitation_id]);
  const target = id(101); await f.owner();
  await f.query('insert into auth.users(id,email) values($1,$2)',[target,'new@example.com']);
  await f.query('insert into auth.sessions(id,user_id) values($1,$1)',[target]);
  await f.service(); await f.rpc('campo_finish_invitation',[invite.invitation_id,claim.claim,'sent',target,null]);
  await f.as(target); await expect(f.rpc('campo_activate_invitation',[invite.invitation_id,'Invitado'])).rejects.toThrow(/Confirmed/i);
  await f.owner(); await f.query('update auth.users set email_confirmed_at=now() where id=$1',[target]);
  await f.as(ids.admin); await f.command('invitation.revoke',{invitation_id:invite.invitation_id});
  await f.as(target); await expect(f.rpc('campo_activate_invitation',[invite.invitation_id,'Invitado'])).rejects.toThrow(/valid/i);
  await f.as(ids.admin); await f.command('membership.suspend',{user_id:ids.worker});
  await f.as(ids.worker); expect((await f.rpc('campo_access_context')).status).toBe('awaiting_approval');
  await expect(f.rpc('campo_request_invitation',[ids.org,'more@example.com'])).rejects.toThrow(/membership/i);
  await f.owner(); await f.query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[ids.worker]);
  await f.as(ids.worker); await expect(f.rpc('campo_access_context')).rejects.toThrow(/identity/i);
});

it('rejects team deactivation with active assignments and audits administrative settings', async () => {
  await expect(f.command('team.update',{id:ids.team,active:false})).rejects.toThrow(/assignments/i);
  await f.command('settings.update',{messaging_scope:'disabled'});
  expect((await f.query('select messaging_scope from public.platform_settings')).rows[0].messaging_scope).toBe('disabled');
  expect((await f.query("select * from public.audit_logs where action='settings.update'")).rows).toHaveLength(1);
  await f.as(ids.manager); await expect(f.command('settings.update',{messaging_scope:'same_organization'})).rejects.toThrow(/administrator/i);
});

it('blocks removed sessions even when the JWT still identifies an administrator', async () => {
  await f.owner(); await f.query('delete from auth.sessions where user_id=$1',[ids.admin]);
  await f.as(ids.admin);
  await expect(f.command('organization.create',{name:'Sesión revocada'})).rejects.toThrow(/administrator/i);
  await expect(f.rpc('campo_access_context')).rejects.toThrow(/identity/i);
});

it('revokes outstanding approvals when an owner changes or suspends membership', async () => {
  const invite=await approved('guest@example.com');
  await f.rpc('campo_claim_invitation',[invite.invitation_id]);
  await f.command('membership.set',{user_id:ids.guest,organization_id:ids.org,role:'USUARIO',team_ids:[ids.team2],name:'Ingreso administrativo'});
  await f.command('membership.suspend',{user_id:ids.guest});
  await f.as(ids.guest);
  await expect(f.rpc('campo_activate_invitation',[invite.invitation_id,'Reingreso indebido'])).rejects.toThrow(/valid/i);
  expect((await f.rpc('campo_access_context')).status).toBe('awaiting_approval');
});

it('completes new-account delivery and activation without granting permissions before confirmation', async () => {
  const invite=await approved(); const claim=await f.rpc('campo_claim_invitation',[invite.invitation_id]);
  const target=id(102); await f.owner();
  await f.query('insert into auth.users(id,email) values($1,$2)',[target,'new@example.com']);
  await f.query('insert into auth.sessions(id,user_id) values($1,$1)',[target]);
  await f.service();
  await expect(f.rpc('campo_finish_invitation',[invite.invitation_id,claim.claim,'sent',ids.worker,null])).rejects.toThrow(/email/i);
  await f.rpc('campo_finish_invitation',[invite.invitation_id,claim.claim,'sent',target,null]);
  await f.as(target); await expect(f.rpc('campo_access_context')).rejects.toThrow(/identity/i);
  await f.owner(); await f.query('update auth.users set email_confirmed_at=now() where id=$1',[target]);
  await f.as(target); await f.rpc('campo_activate_invitation',[invite.invitation_id,'Nuevo integrante']);
  expect((await f.rpc('campo_access_context')).role).toBe('USUARIO');
});

it('refuses expired approvals and sends at most three claimed attempts with cooldown', async () => {
  const invitation=await approved();
  for(let attempt=0;attempt<3;attempt++) {
    await f.as(ids.admin); const claim=await f.rpc('campo_claim_invitation',[invitation.invitation_id]);
    await f.service(); await f.rpc('campo_finish_invitation',[invitation.invitation_id,claim.claim,'failed',null,'over_email_send_rate_limit']);
    await f.as(ids.admin); await expect(f.rpc('campo_claim_invitation',[invitation.invitation_id])).rejects.toThrow(/limit|cooldown/i);
    await f.owner(); await f.query("update public.invitations set delivery_started_at=now()-interval '6 minutes' where id=$1",[invitation.invitation_id]);
  }
  await f.as(ids.admin); await expect(f.rpc('campo_claim_invitation',[invitation.invitation_id])).rejects.toThrow(/limit/i);
  // Seed a previously approved, expired snapshot without altering immutable expiry fields.
  const request=await f.rpc('campo_request_invitation',[ids.org,'guest@example.com']);
  await f.owner();
  await f.query("update public.invitation_requests set status='approved',decided_by=$1,decided_at=now() where id=$2",[ids.admin,request.request_id]);
  const expired=(await f.query("insert into public.invitations(request_id,organization_id,email,role,approved_by,created_at,expires_at,recipient_id,delivery_status) values($1,$2,'guest@example.com','GERENTE',$3,now()-interval '8 days',now()-interval '1 day',$4,'existing_account') returning id",[request.request_id,ids.org,ids.admin,ids.guest])).rows[0].id;
  await f.as(ids.guest); await expect(f.rpc('campo_activate_invitation',[expired,'Vencido'])).rejects.toThrow(/valid/i);
});

it('lets only the owner choose a different destination organization on approval', async () => {
  await f.as(ids.worker); const request=await f.rpc('campo_request_invitation',[ids.org,'guest@example.com']);
  await f.as(ids.admin);
  const invite=await f.command('invitation.approve',{request_id:request.request_id,organization_id:ids.otherOrg,role:'USUARIO',team_ids:[ids.otherTeam]});
  await f.rpc('campo_claim_invitation',[invite.invitation_id]);
  await f.as(ids.guest); await f.rpc('campo_activate_invitation',[invite.invitation_id,'Integrante B']);
  const context=await f.rpc('campo_access_context'); expect(context.organization_id).toBe(ids.otherOrg); expect(context.teams[0].id).toBe(ids.otherTeam);
  await f.as(ids.worker);
  expect((await f.query('select user_id from public.organization_members where user_id=$1',[ids.guest])).rows).toHaveLength(0);
});

it('rejects requests permanently and prevents unauthorized team and organization administration', async () => {
  await f.as(ids.worker); const request=await f.rpc('campo_request_invitation',[ids.org,'rejected@example.com']);
  await f.as(ids.admin); await f.command('invitation.reject',{request_id:request.request_id});
  await expect(f.command('invitation.approve',{request_id:request.request_id,organization_id:ids.org,role:'GERENTE',team_ids:[]})).rejects.toThrow(/decided/i);
  const organization=await f.command('organization.create',{name:'Nueva organización'});
  const team=await f.command('team.create',{organization_id:organization.id,name:'Equipo inicial'});
  await f.command('team.update',{id:team.id,name:'Equipo renombrado',active:false});
  await f.command('organization.update',{id:organization.id,name:'Organización renombrada',active:false});
  await f.as(ids.manager);
  await expect(f.command('team.create',{organization_id:ids.org,name:'Intrusión'})).rejects.toThrow(/administrator/i);
  expect((await f.query('select * from public.organizations where id=$1',[organization.id])).rows).toHaveLength(0);
});

it('bounds invitation request creation per actor independently of proposed email', async () => {
  await f.as(ids.worker);
  for(let n=0;n<20;n++) await f.rpc('campo_request_invitation',[ids.org,`guest-${n}@example.com`]);
  await expect(f.rpc('campo_request_invitation',[ids.org,'one-more@example.com'])).rejects.toThrow(/rate limit/i);
});
