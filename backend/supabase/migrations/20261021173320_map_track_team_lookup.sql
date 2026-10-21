begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
-- Organization/date lookups now use map_tracks_org_history. Reorder the older
-- index to match the team foreign key instead of retaining a duplicate index.
drop index public.map_tracks_scope;
create index map_tracks_scope on public.map_tracks(team_id,organization_id,started_at desc);
commit;
