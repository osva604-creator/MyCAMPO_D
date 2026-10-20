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
// Samples from different segments are never joined, including after a long gap.
export function acceptPosition(position, previous, segment, seq, now=Date.now()) {
  const {latitude,longitude,accuracy}=position.coords || {};
  const time=position.timestamp;
  if (!validCoordinate(longitude,latitude) || !Number.isFinite(accuracy) || accuracy<0 || accuracy>50 || !Number.isFinite(time) || time>now+5000 || now-time>30000)
    return {error:'Esperando una posición reciente con precisión de 50 m o mejor.'};
  let delta=0;
  if(previous) {
    const dt=(time-Date.parse(previous.recorded_at))/1000;
    if(dt<=0) return {error:'Se descartó una posición GPS repetida o fuera de orden.'};
    if(dt>120) segment=Math.max(segment,previous.segment+1);
    if(segment===previous.segment) {
      if(dt<2) return {skip:true};
      delta=distanceMeters(previous,{latitude,longitude});
      if(delta/dt>35) return {error:'Se descartó un salto de GPS. Esperando una señal estable.'};
      if(delta<2) return {skip:true};
    }
  }
  return { sample:{id:crypto.randomUUID(),seq,segment,latitude,longitude,accuracy,recorded_at:new Date(time).toISOString(),distance_m:delta} };
}
export const positionIsStale = (track, now=Date.now()) => !track.last_fix_at || !track.received_at || now-Date.parse(track.last_fix_at)>90000 || now-Date.parse(track.received_at)>90000;
export const durationMs = (track, now=Date.now()) => (track.duration_ms||0)+(track.status==='active' && track.active_since ? Math.max(0,now-Date.parse(track.active_since)):0);
