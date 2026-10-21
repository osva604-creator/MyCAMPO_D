import { useRegisterSW } from 'virtual:pwa-register/react';
import { isNative } from '../lib/nativeLocation';
import { useEffect } from 'react';
import InstallationNotice from './InstallationNotice';

export default function OfflineReady() {
  return <><InstallationNotice/>{!isNative()&&<WebOfflineReady />}</>;
}
function WebOfflineReady() {
  const { offlineReady: [ready, setReady], needRefresh: [refresh, setRefresh], updateServiceWorker } = useRegisterSW();
  useEffect(()=>{if(!ready||refresh)return;const timer=setTimeout(()=>setReady(false),2000);return()=>clearTimeout(timer);},[ready,refresh,setReady]);
  if (!ready && !refresh) return null;
  return <aside role="status" className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 mx-auto max-w-lg rounded-2xl border border-green-200 bg-white p-4 text-sm shadow-lg sm:bottom-4">
    <p>{refresh ? 'Hay una nueva versión. Guardá tus borradores antes de actualizar.' : 'App lista para abrir sin conexión en este dispositivo.'}</p>
    <div className="mt-2 flex gap-4">{refresh && <button onClick={() => updateServiceWorker(true)} className="min-h-11 font-semibold text-green-800">Actualizar</button>}<button onClick={() => { setReady(false); setRefresh(false); }} className="min-h-11 text-stone-500">Cerrar</button></div>
  </aside>;
}
