// @vitest-environment jsdom
import { File } from 'node:buffer';
import { describe,it,expect,vi } from 'vitest';
import { zipSync,strToU8 } from 'fflate';
import { Capacitor } from '@capacitor/core';
import { gisFeatures,importGisFile,polygonKmz,sharePolygon } from '../src/lib/mapGis';

vi.mock('@capacitor/filesystem',()=>({Directory:{Cache:'CACHE'},Filesystem:{writeFile:vi.fn(async()=>({uri:'file:///cache/polygon.kmz'}))}}));
vi.mock('@capacitor/share',()=>({Share:{share:vi.fn(async()=>({}))}}));

const geometry={type:'Polygon',coordinates:[[[-61,-35],[-60.99,-35],[-60.99,-34.99],[-61,-34.99],[-61,-35]]]};
const feature={type:'Feature',properties:{name:'Lote Norte',Cultivo:'Soja',Productor:'María'},geometry};
const file=(name,data)=>({name,size:data.length,arrayBuffer:async()=>Uint8Array.from(data).buffer,text:async()=>new TextDecoder().decode(data)});

describe('archivos GIS',()=>{
  it('conserva los atributos como texto legible y separa MultiPolygon',()=>{
    const items=gisFeatures({...feature,geometry:{type:'MultiPolygon',coordinates:[geometry.coordinates,geometry.coordinates]}});
    expect(items).toHaveLength(2);expect(items[0].description).toBe('Cultivo: Soja\nProductor: María');
    expect(items[0].area_ha).toBeGreaterThan(100);
  });
  it('exporta un KMZ válido con nombre y hectáreas y lo vuelve a importar',async()=>{
    vi.stubGlobal('File',File);
    try {
      const kmz=polygonKmz({name:'Norte & Sur <2026>',geometry,description:'Productor: María'});
      expect(kmz.name).toMatch(/ha\.kmz$/);
      const items=await importGisFile(kmz);
      expect(items[0].name).toContain('Norte & Sur <2026>');
      expect(items[0].geometry).toEqual(geometry);
      expect(items[0].description).toContain('María');
    }finally{vi.unstubAllGlobals();}
  });
  it('importa KML con altura y atributos sin ejecutar HTML',async()=>{
    const kml='<kml xmlns="http://www.opengis.net/kml/2.2"><Placemark><name>Prueba</name><ExtendedData><Data name="Cultivo"><value>Trigo</value></Data></ExtendedData><Polygon><outerBoundaryIs><LinearRing><coordinates>-61,-35,4 -60.99,-35,4 -60.99,-34.99,4 -61,-34.99,4 -61,-35,4</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></kml>';
    const items=await importGisFile(file('prueba.kml',strToU8(kml)));
    expect(items[0].geometry).toEqual(geometry);expect(items[0].description).toContain('Cultivo: Trigo');
  });
  it('rechaza archivos incompletos y atributos excesivos sin perder datos silenciosamente',async()=>{
    await expect(importGisFile(file('solo.shp',new Uint8Array()))).rejects.toThrow('ZIP');
    await expect(importGisFile(file('incompleto.zip',zipSync({'lote.shp':new Uint8Array([0])})))).rejects.toThrow('.dbf');
    expect(()=>gisFeatures({...feature,properties:{detalle:'x'.repeat(3001)}})).toThrow('3000');
    await expect(importGisFile({name:'grande.kmz',size:11*1024*1024})).rejects.toThrow('10 MB');
  });
  it('importa un Shapefile ZIP real con proyección y DBF',async()=>{
    const points=geometry.coordinates[0],length=156+points.length*16;
    const shp=new Uint8Array(length),v=new DataView(shp.buffer);
    v.setInt32(0,9994);v.setInt32(24,length/2);v.setInt32(28,1000,true);v.setInt32(32,5,true);
    for(const offset of [36,112]){v.setFloat64(offset,-61,true);v.setFloat64(offset+8,-35,true);v.setFloat64(offset+16,-60.99,true);v.setFloat64(offset+24,-34.99,true);}
    v.setInt32(100,1);v.setInt32(104,(length-108)/2);v.setInt32(108,5,true);v.setInt32(144,1,true);v.setInt32(148,points.length,true);v.setInt32(152,0,true);
    points.forEach((p,i)=>{v.setFloat64(156+i*16,p[0],true);v.setFloat64(164+i*16,p[1],true);});
    const dbf=new Uint8Array(87),d=new DataView(dbf.buffer);dbf[0]=3;d.setUint32(4,1,true);d.setUint16(8,65,true);d.setUint16(10,21,true);dbf.set(strToU8('Cultivo'),32);dbf[43]=67;dbf[48]=20;dbf[64]=13;dbf.fill(32,65,86);dbf.set(strToU8('Soja'),66);dbf[86]=26;
    const prj='GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]';
    const bytes=zipSync({'lote.shp':shp,'lote.shx':new Uint8Array(100),'lote.dbf':dbf,'lote.prj':strToU8(prj)});
    const items=await importGisFile(file('lote.zip',bytes));
    expect(items[0].description).toContain('Cultivo: Soja');expect(items[0].geometry.coordinates[0]).toHaveLength(5);
    expect(items[0].area_ha).toBeGreaterThan(100);
  });
  it('comparte el archivo y respeta la cancelación del usuario',async()=>{
    const share=vi.fn().mockRejectedValue(new DOMException('Cancelado','AbortError'));
    Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});
    Object.defineProperty(navigator,'share',{configurable:true,value:share});
    expect(await sharePolygon({name:'Lote',geometry})).toBe('cancelled');
    expect(share.mock.calls[0][0].files[0].name).toContain('ha.kmz');
    delete navigator.share;delete navigator.canShare;
  });
  it('comparte el KMZ desde la caché nativa en Android/iOS',async()=>{
    const platform=vi.spyOn(Capacitor,'isNativePlatform').mockReturnValue(true);
    vi.stubGlobal('File',File);
    try {
      const {Filesystem}=await import('@capacitor/filesystem'),{Share}=await import('@capacitor/share');
      expect(await sharePolygon({name:'Norte',geometry})).toBe('shared');
      expect(Filesystem.writeFile).toHaveBeenCalledWith(expect.objectContaining({directory:'CACHE',recursive:true}));
      expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({files:['file:///cache/polygon.kmz']}));
      expect(atob(Filesystem.writeFile.mock.calls[0][0].data).slice(0,2)).toBe('PK');
    }finally{platform.mockRestore();vi.unstubAllGlobals();}
  });
});
