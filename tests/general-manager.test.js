import { beforeAll, afterAll, expect, it } from 'vitest';
import { platformDb, ids, id } from './helpers/platform-db';
import { canManage } from '../src/context/TeamContext';

let f;
const set = (org, role = 'GERENTE_GENERAL') => f.command('membership.set', {
  user_id: ids.manager, organization_id: org, role, team_ids: [], name: 'General',
});
beforeAll(async () => {
  f = await platformDb({ application: true, sharedWorkTeams: true, generalManager: true });
}, 30000);
afterAll(async () => { await f?.db.close(); });

it('retains both organizations and gives manager permissions without platform administration', async () => {
  await set(ids.org);
  await set(ids.otherOrg);
  await f.as(ids.manager);
  const access = await f.rpc('campo_access_context');
  expect(access.role).toBe('GERENTE_GENERAL');
  expect(access.memberships.map(m => m.organization_id).sort()).toEqual([ids.org, ids.otherOrg].sort());
  expect(access.teams).toHaveLength(3);
  const execute = (action, payload) => f.rpc('campo_content_command', [action, JSON.stringify(payload), crypto.randomUUID()]);
  for (const [org, team, assignee] of [[ids.org, ids.team, ids.worker], [ids.otherOrg, ids.otherTeam, ids.other]]) {
    await execute('task.create', { organization_id: org, team_id: team, assignee_id: assignee, title: 'General manager task' });
    const chat = await execute('conversation.open', { organization_id: org, recipient_id: assignee });
    expect(chat.conversation_id).toBeTruthy();
  }
  await expect(f.command('organization.create', { name: 'Forbidden' })).rejects.toThrow();
  expect(canManage({ ...access, organization_id: ids.otherOrg }, ids.otherOrg, ids.otherTeam)).toBe(true);
  expect(canManage(access, id(999), ids.otherTeam)).toBe(false);
  await f.owner();
  await f.query('insert into public.organizations(id,name) values($1,$2)', [id(900), 'Unassigned']);
  await f.as(ids.manager);
  expect((await f.query('select id from public.organizations where id=$1', [id(900)])).rows).toHaveLength(0);
});

it('rejects duplicate organizations and mixed roles, preserves other memberships on reassignment', async () => {
  await f.owner();
  await expect(f.query("insert into public.organization_members(user_id,organization_id,name,role) values($1,$2,'Duplicate','GERENTE_GENERAL')", [ids.manager, ids.org])).rejects.toThrow(/unique/i);
  await expect(f.query("update public.organization_members set role='GERENTE' where user_id=$1 and organization_id=$2 and ended_at is null", [ids.manager, ids.org])).rejects.toThrow(/immutable/i);
  await expect(f.query("insert into public.organization_members(user_id,organization_id,name,role) values($1,$2,'Mixed','GERENTE')", [ids.manager, id(900)])).rejects.toThrow(/general managers/i);
  await f.as(ids.admin);
  await set(ids.org);
  await f.as(ids.manager);
  expect((await f.rpc('campo_access_context')).memberships).toHaveLength(2);
  await f.as(ids.admin);
  await set(ids.org, 'GERENTE');
  await f.as(ids.manager);
  expect((await f.rpc('campo_access_context')).memberships).toHaveLength(1);
});

it('activates an approved invitation to a second organization without losing the first', async () => {
  await f.as(ids.admin);
  await f.command('membership.set', { user_id:ids.guest, organization_id:ids.org, role:'GERENTE_GENERAL', team_ids:[], name:'Invited general' });
  const request = await f.rpc('campo_request_invitation', [ids.otherOrg, 'guest@example.com']);
  const invitation = await f.command('invitation.approve', { request_id:request.request_id, organization_id:ids.otherOrg, role:'GERENTE_GENERAL', team_ids:[] });
  expect(await f.rpc('campo_claim_invitation', [invitation.invitation_id])).toMatchObject({status:'existing_account',send:false});
  await f.as(ids.guest);
  expect((await f.rpc('campo_access_context')).invitations).toHaveLength(1);
  await f.rpc('campo_activate_invitation', [invitation.invitation_id, 'Invited general']);
  expect((await f.rpc('campo_access_context')).memberships).toHaveLength(2);
});

it('suspends every organization of the account', async () => {
  await f.as(ids.admin);
  await set(ids.org);
  await set(ids.otherOrg);
  await f.command('membership.suspend', { user_id: ids.manager });
  await f.as(ids.manager);
  expect((await f.rpc('campo_access_context')).status).toBe('awaiting_approval');
  expect((await f.query('select id from public.organizations')).rows).toHaveLength(0);
});
