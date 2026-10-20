import { expect,it } from 'vitest';
import { validateGeometry,parseGeoJSON,publicationPoint,acceptPosition,positionIsStale,durationMs } from '../src/lib/mapGeometry';
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
  expect(next.distance_m).toBeGreaterThan(10);
  const gap=acceptPosition(pos(-30),{...first,recorded_at:new Date(now-130000).toISOString()},0,1,now).sample;
  expect(gap.segment).toBe(1);expect(gap.distance_m).toBe(0);
  expect(acceptPosition(pos(-30),first,1,1,now).sample.distance_m).toBe(0);
});
it('shows stale locations from their acquisition time as well as receipt time',()=>{
  const now=Date.now();expect(positionIsStale({received_at:new Date(now).toISOString(),last_fix_at:new Date(now-100000).toISOString()},now)).toBe(true);
  expect(positionIsStale({received_at:new Date(now).toISOString(),last_fix_at:new Date(now).toISOString()},now)).toBe(false);
  expect(durationMs({status:'paused',duration_ms:1234,active_since:new Date(now-5000).toISOString()},now)).toBe(1234);
});
