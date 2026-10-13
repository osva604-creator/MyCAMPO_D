import { useRegisterSW } from 'virtual:pwa-register/react';

export default function OfflineReady() {
  const { offlineReady: [ready, setReady], needRefresh: [refresh, setRefresh], updateServiceWorker } = useRegisterSW();
  if (!ready && !refresh) return null;
  return <aside role="status" className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-lg rounded-2xl border border-green-200 bg-white p-4 text-sm shadow-lg">
    <p>{refresh ? 'Hay una nueva versión. Guardá tus borradores antes de actualizar.' : 'App lista para abrir sin conexión en este dispositivo.'}</p>
    <div className="mt-2 flex gap-4">{refresh && <button onClick={() => updateServiceWorker(true)} className="min-h-11 font-semibold text-green-800">Actualizar</button>}<button onClick={() => { setReady(false); setRefresh(false); }} className="min-h-11 text-stone-500">Cerrar</button></div>
  </aside>;
}
