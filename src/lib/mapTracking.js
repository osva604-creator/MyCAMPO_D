import { createMapRecorder } from './mapRecorder';

let recorder=null,scope=null,context=null;
const listeners=new Set();
let lastError='';
function publish(track){for(const listener of listeners)listener({track,error:lastError});}
function ensure({scope:nextScope,context:nextContext}) {
  const current=recorder?.current();
  if(current&&current.status!=='finished'&&current.user_id!==nextContext.user_id)
    throw new Error('Hay una medición activa de otra sesión. Cerrá sesión y recuperá la medición antes de cambiar de usuario.');
  // Preserve the recorder while it is idle too: restoration and StrictMode
  // reconnect before the first track starts. Replacing it then leaves the UI
  // holding an old recorder and GPS callbacks publishing from the empty one.
  if(!recorder||current?.status==='finished'||context?.user_id!==nextContext.user_id||(!current&&scope!==nextScope)){
    scope=nextScope;context=nextContext;lastError='';
    recorder=createMapRecorder({scope,context,onChange:publish,onError:error=>{lastError=error;publish(recorder?.current()||null);}});
  }
  return recorder;
}
export function connectMapTracking(options,listener) {
  const instance=ensure(options);
  listeners.add(listener);
  listener({track:instance.current(),error:lastError});
  return {recorder:instance,disconnect:()=>listeners.delete(listener)};
}
export function subscribeMapTracking(listener) {
  listeners.add(listener);listener({track:recorder?.current()||null,error:lastError});
  return ()=>listeners.delete(listener);
}
export async function restoreMapTracking(options,records) {
  const instance=ensure(options);
  if(instance.current())return instance.current();
  const candidate=[...(records||[])].filter(record=>record.kind==='track'&&record.user_id===options.context.user_id&&record.status!=='finished')
    .sort((a,b)=>b.started_at.localeCompare(a.started_at))[0];
  if(candidate)await instance.recover(candidate);
  return instance.current();
}
export async function stopMapTracking(userId,reason='La sesión terminó; el recorrido quedó pausado.') {
  const current=recorder?.current();
  if(!current||current.user_id!==userId||current.status==='finished')return;
  await recorder.pause(new Date().toISOString(),reason);
}
