begin;
-- Manager permissions in each explicitly assigned organization.
alter table public.organization_members drop constraint organization_members_role_check;
alter table public.organization_members add constraint organization_members_role_check check(role in ('GERENTE_GENERAL','GERENTE','ENCARGADO','USUARIO'));
alter table public.invitations drop constraint invitations_role_check;
alter table public.invitations add constraint invitations_role_check check(role in ('GERENTE_GENERAL','GERENTE','ENCARGADO','USUARIO'));
drop index public.one_active_organization;
create unique index one_active_membership_per_organization on public.organization_members(user_id,organization_id) where ended_at is null;
create function campo_private.validate_organization_access() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from auth.users where id=new.user_id for update;
  if new.ended_at is null and exists(select 1 from public.organization_members m
    where m.user_id=new.user_id and m.id<>new.id and m.ended_at is null
    and (new.role<>'GERENTE_GENERAL' or m.role<>'GERENTE_GENERAL')) then
    raise exception 'Only general managers may have multiple active organizations' using errcode='23505';
  end if;
  return new;
end $$;
revoke all on function campo_private.validate_organization_access() from public,anon,authenticated,service_role;
create trigger validate_organization_access before insert or update on public.organization_members
for each row execute function campo_private.validate_organization_access();

create or replace function campo_private.manages(org uuid, team uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select campo_private.is_admin() or (campo_private.in_org(org) and exists (
    select 1 from public.organization_members m where m.user_id = auth.uid() and m.organization_id = org and m.ended_at is null
    and (m.role in ('GERENTE','GERENTE_GENERAL') or (m.role = 'ENCARGADO' and exists (
      select 1 from public.team_supervisors s where s.member_id = m.id and s.team_id = team and s.ended_at is null)))))
$$;

create or replace function campo_private.validate_membership() returns trigger
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
    or (m.role = 'ENCARGADO' and (n <> 0 or s < 1)) or (m.role in ('GERENTE','GERENTE_GENERAL') and n + s <> 0))
    then raise exception 'Role and team assignments do not match'; end if;
  return null;
end $$;

create or replace function campo_private.validate_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.organization_id, new.team_id, new.created_by, new.created_at, new.id)
    is distinct from (old.organization_id, old.team_id, old.created_by, old.created_at, old.id)
    then raise exception 'Task origin is immutable'; end if;
  if tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    if not exists (select 1 from public.organization_members m where m.user_id = new.assignee_id and m.organization_id = new.organization_id and m.ended_at is null
      and (campo_private.is_admin() or exists (select 1 from public.organization_members manager where manager.user_id = auth.uid()
        and manager.organization_id = new.organization_id and manager.role in ('GERENTE','GERENTE_GENERAL') and manager.ended_at is null)
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


create or replace function campo_private.check_assignment(org uuid, member_role text, team_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare n integer := cardinality(team_ids);
begin
  if member_role is null or member_role not in ('GERENTE_GENERAL','GERENTE','ENCARGADO','USUARIO') or team_ids is null
    or (member_role in ('GERENTE','GERENTE_GENERAL') and n<>0) or (member_role='USUARIO' and n<>1) or (member_role='ENCARGADO' and n<1)
    or n > 100 or (select count(distinct x) from unnest(team_ids) x) <> n
    then raise exception 'Invalid role or team assignments' using errcode='22023'; end if;
  perform 1 from public.organizations where id=org and active for share;
  if not found then raise exception 'Active organization required' using errcode='22023'; end if;
  perform 1 from public.teams where id=any(team_ids) and organization_id=org and active order by id for share;
  if (select count(*) from public.teams where id=any(team_ids) and organization_id=org and active) <> n
    then raise exception 'Teams must be active and belong to the organization' using errcode='22023'; end if;
end $$;

create or replace function campo_private.replace_membership(target uuid, org uuid, member_role text, team_ids uuid[], display_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare previous uuid; mid uuid;
begin
  perform campo_private.check_assignment(org, member_role, team_ids);
  perform 1 from auth.users where id=target and email_confirmed_at is not null and (banned_until is null or banned_until<now()) for update;
  if not found then raise exception 'Confirmed, non-banned Auth account required' using errcode='22023'; end if;
  if display_name is null or length(trim(display_name)) not between 1 and 80 then raise exception 'Invalid display name' using errcode='22023'; end if;
  for previous in select id from public.organization_members where user_id=target and ended_at is null and (member_role<>'GERENTE_GENERAL' or role<>'GERENTE_GENERAL' or organization_id=org) for update loop
    update public.team_members set ended_at=now() where member_id=previous and ended_at is null;
    update public.team_supervisors set ended_at=now() where member_id=previous and ended_at is null;
    update public.organization_members set ended_at=now() where id=previous;
  end loop;
  insert into public.organization_members(user_id,organization_id,name,role) values(target,org,trim(display_name),member_role) returning id into mid;
  if member_role='USUARIO' then
    insert into public.team_members(organization_id,member_id,team_id) select org,mid,x from unnest(team_ids) x;
  elsif member_role='ENCARGADO' then
    insert into public.team_supervisors(organization_id,member_id,team_id) select org,mid,x from unnest(team_ids) x;
  end if;
  return mid;
end $$;

create or replace function campo_private.admin_command(action text, payload jsonb, operation_id uuid) returns jsonb
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
    select jsonb_agg(to_jsonb(m)) into old_record from public.organization_members m where user_id=target and ended_at is null;
    if old_record is null then raise exception 'Active membership not found' using errcode='P0002'; end if;
    for mid in select id from public.organization_members where user_id=target and ended_at is null for update loop
    update public.team_members set ended_at=now() where member_id=mid and ended_at is null;
    update public.team_supervisors set ended_at=now() where member_id=mid and ended_at is null;
    update public.organization_members set ended_at=now() where id=mid;
    end loop;
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
      if exists(select 1 from auth.users u join public.organization_members m on m.user_id=u.id where lower(u.email)=r.email and m.ended_at is null and (member_role<>'GERENTE_GENERAL' or m.role<>'GERENTE_GENERAL' or m.organization_id=org))
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

create or replace function campo_private.claim_invitation(iid uuid) returns jsonb
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
    if exists(select 1 from public.organization_members where user_id=target and ended_at is null and (i.role<>'GERENTE_GENERAL' or role<>'GERENTE_GENERAL' or organization_id=i.organization_id)) then raise exception 'Account already has an active membership' using errcode='23505'; end if;
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

create or replace function campo_private.activate_invitation(iid uuid, display_name text) returns jsonb
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
  if exists(select 1 from public.organization_members where user_id=actor and ended_at is null and (i.role<>'GERENTE_GENERAL' or role<>'GERENTE_GENERAL' or organization_id=i.organization_id)) then raise exception 'Account already has an active membership' using errcode='23505'; end if;
  mid := campo_private.replace_membership(actor,i.organization_id,i.role,team_ids,display_name);
  update public.invitations set consumed_at=now(),activated_member_id=mid where id=iid;
  insert into public.audit_logs(actor_id,action,resource_id,reason,details) values(actor,'invitation.activate',iid,'Approved invitation activated by its verified recipient',jsonb_build_object('member_id',mid));
  return jsonb_build_object('member_id',mid,'status','activated');
end $$;

create or replace function campo_private.access_context() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare m public.organization_members; teams jsonb; pending jsonb; memberships jsonb;
begin
  if not campo_private.active_identity() then raise exception 'Confirmed, non-banned identity required' using errcode='42501'; end if;
  if campo_private.is_admin() then return jsonb_build_object('status','active','role','SUPER_ADMIN','user_id',auth.uid(),'organization_id',null,'teams','[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'organization_id',i.organization_id,'role',i.role,'delivery_status',i.delivery_status,'expires_at',i.expires_at)),'[]'::jsonb) into pending
    from public.invitations i join auth.users u on u.id=auth.uid() join public.organizations o on o.id=i.organization_id
    where lower(u.email)=i.email and i.recipient_id=u.id and i.consumed_at is null and i.revoked_at is null and i.expires_at>now() and o.active;
  select * into m from public.organization_members where user_id=auth.uid() and ended_at is null and campo_private.in_org(organization_id) order by joined_at,id limit 1;
  if found and campo_private.in_org(m.organization_id) then
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name),'[]'::jsonb) into teams from public.teams t where t.organization_id=m.organization_id and t.active and
      (m.role in ('GERENTE','GERENTE_GENERAL') or exists(select 1 from public.team_members tm where tm.member_id=m.id and tm.team_id=t.id and tm.ended_at is null)
        or exists(select 1 from public.team_supervisors ts where ts.member_id=m.id and ts.team_id=t.id and ts.ended_at is null));
    select coalesce(jsonb_agg(jsonb_build_object('member_id',id,'organization_id',organization_id,'role',role,'name',name) order by joined_at,id),'[]'::jsonb) into memberships from public.organization_members where user_id=auth.uid() and ended_at is null and campo_private.in_org(organization_id);
    if m.role='GERENTE_GENERAL' then
      select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name)),'[]'::jsonb) into teams from public.teams t where t.active and campo_private.in_org(t.organization_id);
    end if;
    return jsonb_build_object('invitations',pending,'memberships',memberships,'status','active','user_id',auth.uid(),'member_id',m.id,'name',m.name,'organization_id',m.organization_id,'role',m.role,'teams',teams);
  end if;
  return jsonb_build_object('status','awaiting_approval','user_id',auth.uid(),'invitations',pending);
end $$;

create or replace function campo_private.content_command(action text, payload jsonb, operation_id uuid) returns jsonb
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
    perform campo_private.check_keys(payload,array['recipient_id','organization_id']); recipient := (payload->>'recipient_id')::uuid;
    select id,organization_id into m1,org from public.organization_members where user_id=actor and ended_at is null and (not (payload ? 'organization_id') or organization_id=(payload->>'organization_id')::uuid) order by joined_at,id limit 1;
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

create or replace function campo_private.invitation_team_count() returns trigger
language plpgsql security definer set search_path = '' as $$
declare iid uuid; i public.invitations; n integer;
begin
  if tg_table_name = 'invitations' then iid := coalesce(new.id, old.id);
  else iid := coalesce(new.invitation_id, old.invitation_id); end if;
  select * into i from public.invitations where id = iid for update;
  if not found then return null; end if;
  select count(*) into n from public.invitation_teams where invitation_id = iid;
  if (i.role = 'USUARIO' and n <> 1) or (i.role = 'ENCARGADO' and n < 1) or (i.role in ('GERENTE','GERENTE_GENERAL') and n <> 0)
    then raise exception 'Invitation role and teams do not match'; end if;
  return null;
end $$;

create or replace function campo_private.request_invitation(org uuid, invite_email text) returns jsonb
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
    or exists(select 1 from auth.users u join public.organization_members m on m.user_id=u.id where lower(u.email)=normalized and m.ended_at is null and (m.role<>'GERENTE_GENERAL' or m.organization_id=org)) then
    raise exception 'Invitation or account unavailable' using errcode='23505'; end if;
  insert into public.invitation_requests(organization_id,requested_by,email) values(org,auth.uid(),normalized) returning id into rid;
  insert into public.audit_logs(actor_id,action,resource_id,reason) values(auth.uid(),'invitation.request',rid,'Invitation requested by an authorized member');
  return jsonb_build_object('request_id',rid,'status','pending');
end $$;
commit;
