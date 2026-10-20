begin;

-- WGS84 simple polygons: one closed exterior ring, at most 500 vertices.
-- No PostGIS dependency and no modification of existing publications.
create function campo_private.map_geometry_area(g jsonb) returns double precision
language plpgsql immutable set search_path='' as $$
declare r jsonb; p jsonb; a double precision[]; b double precision[]; c double precision[]; d double precision[];
  n int; i int; j int; area double precision:=0; cross1 double precision; cross2 double precision; cross3 double precision; cross4 double precision;
begin
  if g->>'type'='Point' then
    r:=g->'coordinates';
    if jsonb_typeof(r) is distinct from 'array' or jsonb_array_length(r)<>2 then return null; end if;
    if jsonb_typeof(r->0) is distinct from 'number' or jsonb_typeof(r->1) is distinct from 'number' then return null; end if;
    if abs((r->>0)::float8)>180 or abs((r->>1)::float8)>90 then return null; end if;
    return 0;
  end if;
  if g->>'type' is distinct from 'Polygon' or jsonb_array_length(g->'coordinates')<>1 then return null; end if;
  r:=g->'coordinates'->0; n:=jsonb_array_length(r);
  if n<4 or n>501 or r->0 is distinct from r->(n-1) then return null; end if;
  for p in select value from jsonb_array_elements(r) loop
    if campo_private.map_geometry_area(jsonb_build_object('type','Point','coordinates',p)) is null then return null; end if;
  end loop;
  for i in 0..n-2 loop
    a:=array[(r->i->>0)::float8,(r->i->>1)::float8]; b:=array[(r->(i+1)->>0)::float8,(r->(i+1)->>1)::float8];
    if a=b or abs(a[1]-b[1])>=180 then return null; end if;
    area:=area+radians(b[1]-a[1])*(2+sin(radians(a[2]))+sin(radians(b[2])));
    for j in i+2..n-2 loop
      if i=0 and j=n-2 then continue; end if;
      c:=array[(r->j->>0)::float8,(r->j->>1)::float8]; d:=array[(r->(j+1)->>0)::float8,(r->(j+1)->>1)::float8];
      cross1:=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);
      cross2:=(b[1]-a[1])*(d[2]-a[2])-(b[2]-a[2])*(d[1]-a[1]);
      cross3:=(d[1]-c[1])*(a[2]-c[2])-(d[2]-c[2])*(a[1]-c[1]);
      cross4:=(d[1]-c[1])*(b[2]-c[2])-(d[2]-c[2])*(b[1]-c[1]);
      if cross1*cross2<=0 and cross3*cross4<=0 and greatest(a[1],b[1])>=least(c[1],d[1]) and greatest(c[1],d[1])>=least(a[1],b[1])
        and greatest(a[2],b[2])>=least(c[2],d[2]) and greatest(c[2],d[2])>=least(a[2],b[2]) then return null; end if;
    end loop;
  end loop;
  area:=abs(area)*6371008.8^2/20000;
  if area<0.0001 then return null; end if;
  return area;
exception when others then return null;
end $$;

create table public.map_features (
  id uuid primary key,
  organization_id uuid not null,
  team_id uuid not null,
  author_id uuid not null references auth.users(id),
  kind text not null check(kind in ('parcel','point')),
  geometry jsonb not null,
  name text not null check(length(trim(name)) between 1 and 120),
  description text not null default '' check(length(description)<=3000),
  category text not null default 'otro' check(category in ('incidencia','tranquera','pozo','maquinaria','otro')),
  crop text not null default '' check(length(crop)<=120),
  season text not null default '' check(length(season)<=80),
  responsible_id uuid references auth.users(id),
  color text not null default '#15803d' check(color ~ '^#[0-9a-fA-F]{6}$'),
  area_ha double precision not null default 0 check(area_ha>=0),
  photo_path text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key(team_id,organization_id) references public.teams(id,organization_id),
  check(campo_private.map_geometry_area(geometry) is not null),
  check((kind='parcel' and geometry->>'type'='Polygon') or (kind='point' and geometry->>'type'='Point'))
);
create index map_features_scope on public.map_features(organization_id,team_id) where deleted_at is null;
create index map_features_author on public.map_features(author_id);
create index map_features_responsible on public.map_features(responsible_id);

create table public.map_tracks (
  id uuid primary key,
  organization_id uuid not null,
  team_id uuid not null,
  user_id uuid not null references auth.users(id),
  status text not null default 'active' check(status in ('active','paused','finished')),
  shared boolean not null default false,
  started_at timestamptz not null,
  active_since timestamptz,
  ended_at timestamptz,
  duration_ms bigint not null default 0 check(duration_ms>=0),
  distance_m double precision not null default 0 check(distance_m>=0),
  last_latitude double precision,
  last_longitude double precision,
  last_accuracy double precision,
  last_fix_at timestamptz,
  received_at timestamptz,
  deleted_at timestamptz,
  foreign key(team_id,organization_id) references public.teams(id,organization_id)
);
create index map_tracks_scope on public.map_tracks(organization_id,team_id,started_at desc);
create index map_tracks_user on public.map_tracks(user_id,started_at desc);
create table public.map_track_samples (
  id uuid primary key,
  track_id uuid not null references public.map_tracks(id),
  seq int not null check(seq>=0),
  segment int not null check(segment>=0),
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  accuracy double precision not null check(accuracy between 0 and 50),
  recorded_at timestamptz not null,
  distance_m double precision not null check(distance_m>=0),
  unique(track_id,seq)
);

create function campo_private.read_map_track(tid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.map_tracks t where t.id=tid and t.deleted_at is null
    and campo_private.can_create(t.organization_id,t.team_id) and (t.user_id=auth.uid() or t.shared))
$$;
create function campo_private.map_photo_allowed(path text, writing boolean) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.map_features f where f.photo_path=path and f.deleted_at is null
    and campo_private.can_create(f.organization_id,f.team_id)
    and (not writing or f.author_id=auth.uid() or campo_private.manages(f.organization_id,f.team_id)))
$$;
alter table public.map_features enable row level security;
alter table public.map_tracks enable row level security;
alter table public.map_track_samples enable row level security;
revoke all on public.map_features,public.map_tracks,public.map_track_samples from public,anon,authenticated;
grant select on public.map_features,public.map_tracks,public.map_track_samples to authenticated;
create policy map_features_read on public.map_features for select to authenticated using(deleted_at is null and campo_private.can_create(organization_id,team_id));
create policy map_tracks_read on public.map_tracks for select to authenticated using(deleted_at is null and campo_private.can_create(organization_id,team_id) and (user_id=auth.uid() or shared));
create policy map_samples_read on public.map_track_samples for select to authenticated using(campo_private.read_map_track(track_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('campo-map-private','campo-map-private',false,10485760,array['image/jpeg','image/png']);
create policy map_photos_read on storage.objects for select to authenticated using(bucket_id='campo-map-private' and campo_private.map_photo_allowed(name,false));
create policy map_photos_insert on storage.objects for insert to authenticated with check(bucket_id='campo-map-private' and campo_private.map_photo_allowed(name,true));
create policy map_photos_update on storage.objects for update to authenticated using(bucket_id='campo-map-private' and campo_private.map_photo_allowed(name,true)) with check(bucket_id='campo-map-private' and campo_private.map_photo_allowed(name,true));

create function campo_private.map_command(action text,payload jsonb,operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); org uuid; team uuid; rid uuid; f public.map_features; t public.map_tracks;
  cached campo_private.command_results; result jsonb; g jsonb; ha float8; at_time timestamptz;
  s jsonb; prev public.map_track_samples; sample_id uuid; lat float8; lng float8; acc float8; dt float8; delta float8; seg int; sn int;
begin
  if not campo_private.active_identity() or (payload->>'user_id')::uuid is distinct from actor then
    raise exception 'Map identity not authorized' using errcode='42501'; end if;
  if operation_id is null or octet_length(payload::text)>200000 then raise exception 'Invalid map operation' using errcode='22023'; end if;
  org:=(payload->>'organization_id')::uuid; team:=(payload->>'team_id')::uuid; rid:=(payload->>'id')::uuid;
  if not campo_private.can_create(org,team) then raise exception 'Map team not authorized' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||operation_id::text,0));
  select * into cached from campo_private.command_results r where r.actor_id=actor and r.operation_id=map_command.operation_id;
  if found then
    if cached.action<>'map.'||action or cached.payload<>payload then raise exception 'Operation ID reused with different data' using errcode='22023'; end if;
    return cached.result;
  end if;
  if action in ('feature.save','feature.delete') then
    select * into f from public.map_features where id=rid for update;
    if found then
      if f.organization_id<>org or f.team_id<>team or f.deleted_at is not null
        or not (campo_private.manages(org,team) or (f.kind='point' and f.author_id=actor)) then
        raise exception 'Map edit not authorized' using errcode='42501'; end if;
      if f.version is distinct from (payload->>'version')::int then raise exception 'Map version conflict. Reload before editing.' using errcode='40001'; end if;
    else
      if action='feature.delete' or payload->>'version' is not null then raise exception 'Map feature not found' using errcode='P0002'; end if;
    end if;
    if action='feature.delete' then
      update public.map_features set deleted_at=now(),updated_at=now(),version=version+1 where id=rid returning * into f;
    else
      if (payload->>'kind') not in ('parcel','point') or (f.id is not null and f.kind<>payload->>'kind') then raise exception 'Invalid feature kind' using errcode='22023'; end if;
      if payload->>'kind'='parcel' and not campo_private.manages(org,team) then raise exception 'Parcel management not authorized' using errcode='42501'; end if;
      g:=payload->'geometry'; ha:=campo_private.map_geometry_area(g);
      if ha is null then raise exception 'Invalid WGS84 geometry: closed simple polygon or point required' using errcode='22023'; end if;
      if payload->>'responsible_id' is not null and not exists(select 1 from public.organization_members m where m.user_id=(payload->>'responsible_id')::uuid and m.organization_id=org and m.ended_at is null) then raise exception 'Responsible must belong to organization' using errcode='22023'; end if;
      insert into public.map_features(id,organization_id,team_id,author_id,kind,geometry,name,description,category,crop,season,responsible_id,color,area_ha,photo_path)
      values(rid,org,team,actor,payload->>'kind',g,trim(payload->>'name'),coalesce(payload->>'description',''),coalesce(payload->>'category','otro'),coalesce(payload->>'crop',''),coalesce(payload->>'season',''),(payload->>'responsible_id')::uuid,coalesce(payload->>'color','#15803d'),ha,
        case when payload->>'photo'='true' then org::text||'/'||rid::text||'/'||operation_id::text end)
      on conflict(id) do update set geometry=excluded.geometry,name=excluded.name,description=excluded.description,category=excluded.category,crop=excluded.crop,season=excluded.season,responsible_id=excluded.responsible_id,color=excluded.color,area_ha=excluded.area_ha,
        photo_path=coalesce(excluded.photo_path,map_features.photo_path),updated_at=now(),version=map_features.version+1
      returning * into f;
    end if;
    result:=to_jsonb(f);
  elsif action='track.start' then
    at_time:=(payload->>'started_at')::timestamptz;
    if at_time is null or at_time>now()+interval '5 minutes' or at_time<now()-interval '365 days' then raise exception 'Invalid track time' using errcode='22023'; end if;
    insert into public.map_tracks(id,organization_id,team_id,user_id,shared,started_at,active_since)
      values(rid,org,team,actor,coalesce((payload->>'shared')::boolean,false),at_time,at_time) returning * into t;
    result:=to_jsonb(t);
  elsif action in ('track.samples','track.state','track.delete') then
    select * into t from public.map_tracks where id=rid for update;
    if not found or t.user_id<>actor or t.organization_id<>org or t.team_id<>team or t.deleted_at is not null then raise exception 'Track not authorized' using errcode='42501'; end if;
    if action='track.delete' then
      if t.status<>'finished' then raise exception 'Finish track before deleting' using errcode='22023'; end if;
      update public.map_tracks set deleted_at=now() where id=rid returning * into t;
    elsif action='track.state' then
      at_time:=(payload->>'at')::timestamptz;
      if at_time is null or at_time<coalesce(t.active_since,t.started_at) or at_time>now()+interval '5 minutes' or t.status='finished'
        or payload->>'status' not in ('active','paused','finished') or payload->>'status'=t.status then raise exception 'Invalid track transition' using errcode='22023'; end if;
      update public.map_tracks set status=payload->>'status',
        duration_ms=duration_ms+case when t.status='active' then greatest(0,(extract(epoch from at_time-t.active_since)*1000)::bigint) else 0 end,
        active_since=case when payload->>'status'='active' then at_time else null end,
        ended_at=case when payload->>'status'='finished' then at_time else null end
      where id=rid returning * into t;
    else
      if t.status<>'active' or jsonb_typeof(payload->'samples') is distinct from 'array' or jsonb_array_length(payload->'samples') not between 1 and 100 then raise exception 'Invalid sample batch' using errcode='22023'; end if;
      for s in select value from jsonb_array_elements(payload->'samples') loop
        sample_id:=(s->>'id')::uuid; lat:=(s->>'latitude')::float8; lng:=(s->>'longitude')::float8; acc:=(s->>'accuracy')::float8;
        at_time:=(s->>'recorded_at')::timestamptz; seg:=(s->>'segment')::int; sn:=(s->>'seq')::int;
        if exists(select 1 from public.map_track_samples where id=sample_id and track_id=rid and seq=sn and latitude=lat and longitude=lng and accuracy=acc and recorded_at=at_time and segment=seg) then continue; end if;
        if lat is null or lng is null or acc is null or sn is null or seg is null or not(lat between -90 and 90 and lng between -180 and 180 and acc between 0 and 50)
          or at_time is null or at_time<t.started_at or at_time<coalesce(t.active_since,t.started_at) or at_time>now()+interval '5 minutes' then raise exception 'Invalid GPS sample' using errcode='22023'; end if;
        select * into prev from public.map_track_samples where track_id=rid order by seq desc limit 1;
        delta:=0;
        if prev.id is not null then
          dt:=extract(epoch from at_time-prev.recorded_at);
          if sn<=prev.seq or seg<prev.segment or dt<=0 then raise exception 'Out of order GPS sample' using errcode='22023'; end if;
          if seg=prev.segment and dt<=120 then
            delta:=2*6371008.8*asin(least(1,sqrt(sin(radians(lat-prev.latitude)/2)^2+cos(radians(prev.latitude))*cos(radians(lat))*sin(radians(lng-prev.longitude)/2)^2)));
            if dt<2 or delta/dt>35 then raise exception 'GPS jump rejected' using errcode='22023'; end if;
          end if;
        end if;
        insert into public.map_track_samples values(sample_id,rid,sn,seg,lat,lng,acc,at_time,delta);
        update public.map_tracks set distance_m=distance_m+delta,last_latitude=lat,last_longitude=lng,last_accuracy=acc,last_fix_at=at_time,received_at=now() where id=rid returning * into t;
      end loop;
    end if;
    result:=to_jsonb(t);
  else raise exception 'Unknown map action' using errcode='22023'; end if;
  insert into campo_private.command_results values(actor,operation_id,'map.'||action,payload,result,now());
  return result;
end $$;
create function public.campo_map_command(action text,payload jsonb,operation_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select campo_private.map_command(action,payload,operation_id) $$;
revoke all on function campo_private.map_command(text,jsonb,uuid),public.campo_map_command(text,jsonb,uuid),campo_private.map_geometry_area(jsonb),campo_private.read_map_track(uuid),campo_private.map_photo_allowed(text,boolean) from public,anon;
grant execute on function campo_private.map_command(text,jsonb,uuid),public.campo_map_command(text,jsonb,uuid),campo_private.read_map_track(uuid),campo_private.map_photo_allowed(text,boolean) to authenticated;
-- Public queries only need the read helpers; writes always pass through the validated RPC.
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.map_features,public.map_tracks;
  end if;
end $$;
commit;
