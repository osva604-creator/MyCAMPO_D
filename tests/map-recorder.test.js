import { expect,it,vi } from 'vitest';
import { createMapRecorder } from '../src/lib/mapRecorder';
function fixture(){let success,failure;const geo={watchPosition:vi.fn((ok,bad)=>{success=ok;failure=bad;return 0;}),clearWatch:vi.fn()};
  const write=vi.fn(async()=>{}),onError=vi.fn();
  const recorder=createMapRecorder({scope:'local',context:{user_id:'local',organization_id:null},geolocation:geo,write,onError,native:false});
  return {recorder,geo,write,onError,position:(lat,time=Date.now())=>success({coords:{latitude:lat,longitude:-61,accuracy:6},timestamp:time}),deny:()=>failure({code:1})};}
it('asks for GPS only on explicit start/resume, stops on pause/finish and never joins paused segments',async()=>{
  const f=fixture();expect(f.geo.watchPosition).not.toHaveBeenCalled();
  await f.recorder.start('local');f.position(-35);await f.recorder.flush();
  await f.recorder.pause();expect(f.geo.clearWatch).toHaveBeenCalledWith(0);
  await f.recorder.resume();f.position(-34,Date.now()+1000);await f.recorder.flush();
  expect(f.recorder.current().distance_m).toBe(0);expect(f.recorder.current().samples).toHaveLength(2);
  await f.recorder.finish();expect(f.recorder.current().status).toBe('finished');
  f.position(-33,Date.now()+2);await f.recorder.flush();expect(f.recorder.current().samples).toHaveLength(2);
  expect(f.write.mock.calls.map(c=>c[1])).toEqual(['track.start','track.configure','track.samples','track.state','track.state','track.samples','track.state']);
});
it('handles denied GPS, preserves the track and stops when the map is disposed',async()=>{
  const f=fixture();await f.recorder.start('local');f.deny();await f.recorder.flush();
  expect(f.recorder.current().status).toBe('paused');expect(f.onError).toHaveBeenCalledWith(expect.stringMatching(/denegado/));
  await f.recorder.resume();await f.recorder.dispose();expect(f.recorder.current().status).toBe('active');
  expect(f.geo.clearWatch).toHaveBeenCalledTimes(2);
});
it('does not restart GPS after restoring a track interrupted by process termination',async()=>{
  const f=fixture(),at=new Date(Date.now()-60000).toISOString();
  await f.recorder.recover({id:'old',team_id:'local',kind:'track',status:'active',started_at:at,active_since:at,duration_ms:0,last_fix_at:at,samples:[]});
  expect(f.recorder.current().status).toBe('paused');expect(f.recorder.current().duration_ms).toBe(0);expect(f.recorder.current().interrupted_at).toBeTruthy();expect(f.geo.watchPosition).not.toHaveBeenCalled();
});
