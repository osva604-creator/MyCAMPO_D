import { useCallback, useEffect, useRef, useState } from 'react';
import { cloud, getMembers, synchronize } from './cloud';
import { readEvents, saveEvent } from './db';
import { createEvent, projectEvents } from './events';
import { initialPosts } from '../data/demo';

export function useField(user) {
  const scope = cloud ? user?.id : 'local';
  const [events, setEvents] = useState([]);
  const [members, setMembers] = useState([]);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [localName, setLocalName] = useState(() => localStorage.getItem('field-name') || 'Operario local');
  const lock = useRef(false);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const actor = cloud ? { id: user?.id, name: members.find((member) => member.id === user?.id)?.name || localStorage.getItem(`field-member-${scope}`) || 'Operario' } : { id: 'local', name: localName.trim() || 'Operario local' };
  const refresh = useCallback(async () => {
    if (!scope) return;
    const data = await readEvents(scope);
    if (currentScope.current === scope) setEvents(data);
  }, [scope]);
  const sync = useCallback(async () => {
    if (!cloud || !scope || !navigator.onLine || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const team = await getMembers();
      if (!team.some((member) => member.id === scope)) throw new Error('Tu cuenta todavía no está habilitada en el equipo. Contactá al administrador.');
      if (currentScope.current !== scope) return;
      setMembers(team);
      localStorage.setItem(`field-member-${scope}`, team.find((member) => member.id === scope).name);
      await synchronize(scope, { id: scope }); await refresh();
      if (currentScope.current === scope) setError('');
    } catch (failure) {
      if (currentScope.current === scope) setError(`No se pudo sincronizar: ${failure.message}. Los registros guardados siguen en este dispositivo.`);
    } finally { lock.current = false; setBusy(false); }
  }, [scope, refresh]);
  useEffect(() => {
    setReady(false); setEvents([]); setMembers([]); setError('');
    if (!scope) return;
    let active = true;
    refresh().then(() => { if (active) { setReady(true); sync(); } }).catch(() => { if (active) setError('No se puede abrir el almacenamiento local. Revisá los permisos del navegador.'); });
    return () => { active = false; };
  }, [scope, refresh, sync]);
  useEffect(() => {
    const reconnect = () => { setOnline(true); sync(); };
    const disconnect = () => setOnline(false);
    const focus = () => { refresh().catch(() => {}); sync(); };
    window.addEventListener('online', reconnect); window.addEventListener('offline', disconnect); window.addEventListener('focus', focus);
    const interval = setInterval(sync, 30000);
    return () => { window.removeEventListener('online', reconnect); window.removeEventListener('offline', disconnect); window.removeEventListener('focus', focus); clearInterval(interval); };
  }, [sync, refresh]);
  async function dispatch(type, payload) {
    if (!ready || !scope) throw new Error('Esperá a que termine la carga del almacenamiento.');
    const event = createEvent(type, payload, actor);
    try { await saveEvent(scope, event); await refresh(); }
    catch { throw new Error('No se pudo guardar. Puede faltar espacio en el dispositivo. Conservá la foto e intentá nuevamente.'); }
    sync();
  }
  return { posts: projectEvents(events, cloud ? [] : initialPosts), ready, online, busy, error, sync, dispatch, actor, members,
    pending: events.filter((event) => !event.synced).length,
    localName, setLocalName: (name) => { localStorage.setItem('field-name', name); setLocalName(name); } };
}
