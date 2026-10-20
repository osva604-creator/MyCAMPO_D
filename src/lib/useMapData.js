import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { mapRecords,mapOutbox,mergeMap,syncMap } from './mapStore';
import { executeMap,loadMap,watchMap } from './mapApi';
import { offlineResource } from './offlineStore';
import { useResource } from './useResource';
import { useSyncLifecycle } from './useSyncLifecycle';

export function useMapData({scope,user,org,date,online}) {
  const live=useRef(true), snapshotReload=useRef(()=>{});
  const [error,setError]=useState(''),[syncing,setSyncing]=useState(false),[realtime,setRealtime]=useState('');
  const local=useResource(useCallback(async()=>({records:await mapRecords(scope),outbox:await mapOutbox(scope)}),[scope]));
  const snapshot=useResource(useCallback(()=>org ? offlineResource(user,`feed:map:${scope}:${date}`,()=>loadMap(org,date),{offline:!online}) : Promise.resolve({features:[],tracks:[],samples:[],publications:[]}),[scope,user,org,date,online]),{poll:org?30000:0});
  snapshotReload.current=snapshot.reload;
  const sync=useCallback(async()=>{
    if(!org || !online || !navigator.onLine || !live.current) return;
    setSyncing(true);setError('');
    try {await syncMap(scope,executeMap,()=>live.current);await snapshotReload.current();}
    catch(failure){if(live.current)setError(failure.message);}
    finally {if(live.current)setSyncing(false);}
  },[scope,org,online]);
  useSyncLifecycle(sync,Boolean(org));
  useEffect(()=>{
    live.current=true;
    let timer,remoteTimer;
    const changed=()=>{void local.reload();clearTimeout(timer);if(online)timer=setTimeout(sync,1000);};
    window.addEventListener('mycampo-d:map-change',changed);
    const stop=watchMap(org,()=>{clearTimeout(remoteTimer);remoteTimer=setTimeout(()=>snapshotReload.current(),600);},setRealtime);
    return()=>{live.current=false;clearTimeout(timer);clearTimeout(remoteTimer);stop();window.removeEventListener('mycampo-d:map-change',changed);};
  },[scope,org,online,sync,local.reload]);
  const merged=useMemo(()=>{
    const records=local.data?.records||[],remote=snapshot.data||{};
    return {records,publications:remote.publications||[],features:mergeMap(remote.features||[],records.filter(r=>r.kind!=='track')),
      tracks:mergeMap((remote.tracks||[]).map(t=>({...t,kind:'track',samples:(remote.samples||[]).filter(s=>s.track_id===t.id).sort((a,b)=>a.seq-b.seq)})),records.filter(r=>r.kind==='track'))};
  },[local.data,snapshot.data]);
  return {...merged,localReady:Boolean(local.data),
    pending:local.data?.outbox.length||0,error:error||snapshot.error||local.error,loading:local.busy||snapshot.busy,sync,syncing,realtime,offline:snapshot.data?.offline};
}
