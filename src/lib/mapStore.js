import { openLocalDb,scopeRange,matchingRows } from './indexedDb';
import { argentinaDate } from './mapGeometry';
import { accessSignature, saveLocally, protectStorage } from './offlineStore';

const database=()=>openLocalDb('mycampo-d-map-v1',1,db=>{
  db.createObjectStore('records',{keyPath:'key'});
  db.createObjectStore('points',{keyPath:'key'});
  db.createObjectStore('outbox',{keyPath:'operation_id'}).createIndex('order','order');
});
export const mapScope=(user,org,access)=>org ? `team:${user}:${org}:${accessSignature(access)}` : 'local';
const changed=()=>{ if(typeof window!=='undefined') window.dispatchEvent(new Event('mycampo-d:map-change')); };
export async function mapRecords(scope,{date}={}) {
  const db=await database();
  const records=await db.getAll('records',scopeRange(scope)),result=[];
  for(const row of records){
    const record=row.data;
    if(record.kind!=='track'){result.push(record);continue;}
    const needed=!date||record.status!=='finished'||argentinaDate(record.started_at)===date;
    const points=needed?await db.getAll('points',scopeRange(`${scope}:${record.id}`)):[];
    result.push({...record,samples:points.map(point=>point.data).sort((a,b)=>a.seq-b.seq)});
  }
  return result;
}
export async function mapOutbox(scope) {
  return (await matchingRows(await database(),'outbox',r=>r.scope===scope)).sort((a,b)=>a.order-b.order);
}
export async function pendingMapScopes(user) {
  const scopes=new Set(),db=await database();
  for(let cursor=await db.transaction('outbox').store.openCursor();cursor;cursor=await cursor.continue())if(cursor.value.scope.startsWith(`team:${user}:`))scopes.add(cursor.value.scope);
  return [...scopes];
}
export async function queueMap(scope,action,payload,record,photo=null) {
  const db=await database();
  const operation_id=crypto.randomUUID();
  const operation={scope,operation_id,action,payload,photo};
  const write=async()=>{
    const tx=db.transaction(['records','outbox','points'],'readwrite');
    if(action==='track.start'){
      const open=(await tx.objectStore('records').getAll()).find(row=>row.data.kind==='track'&&row.data.status!=='finished');
      if(open){
        await tx.done;
        throw new Error(open.data.user_id!==payload.user_id
          ?'Hay una medición abierta de otra cuenta en este dispositivo. Iniciá sesión con esa cuenta para recuperarla antes de comenzar otra.'
          :'Ya hay un recorrido abierto o interrumpido en este dispositivo. Reanudalo o finalizalo antes de iniciar otro.');
      }
    }
    const last=await tx.objectStore('outbox').index('order').openCursor(null,'prev');
    const order=Math.max(Date.now(),(last?.value.order||0)+1);
    if(scope!=='local') await tx.objectStore('outbox').put({...operation,order});
    if(action==='track.samples') for(const sample of payload.samples) await tx.objectStore('points').put({key:`${scope}:${record.id}:${sample.seq}`,scope,track_id:record.id,data:sample});
    const {samples,...data}=record;
    await tx.objectStore('records').put({key:`${scope}:${record.id}`,scope,data:{...data,local:true,pending:scope!=='local',lastOperation:operation_id}});
    await tx.done;
  };
  await saveLocally(write); void protectStorage(); changed(); return operation;
}
const locks=new Map();
export async function pruneSyncedMapHistory(scope,now=Date.now()) {
  if(scope==='local')return 0;
  const db=await database(),tx=db.transaction(['records','points','outbox'],'readwrite');
  const pending=new Set();
  for(let cursor=await tx.objectStore('outbox').openCursor();cursor;cursor=await cursor.continue())if(cursor.value.scope===scope)pending.add(cursor.value.payload.id);
  let removed=0;
  for(let cursor=await tx.objectStore('records').openCursor(scopeRange(scope));cursor;cursor=await cursor.continue()){
    const row=cursor.value,record=row.data;
    if(record.kind!=='track'||record.status!=='finished'||record.local!==false||record.pending!==false||pending.has(record.id)||
      !Number.isFinite(Date.parse(record.ended_at))||Date.parse(record.ended_at)>=now-30*86400000)continue;
    await tx.objectStore('points').delete(scopeRange(`${scope}:${record.id}`));
    await cursor.delete();removed++;
  }
  await tx.done;return removed;
}
export async function mapStorageStatus(user) {
  const db=await database();let pending=0,samples=0;
  const allowed=scope=>!user||(user==='local'?scope==='local':scope.startsWith(`team:${user}:`));
  for(let cursor=await db.transaction('outbox').store.openCursor();cursor;cursor=await cursor.continue())if(allowed(cursor.value.scope))pending++;
  for(let cursor=await db.transaction('points').store.openKeyCursor();cursor;cursor=await cursor.continue()){
    const key=String(cursor.key);if(!user||(user==='local'?key.startsWith('local:'):key.startsWith(`team:${user}:`)))samples++;
  }
  return {pending,samples};
}
export function syncMap(scope,execute,isCurrent=()=>true) {
  if(scope==='local') return Promise.resolve();
  if(locks.has(scope)) return locks.get(scope);
  const run=async()=>{
    const work=async()=>{
      const db=await database(); const blocked=new Set(); const errors=[]; let processed=false;
      for(const operation of await mapOutbox(scope)) {
        if(!isCurrent()) break;
        if(blocked.has(operation.payload.id)) continue;
        try {
          const server=await execute(operation);
          if(!isCurrent()) break;
          const tx=db.transaction(['records','outbox'],'readwrite');
          await tx.objectStore('outbox').delete(operation.operation_id);
          const key=`${scope}:${operation.payload.id}`;
          const row=await tx.objectStore('records').get(key);
          // A newer local edit must survive acknowledgement of an earlier operation.
          if(row?.data.lastOperation===operation.operation_id){
            const data={...row.data,...server,pending:false,local:false};
            if(operation.photo&&server?.photo_path)delete data.photoBlob;
            await tx.objectStore('records').put({...row,data});
          }
          await tx.done;
          processed=true;
        } catch(error) {blocked.add(operation.payload.id);errors.push(error.message);}
      }
      // Only acknowledged, finished remote copies expire. Never remove local
      // work, active recordings, tombstones or anything still in the outbox.
      if(isCurrent())await pruneSyncedMapHistory(scope).catch(()=>{});
      if(processed) changed(); if(errors.length) throw new Error([...new Set(errors)].join(' '));
    };
    if(globalThis.navigator?.locks?.request) await navigator.locks.request(`map-sync:${scope}`,work); else await work();
  };
  const promise=run().finally(()=>locks.delete(scope)); locks.set(scope,promise); return promise;
}
export function mergeMap(remote,local) {
  const records=new Map(remote.map(r=>[r.id,r]));
  for(const row of local) if(row.kind==='track'||row.pending||row.local) records.set(row.id,row);
  return [...records.values()].filter(r=>!r.deleted_at);
}
