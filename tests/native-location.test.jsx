// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
const mock = vi.hoisted(() => ({ native: true, platform: 'android', addWatcher: vi.fn(), removeWatcher: vi.fn(), requestPermissions: vi.fn(), getCurrentPosition: vi.fn(), openSettings: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mock.native, getPlatform: () => mock.platform }, registerPlugin: () => mock }));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: mock }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: mock }));
import { normalizeFix, nativePosition, startBackgroundLocation, stopBackgroundLocation, locationState } from '../src/lib/nativeLocation';
import LocationPanel from '../src/components/LocationPanel';
beforeEach(async () => {
  await stopBackgroundLocation(); vi.clearAllMocks(); mock.native = true; mock.platform = 'android';
  mock.requestPermissions.mockResolvedValue({ display: 'granted' });
  mock.addWatcher.mockResolvedValue('watch-1'); mock.removeWatcher.mockResolvedValue();
});
afterEach(async () => { cleanup(); await stopBackgroundLocation(); });
it('requests a fresh native position offline instead of reusing the background point', async () => {
  mock.getCurrentPosition.mockResolvedValue({ coords: { latitude: -35, longitude: -61, accuracy: 5 }, timestamp: 1792436400000 });
  const fix = await nativePosition(30000);
  expect(mock.getCurrentPosition).toHaveBeenCalledWith({ enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  expect(fix).toEqual({ lat: -35, lng: -61, accuracy: 5, timestamp: new Date(1792436400000).toISOString() });
});
it('keeps only the latest point, requests the Android notification and stops the watcher', async () => {
  await startBackgroundLocation(); await startBackgroundLocation();
  expect(mock.addWatcher).toHaveBeenCalledTimes(1);
  expect(mock.requestPermissions).toHaveBeenCalledTimes(1);
  const [options, callback] = mock.addWatcher.mock.calls[0];
  expect(options).toMatchObject({ stale: false, requestPermissions: true, distanceFilter: 0, backgroundMessage: expect.any(String) });
  callback({ latitude: -35, longitude: -61, accuracy: 7, time: 1792436400000 });
  callback({ latitude: -36, longitude: -62, accuracy: 8, time: 1792436401000 });
  expect(locationState().fix.lat).toBe(-36);
  await stopBackgroundLocation();
  expect(mock.removeWatcher).toHaveBeenCalledWith({ id: 'watch-1' });
  callback({ latitude: -37, longitude: -63, accuracy: 8, time: 1792436402000 });
  expect(locationState()).toMatchObject({ active: false, fix: null });
});
it('does not start Android background GPS when notification permission is denied', async () => {
  mock.requestPermissions.mockResolvedValue({ display: 'denied' });
  await expect(startBackgroundLocation()).rejects.toThrow(/notificaciones/);
  expect(mock.addWatcher).not.toHaveBeenCalled(); expect(locationState().pending).toBe(false);
});
it('cleans up a watcher that finishes starting after the user stops it', async () => {
  let resolve; mock.addWatcher.mockImplementation(() => new Promise(done => { resolve = done; }));
  const start = startBackgroundLocation();
  await vi.waitFor(() => expect(resolve).toBeTypeOf('function'));
  await stopBackgroundLocation(); resolve('late'); await start;
  expect(mock.removeWatcher).toHaveBeenCalledWith({ id: 'late' });
  expect(locationState().active).toBe(false);
});
it('cleans up synchronous permission rejection even before a watcher id is returned', async () => {
  mock.addWatcher.mockImplementation(async (_, callback) => { callback(null, { code: 'NOT_AUTHORIZED' }); return 'denied'; });
  await startBackgroundLocation();
  expect(mock.removeWatcher).toHaveBeenCalledWith({ id: 'denied' });
  expect(locationState()).toMatchObject({ active: false, pending: false, error: expect.stringMatching(/permiso/) });
});
it('uses the iOS background watcher without requesting Android notification permissions', async () => {
  mock.platform = 'ios'; await startBackgroundLocation();
  expect(mock.requestPermissions).not.toHaveBeenCalled(); expect(locationState().active).toBe(true);
});
it('rejects invalid or missing device coordinates instead of fabricating a GPS fix', () => {
  for (const coords of [{ latitude: 91, longitude: 0, accuracy: 1 }, { latitude: 0, longitude: 0, accuracy: -1 }, { latitude: 0, longitude: NaN, accuracy: 1 }])
    expect(() => normalizeFix(coords, Date.now())).toThrow(/válida/);
});
it('links foreground route recording to Mapa and keeps background GPS unavailable in the website', async () => {
  mock.native = false; render(<LocationPanel />);
  expect(screen.getByRole('link', { name: /Abrir recorridos en Mapa/ }).getAttribute('href')).toBe('/dashboard/mapa');
  expect(screen.getByRole('button', { name: /Activar GPS/ }).disabled).toBe(true);
  await expect(startBackgroundLocation()).rejects.toThrow(/nativa/);
  expect(mock.addWatcher).not.toHaveBeenCalled();
});
