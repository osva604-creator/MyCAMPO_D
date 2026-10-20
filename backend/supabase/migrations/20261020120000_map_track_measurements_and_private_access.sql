begin;

alter table public.map_tracks
  add column measurement_type text check (measurement_type in ('perimeter','labor')),
  add column implement_width_m double precision check (implement_width_m is null or implement_width_m > 0),
  add column result_area_ha double precision check (result_area_ha is null or result_area_ha >= 0),
  add column closure_distance_m double precision check (closure_distance_m is null or closure_distance_m >= 0),
  add column result_geometry jsonb,
  add column gps_quality jsonb,
  add column interruption_reason text,
  add column interrupted_at timestamptz;

comment on column public.map_tracks.shared is
  'Legacy compatibility only. Track access is owner or SUPER_ADMIN; this value is ignored.';
comment on column public.map_tracks.measurement_type is
  'Null for legacy tracks; perimeter or labor for new measurements.';

-- Legacy data and samples are retained. A formerly shared track is no longer exposed
-- to other members; the old sharing flag is cleared so future readers cannot mistake it.
update public.map_tracks set shared=false where shared;
create function campo_private.force_private_map_track() returns trigger
language plpgsql set search_path='' as $$
begin
  new.shared:=false;
  return new;
end $$;
create trigger map_track_always_private before insert or update of shared on public.map_tracks
  for each row execute function campo_private.force_private_map_track();

drop policy if exists map_tracks_read on public.map_tracks;
create policy map_tracks_read on public.map_tracks for select to authenticated
  using (deleted_at is null and campo_private.can_create(organization_id,team_id)
    and (user_id=auth.uid() or campo_private.is_admin()));

create or replace function campo_private.read_map_track(tid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.map_tracks t where t.id=tid and t.deleted_at is null
    and campo_private.can_create(t.organization_id,t.team_id)
    and (t.user_id=auth.uid() or campo_private.is_admin()))
$$;
drop policy if exists map_samples_read on public.map_track_samples;
create policy map_samples_read on public.map_track_samples for select to authenticated
  using (campo_private.read_map_track(track_id));

create function campo_private.map_sample_drift_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare prev public.map_track_samples; dt float8; raw_delta float8; threshold float8;
begin
  select * into prev from public.map_track_samples
    where track_id=new.track_id order by seq desc limit 1;
  if prev.id is null or prev.segment<>new.segment then return new; end if;
  dt:=extract(epoch from new.recorded_at-prev.recorded_at);
  if new.seq<=prev.seq or dt<=0 then raise exception 'Out of order GPS sample' using errcode='22023'; end if;
  if dt>120 then raise exception 'GPS interruption requires a new segment' using errcode='22023'; end if;
  raw_delta:=2*6371008.8*asin(least(1,sqrt(
    sin(radians(new.latitude-prev.latitude)/2)^2
    +cos(radians(prev.latitude))*cos(radians(new.latitude))
    *sin(radians(new.longitude-prev.longitude)/2)^2
  )));
  threshold:=greatest(2,sqrt(prev.accuracy^2+new.accuracy^2)*0.7);
  new.distance_m:=greatest(0,raw_delta-threshold);
  return new;
end $$;
drop trigger if exists map_sample_drift_guard on public.map_track_samples;
create trigger map_sample_drift_guard before insert on public.map_track_samples
  for each row execute function campo_private.map_sample_drift_guard();
create function campo_private.map_track_distance_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare latest public.map_track_samples; prev public.map_track_samples; dt float8; raw_delta float8;
begin
  select * into latest from public.map_track_samples where track_id=new.id order by seq desc limit 1;
  if latest.id is null or latest.recorded_at is distinct from new.last_fix_at then return new; end if;
  select * into prev from public.map_track_samples where track_id=new.id and seq<latest.seq order by seq desc limit 1;
  if prev.id is null or prev.segment<>latest.segment then return new; end if;
  dt:=extract(epoch from latest.recorded_at-prev.recorded_at);
  if dt<=0 or dt>120 then return new; end if;
  raw_delta:=2*6371008.8*asin(least(1,sqrt(
    sin(radians(latest.latitude-prev.latitude)/2)^2
    +cos(radians(prev.latitude))*cos(radians(latest.latitude))
    *sin(radians(latest.longitude-prev.longitude)/2)^2
  )));
  -- map_command adds raw_delta; correct the accumulated distance after its
  -- update so the total never temporarily violates the non-negative constraint.
  update public.map_tracks set distance_m=distance_m+latest.distance_m-raw_delta where id=new.id;
  return new;
end $$;
create trigger map_track_distance_guard after update of last_fix_at on public.map_tracks
  for each row execute function campo_private.map_track_distance_guard();

create function campo_private.map_track_metadata(action text,payload jsonb,operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); rid uuid; org uuid; team uuid; t public.map_tracks;
  cached campo_private.command_results; result jsonb; at_time timestamptz; width float8; area_ha float8; g jsonb; calculated_area float8;
begin
  if not campo_private.active_identity() or (payload->>'user_id')::uuid is distinct from actor then
    raise exception 'Map identity not authorized' using errcode='42501';
  end if;
  if action not in ('track.configure','track.result','track.fix') or operation_id is null
    or octet_length(payload::text)>200000 then
    raise exception 'Invalid track metadata operation' using errcode='22023';
  end if;
  rid:=(payload->>'id')::uuid; org:=(payload->>'organization_id')::uuid; team:=(payload->>'team_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||operation_id::text,0));
  select * into cached from campo_private.command_results r
    where r.actor_id=actor and r.operation_id=map_track_metadata.operation_id;
  if found then
    if cached.action<>'map.'||action or cached.payload<>payload then
      raise exception 'Operation ID reused with different data' using errcode='22023';
    end if;
    return cached.result;
  end if;
  select * into t from public.map_tracks where id=rid for update;
  if not found or t.user_id<>actor or t.organization_id<>org or t.team_id<>team
    or t.deleted_at is not null or not campo_private.can_create(org,team) then
    raise exception 'Track not authorized' using errcode='42501';
  end if;
  if action='track.configure' then
    if t.measurement_type is not null or t.status<>'active'
      or payload->>'measurement_type' not in ('perimeter','labor') then
      raise exception 'Invalid measurement configuration' using errcode='22023';
    end if;
    width:=nullif(payload->>'implement_width_m','')::float8;
    if payload->>'measurement_type'='labor' and (width is null or width<=0 or width>100)
      or payload->>'measurement_type'='perimeter' and width is not null then
      raise exception 'Invalid implement width' using errcode='22023';
    end if;
    update public.map_tracks set measurement_type=payload->>'measurement_type',
      implement_width_m=width where id=rid returning * into t;
  elsif action='track.fix' then
    at_time:=(payload->>'last_fix_at')::timestamptz;
    if t.status<>'active' or at_time is null or at_time<t.started_at or at_time>now()+interval '5 minutes'
      or (payload->>'last_latitude') is null or (payload->>'last_latitude')::float8 not between -90 and 90
      or (payload->>'last_longitude') is null or (payload->>'last_longitude')::float8 not between -180 and 180
      or (payload->>'last_accuracy') is null or (payload->>'last_accuracy')::float8 not between 0 and 50 then
      raise exception 'Invalid latest GPS fix' using errcode='22023';
    end if;
    update public.map_tracks set last_latitude=(payload->>'last_latitude')::float8,
      last_longitude=(payload->>'last_longitude')::float8,last_accuracy=(payload->>'last_accuracy')::float8,
      last_fix_at=at_time,received_at=now() where id=rid returning * into t;
  else
    if t.status<>'finished' or t.measurement_type is null then
      raise exception 'Finish a configured track before saving its result' using errcode='22023';
    end if;
    if jsonb_typeof(payload->'gps_quality') is distinct from 'object' then
      raise exception 'GPS quality details are required' using errcode='22023';
    end if;
    area_ha:=nullif(payload->>'result_area_ha','')::float8;
    g:=payload->'result_geometry';
    if t.measurement_type='labor' then
      if area_ha is null or area_ha<0 or t.implement_width_m is null
        or abs(area_ha-(t.distance_m*t.implement_width_m/10000))>greatest(0.001,area_ha*0.001) then
        raise exception 'Invalid gross work-area estimate' using errcode='22023';
      end if;
      g:=null;
    elsif area_ha is not null and (g is null or campo_private.map_geometry_area(g) is null) then
      raise exception 'Invalid measured perimeter geometry' using errcode='22023';
    elsif area_ha is not null then
      calculated_area:=campo_private.map_geometry_area(g);
      if abs(area_ha-calculated_area)>greatest(0.001,area_ha*0.01) then
        raise exception 'Measured perimeter area does not match its geometry' using errcode='22023';
      end if;
    elsif g is not null then
      raise exception 'Perimeter geometry requires a validated area' using errcode='22023';
    end if;
    update public.map_tracks set result_area_ha=area_ha,
      closure_distance_m=nullif(payload->>'closure_distance_m','')::float8,
      result_geometry=g,gps_quality=payload->'gps_quality',
      interruption_reason=nullif(payload->>'interruption_reason','')
      where id=rid returning * into t;
  end if;
  result:=to_jsonb(t);
  insert into campo_private.command_results values(actor,operation_id,'map.'||action,payload,result,now());
  return result;
end $$;

create function public.campo_map_track_metadata(action text,payload jsonb,operation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select campo_private.map_track_metadata(action,payload,operation_id)
$$;
revoke all on function campo_private.map_track_metadata(text,jsonb,uuid),
  public.campo_map_track_metadata(text,jsonb,uuid),
  campo_private.map_sample_drift_guard(),campo_private.map_track_distance_guard(),
  campo_private.force_private_map_track() from public,anon;
grant execute on function campo_private.map_track_metadata(text,jsonb,uuid),
  public.campo_map_track_metadata(text,jsonb,uuid) to authenticated;

commit;
