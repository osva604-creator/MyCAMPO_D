import { beforeAll,afterAll,expect,it } from 'vitest';
import { platformDb,ids,id } from './helpers/platform-db';

let f,post,conversation;
beforeAll(async()=>{f=await platformDb({application:true});},30000);
afterAll(async()=>{await f?.db.close();});
const command=(action,payload,operation=crypto.randomUUID())=>f.rpc('campo_content_command',[action,JSON.stringify(payload),operation]);
it('creates publications transactionally with real mentions, scoped teams and idempotent retries',async()=>{
  await f.as(ids.worker);const mention=(await f.query('select id from public.organization_members where user_id=$1 and ended_at is null',[ids.supervisor])).rows[0].id;
  const operation=id(200),payload={organization_id:ids.org,team_id:ids.team,body:'Revisar molino',location:'Lote 1',mention_ids:[mention]};
  post=await command('post.create',payload,operation);
  expect(await command('post.create',payload,operation)).toEqual(post);
  expect((await f.query('select * from public.posts')).rows).toHaveLength(1);
  await expect(command('post.create',{...payload,team_id:ids.otherTeam})).rejects.toThrow(/authorized/i);
  await expect(command('post.create',{...payload,mention_ids:[ids.other]})).rejects.toThrow(/Mentions/i);
  await expect(f.query('insert into public.posts(organization_id,team_id,author_id,body) values($1,$2,$3,$4)',[ids.org,ids.team,ids.worker,'Bypass'])).rejects.toThrow(/permission/i);
});
it('authorizes comments and status independently and isolates the child resources',async()=>{
  await f.as(ids.worker);await command('comment.create',{post_id:post.id,body:'Preparando reparación'});await command('reaction.set',{post_id:post.id,liked:true});
  await command('post.status',{post_id:post.id,status:'En Proceso'});
  expect((await f.query('select * from public.post_comments')).rows).toHaveLength(2);
  await f.as(ids.other);await expect(command('comment.create',{post_id:post.id,body:'Intrusión'})).rejects.toThrow(/authorized/i);
  expect((await f.query('select * from public.post_comments')).rows).toHaveLength(0);
});
it('validates task assignments and records changes while preventing assignee escalation',async()=>{
  await f.as(ids.manager);const task=await command('task.create',{organization_id:ids.org,team_id:ids.team,assignee_id:ids.worker,title:'Reparar molino',post_id:post.id});
  await f.as(ids.worker);await command('task.update',{task_id:task.id,status:'Completada'});
  expect((await f.query('select * from public.task_history where task_id=$1',[task.id])).rows).toHaveLength(2);
  await expect(command('task.update',{task_id:task.id,assignee_id:ids.manager})).rejects.toThrow();
  await expect(command('task.create',{organization_id:ids.org,team_id:ids.team,assignee_id:ids.manager,title:'Asignación indebida'})).rejects.toThrow(/authorized/i);
  await f.as(ids.other);expect((await f.query('select * from public.tasks')).rows).toHaveLength(0);
});
it('creates private same-organization conversations, unread counts and participant-only receipts',async()=>{
  await f.as(ids.worker);conversation=await command('conversation.open',{recipient_id:ids.manager});
  const duplicate=await command('conversation.open',{recipient_id:ids.manager});expect(duplicate.conversation_id).toBe(conversation.conversation_id);
  await command('message.send',{conversation_id:conversation.conversation_id,body:'Mensaje privado'});
  await expect(command('conversation.open',{recipient_id:ids.other})).rejects.toThrow(/authorized/i);
  await f.as(ids.manager);expect((await f.rpc('campo_inbox')).unread_total).toBe(1);
  const message=(await f.query('select id from public.messages')).rows[0];
  await f.query('insert into public.message_reads(message_id,conversation_id,user_id) values($1,$2,$3)',[message.id,conversation.conversation_id,ids.manager]);
  expect((await f.rpc('campo_inbox')).unread_total).toBe(0);
  await f.as(ids.admin);expect((await f.rpc('campo_inbox')).conversations).toHaveLength(0);
  expect(await f.rpc('campo_audit_conversations')).toHaveLength(1);
  expect((await f.query('select * from public.messages')).rows).toHaveLength(0);
  const messages=await f.query('select * from public.audit_message_page($1,$2)',[conversation.conversation_id,'Supervisión de prueba explícita']);
  expect(messages.rows).toHaveLength(1);
  await f.as(ids.other);await expect(f.rpc('campo_audit_conversations')).rejects.toThrow(/administrator/i);
});
it('keeps reserved files private until verified upload and denies arbitrary object paths and finalization',async()=>{
  await f.as(ids.worker);const aid=id(201);
  const comment=await command('comment.create',{post_id:post.id,body:'',attachment:{id:aid,mime_type:'image/jpeg',size_bytes:3}});
  expect(comment.attachment_id).toBe(aid);
  await expect(f.query("insert into storage.objects(bucket_id,name) values('campo-private',$1)",[`${ids.org}/${aid}`])).rejects.toThrow();
  await expect(f.rpc('campo_finish_attachment',[aid,'a'.repeat(64)])).rejects.toThrow(/permission/i);
  await f.owner();await f.query("insert into storage.objects(bucket_id,name) values('campo-private',$1)",[`${ids.org}/${aid}`]);
  await f.as(ids.worker);expect((await f.query('select * from storage.objects')).rows).toHaveLength(0);
  await f.service();await f.rpc('campo_finish_attachment',[aid,'a'.repeat(64)]);
  await f.as(ids.worker);expect((await f.query('select * from storage.objects')).rows).toHaveLength(1);
  await f.as(ids.other);expect((await f.query('select * from storage.objects')).rows).toHaveLength(0);
});
it('restricts the Auth account directory to the actual platform owner',async()=>{
  await f.as(ids.worker);await expect(f.rpc('campo_accounts')).rejects.toThrow(/administrator/i);
  await f.as(ids.admin);const accounts=await f.rpc('campo_accounts',['worker']);expect(accounts).toHaveLength(1);expect(accounts[0].email).toBe('worker@example.com');expect(accounts[0].encrypted_password).toBeUndefined();
});
it('requires a separately logged administrative access for every message attachment',async()=>{
  await f.as(ids.worker);const aid=id(202);
  await command('message.send',{conversation_id:conversation.conversation_id,body:'Foto privada',attachment:{id:aid,mime_type:'image/jpeg',size_bytes:4}});
  await f.owner();await f.query("insert into storage.objects(bucket_id,name) values('campo-private',$1)",[`${ids.org}/${aid}`]);
  await f.service();await f.rpc('campo_finish_attachment',[aid,'b'.repeat(64)]);
  await f.as(ids.admin);
  expect((await f.query('select * from storage.objects')).rows).toHaveLength(1); // The post attachment is visible; the message attachment is not.
  const page=await f.rpc('campo_audit_message_page',[conversation.conversation_id,'Supervisión explícita del incidente']);
  expect(page.some(m=>m.attachments.some(a=>a.id===aid))).toBe(true);
  const audited=await f.rpc('campo_audit_attachment',[aid,'Verificación de la evidencia fotográfica']);expect(audited.id).toBe(aid);
  expect((await f.query("select * from public.audit_logs where action='messages.attachment_read'")).rows).toHaveLength(1);
  await f.as(ids.other);await expect(f.rpc('campo_audit_attachment',[aid,'Acceso no autorizado a la evidencia'])).rejects.toThrow(/administrator/i);
});
it('keeps exposed entry points as invokers and denies anonymous private helpers and removed sessions',async()=>{
  await f.owner();
  expect((await f.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef")).rows).toHaveLength(0);
  expect((await f.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='campo_private' and has_function_privilege('anon',p.oid,'EXECUTE')")).rows).toHaveLength(0);
  await f.query('delete from auth.sessions where user_id=$1',[ids.admin]);await f.as(ids.admin);
  expect((await f.query('select * from public.platform_admins')).rows).toHaveLength(0);
});
