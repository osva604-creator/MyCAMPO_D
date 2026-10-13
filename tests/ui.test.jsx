// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../src/App';
import { readEvents } from '../src/lib/db';

vi.mock('../src/lib/media', () => ({
  preparePhoto: async () => 'data:image/jpeg;base64,YQ==',
  locate: async () => { throw new Error('GPS denegado: ingresá el lote.'); },
}));
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
afterEach(cleanup);

it('crea una incidencia sin GPS, conserva evidencia y estado después de recargar y filtra el feed', async () => {
  const user = userEvent.setup();
  const first = render(<App />);
  await screen.findByText('Juan Pérez', { selector: 'h2' });
  await user.click(screen.getByRole('button', { name: 'Tomar foto o crear publicación' }));
  const dialog = screen.getByRole('dialog');
  await user.upload(within(dialog).getByLabelText('Seleccionar foto'), new File(['a'], 'campo.jpg', { type: 'image/jpeg' }));
  await user.type(within(dialog).getByLabelText('Problema detectado'), 'Alambrado caído @Carlos');
  await user.type(within(dialog).getByLabelText('Lote o ubicación'), 'Lote Sur');
  await user.type(within(dialog).getByLabelText('Solución sugerida'), 'Reponer postes');
  await user.click(within(dialog).getByRole('button', { name: 'Guardar incidencia' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const article = screen.getByText('Reponer postes').closest('article');
  await user.selectOptions(within(article).getByRole('combobox'), 'Resuelto');
  await user.click(within(article).getByRole('button', { name: 'Mostrar u ocultar comentarios' }));
  await user.type(within(article).getByLabelText('Escribe un comentario'), 'Reparación finalizada');
  await user.upload(within(article).getByLabelText('Adjuntar evidencia fotográfica'), new File(['b'], 'reparacion.jpg', { type: 'image/jpeg' }));
  await user.click(within(article).getByRole('button', { name: 'Publicar comentario' }));
  await within(article).findByText('Reparación finalizada');
  first.unmount();
  render(<App />);
  await screen.findByText('Reponer postes');
  const restored = screen.getByText('Reponer postes').closest('article');
  expect(within(restored).getByRole('combobox').value).toBe('Resuelto');
  await user.click(within(restored).getByRole('button', { name: 'Mostrar u ocultar comentarios' }));
  expect(within(restored).getByAltText('Evidencia de seguimiento o reparación').src).toBe('data:image/jpeg;base64,YQ==');
  await user.type(screen.getByLabelText('Buscar incidencias'), 'Lote Sur');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect((await readEvents('local')).filter((event) => event.type === 'post')[0].payload.gps).toBeNull();
});
