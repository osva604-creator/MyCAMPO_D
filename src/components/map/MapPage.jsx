import { useCallback,useEffect,useRef,useState } from 'react';
import { Link } from 'react-router-dom';
import { LocateFixed,MapPinned,Plus,Upload,RefreshCw } from 'lucide-react';
import { useTeam,canManage } from '../../context/TeamContext';
import { useMapData } from '../../lib/useMapData';
import { mapScope,queueMap,mapRecords } from '../../lib/mapStore';
import { connectMapTracking,restoreMapTracking } from '../../lib/mapTracking';
import { validateGeometry,publicationPoint,durationMs,positionIsStale,measurementResult,trackGpsQuality,argentinaDate } from '../../lib/mapGeometry';
import { isNative } from '../../lib/nativeLocation';
import { locate,preparePhoto } from '../../lib/media';
import { mediaBlob } from '../../lib/teamApi';
import { downloadJson } from '../../lib/teamDrafts';
import { readForm,saveForm,removeForm,offlineResource } from '../../lib/offlineStore';
import { mapPhoto } from '../../lib/mapApi';
import { useResource } from '../../lib/useResource';
import MapCanvas from './MapCanvas';
import MapFeaturePopup from './MapFeaturePopup';
import { importGisFile,sharePolygon } from '../../lib/mapGis';

const today=()=>argentinaDate(new Date());
const categories=['incidencia','tranquera','pozo','maquinaria','otro'];
const colors=['#15803d','#2563eb','#b45309','#7c3aed','#be123c','#0891b2'];
const fmt=timestamp=>timestamp?new Date(timestamp).toLocaleString('es-AR'):'Sin posición';
function useClock(){const [now,setNow]=useState(Date.now());useEffect(()=>{const id=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(id);},[]);return now;}
function TrackStats({track}) {
  const now=useClock(),seconds=Math.floor(durationMs(track,now)/1000);
  return <div className="mt-2 text-sm"><p>{(track.distance_m||0).toFixed(1)} m · {Math.floor(seconds/3600)} h {Math.floor(seconds/60)%60} min {seconds%60} s · {track.last_accuracy!=null?`±${Math.round(track.last_accuracy)} m`:'Esperando GPS'}</p>
    <p className={positionIsStale(track,now)?'mt-1 text-amber-800':'mt-1 text-green-800'}>{positionIsStale(track,now)?'Última señal GPS desactualizada':'GPS actualizado'} · Última posición: {fmt(track.last_fix_at)} · Último movimiento: {fmt(track.last_movement_at||track.samples?.at(-1)?.recorded_at)}</p></div>;
}
function Photo({feature,scope,user,online}) {
  const resource=useResource(useCallback(async()=>{
    if(!feature.photoBlob && !feature.photo_path)return {};
    const load=async()=>{const blob=feature.photoBlob||await mapPhoto(feature.photo_path),url=URL.createObjectURL(blob);return {photo:url,dispose:()=>URL.revokeObjectURL(url)};};
    return scope==='local'||feature.photoBlob ? load() : offlineResource(user,`feed:map-photo:${scope}:${feature.photo_path}`,load,{offline:!online});
  },[feature.id,feature.photo_path,feature.photoBlob,scope,user,online]));
  return <>{resource.data?.photo&&<img src={resource.data.photo} alt={feature.name} className="mt-3 max-h-72 w-full rounded-xl object-contain"/>}{resource.busy&&<p role="status">Cargando foto…</p>}{resource.error&&<p className="mt-2 text-sm text-amber-800">{resource.error}</p>}</>;
}
export function TeamMap() {
  const team=useTeam();
  if(!team?.orgId)return <section className="panel"><h1 className="text-2xl font-bold">Mapa</h1><p className="mt-3">Seleccioná una organización para abrir su mapa.</p></section>;
  return <MapPage key={mapScope(team.user.id,team.orgId,team.access)} team={team}/>;
}
export default function MapPage({team=null,posts=[],actor={id:'local',name:'Cuenta local'},onOpenPost}) {
  const local=!team, user=team?.user.id||'local',org=team?.orgId||null;
  const scope=mapScope(user,org,team?.access),formKey=`map-editor:${scope}`,trackingNoticeKey=`map-track-notice:${scope}`;
  const [network,setNetwork]=useState(navigator.onLine),[date,setDate]=useState(today),[historyUser,setHistoryUser]=useState('');
  const online=network&&(team?.online??true);
  const isAdmin=team?.access.role==='SUPER_ADMIN',historyFilter=isAdmin?historyUser:'';
  const data=useMapData({scope,user,userId:user,org,date,historyUser:historyFilter,isAdmin,online});
  const [baseLayer,setBaseLayer]=useState('satellite');
  const [layers,setLayers]=useState({parcels:true,points:true,tracks:true});
  const [editor,setEditor]=useState(null),[vertices,setVertices]=useState([]),[drawing,setDrawing]=useState(false),[placing,setPlacing]=useState(false);
  const [preview,setPreview]=useState([]),[selected,setSelected]=useState(null),[center,setCenter]=useState(null),[confirm,setConfirm]=useState(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[gpsError,setGpsError]=useState('');
  const [current,setCurrent]=useState(null),[formReady,setFormReady]=useState(false),[measurementType,setMeasurementType]=useState('perimeter');
  const [implementWidth,setImplementWidth]=useState(''),[noticeAccepted,setNoticeAccepted]=useState(false),[noticeReady,setNoticeReady]=useState(false);
  const [closurePreview,setClosurePreview]=useState(null),[resultTrack,setResultTrack]=useState(null);
  const recorder=useRef(null),recovered=useRef(false),saved=useRef(Promise.resolve()),mounted=useRef(true);
  const teams=local?[{id:'local',name:'Dispositivo local'}]:(team.info.teams||[]).filter(t=>t.organization_id===org&&t.active&&(team.access.role==='SUPER_ADMIN'||team.access.teams.some(a=>a.id===t.id)));
  const [teamId,setTeamId]=useState(teams[0]?.id||'');
  const permitted=local||Boolean(teams.find(t=>t.id===teamId));
  const manages=t=>local||canManage(team.access,org,t);
  const people=local?[{user_id:'local',name:actor.name}]:team.info.members.filter(m=>m.organization_id===org);
  const name=id=>people.find(p=>p.user_id===id)?.name||(id===user?(team?.access.name||actor.name):'Integrante autorizado');
  const context={user_id:user,organization_id:org};
  const payload=(record,extra={})=>({...context,team_id:record.team_id,id:record.id,...extra});
  const publications=local?posts.filter(publicationPoint):data.publications;
  useEffect(()=>{
    mounted.current=true;
    const changed=()=>setNetwork(navigator.onLine);
    window.addEventListener('online',changed);window.addEventListener('offline',changed);
    let connection;
    try{
      connection=connectMapTracking({scope,context},({track,error:message})=>{
        if(mounted.current){setCurrent(track?{...track}:null);setGpsError(message||'');}
      });
      recorder.current=connection.recorder;
    }catch(failure){setError(failure.message);}
    return()=>{mounted.current=false;window.removeEventListener('online',changed);window.removeEventListener('offline',changed);connection?.disconnect();};
  },[scope]);
  useEffect(()=>{
    if(recovered.current||!data.localReady)return;
    recovered.current=true;
    if(recorder.current)void restoreMapTracking({scope,context},data.records).catch(failure=>setError(failure.message));
  },[data.localReady,data.records,user]);
  useEffect(()=>{
    let active=true;
    readForm(trackingNoticeKey).then(row=>{if(active)setNoticeAccepted(Boolean(row?.data?.accepted));})
      .catch(failure=>{if(active)setError(failure.message);})
      .finally(()=>{if(active)setNoticeReady(true);});
    return()=>{active=false;};
  },[trackingNoticeKey]);
  useEffect(()=>{
    let active=true;
    readForm(formKey).then(row=>{
      if(active&&row?.data){const value=row.data;setEditor(value.editor?{...value.editor,photo:value.photo||null}:null);setVertices(value.vertices||[]);setDrawing(Boolean(value.drawing));setPreview(value.preview||[]);setNotice('Borrador del mapa recuperado en este dispositivo.');}
    }).catch(failure=>{if(active)setError(failure.message);}).finally(()=>{if(active)setFormReady(true);});
    return()=>{active=false;};
  },[formKey]);
  useEffect(()=>{
    if(!formReady||(!editor&&!preview.length))return;
    const {photo,...fields}=editor||{};
    saved.current=saved.current.catch(()=>{}).then(()=>saveForm(formKey,{editor:editor?fields:null,photo:photo||null,vertices,drawing,preview}));
    saved.current.catch(failure=>{if(mounted.current)setError(failure.message);});
  },[editor,vertices,drawing,preview,formReady,formKey]);
  async function act(work){setBusy(true);setError('');setNotice('');try{await work();}catch(failure){if(mounted.current)setError(failure.message||'No se pudo completar la acción.');}finally{if(mounted.current)setBusy(false);}}
  const fresh=(kind,geometry=null)=>({id:crypto.randomUUID(),kind,team_id:teamId,geometry,name:'',description:'',category:'otro',crop:'',season:'',responsible_id:null,color:colors[data.features.length%colors.length],version:null});
  async function startOrStopMeasurement(){
    if(current?.status==='active'){
      await finishMeasurement(false);
      return;
    }
    if(current?.status==='paused'){
      await recorder.current.resume();
      setGpsError('Esperando una posición GPS reciente para reanudar el recorrido.');
      return;
    }
    if(!noticeAccepted)throw new Error('Leé y confirmá el aviso de privacidad y ubicación antes de iniciar.');
    if(!permitted||!teamId)throw new Error('Elegí un equipo activo autorizado para registrar la medición.');
    setResultTrack(null);setClosurePreview(null);
    await recorder.current.start(teamId,{measurementType, width:implementWidth?Number(implementWidth):null});
    setGpsError('Esperando una posición GPS reciente.');
  }
  async function finishMeasurement(closePerimeter,skipClosure=false){
    const recording=recorder.current?.current();
    if(!recording||recording.status!=='active')throw new Error('No hay una medición activa para detener.');
    if(!recording.measurement_type){
      await recorder.current.finish();
      const finished=recorder.current.current();
      const result={...finished,measurement_type:'legacy',gps_quality:trackGpsQuality(finished)};
      setCurrent({...finished});setResultTrack(result);setNotice('Recorrido anterior finalizado. No se calculó una superficie porque no se habían guardado parámetros de medición.');
      return;
    }
    let calculated=null,issue='';
    try{
      calculated=measurementResult({...recording,duration_ms:durationMs(recording)}, {closePerimeter});
      if(calculated.closure_required&&!skipClosure){
        setClosurePreview(measurementResult({...recording,duration_ms:durationMs(recording)},{closePerimeter:true}));
        return;
      }
    }catch(failure){issue=failure.message;}
    await recorder.current.finish();
    const finished=recorder.current.current();
    if(!issue){
      try{calculated=measurementResult(finished,{closePerimeter});}
      catch(failure){issue=failure.message;}
    }
    const result=calculated&&!calculated.closure_required?calculated:{
      measurement_type:finished.measurement_type,distance_m:finished.distance_m||0,duration_ms:finished.duration_ms||0,
      gps_quality:trackGpsQuality(finished),closure_distance_m:calculated?.closure_distance_m??null,
      interruption_reason:issue||finished.interruption_reason||'No hay geometría suficiente para calcular una superficie confiable.',
    };
    await recorder.current.saveResult(result);
    setCurrent({...recorder.current.current()});setResultTrack({...recorder.current.current()});setClosurePreview(null);
    setNotice('Medición detenida y resultado guardado. Las superficies son estimadas y no sustituyen una mensura.');
  }
  async function acceptTrackingNotice(accepted){
    setNoticeAccepted(accepted);
    await saveForm(trackingNoticeKey,{accepted});
  }
  async function clearEditor(){await saved.current;await removeForm(formKey);setEditor(null);setVertices([]);setDrawing(false);setPlacing(false);setPreview([]);}
  async function myLocation(point=false){await act(async()=>{const fix=await locate({timeout:30000});if(!mounted.current)return;const geometry={type:'Point',coordinates:[fix.lng,fix.lat]};setCenter({...geometry,nonce:Date.now()});if(point){setEditor(fresh('point',geometry));setPlacing(false);}});}
  function mapClick(coordinates){if(drawing)setVertices(v=>v.length<500?[...v,coordinates]:v);else if(placing){setEditor(fresh('point',{type:'Point',coordinates}));setPlacing(false);}}
  function updateVertex(index,coordinates){setVertices(previous=>{const next=previous.map((p,i)=>i===index?coordinates:p);if(!drawing)setEditor(e=>({...e,geometry:{type:'Polygon',coordinates:[[...next,next[0]]]}}));return next;});}
  function finishDrawing(){void act(async()=>{const geometry={type:'Polygon',coordinates:[[...vertices,vertices[0]]]};const area_ha=validateGeometry(geometry);setEditor(e=>({...e,geometry,area_ha}));setDrawing(false);setNotice(`Polígono cerrado · ${area_ha.toFixed(2)} ha. Asignale un nombre para guardarlo.`);});}
  async function persist(record) {
    const geometry=record.geometry,area_ha=validateGeometry(geometry);
    if(!record.name.trim())throw new Error('Indicá el nombre o título.');
    if(record.kind==='parcel'&&!manages(record.team_id))throw new Error('Tu rol no permite gestionar lotes de este equipo.');
    const {photo,photoBlob:existing,...fields}=record;
    const photoBlob=photo?mediaBlob(photo):existing;
    const next={...fields,name:record.name.trim(),area_ha,author_id:record.author_id||user,created_at:record.created_at||new Date().toISOString(),updated_at:new Date().toISOString(),version:(record.version||0)+1,...(photoBlob?{photoBlob}:{} )};
    await queueMap(scope,'feature.save',payload(record,{kind:record.kind,geometry,name:next.name,description:record.description,category:record.category,crop:record.crop,season:record.season,
      responsible_id:record.responsible_id||null,color:record.color,version:record.version,photo:Boolean(photo)}),next,photo?photoBlob:null);
  }
  function saveEditor(event){event.preventDefault();void act(async()=>{if(drawing)throw new Error('Terminá de dibujar el polígono antes de guardar.');await persist(editor);await clearEditor();setNotice(local?'Guardado solo en este dispositivo.':'Guardado en el dispositivo. Se sincronizará con el equipo.');});}
  function edit(feature){setSelected(null);setEditor({...feature,photo:null});setVertices(feature.kind==='parcel'?feature.geometry.coordinates[0].slice(0,-1):[]);setDrawing(false);}
  async function remove(){await act(async()=>{
    const row=confirm;
    await queueMap(scope,row.kind==='track'?'track.delete':'feature.delete',payload(row,{version:row.version}),{...row,deleted_at:new Date().toISOString()});
    setSelected(null);setConfirm(null);setNotice('Eliminación guardada; los cambios del equipo se sincronizan al recuperar conexión.');
  });}
  async function importFile(file){if(!file)return;await act(async()=>{
    const items=await importGisFile(file);
    if(items.some(item=>item.kind==='parcel')&&!manages(teamId))throw new Error('Tu rol no permite importar lotes para este equipo.');
    setPreview(items.map(item=>({...item,id:crypto.randomUUID()})));setEditor({...fresh('parcel'),name:'Lotes importados'});setVertices([]);setDrawing(false);
  });}
  async function share(feature){await act(async()=>{const result=await sharePolygon(feature);if(result==='downloaded')setNotice('KMZ descargado. Adjuntalo como documento en WhatsApp.');});}
  function saveImport(){void act(async()=>{
    // Each successful item is removed from the preview so a retry cannot duplicate it.
    for(const item of preview){
      const description=[editor.description,item.description].filter(Boolean).join('\n');
      if(description.length>3000)throw new Error('La descripción y los atributos GIS superan 3000 caracteres. Acortá la descripción común.');
      await persist({...editor,...item,description,id:item.id||crypto.randomUUID(),version:null});setPreview(previous=>previous.filter(p=>p!==item));
    }
    await clearEditor();setNotice('Importación guardada. Los pendientes se sincronizan sin duplicar elementos.');
  });}
  const editorField=(key,value)=>setEditor(e=>({...e,[key]:value}));
  const selectedLive=selected?.kind==='track'?data.tracks.find(t=>t.id===selected.id)||selected:
    ['parcel','point'].includes(selected?.kind)?data.features.find(f=>f.id===selected.id)||null:selected;
  const visibleTracks=data.tracks;
  const canEdit=selected&&selected.kind!=='publication'&&selected.kind!=='track'&&(manages(selected.team_id)||(selected.kind==='point'&&selected.author_id===user));
  const active=current&&current.status!=='finished';
  const mapPreview=closurePreview?.geometry?[...preview,{id:'perimeter-closure',geometry:closurePreview.geometry}]:preview;
  return <section className="space-y-4" aria-label="Mapa de campo">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="flex items-center gap-2 text-2xl font-bold"><MapPinned/>Mapa</h1><p className="mt-1 text-sm text-stone-500">Lotes, puntos y recorridos de {local?'este dispositivo':team.info.organization?.name||'tu organización'}.</p></div>
      <button className="btn-secondary" disabled={!org||!online||data.syncing} onClick={data.sync}><RefreshCw size={17}/>{data.syncing?'Sincronizando…':`Sincronizar mapa (${data.pending})`}</button></div>
    <p role="status" className="text-sm text-stone-600">{local?'Modo local · no se comparte con el equipo':`${data.pending} operaciones pendientes · ${online&&!data.offline?'Con conexión':'Sin conexión · copia del dispositivo'}`}{org&&` · ${data.realtime==='SUBSCRIBED'?'Actualización en vivo conectada':'Reconectando actualizaciones en vivo'}`}</p>
    <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">El mapa base necesita internet. Sin conexión podés registrar puntos y recorridos sobre las geometrías guardadas. No se descargan mapas para uso offline.</p>
    {data.loading&&<p role="status">Cargando mapa y registros…</p>}
    {(error||data.error)&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error||data.error}</p>}
    {notice&&<p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    <div className="panel space-y-3">
      <label className="form-label">Equipo<select aria-label="Equipo del mapa" className="form-input" value={teamId} disabled={busy||Boolean(editor)||active} onChange={e=>setTeamId(e.target.value)}>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {!teams.length&&<p className="text-sm">No tenés un equipo activo para crear elementos.</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-secondary" onClick={()=>myLocation()} disabled={busy}><LocateFixed size={17}/>Centrar en mi ubicación</button>
        <button className="btn-secondary" disabled={!permitted||busy||!!editor} onClick={()=>{setPlacing(true);setNotice('Tocá el mapa para elegir la ubicación del nuevo punto.');}}><Plus size={17}/>Nuevo punto</button>
        <button className="btn-secondary" disabled={!permitted||busy||!!editor} onClick={()=>myLocation(true)}>Punto en mi ubicación</button>
        <button className="btn-secondary" disabled={!permitted||!manages(teamId)||busy||!!editor} onClick={()=>{setEditor(fresh('parcel'));setVertices([]);setDrawing(true);setPlacing(false);}}>Dibujar lote</button>
        <label className={`btn-secondary ${!permitted||!!editor?'opacity-40':''}`}><Upload size={17}/>Importar GIS<input aria-label="Importar GIS" type="file" accept=".geojson,.json,.kml,.kmz,.zip,.shp" className="sr-only" disabled={!permitted||busy||!!editor} onChange={event=>{const file=event.target.files?.[0];event.target.value='';void importFile(file);}}/></label>
        {placing&&<button className="btn-secondary" onClick={()=>setPlacing(false)}>Cancelar nuevo punto</button>}
      </div>
      <p className="text-xs text-stone-500">GIS: GeoJSON, KML, KMZ o Shapefile ZIP con .shp, .dbf, .shx y .prj. Hasta 10 MB, 100 elementos y 500 vértices por polígono simple sin huecos.</p>
    </div>
    <section className="panel" aria-label="Registro de recorridos"><h2 className="text-lg font-bold">Recorridos</h2>
      <p className="mt-2 text-sm text-stone-600">{isNative()?'En Android/iOS puede continuar en segundo plano si el sistema y los permisos lo permiten; no se garantiza continuidad tras cierre forzado.':'En web/PWA el sistema puede suspender la ubicación en segundo plano; no se garantiza seguimiento continuo.'} Al iniciar se registra la ubicación del dispositivo y el SUPER_ADMIN puede consultar el historial dentro del alcance autorizado.</p>
      {!active&&(!current||current.status==='finished')&&<div className="mt-3 space-y-3">
        <label className="form-label">Tipo de medición<select className="form-input" value={measurementType} disabled={busy||Boolean(current&&current.status!=='finished')} onChange={event=>setMeasurementType(event.target.value)}><option value="perimeter">Medir perímetro de un lote</option><option value="labor">Medir labor realizada</option></select></label>
        {measurementType==='labor'&&<label className="form-label">Ancho de labor (m)<input className="form-input" type="number" min="0.01" max="100" step="0.01" required value={implementWidth} disabled={busy||Boolean(current&&current.status!=='finished')} onChange={event=>setImplementWidth(event.target.value)}/></label>}
      </div>}
      {!active&&current?.status==='paused'&&<p className="mt-3 text-sm">Medición seleccionada: {current.measurement_type==='labor'?'labor':current.measurement_type==='perimeter'?'perímetro':'recorrido anterior sin tipo de medición guardado'}.</p>}
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <p>Antes de iniciar: se registrará la ubicación durante el recorrido; en la app nativa puede continuar en segundo plano y el SUPER_ADMIN puede consultar el historial. La medición es estimada y no reemplaza una mensura.</p>
        {!noticeAccepted&&<label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={false} disabled={!noticeReady||busy} onChange={event=>void act(()=>acceptTrackingNotice(event.target.checked))}/><span>Leí y acepto el aviso de registro de ubicación.</span></label>}
        {noticeAccepted&&<p className="mt-2 font-medium">Aviso aceptado para esta cuenta.</p>}
      </div>
      {active&&<><p className="mt-3 font-semibold text-green-800" role="status">● Medición activa · Ubicación visible durante el registro</p><TrackStats track={current}/></>}
      {current?.status==='paused'&&<><p className="mt-3 font-semibold text-amber-800">Medición pausada · {current.interruption_reason||'Sin ubicación activa'}</p><TrackStats track={current}/></>}
      <button className="btn-primary mt-3" disabled={busy||Boolean(closurePreview)||!formReady||!noticeReady||(!active&&!noticeAccepted)||(!active&&current?.status!=='paused'&&!permitted)||(!active&&current?.status!=='paused'&&measurementType==='labor'&&(!Number.isFinite(Number(implementWidth))||Number(implementWidth)<=0))}
        onClick={()=>act(startOrStopMeasurement)}>{active?'Detener y ver resultado':current?.status==='paused'?'Reanudar medición':'Iniciar medición'}</button>
      {gpsError&&<p role="status" className="mt-3 text-sm text-amber-800">{gpsError}</p>}
    </section>
    {closurePreview&&<section className="panel border-amber-300" role="alertdialog" aria-label="Confirmar cierre del perímetro">
      <h2 className="font-bold">Confirmar cierre del perímetro</h2><p className="mt-2 text-sm">El tramo recto entre el último punto y el inicio es de {closurePreview.closure_distance_m.toFixed(1)} m. La vista previa lo cierra para calcular el área; no se suma a los metros realmente recorridos.</p>
      <p className="mt-2 text-sm">Área estimada de vista previa: {closurePreview.area_ha.toFixed(2)} ha.</p>
      <div className="mt-3 flex flex-wrap gap-2"><button className="btn-primary" disabled={busy} onClick={()=>act(()=>finishMeasurement(true))}>Confirmar cierre y guardar</button><button className="btn-secondary" disabled={busy} onClick={()=>act(()=>finishMeasurement(false,true))}>Finalizar sin hectáreas</button></div>
    </section>}
    {resultTrack&&<section className="panel" aria-label="Resultado de la medición">
      <h2 className="text-lg font-bold">Resultado de la medición</h2><p className="mt-2 text-sm">{name(resultTrack.user_id)} · {fmt(resultTrack.started_at)} · {resultTrack.measurement_type==='labor'?'Labor realizada':resultTrack.measurement_type==='perimeter'?'Perímetro de lote':'Recorrido anterior'}</p>
      <p className="mt-2 text-sm">Metros lineales recorridos: {(resultTrack.distance_m||0).toFixed(1)} m · Duración: {Math.floor((resultTrack.duration_ms||0)/60000)} min · Calidad GPS: {resultTrack.gps_quality?.sample_count??resultTrack.samples?.length??0} puntos, precisión máx. {resultTrack.gps_quality?.max_accuracy_m==null?'sin datos':`±${resultTrack.gps_quality.max_accuracy_m.toFixed(1)} m`}.</p>
      {resultTrack.measurement_type==='labor'&&<p className="mt-2 text-sm">Ancho: {resultTrack.implement_width_m} m · Superficie bruta estimada: {(resultTrack.result_area_ha||0).toFixed(2)} ha. Puede incluir solapamientos, giros y pasadas repetidas; no representa superficie neta trabajada.</p>}
      {resultTrack.measurement_type==='perimeter'&&resultTrack.result_area_ha!=null&&<p className="mt-2 text-sm">Superficie encerrada estimada: {resultTrack.result_area_ha.toFixed(2)} ha · Tramo de cierre: {(resultTrack.closure_distance_m||0).toFixed(1)} m (no incluido en la distancia recorrida).</p>}
      {resultTrack.measurement_type==='perimeter'&&resultTrack.result_area_ha==null&&<p className="mt-2 text-sm text-amber-800">No se calculó un área confiable. {resultTrack.interruption_reason||'Revisá la señal GPS y repetí el perímetro sin interrupciones.'}</p>}
      {resultTrack.measurement_type==='legacy'&&<p className="mt-2 text-sm text-amber-800">No se calculó una superficie para este recorrido anterior.</p>}
      <p className="mt-2 text-xs text-stone-500">Resultado estimado; no sustituye una mensura.</p>
      {resultTrack.measurement_type==='perimeter'&&resultTrack.result_geometry&&manages(resultTrack.team_id)&&<button className="btn-secondary mt-3" disabled={busy||Boolean(editor)} onClick={()=>{const geometry=resultTrack.result_geometry;setEditor({...fresh('parcel',geometry),name:`Lote medido ${argentinaDate(resultTrack.started_at)}`});setVertices(geometry.coordinates[0].slice(0,-1));setDrawing(false);setSelected(null);}}>Guardar perímetro como lote</button>}
    </section>}
    <div className="map-workspace">
    <div className="map-layer-picker"><label>Mapa base<select aria-label="Mapa base" value={baseLayer} onChange={event=>setBaseLayer(event.target.value)}><option value="satellite">Satélite</option><option value="terrain">Calles y relieve</option></select></label><details><summary>Capas visibles</summary><div>{[['parcels','Lotes'],['points','Puntos y publicaciones'],['tracks','Recorridos']].map(([key,label])=><label key={key}><input type="checkbox" checked={layers[key]} onChange={event=>setLayers(value=>({...value,[key]:event.target.checked}))}/>{label}</label>)}</div></details></div>
    <MapCanvas baseLayer={baseLayer} onClosePolygon={finishDrawing} features={data.features} publications={publications} tracks={visibleTracks} layers={layers} preview={mapPreview} vertices={vertices} drawing={drawing} editable={Boolean(editor?.geometry&&editor.kind==='parcel')} onVertex={updateVertex} onClick={mapClick} onSelect={setSelected} center={center}/>
    <MapFeaturePopup feature={selectedLive?.kind==='parcel'?selectedLive:null} onClose={()=>setSelected(null)} onEdit={canEdit&&!editor?edit:null} onDelete={canEdit?setConfirm:null} onShare={share} busy={busy} responsibleName={selectedLive?.responsible_id?name(selectedLive.responsible_id):null}/>
    </div>
    {drawing&&<div className="panel" role="status"><p>Tocá el mapa para agregar vértices. Podés arrastrarlos para ajustarlos. Tocá el primer vértice verde para cerrar y calcular las hectáreas. {vertices.length}/500 vértices.</p><div className="mt-3 flex gap-2"><button className="btn-secondary" disabled={!vertices.length} onClick={()=>setVertices(v=>v.slice(0,-1))}>Deshacer vértice</button><button className="btn-primary" disabled={vertices.length<3||busy} onClick={finishDrawing}>Cerrar polígono</button></div></div>}
    {editor&&<form className="panel space-y-3" onSubmit={saveEditor} aria-label="Ficha del mapa">
      <h2 className="text-lg font-bold">{preview.length?'Vista previa de importación':editor.kind==='parcel'?'Ficha del lote':'Ficha del punto'}</h2>
      {preview.length?<><p className="text-sm">Revisá las geometrías en naranja. No se guardan hasta confirmar. La ficha común se aplicará a todos; podés editar cada elemento después.</p><ul className="max-h-56 overflow-auto space-y-2">{preview.map((item,index)=><li key={index} className="flex flex-wrap items-center gap-2"><label className="form-label flex-1">Nombre {index+1}<input className="form-input" required maxLength={120} value={item.name} onChange={e=>setPreview(p=>p.map((f,i)=>i===index?{...f,name:e.target.value}:f))}/></label><span className="text-sm">{item.kind==='parcel'?`${item.area_ha.toFixed(2)} ha`:'Punto'}</span></li>)}</ul></>:
      <label className="form-label">{editor.kind==='parcel'?'Nombre del lote':'Título del punto'}<input className="form-input" required maxLength={120} value={editor.name} onChange={e=>editorField('name',e.target.value)}/></label>}
      <label className="form-label">Descripción<textarea className="form-input" maxLength={3000} value={editor.description} onChange={e=>editorField('description',e.target.value)}/></label>
      {editor.kind==='parcel'?<><div className="grid gap-3 sm:grid-cols-2"><label className="form-label">Cultivo<input className="form-input" maxLength={120} value={editor.crop} onChange={e=>editorField('crop',e.target.value)}/></label><label className="form-label">Campaña<input className="form-input" maxLength={80} value={editor.season} onChange={e=>editorField('season',e.target.value)}/></label></div><label className="form-label">Responsable<select className="form-input" value={editor.responsible_id||''} onChange={e=>editorField('responsible_id',e.target.value||null)}><option value="">Sin asignar</option>{people.map(p=><option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select></label>{editor.geometry&&<p className="text-sm">Superficie estimada: {(()=>{try{return validateGeometry(editor.geometry).toFixed(2)+' ha';}catch{return 'Corregí los vértices antes de guardar';}})()}</p>}{!preview.length&&<button type="button" className="btn-secondary" onClick={()=>{editorField('geometry',null);setVertices([]);setDrawing(true);}}>Redibujar polígono</button>}</>:
      <><label className="form-label">Categoría<select className="form-input" value={editor.category} onChange={e=>editorField('category',e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label><p className="text-sm">Longitud, latitud: {editor.geometry?.coordinates.join(', ')}</p><label className="form-label">Foto privada opcional<input type="file" accept="image/*" onChange={event=>{const file=event.target.files?.[0];if(file)void act(async()=>editorField('photo',await preparePhoto(file)));}}/></label>{editor.photo&&<img src={editor.photo} alt="Vista previa del punto" className="max-h-48 rounded-xl"/>}</>}
      <label className="form-label">Color<input type="color" value={editor.color} onChange={e=>editorField('color',e.target.value)} className="h-11 w-20"/></label>
      <div className="flex flex-wrap gap-2">{preview.length?<button type="button" className="btn-primary" disabled={busy} onClick={saveImport}>Confirmar importación ({preview.length})</button>:<button className="btn-primary" disabled={busy||drawing||!editor.geometry}>Guardar {editor.kind==='parcel'?'lote':'punto'}</button>}<button type="button" className="btn-secondary" disabled={busy} onClick={()=>act(clearEditor)}>Cancelar edición</button></div>
      <p className="text-xs text-stone-500">Borrador guardado en este dispositivo. Las superficies son estimadas; no sustituyen una mensura.</p>
    </form>}
    {selectedLive&&selectedLive.kind!=='parcel'&&<section className="panel" aria-label="Detalle del elemento"><div className="flex justify-between gap-3"><h2 className="text-lg font-bold">{selectedLive.name||selectedLive.body||'Recorrido'}</h2><button className="btn-secondary" onClick={()=>setSelected(null)}>Cerrar ficha</button></div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{selectedLive.description}</p>
      {selectedLive.kind==='point'&&<><p className="mt-2 text-sm">{selectedLive.category} · {selectedLive.geometry.coordinates.join(', ')} · {name(selectedLive.author_id)} · {fmt(selectedLive.created_at)}</p><Photo feature={selectedLive} scope={scope} user={user} online={online}/></>}
      {selectedLive.kind==='publication'&&(local?<button className="btn-primary mt-3" onClick={()=>onOpenPost?.(selectedLive.id)}>Abrir publicación original</button>:<Link className="btn-primary mt-3" to={`/dashboard#publicacion-${selectedLive.id}`}>Abrir publicación original</Link>)}
      {selectedLive.kind==='track'&&<><p className="mt-2 text-sm">{name(selectedLive.user_id)} · {fmt(selectedLive.started_at)} · {selectedLive.status} · {selectedLive.measurement_type==='labor'?'Labor':selectedLive.measurement_type==='perimeter'?'Perímetro':'Recorrido anterior'}</p><TrackStats track={selectedLive}/>{selectedLive.result_area_ha!=null&&<p className="mt-2 text-sm">Área estimada: {selectedLive.result_area_ha.toFixed(2)} ha</p>}{selectedLive.user_id===user&&selectedLive.status==='paused'&&(!active||current.id===selectedLive.id)&&<button className="btn-primary mt-3" disabled={busy} onClick={()=>act(()=>recorder.current.resume(selectedLive))}>Reanudar medición</button>}</>}
      <div className="mt-3 flex flex-wrap gap-2">{canEdit&&<button className="btn-secondary" disabled={busy||!!editor} onClick={()=>edit(selectedLive)}>Editar ficha y geometría</button>}{(canEdit||(selectedLive.kind==='track'&&selectedLive.user_id===user&&selectedLive.status==='finished'))&&<button className="btn-secondary" onClick={()=>setConfirm(selectedLive)}>Eliminar</button>}</div>
    </section>}
    {confirm&&<section className="panel border-red-200" role="alertdialog" aria-label="Confirmar eliminación"><p>¿Eliminar {confirm.name||'este recorrido'}? Se quitará del mapa compartido al sincronizar.</p><div className="mt-3 flex gap-2"><button className="btn-primary" disabled={busy} onClick={remove}>Confirmar eliminación</button><button className="btn-secondary" onClick={()=>setConfirm(null)}>Conservar</button></div></section>}
    <section className="panel"><h2 className="text-lg font-bold">Lotes y puntos</h2>{!data.features.length&&!publications.length?<p className="mt-3 text-sm text-stone-500">No hay lotes, puntos ni publicaciones con coordenadas válidas para mostrar.</p>:<ul className="mt-3 grid gap-2 sm:grid-cols-2">{data.features.map(f=><li key={f.id}><button className="flex min-h-11 w-full items-center gap-2 rounded-xl border p-3 text-left text-sm" onClick={()=>{setSelected(f);const p=f.geometry.type==='Point'?f.geometry.coordinates:f.geometry.coordinates[0][0];setCenter({coordinates:p,nonce:Date.now()});}}><span className="size-3 shrink-0 rounded-full" style={{background:f.color}}/>{f.name}{f.kind==='parcel'?` · ${Number(f.area_ha||0).toFixed(2)} ha`:''} · {f.pending?'Pendiente':local?'Solo local':'Sincronizado'}</button></li>)}{publications.map(p=><li key={`post:${p.id}`}><button className="min-h-11 w-full rounded-xl border p-3 text-left text-sm" onClick={()=>{setSelected({...p,kind:'publication'});setCenter({...publicationPoint(p),nonce:Date.now()});}}>Publicación · {p.body||p.caption}</button></li>)}</ul>}</section>
    <section className="panel"><h2 className="text-lg font-bold">Historial de recorridos</h2><div className="mt-3 flex flex-wrap gap-3"><label className="form-label">Fecha<input type="date" className="form-input" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}}/></label>{isAdmin&&<label className="form-label">Usuario<select className="form-input" value={historyUser} onChange={e=>setHistoryUser(e.target.value)}><option value="">Todos los usuarios autorizados</option>{people.map(p=><option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select></label>}</div><ul className="mt-3 space-y-2">{visibleTracks.map(t=><li key={t.id}><button className="min-h-11 w-full rounded-xl border p-3 text-left text-sm" onClick={()=>setSelected(t)}>{name(t.user_id)} · {fmt(t.started_at)} · {t.status==='active'?'Activo':t.status==='paused'?'Pausado':'Finalizado'} · {t.measurement_type==='labor'?'Labor':t.measurement_type==='perimeter'?'Perímetro':'Recorrido previo'} · {t.pending?'Pendiente':local?'Solo local':'Sincronizado'}</button></li>)}</ul>{!visibleTracks.length&&<p className="mt-3 text-sm text-stone-500">No hay recorridos para esta fecha{isAdmin&&historyUser?' y usuario seleccionado':''}.</p>}</section>
    <button className="btn-secondary" onClick={()=>act(async()=>downloadJson('mycampo-d-mapa.json',{exported_at:new Date().toISOString(),mode:local?'local':'team',organization_id:org,records:await mapRecords(scope),features:data.features,tracks:visibleTracks}))}>Exportar respaldo del mapa</button>
  </section>;
}
