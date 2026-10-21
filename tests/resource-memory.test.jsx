// @vitest-environment jsdom
import React from 'react';
import { afterEach,it,vi,expect } from 'vitest';
import { act,cleanup,render,screen,waitFor } from '@testing-library/react';
import { useResource } from '../src/lib/useResource';
import InstallationNotice from '../src/components/InstallationNotice';
vi.mock('../src/lib/nativeLocation',()=>({isNative:()=>false}));
afterEach(()=>{cleanup();vi.useRealTimers();localStorage.clear();});
it('coalesces focus/reconnect bursts and disposes late resources after unmount',async()=>{
  let finish;const loader=vi.fn(()=>new Promise(resolve=>{finish=resolve;})),dispose=vi.fn();
  function Probe(){const result=useResource(loader);return <p>{result.busy?'Loading':'Done'}</p>;}
  const view=render(<Probe/>);
  act(()=>{for(let i=0;i<10;i++){window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('online'));}});
  expect(loader).toHaveBeenCalledTimes(1);
  view.unmount();await act(async()=>finish({dispose}));
  expect(dispose).toHaveBeenCalledTimes(1);
});
it('releases the old resource when replaced and the current one when unmounted',async()=>{
  const first=vi.fn(),second=vi.fn(),loader=vi.fn().mockResolvedValueOnce({dispose:first}).mockResolvedValue({dispose:second});
  function Probe(){useResource(loader);return null;}
  const view=render(<Probe/>);await waitFor(()=>expect(loader).toHaveBeenCalledTimes(1));
  await act(async()=>window.dispatchEvent(new Event('focus')));
  expect(first).toHaveBeenCalledTimes(1);view.unmount();expect(second).toHaveBeenCalledTimes(1);
});
it('shows installation success for exactly two seconds and cleans its timer',()=>{
  vi.useFakeTimers();const view=render(<InstallationNotice/>);
  act(()=>window.dispatchEvent(new Event('appinstalled')));
  expect(screen.getByRole('status').textContent).toContain('instalada');
  act(()=>vi.advanceTimersByTime(1999));expect(screen.getByRole('status')).toBeTruthy();
  act(()=>vi.advanceTimersByTime(1));expect(screen.queryByRole('status')).toBeNull();
  view.unmount();act(()=>window.dispatchEvent(new Event('appinstalled')));expect(vi.getTimerCount()).toBe(0);
});
it('auto-dismisses a first standalone launch in StrictMode too',()=>{
  vi.useFakeTimers();const previous=window.matchMedia;window.matchMedia=()=>({matches:true});
  try{
    render(<React.StrictMode><InstallationNotice/></React.StrictMode>);
    expect(screen.getByRole('status')).toBeTruthy();
    act(()=>vi.advanceTimersByTime(2000));expect(screen.queryByRole('status')).toBeNull();
  }finally{window.matchMedia=previous;}
});
