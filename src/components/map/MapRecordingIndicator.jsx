import { useEffect,useState } from 'react';
import { Link } from 'react-router-dom';
import { subscribeMapTracking } from '../../lib/mapTracking';

export default function MapRecordingIndicator({onOpen}) {
  const [track,setTrack]=useState(null);
  useEffect(()=>subscribeMapTracking(({track:current})=>setTrack(current)),[]);
  if(!track||track.status==='finished')return null;
  const active=track.status==='active';
  const label=active?'Medición activa · GPS registrando':'Medición pausada · requiere reanudar';
  const content=<span className="flex items-center gap-2"><span aria-hidden="true" className={`size-2 rounded-full ${active?'animate-pulse bg-red-600':'bg-amber-600'}`}/>{label} · {((track.distance_m||0)).toFixed(0)} m</span>;
  return <aside role="status" className="fixed bottom-20 left-2 right-2 z-[1000] mx-auto flex min-h-11 max-w-2xl items-center justify-between gap-3 rounded-xl bg-green-950 px-4 py-2 text-sm font-semibold text-white shadow-lg">
    {content}{onOpen?<button className="underline underline-offset-2" onClick={onOpen}>Ver medición</button>:<Link className="underline underline-offset-2" to="/dashboard/mapa">Ver medición</Link>}
  </aside>;
}
