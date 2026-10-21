import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { beforeEach,expect,it,vi } from 'vitest';
import { mapScope,mapRecords,mapOutbox,queueMap,syncMap,mergeMap,pruneSyncedMapHistory } from '../src/lib/mapStore';
const scope='team:user:org:permissions';
beforeEach(async()=>{
  await mapRecords('init');const db=await openDB('mycampo-d-map-v1',1);const tx=db.transaction(['records','outbox','points'],'readwrite');await Promise.all(['records','outbox','points'].map(s=>tx.objectStore(s).clear()));await tx.done;db.close();
});
it('separates local mode, users, organizations and membership versions',async()=>{
  const a=mapScope('a','org',{role:'USUARIO',teams:[{id:'one'}]}),b=mapScope('b','org',{role:'USUARIO'}),c=mapScope('a','other',{role:'USUARIO'});
  expect(mapScope('a',null,{})).toBe('local');expect(a).not.toBe(mapScope('a','org',{role:'USUARIO',teams:[{id:'two'}]}));
  for(const [i,key] of [a,b,c,'local'].entries())await queueMap(key,'feature.save',{id:`${i}`},{id:`${i}`,kind:'point',name:key});
  expect(await mapRecords(a)).toHaveLength(1);expect(await mapOutbox('local')).toHaveLength(0);
  expect(await mapOutbox(b)).toHaveLength(1);
});
it('keeps private photo bytes after interrupted upload and retries the same operation once',async()=>{
  const blob=new Blob(['exact bytes'],{type:'image/jpeg'});
  await queueMap(scope,'feature.save',{id:'point'},{id:'point',kind:'point',photoBlob:blob},blob);
  const failed=vi.fn(async()=>{throw new Error('connection interrupted');});
  await expect(syncMap(scope,failed)).rejects.toThrow(/interrupted/);
  const queued=await mapOutbox(scope);expect(await queued[0].photo.text()).toBe('exact bytes');
  const execute=vi.fn(async op=>({id:op.payload.id,version:1}));
  await Promise.all([syncMap(scope,execute),syncMap(scope,execute)]);
  expect(execute).toHaveBeenCalledTimes(1);expect(execute.mock.calls[0][0].operation_id).toBe(queued[0].operation_id);
  expect(await mapOutbox(scope)).toHaveLength(0);expect((await mapRecords(scope))[0].pending).toBe(false);
});
it('persists samples separately and preserves a newer edit while acknowledging an earlier one',async()=>{
  const track={id:'track',kind:'track',status:'active'};
  await queueMap(scope,'track.start',{id:track.id},track);
  const sample={id:'sample',seq:0,segment:0,latitude:-35,longitude:-61,accuracy:5,recorded_at:new Date().toISOString()};
  await queueMap(scope,'track.samples',{id:track.id,samples:[sample]},{...track,samples:[sample],distance_m:0});
  let added=false;
  await syncMap(scope,async op=>{
    if(!added){added=true;await queueMap(scope,'track.state',{id:track.id,status:'paused'},{...track,status:'paused',samples:[sample]});}
    return {id:track.id,status:'active'};
  });
  expect((await mapRecords(scope))[0]).toMatchObject({status:'paused',pending:true,samples:[sample]});
  expect(await mapOutbox(scope)).toHaveLength(1);
  await syncMap(scope,async()=>({id:'track',status:'paused'}));
  expect(await mapOutbox(scope)).toHaveLength(0);expect((await mapRecords(scope))[0].samples).toEqual([sample]);
});
it('stops replay when identity changes and never restores removed server data from acknowledged local rows',async()=>{
  await queueMap(scope,'track.start',{id:'one'},{id:'one',kind:'track'});
  const execute=vi.fn();await syncMap(scope,execute,()=>false);
  expect(execute).not.toHaveBeenCalled();expect(await mapOutbox(scope)).toHaveLength(1);
  expect(mergeMap([],[{id:'removed',local:false,pending:false}])).toEqual([]);
  expect(mergeMap([{id:'same',version:2}],[{id:'same',pending:true,version:3}])[0].version).toBe(3);
});
it('atomically prevents concurrent open tracks across map scopes on one device',async()=>{
  await queueMap('team:first','track.start',{id:'first',user_id:'first-user'},{id:'first',kind:'track',status:'active',user_id:'first-user'});
  await expect(queueMap('team:second','track.start',{id:'second',user_id:'second-user'},{id:'second',kind:'track',status:'active',user_id:'second-user'}))
    .rejects.toThrow(/medición abierta de otra cuenta/);
  expect(await mapRecords('team:first')).toHaveLength(1);
  expect(await mapRecords('team:second')).toHaveLength(0);
});
it('loads GPS samples only for the selected day while keeping complete backups available',async()=>{
  const point={seq:0,latitude:-35,longitude:-61,segment:0};
  for(const [id,started_at] of [['old','2026-10-10T12:00:00Z'],['today','2026-10-21T12:00:00Z']]){
    await queueMap(scope,'track.samples',{id,samples:[point]},{id,kind:'track',status:'finished',started_at});
  }
  const selected=await mapRecords(scope,{date:'2026-10-21'});
  expect(selected.find(t=>t.id==='old').samples).toEqual([]);
  expect(selected.find(t=>t.id==='today').samples).toHaveLength(1);
  expect((await mapRecords(scope)).find(t=>t.id==='old').samples).toHaveLength(1);
});
it('expires only old acknowledged finished server copies and retains local or pending records',async()=>{
  const now=Date.parse('2026-10-21T12:00:00Z'),ended_at='2026-09-01T12:00:00Z';
  for(const [key,pending,local,status] of [['remote',false,false,'finished'],['pending',true,false,'finished'],['active',false,false,'active'],['local',false,true,'finished']]){
    const db=await openDB('mycampo-d-map-v1',1);
    await db.put('records',{key:`${scope}:${key}`,scope,data:{id:key,kind:'track',status,pending,local,ended_at}});
    await db.put('points',{key:`${scope}:${key}:0`,scope,track_id:key,data:{seq:0}});db.close();
  }
  expect(await pruneSyncedMapHistory(scope,now)).toBe(1);
  const remaining=await mapRecords(scope);expect(remaining.map(r=>r.id).sort()).toEqual(['active','local','pending']);
  expect(remaining.every(r=>r.samples.length===1)).toBe(true);
});
