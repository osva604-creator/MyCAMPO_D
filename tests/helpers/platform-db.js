import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

export const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const ids = { admin: id(1), manager: id(2), supervisor: id(3), worker: id(4), guest: id(5), other: id(6),
  org: id(10), otherOrg: id(11), team: id(20), team2: id(21), otherTeam: id(22) };
export async function platformDb({application=false}={}) {
  const db = new PGlite(); const query = (sql, args) => db.query(sql, args);
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text unique, email_confirmed_at timestamptz, banned_until timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id));
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    grant select,insert,update,delete on storage.objects to authenticated,service_role;
  `);
  const migrations=['20261014143135_multi_organization.sql','20261014152959_administrative_workflows.sql'];
  if(application)migrations.push('20261014163341_application_workflows.sql');
  for (const migration of migrations) {
    await db.exec(await readFile(new URL(`../../backend/supabase/migrations/${migration}`, import.meta.url), 'utf8'));
  }
  await query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now()),($5,$6,now()),($7,$8,now()),($9,$10,now()),($11,$12,now())',
    [ids.admin,'owner@example.com',ids.manager,'manager@example.com',ids.supervisor,'supervisor@example.com',ids.worker,'worker@example.com',ids.guest,'guest@example.com',ids.other,'other@example.com']);
  await query('insert into auth.sessions select id,id from auth.users');
  await query('insert into public.platform_admins(user_id) values($1)',[ids.admin]);
  await query("insert into public.organizations(id,name) values($1,'Campo A'),($2,'Campo B')",[ids.org,ids.otherOrg]);
  await query("insert into public.teams(id,organization_id,name) values($1,$2,'Norte'),($3,$2,'Sur'),($4,$5,'Otro')",[ids.team,ids.org,ids.team2,ids.otherTeam,ids.otherOrg]);
  const as = async (user) => {
    await db.exec('reset role; set role authenticated');
    await query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    await query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,session_id:user})]);
  };
  const owner = async () => { await db.exec('reset role'); await query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)"); };
  const service = async () => { await owner(); await db.exec('set role service_role'); };
  const rpc = async (name, args = []) => (await query(`select public.${name}(${args.map((_,i) => `$${i+1}`).join(',')}) as result`, args)).rows[0].result;
  const command = (action, payload, operation = crypto.randomUUID()) => rpc('campo_admin_command',[action,JSON.stringify({ reason:'Administración de prueba autorizada', ...payload }),operation]);
  await as(ids.admin);
  await command('membership.set',{ user_id:ids.manager,organization_id:ids.org,role:'GERENTE',team_ids:[],name:'Gerente' });
  await command('membership.set',{ user_id:ids.supervisor,organization_id:ids.org,role:'ENCARGADO',team_ids:[ids.team,ids.team2],name:'Encargado' });
  await command('membership.set',{ user_id:ids.worker,organization_id:ids.org,role:'USUARIO',team_ids:[ids.team],name:'Operario' });
  await command('membership.set',{ user_id:ids.other,organization_id:ids.otherOrg,role:'USUARIO',team_ids:[ids.otherTeam],name:'Externo' });
  return { db, query, rpc, command, as, owner, service };
}
