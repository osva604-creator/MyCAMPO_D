// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '../src/context/AuthContext';
import ProtectedRoute from '../src/components/ProtectedRoute';
import Auth from '../src/components/Auth';
import { rememberAccess, clearReadCache } from '../src/lib/offlineStore';

const mock = vi.hoisted(() => ({ listener: null, session: null, auth: {} }));
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: mock.auth } }));
beforeEach(() => {
  mock.session = null;
  mock.auth.onAuthStateChange = vi.fn((fn) => { mock.listener = fn; return { data: { subscription: { unsubscribe: vi.fn() } } }; });
  mock.auth.getSession = vi.fn(async () => ({ data: { session: mock.session } }));
  mock.auth.signInWithPassword = vi.fn(async () => {
    mock.session = { user: { id: 'one', email: 'test@example.com' } };
    mock.listener('SIGNED_IN', mock.session);
    return { data: { session: mock.session } };
  });
  mock.auth.signOut = vi.fn(async () => { mock.listener('SIGNED_OUT', null); return { data: {} }; });
  mock.auth.signUp = vi.fn(async () => ({ data: { session: null } }));
  mock.auth.resetPasswordForEmail = vi.fn(async () => ({ data: {} }));
  mock.auth.updateUser = vi.fn(async () => ({ data: {} }));
});
afterEach(()=>{cleanup();Object.defineProperty(navigator,'onLine',{value:true,configurable:true});});
function Panel() {
  const auth = useAuth(); const location = useLocation();
  return <><p>{auth.user.email}</p><p>{location.pathname}</p><button onClick={auth.signOut}>Salir</button></>;
}
function setup(path = '/dashboard') {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><Routes>
    <Route path="/login" element={<Auth />} />
    <Route path="/registro" element={<Auth mode="register" />} />
    <Route path="/recuperar-password" element={<Auth mode="forgot" />} />
    <Route path="/reset-password" element={<Auth mode="reset" />} />
    <Route path="/dashboard" element={<ProtectedRoute><Panel /></ProtectedRoute>} />
    <Route path="/privada" element={<ProtectedRoute><Panel /></ProtectedRoute>} />
  </Routes></AuthProvider></MemoryRouter>);
}
async function credentials(user, confirm = false) {
  await user.type(screen.getByLabelText('Correo'), 'test@example.com');
  await user.type(screen.getByLabelText('Contraseña', { exact: true }), 'password123');
  if (confirm) await user.type(screen.getByLabelText('Confirmar contraseña'), 'password123');
}
it('protege rutas, vuelve a la ruta solicitada y bloquea tras salir', async () => {
  const user = userEvent.setup(); setup('/privada');
  await screen.findByRole('heading', { name: 'Ingresá a MyCAMPO_D' });
  await credentials(user); await user.click(screen.getByRole('button', { name: 'Ingresar' }));
  await screen.findByText('/privada');
  await user.click(screen.getByRole('button', { name: 'Salir' }));
  await screen.findByRole('heading', { name: 'Ingresá a MyCAMPO_D' });
  expect(screen.queryByText('test@example.com')).toBeNull();
});
it('restaura la sesión al montar nuevamente', async () => {
  mock.session = { user: { id: 'one', email: 'test@example.com' } };
  const view = setup(); await screen.findByText('test@example.com');
  view.unmount(); setup(); await screen.findByText('test@example.com');
});
it('allows local offline capture from a previously verified identity without refreshing an expired token',async()=>{
  await rememberAccess({user_id:'offline-auth',status:'active',role:'USUARIO',member_id:'m',organization_id:'o',teams:[],offlineIdentity:{id:'offline-auth',email:'offline-auth@example.com'}});
  Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
  setup();await screen.findByText('offline-auth@example.com');
  expect(mock.auth.getSession).not.toHaveBeenCalled();
  await clearReadCache('offline-auth');
});
it('espera la restauración y prioriza el evento de recuperación sobre el panel', async () => {
  let restore;
  mock.auth.getSession.mockImplementation(() => new Promise((resolve) => { restore = resolve; }));
  setup();
  expect(screen.getByRole('status').textContent).toBe('Cargando sesión…');
  act(() => mock.listener('PASSWORD_RECOVERY', { user: { id: 'one', email: 'test@example.com' } }));
  await screen.findByRole('heading', { name: 'Elegí una nueva contraseña' });
  await act(async () => restore({ data: { session: null } }));
  expect(screen.getByRole('button', { name: 'Guardar contraseña' })).toBeTruthy();
});
it('bloquea el registro público y explica el ingreso aprobado por invitación', async () => {
  setup('/registro');
  await screen.findByRole('heading', { name: 'Ingreso por invitación' });
  expect(screen.queryByRole('button', { name: 'Registrarme' })).toBeNull();
  expect(mock.auth.signUp).not.toHaveBeenCalled();
});
it('solicita recuperación con la URL de retorno', async () => {
  const user = userEvent.setup(); setup('/recuperar-password');
  await screen.findByLabelText('Correo'); await user.type(screen.getByLabelText('Correo'), 'test@example.com');
  await user.click(screen.getByRole('button', { name: 'Enviar enlace' }));
  await screen.findByText(/Si existe una cuenta/);
  expect(mock.auth.resetPasswordForEmail).toHaveBeenCalledWith('test@example.com', { redirectTo: `${window.location.origin}/reset-password` });
});
it('rechaza reset sin sesión y permite cambiar con sesión', async () => {
  const user = userEvent.setup(); const view = setup('/reset-password');
  await screen.findByText(/El enlace no es válido/); expect(mock.auth.updateUser).not.toHaveBeenCalled();
  view.unmount(); mock.session = { user: { id: 'one', email: 'test@example.com' } }; setup('/reset-password');
  await screen.findByLabelText('Contraseña', { exact: true });
  await user.type(screen.getByLabelText('Contraseña', { exact: true }), 'newpassword123');
  await user.type(screen.getByLabelText('Confirmar contraseña'), 'newpassword123');
  await user.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
  await screen.findByText(/Contraseña actualizada/);
  expect(mock.auth.updateUser).toHaveBeenCalledWith({ password: 'newpassword123' });
});
it('muestra errores de credenciales sin conceder acceso', async () => {
  mock.auth.signInWithPassword.mockResolvedValue({ error: { code: 'invalid_credentials' } });
  const user = userEvent.setup(); setup('/dashboard');
  await screen.findByLabelText('Correo'); await credentials(user);
  await user.click(screen.getByRole('button', { name: 'Ingresar' }));
  await screen.findByText('Correo o contraseña incorrectos.');
  expect(screen.queryByText('/dashboard')).toBeNull();
});
