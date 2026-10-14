-- READ ONLY: ejecutar después de aplicar las tres migraciones aprobadas.
-- Revisar todos los resultados; no modifica ni repara permisos.
select schemaname, tablename, rowsecurity
from pg_tables where schemaname in ('public', 'campo_private')
order by schemaname, tablename;

-- Debe devolver cero filas para tablas de aplicación expuestas sin RLS.
select schemaname, tablename from pg_tables
where schemaname = 'public' and not rowsecurity;

-- Revisar especialmente funciones definer expuestas y EXECUTE heredado de PUBLIC.
select n.nspname as schema_name, p.proname, p.prosecdef as security_definer,
       p.proconfig, p.proacl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'campo_private')
order by n.nspname, p.proname;

select version, name from supabase_migrations.schema_migrations order by version;
select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'campo-private';
select schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime' order by schemaname, tablename;

-- Después del bootstrap debe ser exactamente uno; antes del bootstrap, cero.
select count(*) as owners from public.platform_admins;
