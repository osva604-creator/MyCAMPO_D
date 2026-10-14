-- Each Supabase project represents one organization, as in schema.sql.
begin;
create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.members(id),
  recipient_id uuid not null references public.members(id),
  body text not null check (length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index direct_messages_conversation on public.direct_messages(sender_id, recipient_id, created_at);
alter table public.direct_messages enable row level security;
create policy "Participants read private messages" on public.direct_messages
for select to authenticated using (public.is_field_member() and (auth.uid() = sender_id or auth.uid() = recipient_id));
create policy "Active members send private messages" on public.direct_messages
for insert to authenticated with check (
  public.is_field_member() and auth.uid() = sender_id
  and exists (select 1 from public.members where id = recipient_id and active)
);
revoke all on public.direct_messages from anon, authenticated;
grant select, insert on public.direct_messages to authenticated;
commit;
