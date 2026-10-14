import { House, Plus, MessageCircle } from 'lucide-react';

export default function MobileNav({ section, avatar, name, onNavigate, onCreate }) {
  const item = 'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-xs font-medium';
  return <nav aria-label="Navegación móvil" className="mobile-nav fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 items-center border-t border-stone-200 bg-white/95 px-3 pt-2 backdrop-blur-md sm:hidden">
    <button aria-current={section === 'home' ? 'page' : undefined} onClick={() => onNavigate('home')} className={`${item} ${section === 'home' ? 'text-green-800' : 'text-stone-500'}`}><House size={24} />Inicio</button>
    <button aria-label="Nueva publicación" onClick={onCreate} className={`${item} text-green-800`}><span className="-mt-5 grid size-14 place-items-center rounded-2xl border-4 border-white bg-green-800 text-white shadow-lg"><Plus size={30} /></span>Publicar</button>
    <button aria-current={section === 'messages' ? 'page' : undefined} onClick={() => onNavigate('messages')} className={`${item} ${section === 'messages' ? 'text-green-800' : 'text-stone-500'}`}><MessageCircle size={24} />Mensajes</button>
    <button aria-label="Configuración de la cuenta" aria-current={section === 'account' ? 'page' : undefined} onClick={() => onNavigate('account')} className={`${item} ${section === 'account' ? 'text-green-800' : 'text-stone-500'}`}><span className={`grid size-7 place-items-center overflow-hidden rounded-full bg-green-100 font-bold text-green-900 ${section === 'account' ? 'ring-2 ring-green-800 ring-offset-2' : ''}`}>{avatar ? <img src={avatar} alt="" className="size-full object-cover" /> : name?.slice(0, 1).toUpperCase()}</span>Mi cuenta</button>
  </nav>;
}
