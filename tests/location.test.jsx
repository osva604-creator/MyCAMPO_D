// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreatePost from '../src/components/CreatePost';
import PostCard from '../src/components/PostCard';
import { mapsUrl } from '../src/lib/location';

vi.mock('../src/lib/media', () => ({
  preparePhoto: async () => 'data:image/jpeg;base64,YQ==',
  locate: async () => ({ lat: -34.61, lng: -60.92, accuracy: 12 }),
}));
HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
afterEach(cleanup);

it('abre coordenadas válidas, incluyendo cero, y rechaza valores incompletos o fuera de rango', () => {
  expect(new URL(mapsUrl({ lat: 0, lng: 0 })).searchParams.get('query')).toBe('0,0');
  for (const gps of [null, { lat: 91, lng: 0 }, { lat: 0, lng: 181 }, { lat: NaN, lng: 0 }, { lat: '', lng: 0 }]) expect(mapsUrl(gps)).toBeNull();
});

it('el pin abre el GPS guardado y no convierte nombres de lote en ubicaciones inventadas', () => {
  const post = { id: 'p', author: { name: 'Ana' }, location: 'Lote 7', createdAt: new Date().toISOString(), caption: 'Revisar', status: 'Pendiente', image: 'foto.jpg', comments: [], gps: { lat: -34.61, lng: -60.92 } };
  const view = render(<PostCard post={post} actor={{ id: 'a' }} onAction={vi.fn()} />);
  expect(new URL(screen.getByRole('link', { name: /Ver en Google Maps/ }).href).searchParams.get('query')).toBe('-34.61,-60.92');
  view.rerender(<PostCard post={{ ...post, gps: null, location: 'Potrero 7 · -34.61, -60.92' }} actor={{ id: 'a' }} onAction={vi.fn()} />);
  expect(screen.queryByRole('link', { name: /Ver en Google Maps/ })).toBeNull();
  expect(screen.getByText('Sin coordenadas GPS')).toBeTruthy();
});

it('exige confirmar el lugar, permite corregirlo y guarda las coordenadas elegidas', async () => {
  const user = userEvent.setup(), publish = vi.fn().mockResolvedValue(undefined);
  render(<CreatePost onClose={vi.fn()} onPublish={publish} members={[]} actor={{ name: 'Ana' }} />);
  await waitFor(() => expect(screen.getByLabelText('Latitud').value).toBe('-34.61'));
  await user.upload(screen.getByLabelText('Seleccionar foto'), new File(['a'], 'campo.jpg', { type: 'image/jpeg' }));
  await user.type(screen.getByLabelText('Problema detectado'), 'Molino roto');
  await user.click(screen.getByRole('button', { name: 'Guardar incidencia' }));
  expect(publish).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('Confirmá');
  await user.click(screen.getByRole('checkbox'));
  await user.clear(screen.getByLabelText('Latitud'));
  await user.type(screen.getByLabelText('Latitud'), '-35');
  expect(screen.getByRole('checkbox').checked).toBe(false);
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button', { name: 'Guardar incidencia' }));
  await waitFor(() => expect(publish).toHaveBeenCalledOnce());
  expect(publish.mock.calls[0][0].gps).toEqual({ lat: -35, lng: -60.92, accuracy: null, source: 'manual' });
});
