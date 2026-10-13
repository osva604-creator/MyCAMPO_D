import { useState } from 'react';
import { cloud } from '../lib/cloud';

export default function Auth() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const { error: failure } = await cloud.auth.signInWithPassword({ email: fields.get('email'), password: fields.get('password') });
      if (failure) throw failure;
    } catch { setError('No se pudo ingresar. Revisá tus credenciales y la conexión.'); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto mt-12 max-w-sm rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
    <h1 className="text-2xl font-bold">Ingresá a MyCAMPO_D</h1><p className="mt-2 text-sm text-stone-500">Usá la cuenta que te asignó el administrador de tu campo.</p>
    <form onSubmit={submit} className="mt-6 space-y-4">
      <label className="block text-sm">Correo<input name="email" type="email" autoComplete="username" required className="mt-1 w-full rounded-xl border p-3" /></label>
      <label className="block text-sm">Contraseña<input name="password" type="password" autoComplete="current-password" required className="mt-1 w-full rounded-xl border p-3" /></label>
      <p role="alert" className="text-sm text-red-700">{error}</p><button disabled={busy} className="min-h-11 w-full rounded-full bg-green-800 px-5 text-white disabled:opacity-50">{busy ? 'Ingresando…' : 'Ingresar'}</button>
    </form>
  </main>;
}
