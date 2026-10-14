import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

it('applies the proposed multi-org schema and enforces roles, tenant boundaries, tasks, messages and private files', async () => {
  const db = new PGlite();
  const admin = uuid(1), manager = uuid(2), supervisor = uuid(3), worker = uuid(4), peer = uuid(5), outsider = uuid(6);
  const org = uuid(10), otherOrg = uuid(11), team = uuid(20), team2 = uuid(21), otherTeam = uuid(22);
  const post = uuid(30), privatePost = uuid(31), task = uuid(40), conversation = uuid(50), message = uuid(51), attachment = uuid(60);
  const query = (sql, args) => db.query(sql, args);
  const as = async (user) => {
    await db.exec('reset role; set role authenticated');
    await query("select set_config('request.jwt.claim.sub', $1, false)", [user]);
  };
  const owner = async () => { await db.exec('reset role'); await query("select set_config('request.jwt.claim.sub', '', false)"); };
  const count = async (table) => (await query(`select * from public.${table}`)).rows.length;
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      grant usage on schema public, auth, storage to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      grant select, insert, update, delete on storage.objects to authenticated;
    `);
    await db.exec(await readFile(new URL('../backend/supabase/migrations/20261014143135_multi_organization.sql', import.meta.url), 'utf8'));
    await query('insert into auth.users(id) values ($1),($2),($3),($4),($5),($6)', [admin, manager, supervisor, worker, peer, outsider]);
    await query('update auth.users set email_confirmed_at=now()');
    await query("select set_config('campo.owner_uuid', $1, false)", [admin]);
    await db.exec(await readFile(new URL('../backend/bootstrap-owner.sql', import.meta.url), 'utf8'));
    expect((await query('select user_id from public.platform_admins')).rows[0].user_id).toBe(admin);
    await expect(query('insert into public.platform_admins(user_id) values ($1)', [manager])).rejects.toThrow(/unique/i);
    await expect(query('update public.platform_admins set active = false')).rejects.toThrow(/must remain/i);
    await query("insert into public.organizations(id,name) values ($1,'Campo A'),($2,'Campo B')", [org, otherOrg]);
    await query("insert into public.teams(id,organization_id,name) values ($1,$2,'Norte'),($3,$2,'Sur'),($4,$5,'Otro')", [team, org, team2, otherTeam, otherOrg]);
    // Deferred constraints allow complete, atomic membership creation.
    await db.exec('begin');
    await query("insert into public.organization_members(id,user_id,organization_id,name,role) values ($1,$1,$2,'Gerente','GERENTE'),($3,$3,$2,'Encargado','ENCARGADO'),($4,$4,$2,'Operario','USUARIO'),($5,$5,$2,'Otro operario','USUARIO'),($6,$6,$7,'Externo','USUARIO')",
      [manager, org, supervisor, worker, peer, outsider, otherOrg]);
    await query('insert into public.team_supervisors(member_id,organization_id,team_id) values ($1,$2,$3),($1,$2,$4)', [supervisor, org, team, team2]);
    await query('insert into public.team_members(member_id,organization_id,team_id) values ($1,$2,$3),($4,$2,$5),($6,$7,$8)', [worker, org, team, peer, team2, outsider, otherOrg, otherTeam]);
    await db.exec('commit');
    await expect(query("insert into public.organization_members(user_id,organization_id,name,role) values ($1,$2,'Sin equipo','USUARIO')", [admin, org])).rejects.toThrow(/assignments/i);
    await expect(query("insert into public.organization_members(user_id,organization_id,name,role) values ($1,$2,'Duplicado','GERENTE')", [worker, otherOrg])).rejects.toThrow(/unique/i);
    await expect(query('insert into public.team_members(member_id,organization_id,team_id) values ($1,$2,$3)', [worker, org, team2])).rejects.toThrow(/unique/i);
    await expect(query('insert into public.team_members(member_id,organization_id,team_id) values ($1,$2,$3)', [worker, org, otherTeam])).rejects.toThrow();
    await as(worker);
    await expect(query("update public.organization_members set role = 'GERENTE' where user_id = $1", [worker])).rejects.toThrow(/permission/i);
    await expect(query("insert into public.platform_admins(user_id) values ($1)", [worker])).rejects.toThrow(/permission/i);
    await query('insert into public.invitation_requests(organization_id,requested_by,email) values ($1,$2,$3)', [org, worker, 'invite@example.com']);
    await expect(query("update public.invitation_requests set status='approved'")).rejects.toThrow(/permission/i);
    await expect(query('insert into public.invitation_requests(organization_id,requested_by,email) values ($1,$2,$3)', [org, worker, 'invite@example.com'])).rejects.toThrow(/unique/i);
    await expect(query('insert into public.invitation_requests(organization_id,requested_by,email) values ($1,$2,$3)', [otherOrg, worker, 'cross@example.com'])).rejects.toThrow();
    await owner();
    const request = (await query("select id from public.invitation_requests where email='invite@example.com'")).rows[0].id;
    await expect(query("insert into public.invitations(request_id,organization_id,email,role,approved_by,expires_at) values ($1,$2,'invite@example.com','GERENTE',$3,now()+interval '1 day')", [request, org, admin])).rejects.toThrow(/approval/i);
    await query("update public.invitation_requests set status='approved',decided_by=$1,decided_at=now() where id=$2", [admin, request]);
    await query("insert into public.invitations(request_id,organization_id,email,role,approved_by,expires_at) values ($1,$2,'invite@example.com','GERENTE',$3,now()+interval '1 day')", [request, org, admin]);
    await expect(query('update public.invitations set recipient_id=$1,consumed_at=now()', [peer])).rejects.toThrow(/confirmed recipient/i);
    await expect(query("update public.invitations set role='USUARIO'")).rejects.toThrow(/immutable/i);
    await as(worker);
    await query('insert into public.posts(id,organization_id,team_id,author_id,body) values ($1,$2,$3,$4,$5)', [post, org, team, worker, 'Visible por autor o mención']);
    await expect(query('insert into public.posts(organization_id,team_id,author_id,body) values ($1,$2,$3,$4)', [org, team2, worker, 'Equipo no autorizado'])).rejects.toThrow();
    await as(peer);
    await query('insert into public.posts(id,organization_id,team_id,author_id,body) values ($1,$2,$3,$4,$5)', [privatePost, org, team2, peer, 'Otra publicación']);
    expect(await count('posts')).toBe(1);
    await expect(query('insert into public.post_comments(post_id,organization_id,author_id,body) values ($1,$2,$3,$4)', [post, org, peer, 'No autorizado'])).rejects.toThrow();
    await owner();
    await query('insert into public.post_mentions(post_id,organization_id,member_id) values ($1,$2,$3)', [post, org, peer]);
    await expect(query('insert into public.post_mentions(post_id,organization_id,member_id) values ($1,$2,$3)', [post, org, outsider])).rejects.toThrow();
    await as(peer); expect(await count('posts')).toBe(2);
    await query('insert into public.post_comments(post_id,organization_id,author_id,body) values ($1,$2,$3,$4)', [post, org, peer, 'Mención válida']);
    await as(manager); expect(await count('posts')).toBe(2);
    await as(supervisor); expect(await count('posts')).toBe(2);
    await as(outsider); expect(await count('posts')).toBe(0); expect(await count('post_comments')).toBe(0);
    await as(admin); expect(await count('posts')).toBe(2);

    await as(manager);
    await query('insert into public.tasks(id,organization_id,team_id,created_by,assignee_id,title) values ($1,$2,$3,$4,$5,$6)', [task, org, team, manager, worker, 'Revisar molino']);
    await as(worker); expect(await count('tasks')).toBe(1);
    await query("update public.tasks set status='En progreso' where id=$1", [task]);
    await expect(query('update public.tasks set assignee_id=$1 where id=$2', [peer, task])).rejects.toThrow();
    await expect(query("update public.tasks set title='Alterado' where id=$1", [task])).rejects.toThrow();
    expect(await count('task_history')).toBe(2);
    await expect(query('delete from public.task_history')).rejects.toThrow(/permission/i);
    await as(peer); expect(await count('tasks')).toBe(0);
    await as(outsider); expect(await count('tasks')).toBe(0);
    await as(supervisor); expect(await count('tasks')).toBe(1);

    await owner();
    await expect(query('insert into public.conversations(organization_id,user_a,user_b) values ($1,$2,$3)', [org, worker, outsider])).rejects.toThrow(/two participants/i);
    await db.exec('begin');
    await query('insert into public.conversations(id,organization_id,user_a,user_b) values ($1,$2,$3,$4)', [conversation, org, worker, peer]);
    await query('insert into public.conversation_members(conversation_id,organization_id,member_id) values ($1,$2,$3),($1,$2,$4)', [conversation, org, worker, peer]);
    await db.exec('commit');
    await as(worker);
    await query('insert into public.messages(id,conversation_id,organization_id,sender_id,body) values ($1,$2,$3,$4,$5)', [message, conversation, org, worker, 'Solo participantes']);
    await as(peer); expect(await count('messages')).toBe(1);
    await query('insert into public.message_reads(message_id,conversation_id,user_id) values ($1,$2,$3)', [message, conversation, peer]);
    await expect(query('insert into public.message_reads(message_id,conversation_id,user_id) values ($1,$2,$3)', [message, conversation, worker])).rejects.toThrow();
    for (const user of [manager, supervisor, outsider, admin]) { await as(user); expect(await count('messages')).toBe(0); }
    await as(manager);
    await expect(query('select * from public.audit_message_page($1,$2)', [conversation, 'Supervisión de la conversación'])).rejects.toThrow(/administrator/i);
    await as(admin);
    await expect(query('select * from public.audit_message_page($1,$2)', [conversation, ''])).rejects.toThrow(/reason/i);
    expect(await count('audit_logs')).toBe(1); // explicit owner bootstrap
    expect((await query('select * from public.audit_message_page($1,$2)', [conversation, 'Supervisión de la conversación'])).rows).toHaveLength(1);
    expect(await count('audit_logs')).toBe(2);
    await expect(query('delete from public.audit_logs')).rejects.toThrow(/permission/i);

    await owner();
    await query('insert into public.attachments(id,organization_id,uploaded_by,post_id,object_path,mime_type,size_bytes) values ($1,$2,$3,$4,$5,$6,100)', [attachment, org, worker, post, `${org}/${attachment}`, 'image/jpeg']);
    await as(worker); await query("insert into storage.objects(bucket_id,name) values ('campo-private',$1)", [`${org}/${attachment}`]);
    expect((await query('select * from storage.objects')).rows).toHaveLength(1);
    await expect(query("insert into storage.objects(bucket_id,name) values ('campo-private','inventado')")).rejects.toThrow();
    await as(outsider); expect((await query('select * from storage.objects')).rows).toHaveLength(0);
    await as(peer); expect((await query('select * from storage.objects')).rows).toHaveLength(1);
    await as(worker);
    await expect(query("insert into public.audit_logs(actor_id,action,reason) values ($1,'fake','fake')", [worker])).rejects.toThrow(/permission/i);
    await db.exec('set role anon');
    await expect(query('select * from public.posts')).rejects.toThrow(/permission/i);
    await owner();
    await expect(query("update public.audit_logs set reason='Reescrito'")).rejects.toThrow(/append-only/i);
    // Team transfer preserves the original post/team and the author's access.
    await db.exec('begin');
    await query('update public.team_members set ended_at=now() where member_id=$1 and ended_at is null', [worker]);
    await query('insert into public.team_members(member_id,organization_id,team_id) values ($1,$2,$3)', [worker, org, team2]);
    await db.exec('commit');
    expect((await query('select team_id from public.posts where id=$1', [post])).rows[0].team_id).toBe(team);
    expect((await query('select * from public.team_members where member_id=$1', [worker])).rows).toHaveLength(2);
    await expect(query('delete from public.team_members where member_id=$1 and ended_at is not null', [worker])).rejects.toThrow(/append-only/i);
    await as(worker); expect(await count('posts')).toBe(1);
    await owner();
    await query("update auth.users set banned_until=now()+interval '1 day' where id=$1", [worker]);
    await as(worker); expect(await count('posts')).toBe(0); expect(await count('tasks')).toBe(0);
    await owner();
    expect((await query("select tablename from pg_tables where schemaname='public' and not rowsecurity")).rows).toHaveLength(0);
  } finally { await db.close(); }
}, 30000);
