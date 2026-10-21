import { useEffect,useState } from 'react';
import { isNative } from '../lib/nativeLocation';

export default function InstallationNotice() {
  const [visible,setVisible]=useState(false);
  useEffect(()=>{
    const installed=()=>{
      setVisible(true);
      try{localStorage.setItem('mycampo-d:installation-notified','true');}catch{/* The notice also works without localStorage. */}
    };
    window.addEventListener('appinstalled',installed);
    const standalone=isNative()||window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone;
    try{if(standalone&&!localStorage.getItem('mycampo-d:installation-notified'))installed();}catch{if(standalone)installed();}
    return()=>window.removeEventListener('appinstalled',installed);
  },[]);
  useEffect(()=>{if(!visible)return;const timer=setTimeout(()=>setVisible(false),2000);return()=>clearTimeout(timer);},[visible]);
  return visible?<aside role="status" className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] left-4 right-4 z-50 mx-auto max-w-sm rounded-2xl bg-green-800 px-5 py-4 text-center font-semibold text-white shadow-lg sm:bottom-4">MyCAMPO_D instalada y lista para usar.</aside>:null;
}
