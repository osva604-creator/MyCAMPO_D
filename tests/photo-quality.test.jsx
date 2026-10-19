// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { photoFromSource } from '../src/lib/media';
afterEach(()=>vi.restoreAllMocks());
it('preserves more detail at 2560px and JPEG .92, offers 1600px economy, and never enlarges small originals',()=>{
  const drawImage=vi.fn();let size;
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({drawImage});
  const encode=vi.spyOn(HTMLCanvasElement.prototype,'toDataURL').mockImplementation(function(){size=[this.width,this.height];return 'data:image/jpeg;base64,YQ==';});
  const source={};
  photoFromSource(source,4000,3000,'high');
  expect(size).toEqual([2560,1920]);
  expect(encode).toHaveBeenLastCalledWith('image/jpeg',0.92);
  photoFromSource(source,4000,3000,'balanced');
  expect(size).toEqual([1600,1200]);
  photoFromSource(source,800,600,'high');
  expect(size).toEqual([800,600]);
  expect(()=>photoFromSource(source,0,0)).toThrow(/lista/);
  photoFromSource(source,4000,3000,'high',0.5);
  expect(size).toEqual([1280,2560]);
  expect(drawImage).toHaveBeenLastCalledWith(source,1250,0,1500,3000,0,0,1280,2560);
});
