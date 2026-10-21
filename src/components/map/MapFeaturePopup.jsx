import { useEffect,useState } from 'react';

export default function MapFeaturePopup({feature,onClose,onEdit,onShare,onDelete,busy,responsibleName}) {
  const [shown,setShown]=useState(feature),[closing,setClosing]=useState(false);
  useEffect(()=>{
    if(feature){setShown(feature);setClosing(false);return;}
    setClosing(true);
    const timer=setTimeout(()=>setShown(null),180);
    return()=>clearTimeout(timer);
  },[feature]);
  useEffect(()=>{
    if(!feature)return;
    const key=event=>{if(event.key==='Escape')onClose();};
    window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
  },[feature,onClose]);
  if(!shown)return null;
  return <aside className={`map-feature-popup ${closing?'is-closing':''}`} aria-label="Información del polígono" aria-hidden={closing}>
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-wider text-green-800">Polígono</p><h2 className="mt-1 text-lg font-bold">{shown.name}</h2></div><button type="button" className="map-popup-close" aria-label="Cerrar información del polígono" onClick={onClose}>×</button></div>
    <dl className="mt-3 space-y-2 text-sm"><div><dt className="font-bold">Superficie estimada</dt><dd>{Number(shown.area_ha||0).toLocaleString('es-AR',{maximumFractionDigits:2,minimumFractionDigits:2})} ha</dd></div>
      {shown.crop&&<div><dt className="font-bold">Cultivo</dt><dd>{shown.crop}</dd></div>}{shown.season&&<div><dt className="font-bold">Campaña</dt><dd>{shown.season}</dd></div>}
      {responsibleName&&<div><dt className="font-bold">Responsable</dt><dd>{responsibleName}</dd></div>}
      {(shown.description||'').split('\n').filter(Boolean).map((line,index)=>{const colon=line.indexOf(':');return <div key={index}>{colon>0?<><dt className="font-bold">{line.slice(0,colon)}</dt><dd className="whitespace-pre-wrap break-words">{line.slice(colon+1).trim()}</dd></>:<dd className="whitespace-pre-wrap break-words">{line}</dd>}</div>;})}
    </dl>
    <div className="mt-4 flex flex-wrap gap-2"><button type="button" className="btn-primary" disabled={busy||closing} onClick={()=>onShare(shown)}>Compartir KMZ</button>{onEdit&&<button type="button" className="btn-secondary" disabled={busy||closing} onClick={()=>onEdit(shown)}>Editar ficha y geometría</button>}{onDelete&&<button type="button" className="btn-secondary" disabled={busy||closing} onClick={()=>onDelete(shown)}>Eliminar</button>}</div>
    <p className="mt-3 text-xs text-stone-500">Compartí el archivo por WhatsApp desde el menú de tu dispositivo.</p>
  </aside>;
}
