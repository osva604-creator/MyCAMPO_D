import {beforeAll,afterAll,expect,it} from 'vitest';
import {platformDb,ids} from './helpers/platform-db';
let f, shared, firstLink;
beforeAll(async()=>{f=await platformDb({application:true,sharedWorkTeams:true});},30000);
afterAll(async()=>{await f?.db.close();});
it('preserves legacy operational teams and creates their catalog entries',async()=>{
  await f.owner();
  const rows=(await f.query('select t.id,t.work_team_id,w.name from public.teams t join public.work_teams w on w.id=t.work_team_id')).rows;
  expect(rows).toHaveLength(3);
  expect(rows.every(row=>row.work_team_id && row.name)).toBe(true);
});
it('creates an independent team and links its identity to two organizations idempotently',async()=>{
  await f.as(ids.admin);
  shared=(await f.command('work_team.create',{name:'Equipo compartido'})).id;
  expect((await f.query('select * from public.teams where work_team_id=$1',[shared])).rows).toHaveLength(0);
  const op=crypto.randomUUID(),payload={work_team_id:shared,organization_id:ids.org};
  const result=await f.command('team.link',payload,op);firstLink=result.team_id;
  expect(await f.command('team.link',payload,op)).toEqual(result);
  const second=await f.command('team.link',{work_team_id:shared,organization_id:ids.otherOrg});
  expect(second.team_id).not.toBe(firstLink);
  expect((await f.query('select * from public.teams where work_team_id=$1',[shared])).rows).toHaveLength(2);
  await expect(f.command('team.link',payload)).rejects.toThrow(/already linked/);
});
it('renames the shared identity across its organization links and audits the command',async()=>{
  await f.as(ids.admin);
  await f.command('work_team.update',{id:shared,name:'Equipo rural'});
  expect((await f.query('select name from public.teams where work_team_id=$1',[shared])).rows.map(x=>x.name)).toEqual(['Equipo rural','Equipo rural']);
  expect((await f.query("select count(*)::int as n from public.audit_logs where action='work_team.update' and resource_id=$1",[shared])).rows[0].n).toBe(1);
});
it('rejects invalid organization links atomically, including optional create-and-link',async()=>{
  await f.as(ids.admin);
  const invalid=crypto.randomUUID();
  await expect(f.command('work_team.create',{name:'No debe persistir',organization_id:invalid})).rejects.toThrow(/Active organization/);
  expect((await f.query("select * from public.work_teams where name='No debe persistir'")).rows).toHaveLength(0);
});
it('sharing a team does not expose its other organization or global catalog to a normal user',async()=>{
  await f.as(ids.admin);
  await f.command('membership.set',{user_id:ids.worker,organization_id:ids.org,role:'USUARIO',team_ids:[firstLink],name:'Operario'});
  await f.as(ids.worker);
  expect((await f.query('select * from public.work_teams')).rows).toHaveLength(0);
  const links=(await f.query('select * from public.teams where work_team_id=$1',[shared])).rows;
  expect(links).toHaveLength(1);expect(links[0].organization_id).toBe(ids.org);
  await expect(f.command('team.link',{work_team_id:shared,organization_id:ids.otherOrg})).rejects.toThrow(/administrator/);
  await expect(f.query("insert into public.work_teams(name) values('Unauthorized')")).rejects.toThrow(/permission denied/);
});
