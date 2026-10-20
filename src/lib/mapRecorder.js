import { queueMap } from './mapStore';
import { acceptPosition } from './mapGeometry';

export function createMapRecorder({scope,context,onChange=()=>{},onError=()=>{},geolocation=globalThis.navigator?.geolocation,write=queueMap}) {
  let track=null,watch=null,generation=0,chain=Promise.resolve(),disposed=false;
  const payload=extra=>({...context,id:track.id,team_id:track.team_id,...extra});
  const emit=()=>{if(!disposed) onChange(track);};
  const stop=()=>{++generation;if(watch!==null){geolocation?.clearWatch(watch);watch=null;}};
  const enqueue=fn=>{const next=chain.then(fn);chain=next.catch(()=>{});return next;};
  const save=async(action,extra,next)=>{await write(scope,action,payload(extra),next);track=next;emit();};
  function listen() {
    if(disposed) return;
    const version=++generation;
    if(!geolocation) {onError('Este dispositivo no dispone de ubicación.');void pause();return;}
    const id=geolocation.watchPosition(position=>{
      if(version!==generation || disposed) return;
      void enqueue(async()=>{
        if(track?.status!=='active') return;
        if(position.timestamp<Date.parse(track.active_since)) {onError('Esperando una posición tomada después de iniciar o continuar el recorrido.');return;}
        const previous=track.samples?.at(-1);
        const accepted=acceptPosition(position,previous,track.segment||0,(previous?.seq??-1)+1);
        if(accepted.error){onError(accepted.error);return;}
        if(!accepted.sample) return;
        const s=accepted.sample;
        await save('track.samples',{samples:[s]}, {...track,samples:[...(track.samples||[]),s],segment:s.segment,distance_m:(track.distance_m||0)+s.distance_m,
          last_latitude:s.latitude,last_longitude:s.longitude,last_accuracy:s.accuracy,last_fix_at:s.recorded_at,received_at:new Date().toISOString()});
        onError('');
      }).catch(error=>{stop();onError(`Se detuvo el GPS: ${error.message}`);});
    },error=>{
      if(version!==generation || disposed) return;
      onError(error.code===1 ? 'Permiso GPS denegado. Habilitá la ubicación en los ajustes del dispositivo para continuar.' : 'Sin señal GPS. Acercate a un lugar abierto; el recorrido se conserva.');
      if(error.code===1) void pause().catch(failure=>onError(failure.message));
    },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    if(version!==generation || disposed) geolocation.clearWatch(id); else watch=id;
  }
  async function start(team,shared=false) {
    if(track && track.status!=='finished') throw new Error('Finalizá el recorrido actual antes de iniciar otro.');
    track={id:crypto.randomUUID(),...context,team_id:team,kind:'track',status:'active',shared,started_at:new Date().toISOString(),active_since:new Date().toISOString(),duration_ms:0,distance_m:0,samples:[],segment:0};
    await enqueue(()=>save('track.start',{started_at:track.started_at,shared},track));
    listen();return track;
  }
  function change(status,at=new Date().toISOString()) {
    stop();
    return enqueue(async()=>{
      if(!track || track.status==='finished' || track.status===status) return;
      const next={...track,status,active_since:status==='active'?at:null,
        ended_at:status==='finished'?at:null,segment:(track.segment||0)+(status==='active'?1:0),
        duration_ms:(track.duration_ms||0)+(track.status==='active'?Math.max(0,Date.parse(at)-Date.parse(track.active_since)):0)};
      await save('track.state',{status,at},next);
      if(status==='active' && !disposed) listen();
    });
  }
  function pause(at){return change('paused',at);}
  return {
    start,pause,finish:()=>change('finished'),
    async resume(saved){
      if(saved){if(track && track.id!==saved.id && track.status!=='finished')throw new Error('Finalizá primero el recorrido actual.');track=saved;}
      if(!track || track.status!=='paused')throw new Error('Seleccioná un recorrido pausado.');
      await change('active');
    },
    async recover(saved){
      track=saved;
      if(track.status==='active') await pause(new Date(Math.max(Date.parse(track.active_since),Date.parse(track.last_fix_at||track.started_at))).toISOString());
      else emit();
    },
    current:()=>track,
    async dispose(){disposed=true;await pause();},
    flush:()=>chain,
  };
}
