import { useEffect,useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { publicationPoint } from '../../lib/mapGeometry';

export default function MapCanvas({features,publications,tracks,layers,preview,vertices,drawing,editable,onVertex,onClick,onSelect,onClosePolygon,baseLayer='satellite',center}) {
  const element=useRef(null),map=useRef(null),groups=useRef({}),latest=useRef({onClick,onSelect,onVertex,features:new Map(),publications:new Map(),tracks:new Map()});
  const basemaps=useRef({});
  const rendered=useRef({features:new Map(),publications:new Map(),tracks:new Map()});
  const [lng,lat]=center?.coordinates||[];
  latest.current={...latest.current,onClick,onSelect,onVertex,onClosePolygon,drawing};
  useEffect(()=>{
    // 26°53'13.64"S 64°59'54.94"W: centro inicial común a todos los usuarios.
    const instance=L.map(element.current,{center:[-26.88712222222222,-64.99859444444445],zoom:12});map.current=instance;
    const attribution='Tiles &copy; Esri, TomTom, Garmin, FAO, NOAA, USGS, EPA, NPS';
    const baseLayers={
      satellite:L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution}),
      terrain:L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution}),
    };
    basemaps.current=baseLayers;
    const satellite=baseLayers.satellite;
    const tileError=()=>element.current?.setAttribute('data-tiles-unavailable','true');
    const tileLoad=()=>element.current?.removeAttribute('data-tiles-unavailable');
    Object.values(baseLayers).forEach(layer=>layer.on('tileerror',tileError).on('tileload',tileLoad));
    satellite.addTo(instance);
    L.control.scale({imperial:false,position:'bottomleft'}).addTo(instance);
    for(const key of ['parcels','points','tracks','draft'])groups.current[key]=L.layerGroup().addTo(instance);
    instance.on('click',event=>latest.current.onClick([event.latlng.lng,event.latlng.lat]));
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>instance.invalidateSize()):null;
    observer?.observe(element.current);
    return()=>{observer?.disconnect();instance.remove();map.current=null;groups.current={};basemaps.current={};rendered.current={features:new Map(),publications:new Map(),tracks:new Map()};};
  },[]);
  useEffect(()=>{
    if(!map.current)return;
    for(const [key,layer] of Object.entries(basemaps.current)){if(key===baseLayer)layer.addTo(map.current);else map.current.removeLayer(layer);}
  },[baseLayer]);
  useEffect(()=>{if(map.current && Number.isFinite(lat) && Number.isFinite(lng)) map.current.setView([lat,lng],16);},[lat,lng,center?.nonce]);
  useEffect(()=>{
    if(!map.current) return;
    const g=groups.current,r=rendered.current;
    latest.current={...latest.current,features:new Map(features.map(feature=>[feature.id,feature])),
      publications:new Map(publications.map(post=>[post.id,post])),tracks:new Map(tracks.map(track=>[track.id,track]))};
    const featureIds=new Set(features.map(feature=>feature.id));
    for(const [id,entry]of r.features)if(!featureIds.has(id)){g[entry.groupKey].removeLayer(entry.layer);r.features.delete(id);}
    for(const feature of features) {
      const groupKey=feature.kind==='parcel'?'parcels':'points';
      const group=g[groupKey];
      const signature=`${feature.version||0}:${feature.updated_at||''}:${feature.kind}:${feature.pending?1:0}`;
      const existing=r.features.get(feature.id);
      if(!layers[groupKey]){if(existing)group.removeLayer(existing.layer);continue;}
      if(existing?.signature===signature){if(!group.hasLayer(existing.layer))group.addLayer(existing.layer);continue;}
      if(existing)g[existing.groupKey].removeLayer(existing.layer);
      const layer=L.geoJSON(feature.geometry,{style:{color:feature.color||'#15803d',fillOpacity:.18},pointToLayer:(_f,pos)=>L.circleMarker(pos,{radius:8,color:feature.color||'#15803d',fillOpacity:.85})})
        .on('click',event=>{L.DomEvent.stopPropagation(event);if(latest.current.drawing)latest.current.onClick([event.latlng.lng,event.latlng.lat]);else latest.current.onSelect(latest.current.features.get(feature.id));});
      layer.addTo(group);r.features.set(feature.id,{signature,layer,groupKey});
    }
    const publicationIds=new Set(publications.map(post=>post.id));
    for(const [id,entry]of r.publications)if(!publicationIds.has(id)){g.points.removeLayer(entry.layer);r.publications.delete(id);}
    if(layers.points)for(const post of publications) {
      const geometry=publicationPoint(post);if(!geometry){const old=r.publications.get(post.id);if(old)g.points.removeLayer(old.layer);r.publications.delete(post.id);continue;}
      const signature=`${post.updated_at||post.created_at||''}:${geometry.coordinates.join(',')}`;
      const existing=r.publications.get(post.id);
      if(existing?.signature===signature)continue;
      if(existing)g.points.removeLayer(existing.layer);
      const layer=L.geoJSON(geometry,{pointToLayer:(_f,pos)=>L.circleMarker(pos,{radius:7,color:'#7c3aed',fillOpacity:.85})})
        .on('click',event=>{L.DomEvent.stopPropagation(event);const item=latest.current.publications.get(post.id);latest.current.onSelect({...item,kind:'publication',geometry:publicationPoint(item)});})
        .addTo(g.points);
      r.publications.set(post.id,{signature,layer});
    }
    if(!layers.points)for(const {layer}of r.publications.values())g.points.removeLayer(layer);
    else for(const {layer}of r.publications.values())if(!g.points.hasLayer(layer))g.points.addLayer(layer);
    const trackIds=new Set(tracks.map(track=>track.id));
    for(const [id,entry]of r.tracks)if(!trackIds.has(id)){g.tracks.removeLayer(entry.layer);r.tracks.delete(id);}
    if(layers.tracks)for(const track of tracks) {
      let entry=r.tracks.get(track.id);
      if(!entry){entry={layer:L.layerGroup(),segments:new Map(),lastSeq:-1,marker:null,status:''};r.tracks.set(track.id,entry);}
      const color=track.status==='active'?'#2563eb':track.status==='paused'?'#b45309':'#78716c';
      if(entry.status!==track.status){for(const line of entry.segments.values())line.setStyle({color,weight:4,dashArray:track.status==='paused'?'6 5':undefined});entry.status=track.status;}
      for(const sample of track.samples||[]) {
        if(sample.seq<=entry.lastSeq)continue;
        let line=entry.segments.get(sample.segment);
        if(!line){
          line=L.polyline([],{color,weight:4,dashArray:track.status==='paused'?'6 5':undefined})
            .on('click',event=>{L.DomEvent.stopPropagation(event);latest.current.onSelect(latest.current.tracks.get(track.id));})
            .addTo(entry.layer);
          entry.segments.set(sample.segment,line);
        }
        line.addLatLng([sample.latitude,sample.longitude]);entry.lastSeq=sample.seq;
      }
      const position=Number.isFinite(track.last_latitude)?[track.last_latitude,track.last_longitude]:null;
      if(position){
        if(!entry.marker)entry.marker=L.circleMarker(position,{radius:7,color,fillOpacity:.9})
          .on('click',event=>{L.DomEvent.stopPropagation(event);latest.current.onSelect(latest.current.tracks.get(track.id));}).addTo(entry.layer);
        else entry.marker.setLatLng(position).setStyle({color});
      }
    }
    for(const {layer}of r.tracks.values()){
      if(layers.tracks&&!g.tracks.hasLayer(layer))g.tracks.addLayer(layer);
      else if(!layers.tracks&&g.tracks.hasLayer(layer))g.tracks.removeLayer(layer);
    }
  },[features,publications,tracks,layers]);
  useEffect(()=>{
    if(!map.current)return;
    const draft=groups.current.draft;draft.clearLayers();
    for(const item of preview||[])L.geoJSON(item.geometry,{style:{color:'#d97706',dashArray:'6 4'},pointToLayer:(_f,pos)=>L.circleMarker(pos,{color:'#d97706',radius:9})}).addTo(draft);
    if(vertices?.length) {
      L.polyline((drawing?vertices:[...vertices,vertices[0]]).map(p=>[p[1],p[0]]),{color:'#d97706',weight:4}).addTo(draft);
      if(drawing || editable) vertices.forEach((p,index)=>{
        const icon=L.divIcon({className:`map-vertex ${drawing&&index===0?'map-vertex-start':''}`,iconSize:[28,28],iconAnchor:[14,14]});
        L.marker([p[1],p[0]],{icon,draggable:true,title:drawing&&index===0?'Cerrar polígono':'Mover vértice',alt:drawing&&index===0?'Cerrar polígono':'Vértice'}).on('click',event=>{L.DomEvent.stopPropagation(event);if(drawing&&index===0&&vertices.length>=3)latest.current.onClosePolygon?.();}).on('dragend',event=>{
          const pos=event.target.getLatLng();latest.current.onVertex(index,[pos.lng,pos.lat]);
        }).addTo(draft);
      });
    }
  },[preview,vertices,drawing,editable]);
  useEffect(()=>{
    if(preview?.length && map.current){const bounds=L.geoJSON(preview.map(f=>({type:'Feature',geometry:f.geometry}))).getBounds();if(bounds.isValid())map.current.fitBounds(bounds,{padding:[24,24],maxZoom:17});}
  },[preview]);
  return <div ref={element} role="region" aria-label="Mapa interactivo de campo" data-no-pull className="campo-map" />;
}
