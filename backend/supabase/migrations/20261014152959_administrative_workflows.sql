-- Etapa C: local proposal. Apply after multi_organization, only with explicit deployment approval.
begin;
alter table public.invitation_requests add column approved_organization_id uuid references public.organizations(id);
alter table public.invitations drop constraint invitations_delivery_status_check;
alter table public.invitations add constraint invitations_delivery_status_check
  check (delivery_status in ('pending','sending','sent','failed','uncertain','existing_account'));
alter table public.invitations add column delivery_claim uuid;
alter table public.invitations add column delivery_started_at timestamptz;
alter table public.invitations add column delivery_requested_by uuid references public.platform_admins(user_id);
alter table public.invitations add column delivery_error_code text check (length(delivery_error_code) <= 64);
alter table public.invitations add column activated_member_id uuid;
alter table public.invitations add foreign key (activated_member_id, organization_id)
  references public.organization_members(id, organization_id);
create index auth_email_invitation_lookup on public.invitations(email, expires_at) where consumed_at is null and revoked_at is null;
create index invitation_requests_by_requester on public.invitation_requests(requested_by,created_at desc);

-- Auth verifies JWT signatures/expiry; database permissions also reject sessions removed by sign-out.
create or replace function campo_private.active_identity() returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(select 1 from auth.users u where u.id=auth.uid()
    and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<now()))
    and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=(auth.jwt()->>'session_id')::uuid)
$$;

create function campo_private.validate_team_state() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.organization_id is distinct from old.organization_id then raise exception 'Team origin is immutable' using errcode='22023'; end if;
  if not new.active and (exists(select 1 from public.team_members where team_id=new.id and ended_at is null)
    or exists(select 1 from public.team_supervisors where team_id=new.id and ended_at is null)
    or exists(select 1 from public.invitation_teams it join public.invitations i on i.id=it.invitation_id
      where it.team_id=new.id and i.consumed_at is null and i.revoked_at is null and i.expires_at>now())) then
    raise exception 'Move active assignments and revoke pending invitations before disabling this team' using errcode='23505';
  end if;
  return new;
end $$;
create trigger teams_validate_state before update on public.teams for each row execute function campo_private.validate_team_state();

create table campo_private.command_results (
  actor_id uuid not null references auth.users(id),
  operation_id uuid not null,
  action text not null,
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (actor_id, operation_id)
);
alter table campo_private.command_results enable row level security;
revoke all on campo_private.command_results from public, anon, authenticated, service_role;

create or replace function campo_private.validate_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare r public.invitation_requests;
begin
  if tg_op = 'UPDATE' and (new.id,new.request_id,new.organization_id,new.email,new.role,new.approved_by,new.created_at,new.expires_at)
    is distinct from (old.id,old.request_id,old.organization_id,old.email,old.role,old.approved_by,old.created_at,old.expires_at)
    then raise exception 'Approved invitation identity and permissions are immutable'; end if;
  if tg_op = 'UPDATE' and old.consumed_at is not null and new is distinct from old then raise exception 'Consumed invitations are immutable'; end if;
  select * into r from public.invitation_requests where id = new.request_id for update;
  if r.status <> 'approved' or coalesce(r.approved_organization_id,r.organization_id) <> new.organization_id or r.email <> new.email or r.decided_by <> new.approved_by
    or (tg_op = 'INSERT' and not exists (select 1 from public.platform_admins where user_id = new.approved_by and active))
    then raise exception 'Invitation requires matching administrator approval'; end if;
  if new.consumed_at is not null and (new.revoked_at is not null or new.expires_at <= now() or not exists (
    select 1 from auth.users u where u.id = new.recipient_id and lower(u.email) = new.email and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until < now())))
    then raise exception 'Invitation activation requires its confirmed recipient and valid approval'; end if;
  return new;
end $$;

create function campo_private.require_admin() returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if not campo_private.is_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
  perform 1 from public.platform_admins where user_id=actor and active for update;
  if not found or not campo_private.is_admin() then raise exception 'Platform administrator required' using errcode='42501'; end if;
  return actor;
end $$;
create function campo_private.check_keys(payload jsonb, allowed text[]) returns void
language plpgsql set search_path = '' as $$
begin
  if payload is null or jsonb_typeof(payload) <> 'object' or exists (
    select 1 from jsonb_object_keys(payload) k where not (k=any(allowed))) then
    raise exception 'Invalid or unexpected request fields' using errcode='22023';
  end if;
end $$;
create function campo_private.check_assignment(org uuid, member_role text, team_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare n integer := cardinality(team_ids);
begin
  if member_role is null or member_role not in ('GERENTE','ENCARGADO','USUARIO') or team_ids is null
    or (member_role='GERENTE' and n<>0) or (member_role='USUARIO' and n<>1) or (member_role='ENCARGADO' and n<1)
    or n > 100 or (select count(distinct x) from unnest(team_ids) x) <> n
    then raise exception 'Invalid role or team assignments' using errcode='22023'; end if;
  perform 1 from public.organizations where id=org and active for share;
  if not found then raise exception 'Active organization required' using errcode='22023'; end if;
  perform 1 from public.teams where id=any(team_ids) and organization_id=org and active order by id for share;
  if (select count(*) from public.teams where id=any(team_ids) and organization_id=org and active) <> n
    then raise exception 'Teams must be active and belong to the organization' using errcode='22023'; end if;
end $$;
create function campo_private.replace_membership(target uuid, org uuid, member_role text, team_ids uuid[], display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare previous uuid; mid uuid;
begin
  perform campo_private.check_assignment(org, member_role, team_ids);
  perform 1 from auth.users where id=target and email_confirmed_at is not null and (banned_until is null or banned_until<now()) for update;
  if not found then raise exception 'Confirmed, non-banned Auth account required' using errcode='22023'; end if;
  if display_name is null or length(trim(display_name)) not between 1 and 80 then raise exception 'Invalid display name' using errcode='22023'; end if;
  select id into previous from public.organization_members where user_id=target and ended_at is null for update;
  if previous is not null then
    update public.team_members set ended_at=now() where member_id=previous and ended_at is null;
    update public.team_supervisors set ended_at=now() where member_id=previous and ended_at is null;
    update public.organization_members set ended_at=now() where id=previous;
  end if;
  insert into public.organization_members(user_id,organization_id,name,role) values(target,org,trim(display_name),member_role) returning id into mid;
  if member_role='USUARIO' then
    insert into public.team_members(organization_id,member_id,team_id) select org,mid,x from unnest(team_ids) x;
  elsif member_role='ENCARGADO' then
    insert into public.team_supervisors(organization_id,member_id,team_id) select org,mid,x from unnest(team_ids) x;
  end if;
  return mid;
end $$;

create function campo_private.close_open_invitations(target uuid) returns void
language plpgsql security definer set search_path='' as $$
declare invitation_id uuid;
begin
  -- Lock invitations before Auth/membership rows, matching activation's order.
  for invitation_id in select i.id from public.invitations i join auth.users u on lower(u.email)=i.email
    where u.id=target and i.consumed_at is null and i.revoked_at is null order by i.id for update of i loop
    update public.invitations set revoked_at=now() where id=invitation_id;
    insert into public.audit_logs(actor_id,action,resource_id,reason) values(auth.uid(),'invitation.revoked_by_membership',invitation_id,
      'Outstanding approval revoked by an administrative membership change');
  end loop;
end $$;

create function campo_private.admin_command(action text, payload jsonb, operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; cached campo_private.command_results; result jsonb; rid uuid; org uuid; tid uuid; target uuid;
  team_ids uuid[]; why text; old_record jsonb; r public.invitation_requests; i public.invitations; member_role text; mid uuid;
begin
  actor := campo_private.require_admin();
  if operation_id is null then raise exception 'Operation ID required' using errcode='22023'; end if;
  select * into cached from campo_private.command_results c where c.actor_id=actor and c.operation_id=admin_command.operation_id;
  if found then
    if cached.action is distinct from action or cached.payload is distinct from payload then raise exception 'Operation ID reused with different input' using errcode='23505'; end if;
    return cached.result;
  end if;
  why := trim(payload->>'reason');
  if why is null or length(why) not between 10 and 1000 then raise exception 'Administrative reason required' using errcode='22023'; end if;
  if payload ? 'active' and jsonb_typeof(payload->'active')<>'boolean' then raise exception 'Active must be boolean' using errcode='22023'; end if;
  if action='organization.create' then
    perform campo_private.check_keys(payload,array['name','reason']);
    insert into public.organizations(name) values(trim(payload->>'name')) returning id into rid;
    result := jsonb_build_object('id',rid);
  elsif action='organization.update' then
    perform campo_private.check_keys(payload,array['id','name','active','reason']); rid := (payload->>'id')::uuid;
    select to_jsonb(o) into old_record from public.organizations o where id=rid for update;
    if not found then raise exception 'Organization not found' using errcode='P0002'; end if;
    update public.organizations set name=case when payload ? 'name' then trim(payload->>'name') else name end,
      active=case when payload ? 'active' then (payload->>'active')::boolean else active end where id=rid;
    result := jsonb_build_object('id',rid);
  elsif action='team.create' then
    perform campo_private.check_keys(payload,array['organization_id','name','reason']); org := (payload->>'organization_id')::uuid;
    perform 1 from public.organizations where id=org and active for share;
    if not found then raise exception 'Active organization required' using errcode='22023'; end if;
    insert into public.teams(organization_id,name) values(org,trim(payload->>'name')) returning id into rid;
    result := jsonb_build_object('id',rid);
  elsif action='team.update' then
    perform campo_private.check_keys(payload,array['id','name','active','reason']); rid := (payload->>'id')::uuid;
    select to_jsonb(t) into old_record from public.teams t where id=rid for update;
    if not found then raise exception 'Team not found' using errcode='P0002'; end if;
    if payload->>'active'='false' and (exists(select 1 from public.team_members where team_id=rid and ended_at is null)
      or exists(select 1 from public.team_supervisors where team_id=rid and ended_at is null)
      or exists(select 1 from public.invitation_teams it join public.invitations v on v.id=it.invitation_id
        where it.team_id=rid and v.consumed_at is null and v.revoked_at is null and v.expires_at>now())) then
      raise exception 'Move active assignments and revoke pending invitations before disabling this team' using errcode='23505';
    end if;
    update public.teams set name=case when payload ? 'name' then trim(payload->>'name') else name end,
      active=case when payload ? 'active' then (payload->>'active')::boolean else active end where id=rid;
    result := jsonb_build_object('id',rid);
  elsif action='membership.set' then
    perform campo_private.check_keys(payload,array['user_id','organization_id','role','team_ids','name','reason']);
    target := (payload->>'user_id')::uuid; org := (payload->>'organization_id')::uuid; member_role := payload->>'role';
    if jsonb_typeof(payload->'team_ids') <> 'array' then raise exception 'Team IDs array required' using errcode='22023'; end if;
    select coalesce(array_agg(x::uuid),'{}'::uuid[]) into team_ids from jsonb_array_elements_text(payload->'team_ids') x;
    select to_jsonb(m) into old_record from public.organization_members m where user_id=target and ended_at is null;
    perform campo_private.close_open_invitations(target);
    mid := campo_private.replace_membership(target,org,member_role,team_ids,payload->>'name'); rid := target;
    result := jsonb_build_object('member_id',mid);
  elsif action='membership.suspend' then
    perform campo_private.check_keys(payload,array['user_id','reason']); target := (payload->>'user_id')::uuid; rid := target;
    perform campo_private.close_open_invitations(target);
    perform 1 from auth.users where id=target for update;
    select to_jsonb(m),m.id into old_record,mid from public.organization_members m where user_id=target and ended_at is null for update;
    if not found then raise exception 'Active membership not found' using errcode='P0002'; end if;
    update public.team_members set ended_at=now() where member_id=mid and ended_at is null;
    update public.team_supervisors set ended_at=now() where member_id=mid and ended_at is null;
    update public.organization_members set ended_at=now() where id=mid;
    result := jsonb_build_object('user_id',target,'status','suspended');
  elsif action in ('invitation.approve','invitation.reject') then
    perform campo_private.check_keys(payload,case when action='invitation.approve' then array['request_id','organization_id','role','team_ids','reason'] else array['request_id','reason'] end);
    rid := (payload->>'request_id')::uuid;
    select * into r from public.invitation_requests where id=rid for update;
    if not found then raise exception 'Request not found' using errcode='P0002'; end if;
    if r.status <> 'pending' then raise exception 'Request already decided' using errcode='23505'; end if;
    old_record := to_jsonb(r);
    if action='invitation.reject' then
      update public.invitation_requests set status='rejected',decided_by=actor,decided_at=now() where id=rid;
      result := jsonb_build_object('request_id',rid,'status','rejected');
    else
      org := coalesce((payload->>'organization_id')::uuid,r.organization_id); member_role := payload->>'role';
      if jsonb_typeof(payload->'team_ids') <> 'array' then raise exception 'Team IDs array required' using errcode='22023'; end if;
      select coalesce(array_agg(x::uuid),'{}'::uuid[]) into team_ids from jsonb_array_elements_text(payload->'team_ids') x;
      perform campo_private.check_assignment(org,member_role,team_ids);
      if exists(select 1 from auth.users u join public.organization_members m on m.user_id=u.id where lower(u.email)=r.email and m.ended_at is null)
        then raise exception 'Account already has an active membership' using errcode='23505'; end if;
      update public.invitation_requests set status='approved',approved_organization_id=org,decided_by=actor,decided_at=now() where id=rid;
      insert into public.invitations(request_id,organization_id,email,role,approved_by,expires_at)
        values(rid,org,r.email,member_role,actor,now()+interval '7 days') returning id into tid;
      insert into public.invitation_teams(invitation_id,organization_id,team_id) select tid,org,x from unnest(team_ids) x;
      result := jsonb_build_object('invitation_id',tid,'status','approved','delivery_status','pending');
    end if;
  elsif action in ('invitation.revoke','invitation.resolve') then
    perform campo_private.check_keys(payload,case when action='invitation.revoke' then array['invitation_id','reason'] else array['invitation_id','outcome','recipient_id','reason'] end);
    rid := (payload->>'invitation_id')::uuid; select * into i from public.invitations where id=rid for update;
    if not found then raise exception 'Invitation not found' using errcode='P0002'; end if;
    if i.consumed_at is not null or i.revoked_at is not null then raise exception 'Invitation is closed' using errcode='23505'; end if;
    old_record := to_jsonb(i);
    if action='invitation.revoke' then
      update public.invitations set revoked_at=now() where id=rid;
      result := jsonb_build_object('id',rid,'status','revoked');
    else
      if i.delivery_status not in ('sending','uncertain') or i.delivery_started_at > now()-interval '5 minutes' then
        raise exception 'Only stale or uncertain deliveries may be reconciled' using errcode='23505'; end if;
      if payload->>'outcome'='confirmed_not_sent' then
        update public.invitations set delivery_status='failed',delivery_claim=null,delivery_error_code='operator_confirmed_not_sent' where id=rid;
      elsif payload->>'outcome'='confirmed_sent' then
        target := (payload->>'recipient_id')::uuid;
        if not exists(select 1 from auth.users u where u.id=target and lower(u.email)=i.email and (u.banned_until is null or u.banned_until<now())) then
          raise exception 'Recipient does not match approved email' using errcode='22023'; end if;
        update public.invitations set delivery_status='sent',recipient_id=target,delivery_claim=null,delivery_error_code=null where id=rid;
      else raise exception 'Invalid reconciliation outcome' using errcode='22023'; end if;
      result := jsonb_build_object('id',rid,'status',payload->>'outcome');
    end if;
  elsif action='settings.update' then
    perform campo_private.check_keys(payload,array['messaging_scope','reason']);
    if payload->>'messaging_scope' not in ('same_organization','disabled') then raise exception 'Invalid messaging scope' using errcode='22023'; end if;
    select to_jsonb(s) into old_record from public.platform_settings s for update;
    update public.platform_settings set messaging_scope=payload->>'messaging_scope';
    result := jsonb_build_object('messaging_scope',payload->>'messaging_scope');
  else raise exception 'Unsupported administrative action' using errcode='22023'; end if;
  insert into public.audit_logs(actor_id,action,resource_id,reason,details)
    values(actor,action,rid,why,jsonb_build_object('operation_id',operation_id,'before',old_record,'result',result));
  insert into campo_private.command_results values(actor,operation_id,action,payload,result,now());
  return result;
end $$;

create function campo_private.request_invitation(org uuid, invite_email text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare rid uuid; normalized text := lower(trim(invite_email));
begin
  if not campo_private.active_identity() or not (campo_private.is_admin() or campo_private.in_org(org)) then
    raise exception 'Active organization membership required' using errcode='42501'; end if;
  perform 1 from public.organizations where id=org and active for share;
  if not found then raise exception 'Active organization required' using errcode='22023'; end if;
  perform 1 from auth.users where id=auth.uid() for update;
  if (select count(*) from public.invitation_requests where requested_by=auth.uid() and created_at>now()-interval '1 hour')>=20 then
    raise exception 'Invitation request rate limit reached' using errcode='23505'; end if;
  if normalized is null or length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid email' using errcode='22023'; end if;
  if exists(select 1 from public.invitations where email=normalized and consumed_at is null and revoked_at is null)
    or exists(select 1 from auth.users u join public.organization_members m on m.user_id=u.id where lower(u.email)=normalized and m.ended_at is null) then
    raise exception 'Invitation or account unavailable' using errcode='23505'; end if;
  insert into public.invitation_requests(organization_id,requested_by,email) values(org,auth.uid(),normalized) returning id into rid;
  insert into public.audit_logs(actor_id,action,resource_id,reason) values(auth.uid(),'invitation.request',rid,'Invitation requested by an authorized member');
  return jsonb_build_object('request_id',rid,'status','pending');
end $$;
-- Require the audited request operation instead of the legacy direct INSERT path.
revoke insert on public.invitation_requests from authenticated;
revoke insert (organization_id,requested_by,email) on public.invitation_requests from authenticated;

create function campo_private.claim_invitation(iid uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; i public.invitations; target uuid; claim uuid; team_ids uuid[];
begin
  actor := campo_private.require_admin();
  select * into i from public.invitations where id=iid for update;
  if not found then raise exception 'Invitation not found' using errcode='P0002'; end if;
  if i.consumed_at is not null or i.revoked_at is not null or i.expires_at<=now() then raise exception 'Invitation is closed or expired' using errcode='23505'; end if;
  if i.delivery_status in ('sent','existing_account') then return jsonb_build_object('status',i.delivery_status,'send',false); end if;
  if i.delivery_status not in ('pending','failed') then raise exception 'Delivery already claimed or uncertain; reconcile first' using errcode='23505'; end if;
  if i.delivery_attempts>=3 or i.delivery_started_at>now()-interval '5 minutes' then raise exception 'Delivery limit or cooldown reached' using errcode='23505'; end if;
  select coalesce(array_agg(team_id),'{}'::uuid[]) into team_ids from public.invitation_teams where invitation_id=iid;
  perform campo_private.check_assignment(i.organization_id,i.role,team_ids);
  select id into target from auth.users where lower(email)=i.email and email_confirmed_at is not null and (banned_until is null or banned_until<now());
  if target is not null then
    if exists(select 1 from public.organization_members where user_id=target and ended_at is null) then raise exception 'Account already has an active membership' using errcode='23505'; end if;
    update public.invitations set recipient_id=target,delivery_status='existing_account' where id=iid;
    insert into public.audit_logs(actor_id,action,resource_id,reason) values(actor,'invitation.existing_account',iid,'Approved invitation bound to existing confirmed account; no new Auth account or email created');
    return jsonb_build_object('status','existing_account','send',false);
  end if;
  claim := gen_random_uuid();
  update public.invitations set delivery_status='sending',delivery_claim=claim,delivery_requested_by=actor,delivery_started_at=now(),delivery_attempts=delivery_attempts+1,delivery_error_code=null where id=iid;
  insert into public.audit_logs(actor_id,action,resource_id,reason,details)
    values(actor,'invitation.delivery_claim',iid,'Official invitation delivery claimed',jsonb_build_object('attempt',i.delivery_attempts+1));
  return jsonb_build_object('send',true,'claim',claim,'email',i.email,'invitation_id',iid);
end $$;

create function campo_private.finish_invitation(iid uuid, claim uuid, outcome text, recipient uuid, error_code text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.invitations;
begin
  -- EXECUTE is granted ONLY to service_role, never authenticated. The unguessable claim binds the result to one approved send.
  select * into i from public.invitations where id=iid for update;
  if not found or i.delivery_claim is distinct from claim or claim is null then raise exception 'Invalid delivery claim' using errcode='42501'; end if;
  if outcome is null or outcome not in ('sent','failed','uncertain') then raise exception 'Invalid delivery outcome' using errcode='22023'; end if;
  if i.delivery_status <> 'sending' then
    if i.delivery_status=outcome then return jsonb_build_object('status',outcome); end if;
    raise exception 'Delivery already finalized' using errcode='23505';
  end if;
  if outcome='sent' and not exists(select 1 from auth.users where id=recipient and lower(email)=i.email) then
    raise exception 'Recipient does not match approved email' using errcode='22023'; end if;
  update public.invitations set delivery_status=outcome,recipient_id=case when outcome='sent' then recipient else recipient_id end,
    delivery_error_code=left(error_code,64) where id=iid;
  insert into public.audit_logs(actor_id,action,resource_id,reason,details) values(i.delivery_requested_by,'invitation.delivery_result',iid,
    'Official invitation delivery result recorded',jsonb_build_object('outcome',outcome,'error_code',left(error_code,64)));
  return jsonb_build_object('status',outcome);
end $$;

create function campo_private.activate_invitation(iid uuid, display_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i public.invitations; actor uuid := auth.uid(); team_ids uuid[]; mid uuid;
begin
  if not campo_private.active_identity() then raise exception 'Confirmed, non-banned identity required' using errcode='42501'; end if;
  select * into i from public.invitations where id=iid for update;
  if not found or i.recipient_id is distinct from actor or not exists(select 1 from auth.users where id=actor and lower(email)=i.email) then
    raise exception 'Invitation does not belong to this identity' using errcode='42501'; end if;
  if i.consumed_at is not null then return jsonb_build_object('member_id',i.activated_member_id,'status','activated'); end if;
  if i.revoked_at is not null or i.expires_at<=now() or i.delivery_status not in ('sent','existing_account') then raise exception 'Invitation is not ready or no longer valid' using errcode='23505'; end if;
  select coalesce(array_agg(team_id),'{}'::uuid[]) into team_ids from public.invitation_teams where invitation_id=iid;
  perform campo_private.check_assignment(i.organization_id,i.role,team_ids);
  perform 1 from auth.users where id=actor for update;
  if exists(select 1 from public.organization_members where user_id=actor and ended_at is null) then raise exception 'Account already has an active membership' using errcode='23505'; end if;
  mid := campo_private.replace_membership(actor,i.organization_id,i.role,team_ids,display_name);
  update public.invitations set consumed_at=now(),activated_member_id=mid where id=iid;
  insert into public.audit_logs(actor_id,action,resource_id,reason,details) values(actor,'invitation.activate',iid,'Approved invitation activated by its verified recipient',jsonb_build_object('member_id',mid));
  return jsonb_build_object('member_id',mid,'status','activated');
end $$;

create function campo_private.access_context() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.organization_members; teams jsonb; pending jsonb;
begin
  if not campo_private.active_identity() then raise exception 'Confirmed, non-banned identity required' using errcode='42501'; end if;
  if campo_private.is_admin() then return jsonb_build_object('status','active','role','SUPER_ADMIN','user_id',auth.uid(),'organization_id',null,'teams','[]'::jsonb); end if;
  select * into m from public.organization_members where user_id=auth.uid() and ended_at is null;
  if found and campo_private.in_org(m.organization_id) then
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name),'[]'::jsonb) into teams from public.teams t where t.organization_id=m.organization_id and t.active and
      (m.role='GERENTE' or exists(select 1 from public.team_members tm where tm.member_id=m.id and tm.team_id=t.id and tm.ended_at is null)
        or exists(select 1 from public.team_supervisors ts where ts.member_id=m.id and ts.team_id=t.id and ts.ended_at is null));
    return jsonb_build_object('status','active','user_id',auth.uid(),'member_id',m.id,'name',m.name,'organization_id',m.organization_id,'role',m.role,'teams',teams);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'organization_id',i.organization_id,'role',i.role,'delivery_status',i.delivery_status,'expires_at',i.expires_at)),'[]'::jsonb) into pending
    from public.invitations i join auth.users u on u.id=auth.uid() join public.organizations o on o.id=i.organization_id
    where lower(u.email)=i.email and i.recipient_id=u.id and i.consumed_at is null and i.revoked_at is null and i.expires_at>now() and o.active;
  return jsonb_build_object('status','awaiting_approval','user_id',auth.uid(),'invitations',pending);
end $$;

-- Public entry points are invokers; privileges and private functions enforce identity independently of the Edge layer.
create function public.campo_admin_command(action text, payload jsonb, operation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.admin_command(action,payload,operation_id) $$;
create function public.campo_request_invitation(org uuid, invite_email text) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.request_invitation(org,invite_email) $$;
create function public.campo_claim_invitation(iid uuid) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.claim_invitation(iid) $$;
create function public.campo_finish_invitation(iid uuid, claim uuid, outcome text, recipient uuid default null, error_code text default null) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.finish_invitation(iid,claim,outcome,recipient,error_code) $$;
create function public.campo_activate_invitation(iid uuid, display_name text) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.activate_invitation(iid,display_name) $$;
create function public.campo_access_context() returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.access_context() $$;
revoke all on function public.campo_admin_command(text,jsonb,uuid),public.campo_request_invitation(uuid,text),public.campo_claim_invitation(uuid),
  public.campo_finish_invitation(uuid,uuid,text,uuid,text),public.campo_activate_invitation(uuid,text),public.campo_access_context() from public,anon,authenticated,service_role;
grant execute on function public.campo_admin_command(text,jsonb,uuid),public.campo_request_invitation(uuid,text),public.campo_claim_invitation(uuid),
  public.campo_activate_invitation(uuid,text),public.campo_access_context() to authenticated;
revoke all on function campo_private.validate_team_state(),campo_private.require_admin(),campo_private.check_keys(jsonb,text[]),campo_private.check_assignment(uuid,text,uuid[]),
  campo_private.replace_membership(uuid,uuid,text,uuid[],text),campo_private.close_open_invitations(uuid),campo_private.admin_command(text,jsonb,uuid),campo_private.request_invitation(uuid,text),
  campo_private.claim_invitation(uuid),campo_private.finish_invitation(uuid,uuid,text,uuid,text),campo_private.activate_invitation(uuid,text),campo_private.access_context()
  from public,anon,authenticated,service_role;
grant execute on function campo_private.admin_command(text,jsonb,uuid),campo_private.request_invitation(uuid,text),campo_private.claim_invitation(uuid),
  campo_private.activate_invitation(uuid,text),campo_private.access_context() to authenticated;
grant usage on schema campo_private to service_role;
grant execute on function public.campo_finish_invitation(uuid,uuid,text,uuid,text),campo_private.finish_invitation(uuid,uuid,text,uuid,text) to service_role;
commit;
