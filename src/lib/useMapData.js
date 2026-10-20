import { useCallback,useEffect,useMemo,useRef,useState } from 'react';
import { mapRecords,mapOutbox,mergeMap,syncMap } from './mapStore';
import { executeMap,loadMap,loadMapItem,loadMapTrackIncrement,watchMap } from './mapApi';
import { filterMapTracks } from './mapGeometry';
import { offlineResource } from './offlineStore';
import { useResource } from './useResource';
import { useSyncLifecycle } from './useSyncLifecycle';

export function useMapData({scope,user,userId=user,org,date,historyUser='',isAdmin=false,online}) {
  const live=useRef(true),snapshotData=useRef(null),trackPatchRef=useRef({}),itemPatchRef=useRef({});
  const trackLocks=useRef(new Map());
  const [error,setError]=useState(''),[syncing,setSyncing]=useState(false),[realtime,setRealtime]=useState('');
  const [trackPatches,setTrackPatches]=useState({}),[itemPatches,setItemPatches]=useState({features:{},publications:{}});
  const local=useResource(useCallback(async()=>({records:await mapRecords(scope),outbox:await mapOutbox(scope)}),[scope]));
  const snapshot=useResource(useCallback(()=>org ? offlineResource(user,`feed:map:v2:${scope}:${date}:${isAdmin?'admin':userId}:${historyUser}`,()=>loadMap(org,date,userId,isAdmin,historyUser),{offline:!online}) : Promise.resolve({features:[],tracks:[],samples:[],publications:[]}),[scope,user,org,date,userId,isAdmin,historyUser,online]));
  snapshotData.current=snapshot.data;trackPatchRef.current=trackPatches;itemPatchRef.current=itemPatches;
  const refreshTrack=useCallback(id=>{
    if(!id||!org)return Promise.resolve();
    const existing=trackLocks.current.get(id);
    const work=(existing||Promise.resolve()).catch(()=>{}).then(async()=>{
      const base=snapshotData.current?.tracks?.find(track=>track.id===id);
      const patch=trackPatchRef.current[id];
      const lastSeq=Math.max(base?.samples?.at(-1)?.seq??-1,patch?.samples?.at(-1)?.seq??-1);
      const track=await loadMapTrackIncrement(org,id,lastSeq,userId,isAdmin);
      setTrackPatches(previous=>{
        if(!track)return {...previous,[id]:{removed:true}};
        const current=previous[id];
        const samples=new Map([...(current?.samples||[]),...(track.samples||[])].map(sample=>[sample.seq,sample]));
        return {...previous,[id]:{track,samples:[...samples.values()].sort((a,b)=>a.seq-b.seq)}};
      });
    });
    trackLocks.current.set(id,work);
    return work.finally(()=>{if(trackLocks.current.get(id)===work)trackLocks.current.delete(id);});
  },[org,userId,isAdmin]);
  const refreshItem=useCallback(async(change)=>{
    const table=change?.table,id=(change?.new?.id||change?.old?.id);
    if(!id||!['map_features','posts'].includes(table))return;
    const value=await loadMapItem(table,id,org);
    const key=table==='map_features'?'features':'publications';
    setItemPatches(previous=>({...previous,[key]:{...previous[key],[id]:value}}));
  },[org]);
  const sync=useCallback(async()=>{
    if(!org||!online||!navigator.onLine||!live.current)return;
    setSyncing(true);setError('');
    try{await syncMap(scope,executeMap,()=>live.current);}
    catch(failure){if(live.current)setError(failure.message);}
    finally{if(live.current)setSyncing(false);}
  },[scope,org,online]);
  useSyncLifecycle(sync,Boolean(org));
  useEffect(()=>{
    live.current=true;
    let timer;
    const changed=()=>{void local.reload();clearTimeout(timer);if(online)timer=setTimeout(sync,1000);};
    const remoteChange=change=>{
      if(change.table==='map_tracks')void refreshTrack(change.new?.id||change.old?.id).catch(failure=>{if(live.current)setError(failure.message);});
      else void refreshItem(change).catch(failure=>{if(live.current)setError(failure.message);});
    };
    window.addEventListener('mycampo-d:map-change',changed);
    const stop=watchMap(org,remoteChange,setRealtime);
    return()=>{live.current=false;clearTimeout(timer);stop();window.removeEventListener('mycampo-d:map-change',changed);};
  },[scope,org,online,sync,local.reload,refreshTrack,refreshItem]);
  useEffect(()=>{
    setTrackPatches({});trackPatchRef.current={};
    setItemPatches({features:{},publications:{}});itemPatchRef.current={};
  },[scope,date,userId,historyUser]);
  const merged=useMemo(()=>{
    const records=local.data?.records||[],remote=snapshot.data||{};
    const update=(rows,patches)=>[...rows.filter(row=>!Object.hasOwn(patches,row.id)||patches[row.id]!==null)
      .map(row=>Object.hasOwn(patches,row.id)?patches[row.id]:row),...Object.entries(patches).filter(([id,value])=>value&&!rows.some(row=>row.id===id)).map(([,value])=>value)];
    const samplesByTrack=new Map();
    for(const sample of remote.samples||[]){
      if(!samplesByTrack.has(sample.track_id))samplesByTrack.set(sample.track_id,[]);
      samplesByTrack.get(sample.track_id).push(sample);
    }
    const tracks=(remote.tracks||[]).flatMap(track=>{
      const patch=trackPatches[track.id];
      if(patch?.removed)return [];
      const samples=new Map([...(samplesByTrack.get(track.id)||[]),...(patch?.samples||[])]
        .map(sample=>[sample.seq,sample]));
      return [{...track,...(patch?.track||{}),samples:[...samples.values()].sort((a,b)=>a.seq-b.seq)}];
    });
    const tracksWithNew=(remote.tracks||[]).map(track=>track.id);
    for(const [id,patch]of Object.entries(trackPatches))if(patch.track&&!patch.removed&&!tracksWithNew.includes(id))tracks.push({...patch.track,samples:patch.samples||[]});
    const visible=filterMapTracks(mergeMap(tracks,records.filter(record=>record.kind==='track')),
      {date,userId,isAdmin,historyUser});
    return {records,publications:update(remote.publications||[],itemPatches.publications||{}),
      features:mergeMap(update(remote.features||[],itemPatches.features||{}),records.filter(record=>record.kind!=='track')),tracks:visible};
  },[local.data,snapshot.data,trackPatches,itemPatches,date,userId,isAdmin,historyUser]);
  return {...merged,localReady:Boolean(local.data),pending:local.data?.outbox.length||0,
    error:error||snapshot.error||local.error,loading:local.busy||snapshot.busy,sync,syncing,realtime,offline:snapshot.data?.offline};
}
