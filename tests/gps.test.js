// @vitest-environment jsdom
import { afterEach,expect,it,vi } from 'vitest';
import { locate } from '../src/lib/media';
afterEach(()=>vi.unstubAllGlobals());
it('requests a new high-accuracy position without requiring internet and preserves accuracy and fix time',async()=>{
  const timestamp=Date.parse('2026-10-19T19:00:00Z');
  const getCurrentPosition=vi.fn(success=>success({coords:{latitude:-35.12,longitude:-61.25,accuracy:7},timestamp}));
  vi.stubGlobal('navigator',{onLine:false,geolocation:{getCurrentPosition}});
  expect(await locate({timeout:30000})).toEqual({lat:-35.12,lng:-61.25,accuracy:7,timestamp:new Date(timestamp).toISOString()});
  expect(getCurrentPosition.mock.calls[0][2]).toEqual({enableHighAccuracy:true,timeout:30000,maximumAge:0});
});
it('reports a denied or unavailable position instead of producing fallback coordinates',async()=>{
  vi.stubGlobal('navigator',{onLine:false,geolocation:{getCurrentPosition:(_success,error)=>error({code:1})}});
  await expect(locate()).rejects.toThrow(/Permiso de ubicación denegado/);
  navigator.geolocation.getCurrentPosition=(_success,error)=>error({code:3});
  await expect(locate()).rejects.toThrow(/foto se conserva/);
});
