import 'fake-indexeddb/auto';
import { afterEach,expect,it,vi } from 'vitest';
import { openDB } from 'idb';
import { mapRecords } from '../src/lib/mapStore';
import { connectMapTracking,restoreMapTracking } from '../src/lib/mapTracking';

it('keeps one recorder and GPS watcher alive when the map screen disconnects',async()=>{
  await mapRecords('local');
  const db=await openDB('mycampo-d-map-v1',1),tx=db.transaction(['records','outbox','points'],'readwrite');
  for(const store of ['records','outbox','points'])await tx.objectStore(store).clear();
  await tx.done;db.close();
  let success;
  const geolocation={watchPosition:vi.fn(callback=>{success=callback;return 7;}),clearWatch:vi.fn()};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{geolocation}});
  const context={user_id:'tracking-test',organization_id:null},options={scope:'local',context};
  const initial=connectMapTracking(options,vi.fn());
  initial.disconnect();
  await restoreMapTracking(options,[]);
  const listener=vi.fn(),screenOne=connectMapTracking(options,listener);
  expect(screenOne.recorder).toBe(initial.recorder);
  await screenOne.recorder.start('local',{measurementType:'labor',width:10});
  screenOne.disconnect();
  expect(geolocation.clearWatch).not.toHaveBeenCalled();
  const liveObserver=connectMapTracking(options,listener);
  const recorded_at=Date.now();
  success({coords:{latitude:-35,longitude:-61,accuracy:5},timestamp:recorded_at});
  await screenOne.recorder.flush();
  // The GPS success callback clears errors; it must publish the same active
  // recorder instead of resetting the screen to a null track.
  expect(listener.mock.lastCall[0].track).toMatchObject({status:'active'});
  liveObserver.disconnect();
  const screenTwo=connectMapTracking(options,vi.fn());
  expect(screenTwo.recorder).toBe(screenOne.recorder);
  expect(screenTwo.recorder.current()).toMatchObject({status:'active',measurement_type:'labor',implement_width_m:10,last_fix_at:new Date(recorded_at).toISOString()});
  await screenTwo.recorder.finish();
  expect(geolocation.clearWatch).toHaveBeenCalledWith(7);
  screenTwo.disconnect();
});
