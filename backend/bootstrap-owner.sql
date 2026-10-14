-- PROPOSAL. Run only after reviewing the migration and identifying the owner's Auth UUID.
-- First, in the SAME SQL session: select set_config('campo.owner_uuid', 'ACTUAL_AUTH_UUID', false);
-- Do not use an email, browser metadata, or "the first registered user" to select an owner.
begin;
lock table public.platform_admins in exclusive mode;
do $$
declare owner_uuid uuid;
begin
  owner_uuid := nullif(current_setting('campo.owner_uuid', true), '')::uuid;
  if owner_uuid is null then raise exception 'Set campo.owner_uuid to the verified owner Auth UUID first'; end if;
  if exists (select 1 from public.platform_admins) then raise exception 'Owner already provisioned; replacement requires a reviewed administrative operation'; end if;
  if not exists (select 1 from auth.users where id = owner_uuid and email_confirmed_at is not null
    and (banned_until is null or banned_until < now())) then
    raise exception 'Owner must be an existing confirmed, non-banned Auth user';
  end if;
  insert into public.platform_admins(user_id) values (owner_uuid);
  insert into public.audit_logs(actor_id, action, resource_id, reason)
    values (owner_uuid, 'owner.bootstrap', owner_uuid, 'Explicit owner provisioning by database operator');
end $$;
commit;
