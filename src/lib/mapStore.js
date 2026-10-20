import { openDB } from 'idb';
import { accessSignature, saveLocally, protectStorage } from './offlineStore';

let connection;
const database=()=>connection ||= openDB('mycampo-d-map-v1',1,{upgrade(db){
  db.createObjectStore('records',{keyPath:'key'});
  db.createObjectStore('points',{keyPath:'key'});
  db.createObjectStore('outbox',{keyPath:'operation_id'}).createIndex('order','order');
}});
export const mapScope=(user,org,access)=>org ? `team:${user}:${org}:${accessSignature(access)}` : 'local';
const changed=()=>{ if(typeof window!=='undefined') window.dispatchEvent(new Event('mycampo-d:map-change')); };
export async function mapRecords(scope) {
  const db=await database();
  const points=(await db.getAll('points')).filter(r=>r.scope===scope);
  return (await db.getAll('records')).filter(r=>r.scope===scope).map(r=>r.data.kind==='track' ? {...r.data,samples:points.filter(p=>p.track_id===r.data.id).map(p=>p.data).sort((a,b)=>a.seq-b.seq)}:r.data);
}
export async function mapOutbox(scope) {
  return (await (await database()).getAll('outbox')).filter(r=>r.scope===scope).sort((a,b)=>a.order-b.order);
}
export async function pendingMapScopes(user) {
  const ops=await (await database()).getAll('outbox');
  return [...new Set(ops.filter(op=>op.scope.startsWith(`team:${user}:`)).map(op=>op.scope))];
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
          if(row?.data.lastOperation===operation.operation_id) await tx.objectStore('records').put({...row,data:{...row.data,...server,pending:false,local:false}});
          await tx.done;
          processed=true;
        } catch(error) {blocked.add(operation.payload.id);errors.push(error.message);}
      }
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
