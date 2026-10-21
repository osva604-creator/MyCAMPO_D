import { supabase } from './supabase';
import { allRows } from './teamApi';
import { publicationPoint,argentinaDayBounds } from './mapGeometry';
import { pendingMapScopes,mapScope,syncMap } from './mapStore';

export async function syncUserMaps(access,isCurrent) {
  const errors=[];
  for(const scope of await pendingMapScopes(access.user_id)) {
    if(!isCurrent())break;
    const org=scope.split(':')[2],membership=access.memberships?.find(m=>m.organization_id===org);
    const assigned=membership?{...access,...membership}:access;
    if(scope!==mapScope(access.user_id,org,assigned)||(access.role!=='SUPER_ADMIN'&&assigned.organization_id!==org)) {
      errors.push('Hay pendientes de Mapa retenidos porque cambió la membresía. Conservá un respaldo para revisarlos.');continue;
    }
    try {await syncMap(scope,executeMap,isCurrent);}catch(error){errors.push(error.message);}
  }
  if(errors.length)throw new Error([...new Set(errors)].join(' '));
}

export async function executeMap(operation) {
  const {data:{session}}=await supabase.auth.getSession();
  if(session?.user?.id!==operation.payload.user_id) throw new Error('Cambió la sesión. El pendiente del mapa se conserva.');
  const metadata=operation.action.startsWith('track.')&&['track.configure','track.result','track.fix'].includes(operation.action);
  const {data,error}=await supabase.rpc(metadata?'campo_map_track_metadata':'campo_map_command',{action:operation.action,payload:operation.payload,operation_id:operation.operation_id});
  if(error) throw new Error(error.code==='40001' ? 'Otra persona modificó este elemento. Exportá tus pendientes y revisá la versión del equipo antes de resolver el conflicto.' :
    error.code==='42501' ? 'Tus permisos ya no permiten este cambio. El pendiente se conserva para revisión.' :
    ['PGRST202','42P01'].includes(error.code) ? 'Falta aplicar la migración de Mapa en Supabase.' : 'No se pudo sincronizar el mapa. Tus cambios siguen guardados en el dispositivo.');
  if(operation.photo) {
    const {data:{session:current}}=await supabase.auth.getSession();
    if(current?.user?.id!==operation.payload.user_id) throw new Error('Cambió la sesión. La foto queda pendiente.');
    const upload=await supabase.storage.from('campo-map-private').upload(data.photo_path,operation.photo,{upsert:true,contentType:operation.photo.type});
    if(upload.error) throw new Error('El punto está guardado; falta subir su foto privada. Reintentá la sincronización.');
  }
  if(operation.action==='track.samples'){
    const {data:track,error:readError}=await supabase.from('map_tracks').select('*').eq('id',operation.payload.id).maybeSingle();
    if(readError||!track)throw new Error('Los puntos se guardaron, pero no se pudo confirmar la distancia acumulada. Reintentá la sincronización.');
    return track;
  }
  return data;
}
export async function loadMap(org,date,userId,isAdmin=false,historyUser='') {
  if(!org) return {features:[],tracks:[],samples:[],publications:[]};
  const {from,to}=argentinaDayBounds(date);
  const tracksQuery=()=>{let query=supabase.from('map_tracks').select('*').eq('organization_id',org).gte('started_at',from).lt('started_at',to).order('id');
    if(!isAdmin)query=query.eq('user_id',userId);else if(historyUser)query=query.eq('user_id',historyUser);
    return query;};
  const [features,history,publications]=await Promise.all([
    allRows(()=>supabase.from('map_features').select('*').eq('organization_id',org).order('id')),
    allRows(tracksQuery),
    allRows(()=>supabase.from('posts').select('id,organization_id,team_id,author_id,body,latitude,longitude,created_at').eq('organization_id',org).not('latitude','is',null).not('longitude','is',null).order('id')),
  ]);
  const tracks=history;
  const samples=[];
  for(let i=0;i<tracks.length;i+=50) samples.push(...await allRows(()=>supabase.from('map_track_samples').select('*').in('track_id',tracks.slice(i,i+50).map(t=>t.id)).order('track_id').order('seq')));
  return {features,tracks,samples,publications:publications.filter(publicationPoint)};
}
export async function loadMapTrackIncrement(org,id,lastSeq,userId,isAdmin=false) {
  let query=supabase.from('map_tracks').select('*').eq('organization_id',org).eq('id',id);
  if(!isAdmin)query=query.eq('user_id',userId);
  const {data:track,error}=await query.maybeSingle();
  if(error)throw new Error('No se pudo actualizar el recorrido. La copia guardada permanece disponible.');
  if(!track)return null;
  const samples=await allRows(()=>supabase.from('map_track_samples').select('*').eq('track_id',id).gt('seq',lastSeq).order('seq'));
  return {...track,samples};
}
export async function loadMapItem(table,id,org) {
  if(table==='map_features'){
    const {data,error}=await supabase.from(table).select('*').eq('organization_id',org).eq('id',id).maybeSingle();
    if(error)throw new Error('No se pudo actualizar el elemento del mapa.');
    return data;
  }
  const {data,error}=await supabase.from('posts').select('id,organization_id,team_id,author_id,body,latitude,longitude,created_at')
    .eq('organization_id',org).eq('id',id).maybeSingle();
  if(error)throw new Error('No se pudo actualizar la publicación del mapa.');
  return data&&publicationPoint(data)?data:null;
}
export function watchMap(org,onChange,onStatus) {
  if(!org || !supabase) return ()=>{};
  const channel=supabase.channel(`map:${org}:${crypto.randomUUID()}`);
  for(const table of ['map_features','map_tracks','posts']) channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`organization_id=eq.${org}`},onChange);
  channel.subscribe(status=>onStatus?.(status));
  return ()=>{void supabase.removeChannel(channel);};
}
export async function mapPhoto(path) {
  const {data,error}=await supabase.storage.from('campo-map-private').download(path);
  if(error) throw new Error('La foto está pendiente o ya no está disponible con tus permisos.');
  return data;
}
