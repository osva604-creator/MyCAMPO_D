import { useEffect, useRef, useState } from 'react';
import { ArrowDown, RefreshCw } from 'lucide-react';

export default function PullToRefresh({ children, onRefresh, refreshing, disabled = false }) {
  const surface = useRef(null);
  const latest = useRef({ onRefresh, refreshing, disabled });
  latest.current = { onRefresh, refreshing, disabled };
  const [distance, setDistance] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const element = surface.current;
    let start = null, pull = 0, locked = false;
    const reset = () => { start = null; pull = 0; setDistance(0); };
    const begin = event => {
      if (locked || latest.current.disabled || latest.current.refreshing || window.scrollY > 0 || event.touches.length !== 1 ||
        event.target.closest('input,textarea,select,dialog,[data-no-pull]')) return;
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    };
    const move = event => {
      if (!start) return;
      if (event.touches.length !== 1 || window.scrollY > 0) return reset();
      const dy = event.touches[0].clientY - start.y;
      const dx = Math.abs(event.touches[0].clientX - start.x);
      if (dy < 0 || dx > Math.abs(dy)) return reset();
      if (dy < 10) return;
      if (event.cancelable) event.preventDefault();
      pull = Math.min(100, dy * 0.5);
      setDistance(pull);
    };
    const finish = async () => {
      const refresh = pull >= 65;
      reset();
      if (!refresh || locked || latest.current.refreshing || latest.current.disabled) return;
      locked = true; setRunning(true); setError('');
      try { await latest.current.onRefresh(); }
      catch { setError('No se pudo actualizar. Reintentá.'); }
      finally { locked = false; setRunning(false); }
    };
    element.addEventListener('touchstart', begin, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', finish);
    element.addEventListener('touchcancel', reset);
    return () => {
      element.removeEventListener('touchstart', begin);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', finish);
      element.removeEventListener('touchcancel', reset);
    };
  }, []);
  const busy = running || refreshing;
  return <div ref={surface} className="pull-refresh-surface">
    {(distance > 0 || running) && <div role="status" className="flex items-center justify-center gap-2 text-sm text-green-800" style={{ height: busy ? 56 : distance }}>
      {busy ? <RefreshCw size={18} className="animate-spin" /> : <ArrowDown size={18} style={{ transform: `rotate(${distance >= 65 ? 180 : 0}deg)` }} />}
      {busy ? 'Actualizando…' : distance >= 65 ? 'Soltá para actualizar' : 'Deslizá para actualizar'}
    </div>}
    {children}
    {error && <p role="status" className="py-2 text-center text-sm text-amber-800">{error}</p>}
  </div>;
}
