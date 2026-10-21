import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { parseGeoJSON, validateGeometry } from './mapGeometry';
import { Capacitor } from '@capacitor/core';

const MAX_BYTES=10*1024*1024, MAX_EXPANDED=25*1024*1024;
const xml=value=>String(value??'').replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const plain=value=>{
  const doc=new DOMParser().parseFromString(String(value),'text/html');
  return doc.body.textContent.trim();
};
function archive(bytes) {
  let total=0;
  return unzipSync(bytes,{filter:entry=>{
    total+=entry.originalSize;
    if(total>MAX_EXPANDED)throw new Error('El archivo descomprimido supera 25 MB.');
    return true;
  }});
}
export function gisFeatures(collection) {
  const collections=Array.isArray(collection)?collection:[collection];
  const result=[];
  for(const data of collections) {
    if(data.crs)throw new Error('Convertí el GeoJSON a WGS84 antes de importar.');
    const features=data.type==='FeatureCollection'?data.features:[data.type==='Feature'?data:{type:'Feature',geometry:data}];
    if(!Array.isArray(features))throw new Error('El archivo no contiene elementos GIS válidos.');
    for(const feature of features) {
      const props=feature.properties||{};
      const description=Object.entries(props).filter(([key])=>!['name','nombre'].includes(key)).map(([key,value])=>`${key}: ${plain(typeof value==='object'?JSON.stringify(value):value??'')}`).join('\n');
      if(description.length>3000)throw new Error('Un elemento supera los 3000 caracteres de atributos. Reducí sus datos antes de importar.');
      // KML includes altitude; field geometries use longitude/latitude only.
      const coordinates=value=>Array.isArray(value)&&typeof value[0]==='number'?value.slice(0,2):value.map(coordinates);
      if(!feature.geometry?.coordinates)throw new Error('Usá puntos, Polygon o MultiPolygon; no se admiten colecciones de geometrías.');
      const geometry={...feature.geometry,coordinates:coordinates(feature.geometry.coordinates)};
      const name=Object.entries(props).find(([key])=>['name','nombre'].includes(key.toLowerCase()))?.[1];
      const items=parseGeoJSON(JSON.stringify({...feature,properties:{...props,...(name?{name}:{} )},geometry}));
      result.push(...items.map(item=>({...item,description})));
      if(result.length>100)throw new Error('Importá hasta 100 elementos por archivo.');
    }
  }
  if(!result.length)throw new Error('El archivo no contiene geometrías para importar.');
  return result;
}
export async function importGisFile(file) {
  if(file.size>MAX_BYTES)throw new Error('El archivo supera 10 MB.');
  const extension=file.name.split('.').at(-1).toLowerCase();
  if(['json','geojson'].includes(extension))return gisFeatures(JSON.parse(await file.text()));
  if(extension==='shp')throw new Error('Comprimí el Shapefile en ZIP junto con .dbf, .shx y .prj.');
  let source;
  if(extension==='kmz'||extension==='zip')source=archive(new Uint8Array(await file.arrayBuffer()));
  if(extension==='zip') {
    const names=Object.keys(source),shapes=names.filter(name=>/\.shp$/i.test(name));
    if(!shapes.length)throw new Error('El ZIP no contiene un Shapefile (.shp).');
    const {default:shp}=await import('shpjs');
    const collections=[];
    for(const name of shapes) {
      const base=name.slice(0,-4),get=ext=>source[names.find(n=>n.toLowerCase()===`${base}.${ext}`.toLowerCase())];
      if(!get('dbf')||!get('shx')||!get('prj'))throw new Error('Cada Shapefile necesita .shp, .dbf, .shx y .prj con el mismo nombre.');
      collections.push(await shp({shp:get('shp'),dbf:get('dbf'),prj:strFromU8(get('prj')),cpg:get('cpg')?strFromU8(get('cpg')):undefined}));
    }
    return gisFeatures(collections);
  }
  if(extension==='kmz'||extension==='kml') {
    const names=Object.keys(source||{}).filter(name=>/\.kml$/i.test(name));
    if(extension==='kmz'&&names.length!==1)throw new Error('El KMZ debe contener un único documento KML.');
    const text=extension==='kml'?await file.text():strFromU8(source[names[0]]);
    const doc=new DOMParser().parseFromString(text,'text/xml');
    if(doc.querySelector('parsererror'))throw new Error('El KML no contiene XML válido.');
    const {kml}=await import('@tmcw/togeojson');
    return gisFeatures(kml(doc));
  }
  throw new Error('Elegí GeoJSON, KML, KMZ o un Shapefile comprimido en ZIP.');
}
export function polygonKmz(feature) {
  const ha=validateGeometry(feature.geometry);
  if(feature.geometry.type!=='Polygon')throw new Error('Elegí un polígono para compartir.');
  const title=`${feature.name} · ${ha.toFixed(2)} ha`;
  const rings=feature.geometry.coordinates.map((ring,i)=>`<${i?'inner':'outer'}BoundaryIs><LinearRing><coordinates>${ring.map(p=>`${p[0]},${p[1]},0`).join(' ')}</coordinates></LinearRing></${i?'inner':'outer'}BoundaryIs>`).join('');
  const kml=`<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(title)}</name><Placemark><name>${xml(title)}</name><description>${xml(feature.description)}</description><ExtendedData><Data name="Superficie (ha)"><value>${ha.toFixed(4)}</value></Data></ExtendedData><Style><LineStyle><color>ff3d8015</color><width>3</width></LineStyle><PolyStyle><color>553d8015</color></PolyStyle></Style><Polygon>${rings}</Polygon></Placemark></Document></kml>`;
  const bytes=zipSync({'doc.kml':strToU8(kml)});
  return new File([bytes],`${title.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-')}.kmz`,{type:'application/vnd.google-earth.kmz'});
}
export async function sharePolygon(feature) {
  // Build synchronously to preserve the user gesture required by Web Share.
  const file=polygonKmz(feature);
  if(Capacitor.isNativePlatform()) {
    const [{Filesystem,Directory},{Share}]=await Promise.all([import('@capacitor/filesystem'),import('@capacitor/share')]);
    // Reclaim only our own temporary exports, after the receiving app has had
    // at least a day to consume them. Pending records and photos are separate.
    try{
      const {files}=await Filesystem.readdir({directory:Directory.Cache,path:'map-share'});
      for(const entry of files)if(/^\d{13}$/.test(entry.name)&&Number(entry.name)<Date.now()-86400000)
        await Filesystem.rmdir({directory:Directory.Cache,path:`map-share/${entry.name}`,recursive:true});
    }catch{/* The folder does not exist on the first share; export still works. */}
    const bytes=new Uint8Array(await file.arrayBuffer());
    let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    const path=`map-share/${Date.now()}/${file.name}`;
    const saved=await Filesystem.writeFile({directory:Directory.Cache,path,data:btoa(binary),recursive:true});
    try{await Share.share({title:file.name.replace(/\.kmz$/,''),files:[saved.uri],dialogTitle:'Compartir polígono'});return 'shared';}
    catch(error){if(/cancel/i.test(error.message||''))return 'cancelled';throw error;}
    // Keep the new file available while the receiving app reads it.
  }
  if(navigator.canShare?.({files:[file]})&&navigator.share) {
    try{await navigator.share({files:[file],title:file.name.replace(/\.kmz$/,'')});return 'shared';}
    catch(error){if(error.name==='AbortError')return 'cancelled';throw error;}
  }
  const url=URL.createObjectURL(file),link=document.createElement('a');
  link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  return 'downloaded';
}
