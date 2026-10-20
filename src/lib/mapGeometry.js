import { area } from '@turf/area';

export const validCoordinate = (lng, lat) => typeof lng === 'number' && typeof lat === 'number' && Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90;
const same = (a,b) => a[0] === b[0] && a[1] === b[1];
const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function intersects(a,b,c,d) {
  return cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0 &&
    Math.max(a[0],b[0])>=Math.min(c[0],d[0]) && Math.max(c[0],d[0])>=Math.min(a[0],b[0]) &&
    Math.max(a[1],b[1])>=Math.min(c[1],d[1]) && Math.max(c[1],d[1])>=Math.min(a[1],b[1]);
}
export function validateGeometry(geometry) {
  const fail = message => { throw new Error(message); };
  const point = p => Array.isArray(p) && p.length===2 && validCoordinate(p[0],p[1]);
  if (geometry?.type === 'Point') {
    if (!point(geometry.coordinates)) fail('Las coordenadas deben estar en WGS84: longitud, latitud.');
    return 0;
  }
  if (geometry?.type !== 'Polygon' || !Array.isArray(geometry.coordinates) || geometry.coordinates.length !== 1)
    fail('Usá polígonos simples sin huecos. Los MultiPolygon se separan al importar.');
  const ring = geometry.coordinates[0];
  if (!Array.isArray(ring) || ring.length<4 || ring.length>501 || !ring.every(point) || !same(ring[0],ring.at(-1)))
    fail('El polígono debe estar cerrado y tener entre 3 y 500 vértices válidos en WGS84.');
  for (let i=0;i<ring.length-1;i++) {
    if (same(ring[i],ring[i+1]) || Math.abs(ring[i][0]-ring[i+1][0])>=180) fail('Hay vértices repetidos o un cruce del antimeridiano.');
    for(let j=i+2;j<ring.length-1;j++) {
      if(i===0 && j===ring.length-2) continue;
      if(intersects(ring[i],ring[i+1],ring[j],ring[j+1])) fail('El polígono se cruza o se toca a sí mismo. Corregí sus vértices.');
    }
  }
  const hectares = area(geometry)/10000;
  if (!Number.isFinite(hectares) || hectares<0.0001) fail('El polígono no tiene una superficie válida.');
  return hectares;
}
export function parseGeoJSON(text) {
  if (new Blob([text]).size>2*1024*1024) throw new Error('El GeoJSON supera 2 MB.');
  let json;
  try { json=JSON.parse(text); } catch { throw new Error('El archivo no contiene JSON válido.'); }
  if (json.crs) throw new Error('Convertí el archivo a GeoJSON WGS84 sin una proyección CRS alternativa.');
  const features = json.type==='FeatureCollection' ? json.features : [json.type==='Feature' ? json : {type:'Feature',geometry:json}];
  if (!Array.isArray(features) || !features.length || features.length>100) throw new Error('Importá entre 1 y 100 elementos por archivo.');
  const result=[];
  for(const [index,feature] of features.entries()) {
    if(feature?.type!=='Feature') throw new Error(`Elemento ${index+1}: se esperaba un Feature.`);
    const geometry=feature.geometry;
    const geometries=geometry?.type==='MultiPolygon' ? geometry.coordinates.map(coordinates=>({type:'Polygon',coordinates})) : [geometry];
    for(const [part,g] of geometries.entries()) {
      const area_ha=validateGeometry(g);
      if(result.length>=100) throw new Error('El archivo contiene más de 100 geometrías.');
      const name=String(feature.properties?.name || feature.properties?.nombre || `Importado ${index+1}`).slice(0,110);
      result.push({kind:g.type==='Point'?'point':'parcel',geometry:g,name:name+(geometries.length>1?` · ${part+1}`:''),area_ha});
    }
  }
  return result;
}
export const publicationPoint = post => {
  const lat=post.latitude ?? post.gps?.lat, lng=post.longitude ?? post.gps?.lng;
  return validCoordinate(lng,lat) ? { type:'Point',coordinates:[lng,lat] } : null;
};
export function distanceMeters(a,b) {
  const rad=x=>x*Math.PI/180;
  const h=Math.sin(rad(b.latitude-a.latitude)/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
  return 2*6371008.8*Math.asin(Math.min(1,Math.sqrt(h)));
}
export function argentinaDate(value) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
export function argentinaDayBounds(date) {
  const [year,month,day]=date.split('-').map(Number);
  const start=Date.UTC(year,month-1,day);
  const offsetAt=instant=>{
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Argentina/Buenos_Aires',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(instant);
    const values=Object.fromEntries(parts.map(part=>[part.type,Number(part.value)]));
    return Date.UTC(values.year,values.month-1,values.day,values.hour,values.minute,values.second)-instant.getTime();
  };
  const from=new Date(start-offsetAt(new Date(start)));
  const nextDate=new Date(Date.UTC(year,month-1,day+1));
  const toStart=nextDate.getTime();
  const to=new Date(toStart-offsetAt(new Date(toStart)));
  return {from:from.toISOString(),to:to.toISOString()};
}
export function filterMapTracks(tracks,{date,userId,isAdmin=false,historyUser=''}={}) {
  return tracks.filter(track=>argentinaDate(track.started_at)===date
    &&(isAdmin?(!historyUser||track.user_id===historyUser):track.user_id===userId));
}
// Samples from different segments are never joined, including after a long gap.
export function acceptPosition(position, previous, segment, seq, now=Date.now()) {
  const {latitude,longitude,accuracy}=position.coords || {};
  const time=position.timestamp;
  if (!validCoordinate(longitude,latitude) || !Number.isFinite(accuracy) || accuracy<0 || accuracy>50 || !Number.isFinite(time) || time>now+5000 || now-time>30000)
    return {error:'Esperando una posición reciente con precisión de 50 m o mejor.'};
  let delta=0;
  let driftThreshold=0;
  if(previous) {
    const dt=(time-Date.parse(previous.recorded_at))/1000;
    if(dt<=0) return {error:'Se descartó una posición GPS repetida o fuera de orden.'};
    if(dt>120) segment=Math.max(segment,previous.segment+1);
    if(segment===previous.segment) {
      if(dt<2) return {skip:true,fix:{latitude,longitude,accuracy,recorded_at:new Date(time).toISOString()}};
      const measured=distanceMeters(previous,{latitude,longitude});
      if(measured/dt>35) return {error:'Se descartó un salto de GPS. Esperando una señal estable.'};
      driftThreshold=Math.max(2,Math.sqrt(previous.accuracy**2+accuracy**2)*0.7);
      if(measured<=driftThreshold) return {skip:true,fix:{latitude,longitude,accuracy,recorded_at:new Date(time).toISOString()}};
      delta=measured-driftThreshold;
    }
  }
  return { sample:{id:crypto.randomUUID(),seq,segment,latitude,longitude,accuracy,recorded_at:new Date(time).toISOString(),distance_m:delta,drift_threshold_m:driftThreshold} };
}
export const positionIsStale = (track, now=Date.now()) => !track.last_fix_at || now-Date.parse(track.last_fix_at)>90000;
export const durationMs = (track, now=Date.now()) => (track.duration_ms||0)+(track.status==='active' && track.active_since ? Math.max(0,now-Date.parse(track.active_since)):0);
export function trackGpsQuality(track) {
  const samples=track.samples||[];
  const segments=new Set(samples.map(sample=>sample.segment));
  return {sample_count:samples.length,segment_count:segments.size,max_accuracy_m:samples.length?Math.max(...samples.map(sample=>sample.accuracy)):null,
    interrupted:Boolean(track.interrupted_at||track.interruption_reason),gap_count:Math.max(0,segments.size-1)};
}
export function measurementResult(track,{closePerimeter=false}={}) {
  const samples=[...(track.samples||[])].sort((a,b)=>a.seq-b.seq),distance_m=track.distance_m||0;
  const segments=new Map();
  for(const sample of samples){if(!segments.has(sample.segment))segments.set(sample.segment,[]);segments.get(sample.segment).push(sample);}
  const quality=trackGpsQuality(track);
  const result={measurement_type:track.measurement_type||'perimeter',distance_m,duration_ms:track.duration_ms||0,gps_quality:quality};
  if(result.measurement_type==='labor'){
    const width=Number(track.implement_width_m);
    if(!Number.isFinite(width)||width<=0)throw new Error('El ancho de labor debe ser mayor que cero.');
    return {...result,implement_width_m:width,area_ha:distance_m*width/10000,area_kind:'gross_estimate'};
  }
  if(segments.size!==1||samples.length<4||quality.max_accuracy_m>20||quality.interrupted)
    throw new Error('No se puede calcular un perímetro confiable: se necesitan al menos cuatro puntos, GPS preciso y un único tramo sin interrupciones.');
  const coords=samples.map(s=>[s.longitude,s.latitude]),first=samples[0],last=samples.at(-1);
  const closure_distance_m=distanceMeters(first,last);
  const closure_required=closure_distance_m>Math.max(5,quality.max_accuracy_m*2);
  if(closure_required&&!closePerimeter)return {...result,closure_distance_m,closure_required:true};
  if(closure_distance_m>100)throw new Error('El inicio y el final están demasiado lejos para cerrar un perímetro confiable. Repetí el recorrido comenzando y terminando en el mismo lugar.');
  const polygon={type:'Polygon',coordinates:[[...coords,coords[0]]]};
  let area_ha;
  try{area_ha=validateGeometry(polygon);}catch{throw new Error('El trazado se cruza o no forma un polígono válido. Revisá el recorrido antes de cerrar.');}
  return {...result,closure_distance_m,closure_required:false,geometry:polygon,area_ha,area_kind:'enclosed'};
}
