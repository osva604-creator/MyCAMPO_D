import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('aplica el esquema PostgreSQL, restringe usuarios externos y conserva eventos y fotos inmutables', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid primary key, bucket_id text, name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1, '/') $$;
      grant usage on schema public, auth, storage to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      grant select, insert, update, delete on storage.objects to authenticated;
    `);
    await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
    const member = '00000000-0000-4000-8000-000000000001';
    const outsider = '00000000-0000-4000-8000-000000000002';
    const eventId = '00000000-0000-4000-8000-000000000003';
    await db.query('insert into auth.users values ($1), ($2)', [member, outsider]);
    await db.query("insert into public.members (id, name, handle) values ($1, 'Ana', 'Ana')", [member]);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [member]);
    const payload = { id: eventId, caption: 'Molino roto', location: 'Lote 1', status: 'Pendiente', createdAt: new Date().toISOString(), image: `${member}/${eventId}.jpg` };
    await db.query("insert into public.events (id, actor_id, type, payload, created_at) values ($1, $2, 'post', $3, now())", [eventId, member, JSON.stringify(payload)]);
    expect((await db.query('select * from public.events')).rows).toHaveLength(1);
    await expect(db.query("update public.events set type = 'like'")).rejects.toThrow();
    await expect(db.query('delete from public.events')).rejects.toThrow();
    await db.query("insert into storage.objects values ($1, 'evidence', $2)", [eventId, payload.image]);
    expect((await db.query('select * from storage.objects')).rows).toHaveLength(1);
    expect((await db.query("update storage.objects set name = 'changed' returning *")).rows).toHaveLength(0);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [outsider]);
    expect((await db.query('select * from public.events')).rows).toHaveLength(0);
    expect((await db.query('select * from storage.objects')).rows).toHaveLength(0);
    await expect(db.query("insert into public.events (id, actor_id, type, payload, created_at) values ('00000000-0000-4000-8000-000000000004', $1, 'post', $2, now())", [outsider, JSON.stringify(payload)])).rejects.toThrow();
    await db.exec('reset role');
    await db.query('update public.members set active = false where id = $1', [member]);
    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [member]);
    expect((await db.query('select * from public.events')).rows).toHaveLength(0);
    await db.exec('set role anon');
    await expect(db.query('select * from public.events')).rejects.toThrow();
  } finally { await db.close(); }
}, 30000);
