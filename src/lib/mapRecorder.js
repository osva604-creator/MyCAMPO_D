import { queueMap } from './mapStore';
import { acceptPosition } from './mapGeometry';
import { isNative,startBackgroundLocation,stopBackgroundLocation } from './nativeLocation';

export function createMapRecorder({scope,context,onChange=()=>{},onError=()=>{},geolocation=globalThis.navigator?.geolocation,
  write=queueMap,native=isNative(),startNative=startBackgroundLocation,stopNative=stopBackgroundLocation}) {
  let track=null,watch=null,nativeStopper=null,generation=0,chain=Promise.resolve(),disposed=false,lastFixSyncAt=0;
  const payload=extra=>({...context,id:track.id,team_id:track.team_id,...extra});
  const emit=()=>{if(!disposed)onChange(track);};
  const enqueue=fn=>{const next=chain.then(fn);chain=next.catch(()=>{});return next;};
  const save=async(action,extra,next)=>{await write(scope,action,payload(extra),next);track=next;emit();};
  async function stop() {
    ++generation;
    if(watch!==null){geolocation?.clearWatch(watch);watch=null;}
    if(nativeStopper){const release=nativeStopper;nativeStopper=null;await release();}
  }
  function reportGpsError(message) {
    onError(message);
    if(/permiso|autoriz|ubicación en segundo plano se detuvo/i.test(message)&&track?.status==='active')
      void pause(new Date().toISOString(),message).catch(failure=>onError(failure.message));
  }
  function ingest(position,version) {
    if(version!==generation||disposed)return;
    void enqueue(async()=>{
      if(track?.status!=='active')return;
      if(position.timestamp<Date.parse(track.active_since)){onError('Esperando una posición tomada después de iniciar o continuar el recorrido.');return;}
      const previous=track.samples?.at(-1);
      const accepted=acceptPosition(position,previous,track.segment||0,(previous?.seq??-1)+1);
      if(accepted.error){onError(accepted.error);return;}
      const instant=accepted.sample?.recorded_at||accepted.fix?.recorded_at;
      const fix=accepted.sample||accepted.fix;
      if(!fix)return;
      const received_at=new Date().toISOString();
      if(accepted.sample){
        const sample=accepted.sample;
        await save('track.samples',{samples:[sample]},{
          ...track,samples:[...(track.samples||[]),sample],segment:sample.segment,distance_m:(track.distance_m||0)+sample.distance_m,
          last_latitude:sample.latitude,last_longitude:sample.longitude,last_accuracy:sample.accuracy,last_fix_at:instant,
          last_movement_at:instant,received_at,
        });
      }else{
        track={...track,last_latitude:fix.latitude,last_longitude:fix.longitude,last_accuracy:fix.accuracy,last_fix_at:instant,received_at};
        emit();
        const time=Date.parse(instant);
        if(time-lastFixSyncAt>=30000){
          lastFixSyncAt=time;
          const next={...track};
          await save('track.fix',{last_latitude:fix.latitude,last_longitude:fix.longitude,last_accuracy:fix.accuracy,last_fix_at:instant},next);
        }
      }
      onError('');
    }).catch(error=>{void stop().catch(failure=>onError(failure.message));reportGpsError(`Se detuvo el GPS: ${error.message}`);});
  }
  function listen() {
    if(disposed||track?.status!=='active')return;
    const version=++generation;
    if(native){
      void Promise.resolve(startNative({
        onFix:fix=>ingest({coords:{latitude:fix.lat,longitude:fix.lng,accuracy:fix.accuracy},timestamp:Date.parse(fix.timestamp)},version),
        onError:reportGpsError,
      })).then(release=>{
        if(version!==generation||disposed)void (typeof release==='function'?release():stopNative());
        else nativeStopper=typeof release==='function'?release:stopNative;
      }).catch(error=>{reportGpsError(error.message);void pause(new Date().toISOString(),error.message).catch(failure=>onError(failure.message));});
      return;
    }
    if(!geolocation){reportGpsError('Este dispositivo no dispone de ubicación.');void pause(new Date().toISOString(),'Ubicación no disponible.');return;}
    const id=geolocation.watchPosition(position=>ingest(position,version),error=>{
      if(version!==generation||disposed)return;
      reportGpsError(error.code===1
        ?'Permiso GPS denegado. Habilitá la ubicación en los ajustes del dispositivo para continuar.'
        :'Sin señal GPS. El recorrido se conserva y continuará cuando el dispositivo reciba una posición válida.');
    },{enableHighAccuracy:true,maximumAge:0,timeout:20000});
    if(version!==generation||disposed)geolocation.clearWatch(id);else watch=id;
  }
  async function start(team,{measurementType='perimeter',width=null}={}) {
    if(track&&track.status!=='finished')throw new Error('Finalizá o recuperá el recorrido actual antes de iniciar otro.');
    if(!['perimeter','labor'].includes(measurementType)||measurementType==='labor'&&(!Number.isFinite(Number(width))||Number(width)<=0))
      throw new Error('Elegí un tipo de medición válido e indicá el ancho de labor cuando corresponda.');
    const at=new Date().toISOString();
    lastFixSyncAt=0;
    track={id:crypto.randomUUID(),...context,team_id:team,kind:'track',status:'active',shared:false,measurement_type:measurementType,
      implement_width_m:measurementType==='labor'?Number(width):null,measurement_configured:false,started_at:at,active_since:at,duration_ms:0,distance_m:0,samples:[],segment:0};
    try{await enqueue(()=>save('track.start',{started_at:at,shared:false},track));}
    catch(error){track=null;emit();throw error;}
    await configure();
    listen();return track;
  }
  async function configure() {
    if(!track?.measurement_type||track.measurement_configured)return;
    const next={...track,measurement_configured:true};
    await enqueue(()=>save('track.configure',{measurement_type:track.measurement_type,implement_width_m:track.implement_width_m},next));
  }
  function change(status,at=new Date().toISOString(),reason='') {
    return enqueue(async()=>{
      if(!track||track.status==='finished'||track.status===status)return;
      await stop();
      const next={...track,status,active_since:status==='active'?at:null,
        ended_at:status==='finished'?at:null,segment:(track.segment||0)+(status==='active'?1:0),
        duration_ms:(track.duration_ms||0)+(track.status==='active'?Math.max(0,Date.parse(at)-Date.parse(track.active_since)):0),
        ...(reason?{interruption_reason:reason,interrupted_at:new Date().toISOString()}:{})};
      await save('track.state',{status,at},next);
      if(status==='active'&&!disposed)listen();
    });
  }
  function pause(at,reason){return change('paused',at,reason);}
  async function saveResult(result) {
    if(!track||track.status!=='finished')throw new Error('Detené la medición antes de guardar el resultado.');
    const next={...track,...result,result_area_ha:result.area_ha??null,result_geometry:result.geometry??null,
      closure_distance_m:result.closure_distance_m??null,gps_quality:result.gps_quality};
    const {geometry,area_ha,...fields}=result;
    await enqueue(()=>save('track.result',{...fields,result_area_ha:area_ha??null,result_geometry:geometry??null},next));
  }
  return {
    start,pause:(at,reason)=>change('paused',at,reason),
    async finish(){await configure();return change('finished');},
    async resume(saved){
      if(saved){if(track&&track.id!==saved.id&&track.status!=='finished')throw new Error('Finalizá primero el recorrido actual.');track=saved;}
      if(!track||track.status!=='paused')throw new Error('Seleccioná un recorrido pausado.');
      await change('active');
    },
    async recover(saved){
      track=saved;
      if(track.status==='active'){
        await configure();
        if(native)await stopNative({notify:false});
        const at=new Date(Math.max(Date.parse(track.active_since||track.started_at),Date.parse(track.last_fix_at||track.started_at))).toISOString();
        await change('paused',at,'La app se cerró o perdió el proceso. No se puede confirmar si hubo ubicación durante la interrupción.');
      }else emit();
    },
    saveResult,current:()=>track,
    async dispose(){await stop();},
    flush:()=>chain,
  };
}
