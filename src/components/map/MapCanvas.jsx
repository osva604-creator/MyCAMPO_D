import { useEffect,useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { publicationPoint } from '../../lib/mapGeometry';

export default function MapCanvas({features,publications,tracks,layers,preview,vertices,drawing,editable,onVertex,onClick,onSelect,center}) {
  const element=useRef(null),map=useRef(null),groups=useRef({}),latest=useRef({onClick,onSelect,onVertex});
  const [lng,lat]=center?.coordinates||[];
  latest.current={onClick,onSelect,onVertex};
  useEffect(()=>{
    const instance=L.map(element.current,{center:[-35,-61],zoom:12});map.current=instance;
    const attribution='Tiles &copy; Esri, TomTom, Garmin, FAO, NOAA, USGS, EPA, NPS';
    const baseLayers={
      'Satélite':L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution}),
      'Calles + relieve':L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution}),
    };
    const satellite=baseLayers['Satélite'];
    const tileError=()=>element.current?.setAttribute('data-tiles-unavailable','true');
    const tileLoad=()=>element.current?.removeAttribute('data-tiles-unavailable');
    Object.values(baseLayers).forEach(layer=>layer.on('tileerror',tileError).on('tileload',tileLoad));
    satellite.addTo(instance);
    L.control.layers(baseLayers,null,{collapsed:false,position:'topright'}).addTo(instance);
    for(const key of ['parcels','points','tracks','draft'])groups.current[key]=L.layerGroup().addTo(instance);
    instance.on('click',event=>latest.current.onClick([event.latlng.lng,event.latlng.lat]));
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>instance.invalidateSize()):null;
    observer?.observe(element.current);
    return()=>{observer?.disconnect();instance.remove();map.current=null;};
  },[]);
  useEffect(()=>{if(map.current && Number.isFinite(lat) && Number.isFinite(lng)) map.current.setView([lat,lng],16);},[lat,lng,center?.nonce]);
  useEffect(()=>{
    if(!map.current) return;
    const g=groups.current;
    Object.values(g).forEach(layer=>layer.clearLayers());
    for(const feature of features) {
      if(!layers[feature.kind==='parcel'?'parcels':'points'])continue;
      L.geoJSON(feature.geometry,{style:{color:feature.color||'#15803d',fillOpacity:.18},pointToLayer:(_f,pos)=>L.circleMarker(pos,{radius:8,color:feature.color||'#15803d',fillOpacity:.85})})
        .on('click',event=>{L.DomEvent.stopPropagation(event);latest.current.onSelect(feature);}).addTo(g[feature.kind==='parcel'?'parcels':'points']);
    }
    if(layers.points)for(const post of publications) {
      const geometry=publicationPoint(post);if(!geometry)continue;
      L.geoJSON(geometry,{pointToLayer:(_f,pos)=>L.circleMarker(pos,{radius:7,color:'#7c3aed',fillOpacity:.85})})
        .on('click',event=>{L.DomEvent.stopPropagation(event);latest.current.onSelect({...post,kind:'publication',geometry});}).addTo(g.points);
    }
    if(layers.tracks)for(const track of tracks) {
      const segments=new Map();
      for(const sample of track.samples||[]){if(!segments.has(sample.segment))segments.set(sample.segment,[]);segments.get(sample.segment).push([sample.latitude,sample.longitude]);}
      for(const points of segments.values()) L.polyline(points,{color:track.shared?'#2563eb':'#b45309',weight:4,dashArray:track.status==='paused'?'6 5':undefined}).on('click',event=>{L.DomEvent.stopPropagation(event);latest.current.onSelect(track);}).addTo(g.tracks);
      if(Number.isFinite(track.last_latitude))L.circleMarker([track.last_latitude,track.last_longitude],{radius:7,color:track.status==='active'?'#2563eb':'#78716c',fillOpacity:.9}).on('click',event=>{L.DomEvent.stopPropagation(event);latest.current.onSelect(track);}).addTo(g.tracks);
    }
    for(const item of preview||[])L.geoJSON(item.geometry,{style:{color:'#d97706',dashArray:'6 4'},pointToLayer:(_f,pos)=>L.circleMarker(pos,{color:'#d97706',radius:9})}).addTo(g.draft);
    if(vertices?.length) {
      L.polyline((drawing?vertices:[...vertices,vertices[0]]).map(p=>[p[1],p[0]]),{color:'#d97706',weight:4}).addTo(g.draft);
      if(drawing || editable) vertices.forEach((p,index)=>{
        const icon=L.divIcon({className:'map-vertex',iconSize:[18,18],iconAnchor:[9,9]});
        L.marker([p[1],p[0]],{icon,draggable:true}).on('dragend',event=>{
          const pos=event.target.getLatLng();latest.current.onVertex(index,[pos.lng,pos.lat]);
        }).addTo(g.draft);
      });
    }
  },[features,publications,tracks,layers,preview,vertices,drawing,editable]);
  useEffect(()=>{
    if(preview?.length && map.current){const bounds=L.geoJSON(preview.map(f=>({type:'Feature',geometry:f.geometry}))).getBounds();if(bounds.isValid())map.current.fitBounds(bounds,{padding:[24,24],maxZoom:17});}
  },[preview]);
  return <div ref={element} role="region" aria-label="Mapa interactivo de campo" data-no-pull className="campo-map" />;
}
