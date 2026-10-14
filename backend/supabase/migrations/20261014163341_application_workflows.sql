-- Etapa D, LOCAL proposal only. Depends on the two preceding migrations.
begin;
-- Also harden installations that used the initial Etapa C proposal.
revoke all on function campo_private.validate_team_state() from public,anon,authenticated,service_role;
drop policy admin_self on public.platform_admins;
grant execute on function campo_private.active_identity() to authenticated;
create policy admin_self on public.platform_admins for select to authenticated using (user_id=(select auth.uid()) and active and campo_private.active_identity());
alter table public.posts add column gps_accuracy double precision check (gps_accuracy>=0);
alter table public.posts add column gps_source text check (gps_source in ('device','manual'));
alter table public.posts add constraint post_category_valid check (category in ('Infraestructura','Agua y hacienda','Sanidad vegetal','Tarea','Otra'));
alter table public.attachments add column ready boolean not null default false;
alter table public.attachments add column sha256 text check (sha256 ~ '^[0-9a-f]{64}$');
alter table public.conversations add column last_message_at timestamptz not null default now();
update public.conversations c set last_message_at=coalesce((select max(m.created_at) from public.messages m where m.conversation_id=c.id),c.created_at);
create index conversations_recent on public.conversations(last_message_at desc,id desc);
create index message_reads_user on public.message_reads(user_id,message_id);
alter table public.post_comments drop constraint post_comments_body_check;
alter table public.post_comments add check (length(body)<=1000);
alter table public.messages drop constraint messages_body_check;
alter table public.messages add check (length(body)<=4000);
-- All content writes now go through transactions which derive the actor and enforce child-resource access.
revoke insert (id,organization_id,team_id,author_id,body,location,latitude,longitude,suggestion,category,captured_at) on public.posts from authenticated;
revoke insert (id,post_id,organization_id,author_id,body) on public.post_comments from authenticated;
revoke insert (post_id,organization_id,user_id), delete on public.post_reactions from authenticated;
revoke insert (id,organization_id,team_id,created_by,assignee_id,post_id,title,description,priority,due_at),
  update (assignee_id,title,description,priority,due_at,status) on public.tasks from authenticated;
revoke insert (id,conversation_id,organization_id,sender_id,body) on public.messages from authenticated;
drop policy campo_files_insert on storage.objects;
drop policy campo_files_read on storage.objects;
create policy campo_files_read on storage.objects for select to authenticated using (
  bucket_id='campo-private' and exists(select 1 from public.attachments a where a.object_path=name and a.ready and campo_private.read_attachment(a.id)));

create function campo_private.reserve_attachment(file jsonb, org uuid, pid uuid, comment uuid, message uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare aid uuid;
begin
  if file is null or file='null'::jsonb then return null; end if;
  perform campo_private.check_keys(file,array['id','mime_type','size_bytes']); aid := (file->>'id')::uuid;
  if aid is null or jsonb_typeof(file->'size_bytes')<>'number' then raise exception 'Invalid attachment' using errcode='22023'; end if;
  insert into public.attachments(id,organization_id,uploaded_by,post_id,comment_id,message_id,object_path,mime_type,size_bytes)
    values(aid,org,auth.uid(),pid,comment,message,org::text||'/'||aid::text,file->>'mime_type',(file->>'size_bytes')::bigint);
  return aid;
end $$;
create function campo_private.content_command(action text, payload jsonb, operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid := auth.uid(); cached campo_private.command_results; result jsonb; rid uuid; org uuid; team uuid;
  p public.posts; t public.tasks; c public.conversations; mention_ids uuid[]; aid uuid; recipient uuid; m1 uuid; m2 uuid;
begin
  if not campo_private.active_identity() then raise exception 'Confirmed identity and live session required' using errcode='42501'; end if;
  if operation_id is null then raise exception 'Operation ID required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||operation_id::text,0));
  select * into cached from campo_private.command_results r where r.actor_id=actor and r.operation_id=content_command.operation_id;
  if found then
    if cached.action is distinct from action or cached.payload is distinct from payload then raise exception 'Operation ID reused' using errcode='23505'; end if;
    if (cached.result ? 'post_id' and not campo_private.read_post((cached.result->>'post_id')::uuid))
      or (cached.result ? 'task_id' and not campo_private.read_task((cached.result->>'task_id')::uuid))
      or (cached.result ? 'conversation_id' and not campo_private.read_conversation((cached.result->>'conversation_id')::uuid)) then
      raise exception 'Access revoked' using errcode='42501'; end if;
    return cached.result;
  end if;
  if action='post.create' then
    perform campo_private.check_keys(payload,array['organization_id','team_id','body','location','latitude','longitude','gps_accuracy','gps_source','suggestion','category','captured_at','mention_ids','attachment']);
    org := (payload->>'organization_id')::uuid; team := (payload->>'team_id')::uuid;
    if not campo_private.can_create(org,team) then raise exception 'Team publication not authorized' using errcode='42501'; end if;
    if jsonb_typeof(payload->'mention_ids') is distinct from 'array' then raise exception 'Mention IDs array required' using errcode='22023'; end if;
    select coalesce(array_agg(x::uuid),'{}'::uuid[]) into mention_ids from jsonb_array_elements_text(payload->'mention_ids') x;
    if cardinality(mention_ids)>100 or (select count(distinct x) from unnest(mention_ids) x)<>cardinality(mention_ids)
      or (select count(*) from public.organization_members where id=any(mention_ids) and organization_id=org and ended_at is null)<>cardinality(mention_ids)
      then raise exception 'Mentions must be active members of the organization' using errcode='22023'; end if;
    rid := operation_id;
    insert into public.posts(id,organization_id,team_id,author_id,body,location,latitude,longitude,gps_accuracy,gps_source,suggestion,category,captured_at)
      values(rid,org,team,actor,trim(payload->>'body'),coalesce(payload->>'location',''),(payload->>'latitude')::double precision,
        (payload->>'longitude')::double precision,(payload->>'gps_accuracy')::double precision,payload->>'gps_source',coalesce(payload->>'suggestion',''),coalesce(payload->>'category','Otra'),(payload->>'captured_at')::timestamptz);
    insert into public.post_mentions(post_id,organization_id,member_id) select rid,org,x from unnest(mention_ids) x;
    aid := campo_private.reserve_attachment(payload->'attachment',org,rid,null,null);
    result := jsonb_build_object('id',rid,'post_id',rid,'attachment_id',aid);
  elsif action in ('post.status','comment.create','reaction.set') then
    perform campo_private.check_keys(payload,case action when 'post.status' then array['post_id','status'] when 'comment.create' then array['post_id','body','attachment'] else array['post_id','liked'] end);
    rid := (payload->>'post_id')::uuid; select * into p from public.posts where id=rid for update;
    if not found or not campo_private.read_post(rid) then raise exception 'Publication not authorized' using errcode='42501'; end if;
    if action='post.status' then
      if not (campo_private.manages(p.organization_id,p.team_id) or (p.author_id=actor and campo_private.in_org(p.organization_id))) then
        raise exception 'Publication status not authorized' using errcode='42501'; end if;
      if payload->>'status' is null or payload->>'status' not in ('Pendiente','En Proceso','Resuelto') then raise exception 'Invalid status' using errcode='22023'; end if;
      if p.status is distinct from payload->>'status' then
        update public.posts set status=payload->>'status' where id=rid;
        insert into public.post_comments(post_id,organization_id,author_id,body) values(rid,p.organization_id,actor,'Cambió el estado a '||(payload->>'status')||'.');
      end if;
      result := jsonb_build_object('id',rid,'post_id',rid);
    elsif action='comment.create' then
      if coalesce(length(trim(payload->>'body')),0)=0 and coalesce(payload->'attachment','null'::jsonb)='null'::jsonb then raise exception 'Text or attachment required' using errcode='22023'; end if;
      insert into public.post_comments(id,post_id,organization_id,author_id,body) values(operation_id,rid,p.organization_id,actor,coalesce(trim(payload->>'body'),''));
      aid := campo_private.reserve_attachment(payload->'attachment',p.organization_id,null,operation_id,null);
      result := jsonb_build_object('id',operation_id,'post_id',rid,'attachment_id',aid);
    else
      if jsonb_typeof(payload->'liked') is distinct from 'boolean' then raise exception 'Invalid reaction' using errcode='22023'; end if;
      if (payload->>'liked')::boolean then insert into public.post_reactions(post_id,organization_id,user_id) values(rid,p.organization_id,actor) on conflict do nothing;
      else delete from public.post_reactions where post_id=rid and user_id=actor; end if;
      result := jsonb_build_object('id',rid,'post_id',rid);
    end if;
  elsif action='task.create' then
    perform campo_private.check_keys(payload,array['organization_id','team_id','assignee_id','post_id','title','description','priority','due_at']);
    org := (payload->>'organization_id')::uuid; team := (payload->>'team_id')::uuid;
    if not campo_private.can_create(org,team) or (not campo_private.manages(org,team) and (payload->>'assignee_id')::uuid is distinct from actor) then
      raise exception 'Task assignment not authorized' using errcode='42501'; end if;
    if payload->>'post_id' is not null and not campo_private.read_post((payload->>'post_id')::uuid) then raise exception 'Linked publication not authorized' using errcode='42501'; end if;
    insert into public.tasks(id,organization_id,team_id,created_by,assignee_id,post_id,title,description,priority,due_at)
      values(operation_id,org,team,actor,(payload->>'assignee_id')::uuid,(payload->>'post_id')::uuid,trim(payload->>'title'),
        coalesce(payload->>'description',''),coalesce(payload->>'priority','normal'),(payload->>'due_at')::timestamptz);
    result := jsonb_build_object('id',operation_id,'task_id',operation_id);
  elsif action='task.update' then
    perform campo_private.check_keys(payload,array['task_id','assignee_id','title','description','priority','due_at','status']);
    rid := (payload->>'task_id')::uuid; select * into t from public.tasks where id=rid for update;
    if not found or not (campo_private.manages(t.organization_id,t.team_id) or (t.assignee_id=actor and campo_private.in_org(t.organization_id))) then
      raise exception 'Task update not authorized' using errcode='42501'; end if;
    update public.tasks set assignee_id=case when payload ? 'assignee_id' then (payload->>'assignee_id')::uuid else assignee_id end,
      title=case when payload ? 'title' then trim(payload->>'title') else title end,
      description=case when payload ? 'description' then payload->>'description' else description end,
      priority=case when payload ? 'priority' then payload->>'priority' else priority end,
      due_at=case when payload ? 'due_at' then (payload->>'due_at')::timestamptz else due_at end,
      status=case when payload ? 'status' then payload->>'status' else status end where id=rid;
    result := jsonb_build_object('id',rid,'task_id',rid);
  elsif action='conversation.open' then
    perform campo_private.check_keys(payload,array['recipient_id']); recipient := (payload->>'recipient_id')::uuid;
    select id,organization_id into m1,org from public.organization_members where user_id=actor and ended_at is null;
    select id into m2 from public.organization_members where user_id=recipient and organization_id=org and ended_at is null;
    if m1 is null or m2 is null or actor=recipient or not campo_private.in_org(org)
      or not exists(select 1 from public.platform_settings where messaging_scope='same_organization')
      or not exists(select 1 from auth.users where id=recipient and email_confirmed_at is not null and (banned_until is null or banned_until<now())) then
      raise exception 'Conversation participants not authorized' using errcode='42501'; end if;
    insert into public.conversations(organization_id,user_a,user_b) values(org,least(actor,recipient),greatest(actor,recipient))
      on conflict (organization_id,user_a,user_b) do update set user_a=excluded.user_a returning * into c;
    if not exists(select 1 from public.conversation_members where conversation_id=c.id) then
      insert into public.conversation_members(conversation_id,organization_id,member_id) values(c.id,org,m1),(c.id,org,m2);
    end if;
    result := jsonb_build_object('id',c.id,'conversation_id',c.id);
  elsif action='message.send' then
    perform campo_private.check_keys(payload,array['conversation_id','body','attachment']); rid := (payload->>'conversation_id')::uuid;
    select * into c from public.conversations where id=rid;
    if not found or not campo_private.read_conversation(rid) or not exists(select 1 from public.organization_members
      where user_id=case when c.user_a=actor then c.user_b else c.user_a end and organization_id=c.organization_id and ended_at is null) then
      raise exception 'Conversation not authorized' using errcode='42501'; end if;
    if not exists(select 1 from auth.users where id=case when c.user_a=actor then c.user_b else c.user_a end
      and email_confirmed_at is not null and (banned_until is null or banned_until<now())) then raise exception 'Recipient unavailable' using errcode='42501'; end if;
    if coalesce(length(trim(payload->>'body')),0)=0 and coalesce(payload->'attachment','null'::jsonb)='null'::jsonb then raise exception 'Text or attachment required' using errcode='22023'; end if;
    insert into public.messages(id,conversation_id,organization_id,sender_id,body) values(operation_id,rid,c.organization_id,actor,coalesce(trim(payload->>'body'),''));
    aid := campo_private.reserve_attachment(payload->'attachment',c.organization_id,null,null,operation_id);
    result := jsonb_build_object('id',operation_id,'conversation_id',rid,'attachment_id',aid);
  else raise exception 'Unsupported content action' using errcode='22023'; end if;
  insert into campo_private.command_results values(actor,operation_id,action,payload,result,now());
  return result;
end $$;

create function campo_private.finish_attachment(aid uuid, checksum text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.attachments;
begin
  select * into a from public.attachments where id=aid for update;
  if not found or checksum is null or checksum !~ '^[0-9a-f]{64}$' then raise exception 'Invalid attachment' using errcode='22023'; end if;
  if a.ready and a.sha256 is distinct from checksum then raise exception 'Immutable attachment differs' using errcode='23505'; end if;
  if not exists(select 1 from storage.objects where bucket_id='campo-private' and name=a.object_path) then raise exception 'Upload not found' using errcode='P0002'; end if;
  update public.attachments set ready=true,sha256=checksum where id=aid;
  return jsonb_build_object('id',aid,'status','ready');
end $$;
create function campo_private.message_activity() returns trigger
language plpgsql security definer set search_path='' as $$
begin update public.conversations set last_message_at=greatest(last_message_at,new.created_at) where id=new.conversation_id; return new; end $$;
create trigger message_activity after insert on public.messages for each row execute function campo_private.message_activity();

create function campo_private.inbox(page_before timestamptz, before_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; unread bigint;
begin
  if not campo_private.active_identity() then raise exception 'Live identity required' using errcode='42501'; end if;
  if (page_before is null)<>(before_id is null) then raise exception 'Invalid cursor' using errcode='22023'; end if;
  select count(*) into unread from public.messages m where m.sender_id<>auth.uid() and campo_private.read_conversation(m.conversation_id)
    and not exists(select 1 from public.message_reads r where r.message_id=m.id and r.user_id=auth.uid());
  select coalesce(jsonb_agg(to_jsonb(x) order by x.last_message_at desc,x.id desc),'[]'::jsonb) into rows from (
    select c.*, (select body from public.messages where conversation_id=c.id order by created_at desc,id desc limit 1) as preview,
      (select count(*) from public.messages m where m.conversation_id=c.id and m.sender_id<>auth.uid() and not exists(select 1 from public.message_reads r where r.message_id=m.id and r.user_id=auth.uid())) as unread
    from public.conversations c where campo_private.read_conversation(c.id) and (page_before is null or (c.last_message_at,c.id)<(page_before,before_id))
    order by c.last_message_at desc,c.id desc limit 50
  ) x;
  return jsonb_build_object('conversations',rows,'unread_total',unread);
end $$;
create function campo_private.audit_conversations(page_before timestamptz, before_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
  perform campo_private.require_admin();
  if (page_before is null)<>(before_id is null) then raise exception 'Invalid cursor' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]'::jsonb) into rows from (
    select id,organization_id,user_a,user_b,created_at from public.conversations
    where page_before is null or (created_at,id)<(page_before,before_id) order by created_at desc,id desc limit 50
  ) x;
  return rows; -- Directory metadata only: no message body, preview or attachment.
end $$;
create function public.campo_content_command(action text,payload jsonb,operation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.content_command(action,payload,operation_id) $$;
create function campo_private.accounts(term text,before_email text,before_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform campo_private.require_admin();
  if term is null or length(term)>254 or (before_email is null)<>(before_id is null) then raise exception 'Invalid account query' using errcode='22023'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.email,x.id),'[]'::jsonb) into result from (
    select u.id,lower(u.email) as email,u.email_confirmed_at,(u.banned_until is not null and u.banned_until>now()) as banned
    from auth.users u where u.email is not null and position(lower(term) in lower(u.email))>0
      and (before_email is null or (lower(u.email),u.id)>(before_email,before_id)) order by lower(u.email),u.id limit 50
  ) x;
  return result;
end $$;
create function public.campo_accounts(term text default '',before_email text default null,before_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.accounts(term,before_email,before_id) $$;
revoke all on function public.campo_accounts(text,text,uuid),campo_private.accounts(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.campo_accounts(text,text,uuid),campo_private.accounts(text,text,uuid) to authenticated;
create function campo_private.audited_message_page(cid uuid,why text,page_before timestamptz,before_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('attachments',coalesce((
    select jsonb_agg(jsonb_build_object('id',a.id,'mime_type',a.mime_type,'size_bytes',a.size_bytes))
    from public.attachments a where a.message_id=m.id and a.ready),'[]'::jsonb)) order by m.created_at desc,m.id desc),'[]'::jsonb)
    into result from campo_private.audit_messages(cid,why,page_before,before_id) m;
  return result;
end $$;
create function campo_private.audit_attachment(aid uuid,why text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.attachments; conversation uuid;
begin
  perform campo_private.require_admin();
  if why is null or length(trim(why)) not between 10 and 1000 then raise exception 'Audit reason required' using errcode='22023'; end if;
  select * into a from public.attachments where id=aid and message_id is not null and ready;
  if not found then raise exception 'Message attachment unavailable' using errcode='P0002'; end if;
  select conversation_id into conversation from public.messages where id=a.message_id;
  insert into public.audit_logs(actor_id,action,resource_id,reason,details) values(auth.uid(),'messages.attachment_read',aid,trim(why),jsonb_build_object('conversation_id',conversation,'message_id',a.message_id));
  return jsonb_build_object('object_path',a.object_path,'mime_type',a.mime_type,'id',a.id);
end $$;
create function public.campo_audit_message_page(cid uuid,why text,page_before timestamptz default null,before_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.audited_message_page(cid,why,page_before,before_id) $$;
create function public.campo_audit_attachment(aid uuid,why text) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.audit_attachment(aid,why) $$;
revoke all on function public.campo_audit_message_page(uuid,text,timestamptz,uuid),campo_private.audited_message_page(uuid,text,timestamptz,uuid),public.campo_audit_attachment(uuid,text),campo_private.audit_attachment(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.campo_audit_message_page(uuid,text,timestamptz,uuid),campo_private.audited_message_page(uuid,text,timestamptz,uuid),public.campo_audit_attachment(uuid,text),campo_private.audit_attachment(uuid,text) to authenticated;
create function public.campo_finish_attachment(aid uuid,checksum text) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.finish_attachment(aid,checksum) $$;
create function public.campo_inbox(page_before timestamptz default null,before_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.inbox(page_before,before_id) $$;
create function public.campo_audit_conversations(page_before timestamptz default null,before_id uuid default null) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.audit_conversations(page_before,before_id) $$;
revoke all on function public.campo_content_command(text,jsonb,uuid),public.campo_finish_attachment(uuid,text),public.campo_inbox(timestamptz,uuid),public.campo_audit_conversations(timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function campo_private.reserve_attachment(jsonb,uuid,uuid,uuid,uuid),campo_private.content_command(text,jsonb,uuid),campo_private.finish_attachment(uuid,text),
  campo_private.inbox(timestamptz,uuid),campo_private.audit_conversations(timestamptz,uuid),campo_private.message_activity() from public,anon,authenticated,service_role;
grant execute on function public.campo_content_command(text,jsonb,uuid),campo_private.content_command(text,jsonb,uuid),public.campo_inbox(timestamptz,uuid),campo_private.inbox(timestamptz,uuid),
  public.campo_audit_conversations(timestamptz,uuid),campo_private.audit_conversations(timestamptz,uuid) to authenticated;
grant execute on function public.campo_finish_attachment(uuid,text),campo_private.finish_attachment(uuid,text) to service_role;
-- Local PGlite does not have logical replication; managed Supabase does.
do $$ declare t text; begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    foreach t in array array['messages','message_reads','tasks','post_mentions','posts','post_comments','post_reactions','attachments'] loop
      if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
        execute format('alter publication supabase_realtime add table public.%I',t);
      end if;
    end loop;
  end if;
end $$;
commit;
