import { beforeAll,afterAll,expect,it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { platformDb,ids,id } from './helpers/platform-db';
let f;
const polygon={type:'Polygon',coordinates:[[[-61,-35],[-60.99,-35],[-60.99,-34.99],[-61,-34.99],[-61,-35]]]};
const payload=(extra={})=>({user_id:ids.manager,organization_id:ids.org,team_id:ids.team,id:crypto.randomUUID(),...extra});
const command=(action,p,op=crypto.randomUUID())=>f.rpc('campo_map_command',[action,JSON.stringify(p),op]);
beforeAll(async()=>{
  f=await platformDb({application:true,sharedWorkTeams:true,generalManager:true});
  await f.owner();
  await f.db.exec(await readFile(new URL('../backend/supabase/migrations/20261019194557_map_features_and_tracks.sql',import.meta.url),'utf8'));
},30000);
afterAll(async()=>{await f?.db.close();});
it('saves geometry, derives hectares and prevents lost edits and duplicate retries',async()=>{
  await f.as(ids.manager);
  const p=payload({kind:'parcel',geometry:polygon,name:'Lote A',crop:'Soja',season:'2026/27'}),op=crypto.randomUUID();
  const saved=await command('feature.save',p,op);
  expect(saved.area_ha).toBeGreaterThan(90);expect(saved.area_ha).toBeLessThan(110);
  expect(await command('feature.save',p,op)).toEqual(saved);
  const updated=await command('feature.save',{...p,version:1,name:'Lote editado'});
  expect(updated.version).toBe(2);expect(updated.crop).toBe('Soja');
  await expect(command('feature.save',{...p,version:1,name:'Perder actualización'})).rejects.toThrow(/version conflict/i);
  await expect(command('feature.save',{...p,name:'Reused'},op)).rejects.toThrow(/reused/i);
  await command('feature.delete',{...p,version:2});
  expect((await f.query('select id from public.map_features where id=$1',[p.id])).rows).toHaveLength(0);
});
it('rejects invalid coordinates, unclosed/self-crossing polygons and missing coordinates at the database',async()=>{
  await f.as(ids.manager);
  for(const geometry of [{type:'Point'}, {type:'Point',coordinates:[200,-35]}, {type:'Polygon',coordinates:[[[-61,-35],[-60,-34],[-61,-34],[-60,-35],[-61,-35]]]}, {type:'Polygon',coordinates:[[[-61,-35],[-60,-35],[-61,-34]]]}])
    await expect(command('feature.save',payload({kind:geometry.type==='Point'?'point':'parcel',geometry,name:'Inválido'}))).rejects.toThrow(/geometry|constraint/i);
});
it('respects team roles, organization boundaries and author identity for features and private photos',async()=>{
  await f.as(ids.worker);
  const p=payload({user_id:ids.worker,kind:'point',geometry:{type:'Point',coordinates:[-61,-35]},name:'Pozo',photo:true});
  const saved=await command('feature.save',p);
  await f.query('insert into storage.objects(bucket_id,name) values($1,$2)',['campo-map-private',saved.photo_path]);
  await expect(command('feature.save',{...p,id:crypto.randomUUID(),kind:'parcel',geometry:polygon})).rejects.toThrow(/not authorized/i);
  await expect(command('feature.save',{...p,id:crypto.randomUUID(),team_id:ids.team2})).rejects.toThrow(/not authorized/i);
  await expect(command('feature.save',{...p,user_id:ids.manager})).rejects.toThrow(/identity/i);
  await f.as(ids.other);
  expect((await f.query('select * from public.map_features')).rows).toHaveLength(0);
  expect((await f.query("select * from storage.objects where bucket_id='campo-map-private'")).rows).toHaveLength(0);
  await expect(command('feature.save',{...p,user_id:ids.other,version:1})).rejects.toThrow(/not authorized/i);
  await f.as(ids.supervisor);
  expect((await f.query('select id from public.map_features where id=$1',[p.id])).rows).toHaveLength(1);
  await command('feature.save',{...p,user_id:ids.supervisor,version:1,name:'Pozo corregido'});
  await expect(f.query("update public.map_features set name='Bypass' where id=$1",[p.id])).rejects.toThrow(/permission/i);
});
it('keeps unshared tracks private and shares only with authorized members, without duplicate samples or distances',async()=>{
  await f.as(ids.worker);
  const started_at=new Date(Date.now()-60000).toISOString();
  const p=payload({user_id:ids.worker,started_at,shared:false});
  await command('track.start',p);
  const samples=[{id:crypto.randomUUID(),seq:0,segment:0,latitude:-35,longitude:-61,accuracy:7,recorded_at:started_at},
    {id:crypto.randomUUID(),seq:1,segment:0,latitude:-35.0001,longitude:-61,accuracy:8,recorded_at:new Date(Date.parse(started_at)+10000).toISOString()}];
  const op=crypto.randomUUID(), batch={...p,samples};
  const first=await command('track.samples',batch,op);
  expect(first.distance_m).toBeGreaterThan(10);expect(first.distance_m).toBeLessThan(12);
  expect(await command('track.samples',batch,op)).toEqual(first);
  await command('track.samples',batch); // Even a different operation cannot duplicate identical sample IDs.
  expect((await f.query('select * from public.map_track_samples where track_id=$1',[p.id])).rows).toHaveLength(2);
  await f.as(ids.manager);
  expect((await f.query('select * from public.map_tracks where id=$1',[p.id])).rows).toHaveLength(0);
  expect((await f.query('select * from public.map_track_samples where track_id=$1',[p.id])).rows).toHaveLength(0);
  await f.as(ids.worker);
  const shared={...p,id:crypto.randomUUID(),shared:true};await command('track.start',shared);
  await command('track.samples',{...shared,samples:[{...samples[0],id:crypto.randomUUID()}]});
  await f.as(ids.supervisor);
  expect((await f.query('select * from public.map_tracks where id=$1',[shared.id])).rows).toHaveLength(1);
  expect((await f.query('select * from public.map_track_samples where track_id=$1',[shared.id])).rows).toHaveLength(1);
  await expect(command('track.state',{...shared,user_id:ids.supervisor,status:'finished',at:new Date().toISOString()})).rejects.toThrow(/not authorized/i);
  await f.as(ids.other);
  expect((await f.query('select * from public.map_tracks')).rows).toHaveLength(0);
});
it('filters GPS jumps, handles pause/resume segments and rejects writes after finishing',async()=>{
  await f.as(ids.worker);const at=Date.now()-120000;
  const p=payload({user_id:ids.worker,started_at:new Date(at).toISOString(),shared:true});await command('track.start',p);
  const sample=(seq,seconds,extra={})=>({id:crypto.randomUUID(),seq,segment:0,latitude:-35,longitude:-61,accuracy:5,recorded_at:new Date(at+seconds*1000).toISOString(),...extra});
  await command('track.samples',{...p,samples:[sample(0,0)]});
  await expect(command('track.samples',{...p,samples:[sample(1,5,{latitude:-30})]})).rejects.toThrow(/jump/i);
  await expect(command('track.samples',{...p,samples:[sample(1,5,{accuracy:100})]})).rejects.toThrow(/Invalid GPS/i);
  await command('track.state',{...p,status:'paused',at:new Date(at+10000).toISOString()});
  await command('track.state',{...p,status:'active',at:new Date(at+20000).toISOString()});
  await command('track.samples',{...p,samples:[sample(1,25,{segment:1,latitude:-34})]});
  const end=await command('track.state',{...p,status:'finished',at:new Date(at+30000).toISOString()});
  expect(end.distance_m).toBe(0);expect(end.duration_ms).toBe(20000);
  await expect(command('track.samples',{...p,samples:[sample(2,35)]})).rejects.toThrow(/Invalid sample/i);
});
