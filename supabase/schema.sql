-- Execute once in the SQL editor of a NEW Supabase project.
-- One deployment/project represents one farm/team. No public signup or public photos.
-- events conserva operaciones inmutables para la sincronización offline.
-- Los campos legibles solicitados se derivan de actor_id/payload; no se envían
-- al insertar. Para cambiar el estado se agrega un evento de tipo 'status'.
begin;
create table public.members (
  id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  name text not null check (length(name) between 1 and 80),
  handle text not null unique check (handle ~ '^[A-Za-z0-9_]{1,40}$')
);
create function public.is_field_member() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.members where id = auth.uid() and active); $$;
revoke all on function public.is_field_member() from public;
grant execute on function public.is_field_member() to authenticated;
alter table public.members enable row level security;
create policy "Members can read directory" on public.members for select to authenticated using (public.is_field_member());
grant select on public.members to authenticated;
revoke all on public.members from anon;

create table public.events (
  id uuid primary key,
  actor_id uuid not null references public.members(id),
  type text not null check (type in ('post', 'comment', 'status', 'like')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) < 100000),
  user_id uuid generated always as (actor_id) stored references public.members(id),
  -- Ruta privada del bucket evidence, no una URL pública ni firmada que expire.
  image_url text generated always as (payload->>'image') stored,
  caption text generated always as (payload->>'caption') stored,
  latitude double precision generated always as (
    case when jsonb_typeof(payload #> '{gps,lat}') = 'number'
    then (payload #>> '{gps,lat}')::double precision end
  ) stored check (latitude between -90 and 90),
  longitude double precision generated always as (
    case when jsonb_typeof(payload #> '{gps,lng}') = 'number'
    then (payload #>> '{gps,lng}')::double precision end
  ) stored check (longitude between -180 and 180),
  status text generated always as (payload->>'status') stored
    check (status in ('Pendiente', 'En Proceso', 'Resuelto')),
  created_at timestamptz not null default now(),
  received_at timestamptz not null default now()
);
create index events_chronology on public.events(created_at, id);
create index events_by_member on public.events(user_id);
create unique index unique_field_post on public.events ((payload->>'id')) where type = 'post';
alter table public.events enable row level security;
create policy "Team reads events" on public.events for select to authenticated using (public.is_field_member());
create policy "Member appends own event" on public.events for insert to authenticated with check (public.is_field_member() and actor_id = auth.uid());
grant select, insert on public.events to authenticated;
revoke all on public.events from anon;
revoke update, delete on public.events from authenticated;

create function public.validate_field_event() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.type = 'post' then
    if coalesce(length(trim(new.payload->>'caption')), 0) not between 1 and 2000
      or coalesce(length(new.payload->>'location'), 0) not between 1 and 120
      or new.payload->>'status' is distinct from 'Pendiente'
      or coalesce(new.payload->>'id', '') !~ '^[0-9a-f-]{36}$'
      or new.payload->>'createdAt' is null
      or new.payload->>'image' is null
    then raise exception 'Invalid post'; end if;
  else
    if not exists (select 1 from public.events where type = 'post' and payload->>'id' = new.payload->>'postId')
    then raise exception 'Post does not exist'; end if;
    if new.type = 'status' and (new.payload->>'status' is null or new.payload->>'status' not in ('Pendiente', 'En Proceso', 'Resuelto')) then raise exception 'Invalid status'; end if;
    if new.type = 'like' and jsonb_typeof(new.payload->'liked') is distinct from 'boolean' then raise exception 'Invalid like'; end if;
    if new.type = 'comment' and (coalesce(length(new.payload->>'text'), 0) > 1000 or (coalesce(length(trim(new.payload->>'text')), 0) = 0 and new.payload->>'image' is null)) then raise exception 'Invalid comment'; end if;
  end if;
  if new.payload->>'image' is not null and new.payload->>'image' <> new.actor_id::text || '/' || new.id::text || '.jpg' then raise exception 'Invalid image path'; end if;
  return new;
end; $$;
create trigger validate_event before insert on public.events for each row execute function public.validate_field_event();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 5242880, array['image/jpeg']);
create policy "Team reads evidence" on storage.objects for select to authenticated using (bucket_id = 'evidence' and public.is_field_member());
create policy "Member uploads own evidence" on storage.objects for insert to authenticated with check (bucket_id = 'evidence' and public.is_field_member() and (storage.foldername(name))[1] = auth.uid()::text);
-- No client updates/deletes: published evidence remains immutable.
commit;
