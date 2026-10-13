import { Camera, Sprout } from 'lucide-react';

export default function Navbar({ onCreatePost }) {
  return (
    <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-white/95 backdrop-blur-md">
      <nav aria-label="Navegación principal" className="mx-auto flex h-18 max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
        <a href="#inicio" aria-label="MyCAMPO_D, inicio" className="flex items-center gap-2.5">
          <span className="grid size-10 place-items-center rounded-2xl bg-green-800 text-white"><Sprout size={24} aria-hidden="true" /></span>
          <span className="text-xl font-extrabold tracking-tight sm:text-2xl">My<span className="text-green-700">CAMPO_D</span></span>
        </a>
        <button type="button" onClick={onCreatePost} className="flex min-h-11 items-center gap-2 rounded-full bg-green-800 px-4 text-sm font-semibold text-white transition hover:bg-green-900" aria-label="Tomar foto o crear publicación">
          <Camera size={19} aria-hidden="true" /><span className="hidden sm:inline">Nueva publicación</span>
        </button>
      </nav>
    </header>
  );
}
