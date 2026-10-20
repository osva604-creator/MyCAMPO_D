import { expect,it } from 'vitest';
import { validateGeometry,parseGeoJSON,publicationPoint,acceptPosition,positionIsStale,durationMs,argentinaDate,argentinaDayBounds,filterMapTracks,measurementResult } from '../src/lib/mapGeometry';
const polygon={type:'Polygon',coordinates:[[[-61,-35],[-60.99,-35],[-60.99,-34.99],[-61,-34.99],[-61,-35]]]};
it('validates simple polygons and calculates hectares with bounded WGS84 coordinates',()=>{
  expect(validateGeometry(polygon)).toBeGreaterThan(90);
  for(const g of [{type:'Point'}, {type:'Point',coordinates:['-61',-35]}, {type:'Polygon',coordinates:[[[-61,-35],[-60,-34],[-61,-34],[-60,-35],[-61,-35]]]}, {...polygon,coordinates:[...polygon.coordinates,polygon.coordinates[0]]}])
    expect(()=>validateGeometry(g)).toThrow();
});
it('validates all imports before any save, splits MultiPolygons and rejects alternative CRS',()=>{
  const features=parseGeoJSON(JSON.stringify({type:'Feature',properties:{name:'Lotes'},geometry:{type:'MultiPolygon',coordinates:[polygon.coordinates,polygon.coordinates]}}));
  expect(features).toHaveLength(2);expect(features[0].name).toBe('Lotes · 1');
  expect(()=>parseGeoJSON(JSON.stringify({type:'FeatureCollection',features:[{type:'Feature',geometry:polygon},{type:'Feature',geometry:{type:'Point',coordinates:[200,20]}}]}))).toThrow();
  expect(()=>parseGeoJSON(JSON.stringify({type:'Feature',crs:{},geometry:polygon}))).toThrow(/WGS84/);
  expect(()=>parseGeoJSON('{')).toThrow(/JSON/);
});
it('links only publications with finite numeric coordinates without copying their contents',()=>{
  const post={id:'existing',latitude:-35,longitude:-61};
  expect(publicationPoint(post)).toEqual({type:'Point',coordinates:[-61,-35]});
  for(const p of [{latitude:null,longitude:0},{latitude:'-35',longitude:-61},{latitude:NaN,longitude:0},{latitude:91,longitude:0}])expect(publicationPoint(p)).toBeNull();
  expect(post).toEqual({id:'existing',latitude:-35,longitude:-61});
});
it('rejects poor, stale, out-of-order fixes and impossible jumps, and splits long gaps',()=>{
  const now=Date.now();const pos=(lat,time=now,accuracy=5)=>({coords:{latitude:lat,longitude:-61,accuracy},timestamp:time});
  const first=acceptPosition(pos(-35,now-20000),null,0,0,now).sample;
  expect(acceptPosition(pos(-35,now,80),first,0,1,now).error).toBeTruthy();
  expect(acceptPosition(pos(-35,now-50000),first,0,1,now).error).toBeTruthy();
  expect(acceptPosition(pos(-30),first,0,1,now).error).toMatch(/salto/);
  const next=acceptPosition(pos(-35.0001),first,0,1,now).sample;
  expect(next.distance_m).toBeGreaterThan(5);
  expect(next.distance_m).toBeLessThan(12);
  const gap=acceptPosition(pos(-30),{...first,recorded_at:new Date(now-130000).toISOString()},0,1,now).sample;
  expect(gap.segment).toBe(1);expect(gap.distance_m).toBe(0);
  expect(acceptPosition(pos(-30),first,1,1,now).sample.distance_m).toBe(0);
});
it('uses Argentina calendar dates and UTC query bounds across midnight',()=>{
  const instant='2026-10-20T00:30:00.000Z';
  expect(argentinaDate(instant)).toBe('2026-10-19');
  expect(argentinaDate('2026-10-20T03:00:00.000Z')).toBe('2026-10-20');
  expect(argentinaDayBounds('2026-10-19')).toEqual({from:'2026-10-19T03:00:00.000Z',to:'2026-10-20T03:00:00.000Z'});
});
it('applies local date and role-appropriate user filters to both the list and map tracks',()=>{
  const tracks=[
    {id:'owner-late',user_id:'owner',started_at:'2026-10-20T00:30:00.000Z'},
    {id:'other-late',user_id:'other',started_at:'2026-10-20T00:45:00.000Z'},
    {id:'next-day',user_id:'owner',started_at:'2026-10-20T03:30:00.000Z'},
  ];
  expect(filterMapTracks(tracks,{date:'2026-10-19',userId:'owner'}).map(track=>track.id)).toEqual(['owner-late']);
  expect(filterMapTracks(tracks,{date:'2026-10-19',isAdmin:true}).map(track=>track.id)).toEqual(['owner-late','other-late']);
  expect(filterMapTracks(tracks,{date:'2026-10-19',isAdmin:true,historyUser:'other'}).map(track=>track.id)).toEqual(['other-late']);
});
it('keeps stationary fixes current without inventing movement distance',()=>{
  const now=Date.now(),pos=(lat,time,accuracy=8)=>({coords:{latitude:lat,longitude:-61,accuracy},timestamp:time});
  const first=acceptPosition(pos(-35,now-10000),null,0,0,now).sample;
  const still=acceptPosition(pos(-35.00001,now),first,0,1,now);
  expect(still.sample).toBeUndefined();expect(still.skip).toBe(true);expect(still.fix.accuracy).toBe(8);
});
it('calculates labor gross area and rejects unreliable perimeter results',()=>{
  const labor=measurementResult({measurement_type:'labor',implement_width_m:12,distance_m:1000,duration_ms:60000,samples:[]});
  expect(labor.area_ha).toBe(1.2);expect(labor.area_kind).toBe('gross_estimate');
  const samples=[
    {seq:0,segment:0,latitude:-35,longitude:-61,accuracy:4},
    {seq:1,segment:0,latitude:-35,longitude:-60.9999,accuracy:4},
    {seq:2,segment:0,latitude:-34.9999,longitude:-60.9999,accuracy:4},
    {seq:3,segment:0,latitude:-34.99999,longitude:-61,accuracy:4},
  ];
  const result=measurementResult({measurement_type:'perimeter',distance_m:40,samples});
  expect(result.closure_required).toBe(false);expect(result.area_ha).toBeGreaterThan(0);expect(result.geometry.type).toBe('Polygon');
  expect(()=>measurementResult({measurement_type:'perimeter',samples:samples.slice(0,2)})).toThrow(/cuatro puntos/);
  expect(()=>measurementResult({measurement_type:'perimeter',samples:samples.map(sample=>({...sample,segment:sample.seq<2?0:1}))})).toThrow(/interrupciones/);
});
it('shows stale locations from their acquisition time as well as receipt time',()=>{
  const now=Date.now();expect(positionIsStale({received_at:new Date(now).toISOString(),last_fix_at:new Date(now-100000).toISOString()},now)).toBe(true);
  expect(positionIsStale({received_at:new Date(now).toISOString(),last_fix_at:new Date(now).toISOString()},now)).toBe(false);
  expect(durationMs({status:'paused',duration_ms:1234,active_since:new Date(now-5000).toISOString()},now)).toBe(1234);
});
