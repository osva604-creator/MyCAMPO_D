import { supabase } from './supabase';
import { allRows } from './teamApi';
import { publicationPoint } from './mapGeometry';
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
  const {data,error}=await supabase.rpc('campo_map_command',{action:operation.action,payload:operation.payload,operation_id:operation.operation_id});
  if(error) throw new Error(error.code==='40001' ? 'Otra persona modificó este elemento. Exportá tus pendientes y revisá la versión del equipo antes de resolver el conflicto.' :
    error.code==='42501' ? 'Tus permisos ya no permiten este cambio. El pendiente se conserva para revisión.' :
    ['PGRST202','42P01'].includes(error.code) ? 'Falta aplicar la migración de Mapa en Supabase.' : 'No se pudo sincronizar el mapa. Tus cambios siguen guardados en el dispositivo.');
  if(operation.photo) {
    const {data:{session:current}}=await supabase.auth.getSession();
    if(current?.user?.id!==operation.payload.user_id) throw new Error('Cambió la sesión. La foto queda pendiente.');
    const upload=await supabase.storage.from('campo-map-private').upload(data.photo_path,operation.photo,{upsert:true,contentType:operation.photo.type});
    if(upload.error) throw new Error('El punto está guardado; falta subir su foto privada. Reintentá la sincronización.');
  }
  return data;
}
export async function loadMap(org,date) {
  if(!org) return {features:[],tracks:[],samples:[],publications:[]};
  const from=new Date(`${date}T00:00:00`),to=new Date(from);to.setDate(to.getDate()+1);
  const [features,history,active,publications]=await Promise.all([
    allRows(()=>supabase.from('map_features').select('*').eq('organization_id',org).order('id')),
    allRows(()=>supabase.from('map_tracks').select('*').eq('organization_id',org).gte('started_at',from.toISOString()).lt('started_at',to.toISOString()).order('id')),
    allRows(()=>supabase.from('map_tracks').select('*').eq('organization_id',org).neq('status','finished').order('id')),
    allRows(()=>supabase.from('posts').select('id,organization_id,team_id,author_id,body,latitude,longitude,created_at').eq('organization_id',org).not('latitude','is',null).not('longitude','is',null).order('id')),
  ]);
  const tracks=[...new Map([...history,...active].map(t=>[t.id,t])).values()];
  const samples=[];
  for(let i=0;i<tracks.length;i+=50) samples.push(...await allRows(()=>supabase.from('map_track_samples').select('*').in('track_id',tracks.slice(i,i+50).map(t=>t.id)).order('track_id').order('seq')));
  return {features,tracks,samples,publications:publications.filter(publicationPoint)};
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
