import { useCallback, useState } from 'react';
import { useResource } from '../lib/useResource';
import { clearReadCache, protectStorage, storageStatus } from '../lib/offlineStore';
import { mapStorageStatus } from '../lib/mapStore';

const amount = bytes => `${((bytes || 0) / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`;
export default function StoragePanel({ user, pending = 0 }) {
  const resource = useResource(useCallback(async() => {
    const [storage,map]=await Promise.all([storageStatus(user),mapStorageStatus(user)]);
    return {...storage,map};
  }, [user]));
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const data = resource.data;
  async function run(action) {
    setBusy(true); setNotice('');
    try { await action(); await resource.reload(); }
    catch { setNotice('No se pudo consultar el almacenamiento. Tus pendientes se conservan.'); }
    finally { setBusy(false); }
  }
  return <section className="panel mt-5">
    <h2 className="text-lg font-bold">Almacenamiento del dispositivo</h2>
    <p className="mt-2 text-sm text-stone-500">Las fotos pendientes se conservan hasta confirmar la subida. Las copias de publicaciones ya descargadas se renuevan automáticamente para limitar el espacio.</p>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-stone-500">Espacio usado por la app</dt><dd className="font-semibold">{data?.usage == null ? 'No informado por el navegador' : amount(data.usage)}</dd></div>
      <div><dt className="text-stone-500">Disponible para la app</dt><dd className="font-semibold">{data?.quota == null ? 'Según el dispositivo' : amount(Math.max(0, data.quota - (data.usage || 0)))}</dd></div>
      <div><dt className="text-stone-500">Copias descargadas</dt><dd className="font-semibold">{amount(data?.cachedBytes)}</dd></div>
      <div><dt className="text-stone-500">Publicaciones y cambios pendientes</dt><dd className="font-semibold">{pending}</dd></div>
      <div><dt className="text-stone-500">Operaciones del mapa pendientes</dt><dd className="font-semibold">{data?.map.pending??'Consultando…'}</dd></div>
      <div><dt className="text-stone-500">Posiciones GPS guardadas</dt><dd className="font-semibold">{data?.map.samples??'Consultando…'}</dd></div>
    </dl>
    <p className="mt-3 text-xs text-stone-500">{data?.persistent ? 'Almacenamiento persistente concedido por el navegador.' : 'Podés solicitar protección para reducir la eliminación automática de datos por el navegador.'}</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button className="btn-secondary" disabled={busy || data?.persistent} onClick={() => run(async () => {
        const granted = await protectStorage({force:true});
        setNotice(granted ? 'Protección de almacenamiento activada.' : 'El navegador no concedió almacenamiento persistente. Conservá respaldos de los pendientes.');
      })}>Proteger guardado sin conexión</button>
      <button className="btn-secondary" disabled={busy || !data?.cachedBytes} onClick={() => run(async () => {
        await clearReadCache(user, { postsOnly: true });
        setNotice('Se liberaron las copias descargadas. Tus fotos pendientes y borradores se conservaron.');
      })}>Liberar copias descargadas</button>
    </div>
    {notice && <p role="status" className="mt-3 text-sm text-green-800">{notice}</p>}
  </section>;
}
