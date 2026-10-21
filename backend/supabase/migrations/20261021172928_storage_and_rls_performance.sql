begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Cover foreign keys without duplicating a nonpartial leading-column index.
-- This avoids sequential scans/long locks when validating referenced rows.
do $$
declare fk record; columns_sql text; index_name text;
begin
  for fk in
    select con.oid,con.conrelid,con.conkey,n.nspname,c.relname
    from pg_constraint con join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where con.contype='f' and n.nspname='public'
      and not exists (
        select 1 from pg_index i where i.indrelid=con.conrelid
          and i.indisvalid and i.indpred is null and i.indexprs is null
          and (i.indkey::smallint[])[0:cardinality(con.conkey)-1] @> con.conkey
      )
    order by cardinality(con.conkey) desc,con.oid
  loop
    -- Recheck after each creation: a composite index can cover another FK.
    if exists(select 1 from pg_index i where i.indrelid=fk.conrelid and i.indisvalid and i.indpred is null and i.indexprs is null
      and (i.indkey::smallint[])[0:cardinality(fk.conkey)-1] @> fk.conkey) then continue; end if;
    select string_agg(format('%I',a.attname),', ' order by k.position)
      into columns_sql from unnest(fk.conkey) with ordinality k(attnum,position)
      join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=k.attnum;
    index_name:=left(fk.relname,35)||'_fk_'||substr(md5(columns_sql),1,12);
    execute format('create index if not exists %I on %I.%I (%s)',index_name,fk.nspname,fk.relname,columns_sql);
  end loop;
end $$;

-- Cache only request-constant identity checks. Row-dependent permission
-- functions remain correlated and every original USING/WITH CHECK is retained.
do $$
declare p record; statement text;
begin
  for p in select * from pg_policies where schemaname='public' and policyname in (
    'requests_read','requests_insert','posts_insert','comments_insert',
    'reactions_insert','reactions_delete','tasks_insert','tasks_update',
    'reads_insert','messages_insert','map_tracks_read'
  ) loop
    statement:=format('alter policy %I on %I.%I',p.policyname,p.schemaname,p.tablename);
    if p.qual is not null then
      statement:=statement||' using ('||replace(replace(p.qual,'auth.uid()','(select auth.uid())'),'campo_private.is_admin()','(select campo_private.is_admin())')||')';
    end if;
    if p.with_check is not null then
      statement:=statement||' with check ('||replace(replace(p.with_check,'auth.uid()','(select auth.uid())'),'campo_private.is_admin()','(select campo_private.is_admin())')||')';
    end if;
    execute statement;
  end loop;
end $$;

create index if not exists map_tracks_org_history on public.map_tracks(organization_id,started_at desc,id) where deleted_at is null;
create index if not exists map_features_photo_path on public.map_features(photo_path) where deleted_at is null and photo_path is not null;

-- command_results is intentionally inaccessible to client roles. RLS without
-- a client policy here is a deny-all boundary, not a missing public grant.
revoke all on campo_private.command_results from anon,authenticated;
comment on table campo_private.command_results is 'Private idempotency ledger. Deny all direct client access; accessed only by authorized command functions.';
commit;
