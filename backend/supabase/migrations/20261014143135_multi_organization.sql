-- PROPOSAL ONLY. New multi-organization installation; do not combine with legacy migrations.
begin;
do $$ begin
  if to_regclass('public.members') is not null or to_regclass('public.events') is not null then
    raise exception 'Legacy schema detected: an explicit data migration is required';
  end if;
end $$;
create schema campo_private;
revoke all on schema campo_private from public, anon;
grant usage on schema campo_private to authenticated;

create table public.platform_admins (
  user_id uuid primary key references auth.users(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index one_active_platform_admin on public.platform_admins ((true)) where active;
create table public.platform_settings (
  singleton boolean primary key default true check (singleton),
  messaging_scope text not null default 'same_organization'
    check (messaging_scope in ('same_organization', 'disabled'))
);
insert into public.platform_settings default values;
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  name text not null check (length(trim(name)) between 1 and 80),
  role text not null check (role in ('GERENTE', 'ENCARGADO', 'USUARIO')),
  joined_at timestamptz not null default now(),
  ended_at timestamptz check (ended_at >= joined_at),
  unique (id, organization_id)
);
create unique index one_active_organization on public.organization_members(user_id) where ended_at is null;
create index directory_organization on public.organization_members(organization_id, user_id) where ended_at is null;
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  name text not null check (length(trim(name)) between 1 and 120),
  active boolean not null default true,
  unique (id, organization_id), unique (organization_id, name)
);
create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  team_id uuid not null,
  joined_at timestamptz not null default now(),
  ended_at timestamptz check (ended_at >= joined_at),
  foreign key (member_id, organization_id) references public.organization_members(id, organization_id),
  foreign key (team_id, organization_id) references public.teams(id, organization_id)
);
create unique index one_active_team on public.team_members(member_id) where ended_at is null;
create index team_members_lookup on public.team_members(team_id, member_id) where ended_at is null;
create table public.team_supervisors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  member_id uuid not null,
  team_id uuid not null,
  joined_at timestamptz not null default now(),
  ended_at timestamptz check (ended_at >= joined_at),
  foreign key (member_id, organization_id) references public.organization_members(id, organization_id),
  foreign key (team_id, organization_id) references public.teams(id, organization_id)
);
create unique index active_supervision on public.team_supervisors(member_id, team_id) where ended_at is null;
create index supervisors_team on public.team_supervisors(team_id, member_id) where ended_at is null;

create table public.invitation_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  requested_by uuid not null references auth.users(id),
  email text not null check (email = lower(trim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(email) <= 254),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.platform_admins(user_id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_by is not null and decided_at is not null))
);
create unique index pending_invitation_email on public.invitation_requests(email) where status = 'pending';
create index invitation_requests_org on public.invitation_requests(organization_id, created_at);
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.invitation_requests(id),
  organization_id uuid not null references public.organizations(id),
  email text not null,
  role text not null check (role in ('GERENTE', 'ENCARGADO', 'USUARIO')),
  approved_by uuid not null references public.platform_admins(user_id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  recipient_id uuid references auth.users(id),
  consumed_at timestamptz,
  revoked_at timestamptz,
  delivery_status text not null default 'pending' check (delivery_status in ('pending', 'sending', 'sent', 'failed')),
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  check (expires_at > created_at),
  check (consumed_at is null or recipient_id is not null),
  unique (id, organization_id)
);
create unique index invitation_recipient_active on public.invitations(recipient_id) where consumed_at is null and recipient_id is not null;
create unique index invitation_email_active on public.invitations(email) where consumed_at is null and revoked_at is null;
create table public.invitation_teams (
  invitation_id uuid not null,
  organization_id uuid not null,
  team_id uuid not null,
  primary key (invitation_id, team_id),
  foreign key (invitation_id, organization_id) references public.invitations(id, organization_id),
  foreign key (team_id, organization_id) references public.teams(id, organization_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  team_id uuid not null,
  author_id uuid not null references auth.users(id),
  body text not null check (length(trim(body)) between 1 and 2000),
  location text not null default '' check (length(location) <= 120),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  suggestion text not null default '' check (length(suggestion) <= 1000),
  category text not null default 'Otra',
  status text not null default 'Pendiente' check (status in ('Pendiente', 'En Proceso', 'Resuelto')),
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  unique (id, organization_id),
  foreign key (team_id, organization_id) references public.teams(id, organization_id)
);
create index posts_org_chronology on public.posts(organization_id, created_at desc, id);
create index posts_team on public.posts(team_id, created_at desc);
create index posts_author on public.posts(author_id, created_at desc);
create table public.post_mentions (
  post_id uuid not null,
  organization_id uuid not null,
  member_id uuid not null,
  primary key (post_id, member_id),
  foreign key (post_id, organization_id) references public.posts(id, organization_id),
  foreign key (member_id, organization_id) references public.organization_members(id, organization_id)
);
create index mentions_member on public.post_mentions(member_id, post_id);
create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  organization_id uuid not null,
  author_id uuid not null references auth.users(id),
  body text not null check (length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (post_id, organization_id) references public.posts(id, organization_id),
  unique (id, organization_id)
);
create index comments_post on public.post_comments(post_id, created_at);
create table public.post_reactions (
  post_id uuid not null,
  organization_id uuid not null,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  foreign key (post_id, organization_id) references public.posts(id, organization_id)
);
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  team_id uuid not null,
  created_by uuid not null references auth.users(id),
  assignee_id uuid not null references auth.users(id),
  post_id uuid,
  title text not null check (length(trim(title)) between 1 and 160),
  description text not null default '' check (length(description) <= 4000),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'Pendiente' check (status in ('Pendiente', 'En progreso', 'Completada', 'Cancelada')),
  due_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (team_id, organization_id) references public.teams(id, organization_id),
  foreign key (post_id, organization_id) references public.posts(id, organization_id)
);
create index tasks_org on public.tasks(organization_id, created_at desc);
create index tasks_team on public.tasks(team_id, status);
create index tasks_assignee on public.tasks(assignee_id, status);
create index tasks_creator on public.tasks(created_by);
create index tasks_post on public.tasks(post_id);
create table public.task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id),
  actor_id uuid references auth.users(id),
  old_values jsonb,
  new_values jsonb not null,
  created_at timestamptz not null default now()
);
create index task_history_task on public.task_history(task_id, created_at);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  user_a uuid not null references auth.users(id),
  user_b uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (user_a < user_b),
  unique (organization_id, user_a, user_b),
  unique (id, organization_id)
);
create table public.conversation_members (
  conversation_id uuid not null,
  organization_id uuid not null,
  member_id uuid not null,
  primary key (conversation_id, member_id),
  foreign key (conversation_id, organization_id) references public.conversations(id, organization_id),
  foreign key (member_id, organization_id) references public.organization_members(id, organization_id)
);
create index conversation_member_lookup on public.conversation_members(member_id, conversation_id);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  organization_id uuid not null,
  sender_id uuid not null references auth.users(id),
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  foreign key (conversation_id, organization_id) references public.conversations(id, organization_id),
  unique (id, conversation_id), unique (id, organization_id)
);
create index messages_conversation on public.messages(conversation_id, created_at desc, id);
create table public.message_reads (
  message_id uuid not null,
  conversation_id uuid not null,
  user_id uuid not null references auth.users(id),
  read_at timestamptz not null default now(),
  primary key (message_id, user_id),
  foreign key (message_id, conversation_id) references public.messages(id, conversation_id)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  action text not null check (length(action) between 1 and 100),
  resource_id uuid,
  reason text not null check (length(trim(reason)) between 1 and 1000),
  details jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_actor on public.audit_logs(actor_id, created_at desc);
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  uploaded_by uuid not null references auth.users(id),
  post_id uuid,
  comment_id uuid,
  message_id uuid,
  object_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  created_at timestamptz not null default now(),
  check (num_nonnulls(post_id, comment_id, message_id) = 1),
  check (object_path = organization_id::text || '/' || id::text),
  foreign key (post_id, organization_id) references public.posts(id, organization_id),
  foreign key (comment_id, organization_id) references public.post_comments(id, organization_id),
  foreign key (message_id, organization_id) references public.messages(id, organization_id)
);
create index attachments_post on public.attachments(post_id);
create index attachments_comment on public.attachments(comment_id);
create index attachments_message on public.attachments(message_id);

-- Non-exposed, fixed-search-path lookup helpers avoid recursive RLS. Each is tied to auth.uid().
create function campo_private.active_identity() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from auth.users u where u.id = auth.uid()
    and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until < now()))
$$;
create function campo_private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select campo_private.active_identity() and exists (select 1 from public.platform_admins where user_id = auth.uid() and active)
$$;
create function campo_private.in_org(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select campo_private.active_identity() and exists (
    select 1 from public.organization_members m join public.organizations o on o.id = m.organization_id
    where m.user_id = auth.uid() and m.organization_id = org and m.ended_at is null and o.active)
$$;
create function campo_private.manages(org uuid, team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select campo_private.is_admin() or (campo_private.in_org(org) and exists (
    select 1 from public.organization_members m where m.user_id = auth.uid() and m.organization_id = org and m.ended_at is null
    and (m.role = 'GERENTE' or (m.role = 'ENCARGADO' and exists (
      select 1 from public.team_supervisors s where s.member_id = m.id and s.team_id = team and s.ended_at is null)))))
$$;
create function campo_private.can_create(org uuid, team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.teams t join public.organizations o on o.id = t.organization_id
    where t.id = team and t.organization_id = org and t.active and o.active) and
  (campo_private.manages(org, team) or (campo_private.in_org(org) and exists (
    select 1 from public.team_members t join public.organization_members m on m.id = t.member_id
    where m.user_id = auth.uid() and m.ended_at is null and m.role = 'USUARIO' and t.team_id = team and t.ended_at is null)))
$$;
create function campo_private.read_post(pid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.posts p where p.id = pid and (
    campo_private.manages(p.organization_id, p.team_id) or (campo_private.in_org(p.organization_id) and (
      p.author_id = auth.uid() or exists (select 1 from public.post_mentions x join public.organization_members m on m.id = x.member_id
        where x.post_id = p.id and m.user_id = auth.uid())))))
$$;
create function campo_private.read_task(tid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.tasks t where t.id = tid and (
    campo_private.manages(t.organization_id, t.team_id) or (campo_private.in_org(t.organization_id)
      and auth.uid() in (t.created_by, t.assignee_id))))
$$;
create function campo_private.read_conversation(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.conversations c join public.conversation_members cm on cm.conversation_id = c.id
    join public.organization_members m on m.id = cm.member_id
    where c.id = cid and m.user_id = auth.uid() and campo_private.in_org(c.organization_id)
      and auth.uid() in (c.user_a, c.user_b)
      and exists (select 1 from public.platform_settings where messaging_scope = 'same_organization'))
$$;
create function campo_private.read_attachment(aid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (select 1 from public.attachments a where a.id = aid and (
    (a.post_id is not null and campo_private.read_post(a.post_id)) or
    (a.comment_id is not null and exists (select 1 from public.post_comments c where c.id = a.comment_id and campo_private.read_post(c.post_id))) or
    (a.message_id is not null and exists (select 1 from public.messages m where m.id = a.message_id and campo_private.read_conversation(m.conversation_id)))))
$$;

-- Constraints apply even to backend writes; all membership changes serialize on the member row.
create function campo_private.validate_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
declare mid uuid; m public.organization_members; n integer; s integer;
begin
  if tg_table_name = 'organization_members' then mid := coalesce(new.id, old.id);
  else mid := coalesce(new.member_id, old.member_id); end if;
  select * into m from public.organization_members where id = mid for update;
  if not found then return null; end if;
  select count(*) into n from public.team_members where member_id = mid and ended_at is null;
  select count(*) into s from public.team_supervisors where member_id = mid and ended_at is null;
  if exists (select 1 from public.team_members tm join public.teams t on t.id = tm.team_id
    where tm.member_id = mid and tm.ended_at is null and not t.active)
    or exists (select 1 from public.team_supervisors ts join public.teams t on t.id = ts.team_id
    where ts.member_id = mid and ts.ended_at is null and not t.active)
    then raise exception 'Active assignments require active teams'; end if;
  if m.ended_at is not null and n + s <> 0 then raise exception 'Inactive membership has active assignments'; end if;
  if m.ended_at is null and ((m.role = 'USUARIO' and (n <> 1 or s <> 0))
    or (m.role = 'ENCARGADO' and (n <> 0 or s < 1)) or (m.role = 'GERENTE' and n + s <> 0))
    then raise exception 'Role and team assignments do not match'; end if;
  return null;
end $$;
create constraint trigger validate_membership after insert or update or delete on public.organization_members
  deferrable initially deferred for each row execute function campo_private.validate_membership();
create constraint trigger validate_member_team after insert or update or delete on public.team_members
  deferrable initially deferred for each row execute function campo_private.validate_membership();
create constraint trigger validate_supervised_team after insert or update or delete on public.team_supervisors
  deferrable initially deferred for each row execute function campo_private.validate_membership();

create function campo_private.immutable_history_keys() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'organization_members' then
    if (new.id, new.user_id, new.organization_id, new.role, new.joined_at) is distinct from (old.id, old.user_id, old.organization_id, old.role, old.joined_at)
      or (old.ended_at is not null and new is distinct from old)
      then raise exception 'Membership history is immutable'; end if;
  else
    if (new.id, new.member_id, new.organization_id, new.team_id, new.joined_at) is distinct from
       (old.id, old.member_id, old.organization_id, old.team_id, old.joined_at)
      or (old.ended_at is not null and new is distinct from old)
      then raise exception 'Assignment history is immutable'; end if;
  end if;
  return new;
end $$;
create trigger membership_history before update on public.organization_members for each row execute function campo_private.immutable_history_keys();
create trigger team_history before update on public.team_members for each row execute function campo_private.immutable_history_keys();
create trigger supervisor_history before update on public.team_supervisors for each row execute function campo_private.immutable_history_keys();

create function campo_private.validate_conversation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cid uuid; c public.conversations; n integer;
begin
  if tg_table_name = 'conversations' then cid := coalesce(new.id, old.id);
  else cid := coalesce(new.conversation_id, old.conversation_id); end if;
  select * into c from public.conversations where id = cid for update;
  if not found then return null; end if;
  select count(*) into n from public.conversation_members cm join public.organization_members m on m.id = cm.member_id
    where cm.conversation_id = cid and m.user_id in (c.user_a, c.user_b);
  if n <> 2 or (select count(*) from public.conversation_members where conversation_id = cid) <> 2
    then raise exception 'A conversation requires exactly its two participants'; end if;
  return null;
end $$;
create constraint trigger conversation_pair after insert or update on public.conversations
  deferrable initially deferred for each row execute function campo_private.validate_conversation();
create constraint trigger conversation_pair_members after insert or update or delete on public.conversation_members
  deferrable initially deferred for each row execute function campo_private.validate_conversation();

create function campo_private.validate_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.organization_id, new.team_id, new.created_by, new.created_at, new.id)
    is distinct from (old.organization_id, old.team_id, old.created_by, old.created_at, old.id)
    then raise exception 'Task origin is immutable'; end if;
  if tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    if not exists (select 1 from public.organization_members m where m.user_id = new.assignee_id and m.organization_id = new.organization_id and m.ended_at is null
      and (campo_private.is_admin() or exists (select 1 from public.organization_members manager where manager.user_id = auth.uid()
        and manager.organization_id = new.organization_id and manager.role = 'GERENTE' and manager.ended_at is null)
        or exists (select 1 from public.team_members tm where tm.member_id = m.id and tm.team_id = new.team_id and tm.ended_at is null)
        or exists (select 1 from public.team_supervisors ts where ts.member_id = m.id and ts.team_id = new.team_id and ts.ended_at is null)))
      then raise exception 'Assignee must belong to the organization and target team'; end if;
  end if;
  if auth.uid() is not null and not campo_private.manages(new.organization_id, new.team_id) then
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status')
      then raise exception 'Only task status may be changed by the assignee'; end if;
  end if;
  return new;
end $$;
create trigger task_validation before insert or update on public.tasks for each row execute function campo_private.validate_task();
create function campo_private.record_task_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.task_history(task_id, actor_id, old_values, new_values)
    values (new.id, auth.uid(), case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end $$;
create trigger task_history after insert or update on public.tasks for each row execute function campo_private.record_task_history();

create function campo_private.keep_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Serializes replacement/deactivation; first bootstrap still requires a confirmed UUID.
  perform pg_advisory_xact_lock(81414001);
  if not exists (select 1 from public.platform_admins where active) then
    raise exception 'An active platform administrator must remain';
  end if;
  return null;
end $$;
create constraint trigger keep_platform_admin after insert or update or delete on public.platform_admins
  deferrable initially deferred for each row execute function campo_private.keep_admin();

create function campo_private.validate_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.invitation_requests; n integer;
begin
  if tg_op = 'UPDATE' and (new.id, new.request_id, new.organization_id, new.email, new.role, new.approved_by, new.created_at, new.expires_at)
    is distinct from (old.id, old.request_id, old.organization_id, old.email, old.role, old.approved_by, old.created_at, old.expires_at)
    then raise exception 'Approved invitation identity and permissions are immutable'; end if;
  if tg_op = 'UPDATE' and old.consumed_at is not null and new is distinct from old then
    raise exception 'Consumed invitations are immutable';
  end if;
  select * into r from public.invitation_requests where id = new.request_id for update;
  if r.status <> 'approved' or r.organization_id <> new.organization_id or r.email <> new.email or r.decided_by <> new.approved_by
    or (tg_op = 'INSERT' and not exists (select 1 from public.platform_admins where user_id = new.approved_by and active))
    then raise exception 'Invitation requires matching administrator approval'; end if;
  if new.consumed_at is not null and (new.revoked_at is not null or new.expires_at <= now() or not exists (
    select 1 from auth.users u where u.id = new.recipient_id and lower(u.email) = new.email and u.email_confirmed_at is not null))
    then raise exception 'Invitation activation requires its confirmed recipient and valid approval'; end if;
  return new;
end $$;
create trigger invitation_approval before insert or update on public.invitations for each row execute function campo_private.validate_invitation();

create function campo_private.invitation_team_count() returns trigger
language plpgsql security definer set search_path = '' as $$
declare iid uuid; i public.invitations; n integer;
begin
  if tg_table_name = 'invitations' then iid := coalesce(new.id, old.id);
  else iid := coalesce(new.invitation_id, old.invitation_id); end if;
  select * into i from public.invitations where id = iid for update;
  if not found then return null; end if;
  select count(*) into n from public.invitation_teams where invitation_id = iid;
  if (i.role = 'USUARIO' and n <> 1) or (i.role = 'ENCARGADO' and n < 1) or (i.role = 'GERENTE' and n <> 0)
    then raise exception 'Invitation role and teams do not match'; end if;
  return null;
end $$;
create constraint trigger invitation_team_count after insert or update on public.invitations
  deferrable initially deferred for each row execute function campo_private.invitation_team_count();
create constraint trigger invitation_team_rows after insert or update or delete on public.invitation_teams
  deferrable initially deferred for each row execute function campo_private.invitation_team_count();

create function campo_private.append_only() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'History is append-only'; end $$;
create trigger audit_append_only before update or delete on public.audit_logs for each row execute function campo_private.append_only();
create trigger tasks_append_only before update or delete on public.task_history for each row execute function campo_private.append_only();
create trigger membership_no_delete before delete on public.organization_members for each row execute function campo_private.append_only();
create trigger assignment_no_delete before delete on public.team_members for each row execute function campo_private.append_only();
create trigger supervision_no_delete before delete on public.team_supervisors for each row execute function campo_private.append_only();

-- The administrator has no SELECT bypass on messages. This audited operation is the only application audit path.
create function campo_private.audit_messages(cid uuid, why text, page_before timestamptz default null, before_id uuid default null)
returns setof public.messages language plpgsql security definer set search_path = '' as $$
begin
  if not campo_private.is_admin() then raise exception 'Platform administrator required' using errcode = '42501'; end if;
  if why is null or length(trim(why)) not between 10 and 1000 then raise exception 'An audit reason is required'; end if;
  if (page_before is null) <> (before_id is null) then raise exception 'Audit pagination requires timestamp and ID together'; end if;
  if not exists (select 1 from public.conversations where id = cid) then raise exception 'Conversation not found'; end if;
  insert into public.audit_logs(actor_id, action, resource_id, reason, details)
    values (auth.uid(), 'messages.read', cid, trim(why), jsonb_build_object('before', page_before, 'before_id', before_id, 'limit', 100));
  return query select * from public.messages where conversation_id = cid and (page_before is null or (created_at, id) < (page_before, before_id))
    order by created_at desc, id desc limit 100;
end $$;
-- Exposed wrapper is SECURITY INVOKER; internal definer checks the actual caller, never a supplied actor UUID.
create function public.audit_message_page(cid uuid, why text, page_before timestamptz default null, before_id uuid default null)
returns setof public.messages language sql security invoker set search_path = '' as $$
  select * from campo_private.audit_messages(cid, why, page_before, before_id)
$$;
revoke all on function public.audit_message_page(uuid,text,timestamptz,uuid) from public, anon;
grant execute on function public.audit_message_page(uuid,text,timestamptz,uuid) to authenticated;

-- All tables explicitly deny anonymous and unintended client privileges.
do $$ declare t text; begin
  foreach t in array array['platform_admins','platform_settings','organizations','organization_members','teams','team_members','team_supervisors',
    'invitation_requests','invitations','invitation_teams','posts','post_mentions','post_comments','post_reactions','tasks','task_history',
    'conversations','conversation_members','messages','message_reads','audit_logs','attachments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('revoke all on public.%I from service_role', t);
    if t in ('audit_logs', 'task_history') then
      execute format('grant select, insert on public.%I to service_role', t);
    else
      execute format('grant select, insert, update, delete on public.%I to service_role', t);
    end if;
  end loop;
end $$;
create policy admin_self on public.platform_admins for select to authenticated using (user_id = (select auth.uid()) and active);
create policy settings_admin on public.platform_settings for select to authenticated using ((select campo_private.is_admin()));
create policy organizations_read on public.organizations for select to authenticated using (campo_private.is_admin() or campo_private.in_org(id));
create policy directory_read on public.organization_members for select to authenticated using (campo_private.is_admin() or campo_private.in_org(organization_id));
create policy teams_read on public.teams for select to authenticated using (campo_private.is_admin() or campo_private.in_org(organization_id));
create policy assignments_read on public.team_members for select to authenticated using (campo_private.is_admin() or campo_private.in_org(organization_id));
create policy supervisors_read on public.team_supervisors for select to authenticated using (campo_private.is_admin() or campo_private.in_org(organization_id));
create policy requests_read on public.invitation_requests for select to authenticated using (campo_private.is_admin() or (requested_by = auth.uid() and campo_private.in_org(organization_id)));
create policy requests_insert on public.invitation_requests for insert to authenticated with check (
  requested_by = auth.uid() and campo_private.in_org(organization_id) and status = 'pending' and decided_by is null and decided_at is null);
grant insert (organization_id, requested_by, email) on public.invitation_requests to authenticated;
create policy invitations_admin on public.invitations for select to authenticated using ((select campo_private.is_admin()));
create policy invitation_teams_admin on public.invitation_teams for select to authenticated using ((select campo_private.is_admin()));
create policy posts_read on public.posts for select to authenticated using (campo_private.read_post(id));
create policy posts_insert on public.posts for insert to authenticated with check (author_id = auth.uid() and campo_private.can_create(organization_id, team_id) and status = 'Pendiente');
grant insert (id, organization_id, team_id, author_id, body, location, latitude, longitude, suggestion, category, captured_at) on public.posts to authenticated;
create policy mentions_read on public.post_mentions for select to authenticated using (campo_private.read_post(post_id));
-- Mention writes go through a transactional backend operation, not direct client inserts.
create policy comments_read on public.post_comments for select to authenticated using (campo_private.read_post(post_id));
create policy comments_insert on public.post_comments for insert to authenticated with check (author_id = auth.uid() and campo_private.read_post(post_id));
grant insert (id, post_id, organization_id, author_id, body) on public.post_comments to authenticated;
create policy reactions_read on public.post_reactions for select to authenticated using (campo_private.read_post(post_id));
create policy reactions_insert on public.post_reactions for insert to authenticated with check (user_id = auth.uid() and campo_private.read_post(post_id));
create policy reactions_delete on public.post_reactions for delete to authenticated using (user_id = auth.uid() and campo_private.read_post(post_id));
grant insert (post_id, organization_id, user_id), delete on public.post_reactions to authenticated;
create policy tasks_read on public.tasks for select to authenticated using (campo_private.read_task(id));
create policy tasks_insert on public.tasks for insert to authenticated with check (created_by = auth.uid() and campo_private.can_create(organization_id, team_id)
  and (campo_private.manages(organization_id, team_id) or assignee_id = auth.uid()) and status = 'Pendiente'
  and (post_id is null or campo_private.read_post(post_id)));
create policy tasks_update on public.tasks for update to authenticated using (campo_private.manages(organization_id, team_id) or
  (assignee_id = auth.uid() and campo_private.in_org(organization_id))) with check (campo_private.manages(organization_id, team_id) or
  (assignee_id = auth.uid() and campo_private.in_org(organization_id)));
grant insert (id, organization_id, team_id, created_by, assignee_id, post_id, title, description, priority, due_at),
  update (assignee_id, title, description, priority, due_at, status) on public.tasks to authenticated;
create policy task_history_read on public.task_history for select to authenticated using (campo_private.read_task(task_id));
create policy conversations_read on public.conversations for select to authenticated using (campo_private.read_conversation(id));
create policy conversation_members_read on public.conversation_members for select to authenticated using (campo_private.read_conversation(conversation_id));
create policy messages_read on public.messages for select to authenticated using (campo_private.read_conversation(conversation_id));
create policy messages_insert on public.messages for insert to authenticated with check (sender_id = auth.uid() and campo_private.read_conversation(conversation_id));
grant insert (id, conversation_id, organization_id, sender_id, body) on public.messages to authenticated;
create policy reads_select on public.message_reads for select to authenticated using (campo_private.read_conversation(conversation_id));
create policy reads_insert on public.message_reads for insert to authenticated with check (user_id = auth.uid() and campo_private.read_conversation(conversation_id));
grant insert (message_id, conversation_id, user_id) on public.message_reads to authenticated;
create policy audit_admin on public.audit_logs for select to authenticated using ((select campo_private.is_admin()));
create policy attachments_read on public.attachments for select to authenticated using (campo_private.read_attachment(id));
-- Metadata creation and administrative writes are backend-only (Etapa C).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campo-private', 'campo-private', false, 10485760, array['image/jpeg','image/png','application/pdf']);
create policy campo_files_read on storage.objects for select to authenticated using (
  bucket_id = 'campo-private' and exists (select 1 from public.attachments a where a.object_path = name and campo_private.read_attachment(a.id)));
create policy campo_files_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'campo-private' and exists (select 1 from public.attachments a where a.object_path = name and a.uploaded_by = auth.uid() and campo_private.read_attachment(a.id)));
-- No client UPDATE/DELETE of immutable evidence, history or messages.

revoke all on all functions in schema campo_private from public, anon, authenticated;
grant execute on function campo_private.is_admin(), campo_private.in_org(uuid), campo_private.manages(uuid,uuid),
  campo_private.can_create(uuid,uuid), campo_private.read_post(uuid), campo_private.read_task(uuid),
  campo_private.read_conversation(uuid), campo_private.read_attachment(uuid), campo_private.audit_messages(uuid,text,timestamptz,uuid) to authenticated;
-- Future functions must explicitly REVOKE EXECUTE from PUBLIC before granting intended callers.
-- A per-schema default REVOKE does not remove PostgreSQL's global PUBLIC function default.
commit;
