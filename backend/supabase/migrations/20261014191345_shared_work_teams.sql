begin;
-- Shared identity; teams remains the organization-scoped operational link.
create table public.work_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);
alter table public.work_teams enable row level security;
revoke all on public.work_teams from public, anon, authenticated, service_role;
grant select on public.work_teams to authenticated;
create policy work_teams_owner_read on public.work_teams for select to authenticated
using ((select campo_private.is_admin()));
alter table public.teams add column work_team_id uuid references public.work_teams(id);
-- Existing team IDs and resource/assignment references remain unchanged.
insert into public.work_teams(id,name) select id,name from public.teams;
update public.teams set work_team_id=id;
alter table public.teams alter column work_team_id set not null;
create unique index team_organization_link on public.teams(work_team_id,organization_id);

-- Compatibility with the original team.create API, including older clients.
create function campo_private.ensure_work_team() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.work_team_id is null then
    insert into public.work_teams(name) values(new.name) returning id into new.work_team_id;
  end if;
  return new;
end $$;
revoke all on function campo_private.ensure_work_team() from public,anon,authenticated,service_role;
create trigger teams_catalog before insert on public.teams
for each row execute function campo_private.ensure_work_team();

create function campo_private.work_team_command(action text,payload jsonb,operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; cached campo_private.command_results; rid uuid; org uuid; link_id uuid;
  result jsonb; why text;
begin
  -- This locks the owner row, serializing administrative commands and retries.
  actor := campo_private.require_admin();
  if operation_id is null then raise exception 'Operation ID required' using errcode='22023'; end if;
  select * into cached from campo_private.command_results c
    where c.actor_id=actor and c.operation_id=work_team_command.operation_id;
  if found then
    if cached.action is distinct from action or cached.payload is distinct from payload then
      raise exception 'Operation ID reused with different input' using errcode='23505'; end if;
    return cached.result;
  end if;
  why := trim(payload->>'reason');
  if why is null or length(why) not between 10 and 1000 then
    raise exception 'Administrative reason required' using errcode='22023'; end if;
  if action='work_team.create' then
    perform campo_private.check_keys(payload,array['name','organization_id','reason']);
    insert into public.work_teams(name) values(trim(payload->>'name')) returning id into rid;
  elsif action='work_team.update' then
    perform campo_private.check_keys(payload,array['id','name','reason']);
    rid := (payload->>'id')::uuid;
    update public.work_teams set name=trim(payload->>'name') where id=rid;
    if not found then raise exception 'Work team not found' using errcode='P0002'; end if;
    update public.teams set name=trim(payload->>'name') where work_team_id=rid;
  elsif action='team.link' then
    perform campo_private.check_keys(payload,array['work_team_id','organization_id','reason']);
    rid := (payload->>'work_team_id')::uuid;
    perform 1 from public.work_teams where id=rid;
    if not found then raise exception 'Work team not found' using errcode='P0002'; end if;
    if not (payload ? 'organization_id') then raise exception 'Organization required' using errcode='22023'; end if;
  else raise exception 'Unknown work team action' using errcode='22023';
  end if;
  if action in ('work_team.create','team.link') and payload ? 'organization_id' then
    org := (payload->>'organization_id')::uuid;
    perform 1 from public.organizations where id=org and active for share;
    if not found then raise exception 'Active organization required' using errcode='22023'; end if;
    select id into link_id from public.teams where work_team_id=rid and organization_id=org;
    if link_id is not null then raise exception 'Team already linked to this organization' using errcode='23505'; end if;
    insert into public.teams(work_team_id,organization_id,name)
      select id,org,name from public.work_teams where id=rid returning id into link_id;
  end if;
  result := jsonb_build_object('id',rid,'team_id',link_id,'organization_id',org);
  insert into public.audit_logs(actor_id,action,resource_id,reason) values(actor,action,rid,why);
  insert into campo_private.command_results(actor_id,operation_id,action,payload,result)
    values(actor,operation_id,action,payload,result);
  return result;
end $$;
revoke all on function campo_private.work_team_command(text,jsonb,uuid) from public,anon,service_role;
grant execute on function campo_private.work_team_command(text,jsonb,uuid) to authenticated;
create or replace function public.campo_admin_command(action text,payload jsonb,operation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select case when action in ('work_team.create','work_team.update','team.link')
    then campo_private.work_team_command(action,payload,operation_id)
    else campo_private.admin_command(action,payload,operation_id) end
$$;
revoke all on function public.campo_admin_command(text,jsonb,uuid) from public,anon,service_role;
grant execute on function public.campo_admin_command(text,jsonb,uuid) to authenticated;
commit;
