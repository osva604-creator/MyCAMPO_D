// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PullToRefresh from '../src/components/PullToRefresh';
import { useSyncLifecycle } from '../src/lib/useSyncLifecycle';
afterEach(()=>{cleanup();vi.useRealTimers();Object.defineProperty(navigator,'onLine',{value:true,configurable:true});});
const touches=(x,y)=>[{clientX:x,clientY:y}];
it('refreshes on a deliberate downward pull at the top, once per gesture',async()=>{
  const refresh=vi.fn().mockResolvedValue(true);
  render(<PullToRefresh onRefresh={refresh}><p>Feed</p></PullToRefresh>);
  const target=screen.getByText('Feed');
  fireEvent.touchStart(target,{touches:touches(50,10)});
  fireEvent.touchMove(target,{touches:touches(50,165)});
  expect(screen.getByText('Soltá para actualizar')).toBeTruthy();
  fireEvent.touchEnd(target);fireEvent.touchEnd(target);
  await waitFor(()=>expect(refresh).toHaveBeenCalledTimes(1));
});
it('does not refresh short, horizontal, cancelled or form-input gestures',()=>{
  const refresh=vi.fn();render(<PullToRefresh onRefresh={refresh}><p>Feed</p><input aria-label="Description"/></PullToRefresh>);
  const target=screen.getByText('Feed');
  fireEvent.touchStart(target,{touches:touches(0,0)});fireEvent.touchMove(target,{touches:touches(0,40)});fireEvent.touchEnd(target);
  fireEvent.touchStart(target,{touches:touches(0,0)});fireEvent.touchMove(target,{touches:touches(200,140)});fireEvent.touchEnd(target);
  fireEvent.touchStart(target,{touches:touches(0,0)});fireEvent.touchMove(target,{touches:touches(0,200)});fireEvent.touchCancel(target);fireEvent.touchEnd(target);
  const input=screen.getByLabelText('Description');fireEvent.touchStart(input,{touches:touches(0,0)});fireEvent.touchMove(input,{touches:touches(0,200)});fireEvent.touchEnd(input);
  expect(refresh).not.toHaveBeenCalled();
});
it('retries on foreground, reconnect, visibility changes, page restore and backgrounding; cleans listeners',()=>{
  vi.useFakeTimers();const sync=vi.fn();function Probe(){useSyncLifecycle(sync);return null;}
  const view=render(<Probe/>);expect(sync).toHaveBeenCalledTimes(1);
  for(const name of ['online','focus','pageshow','pagehide'])act(()=>window.dispatchEvent(new Event(name)));
  act(()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(sync).toHaveBeenCalledTimes(6);
  act(()=>vi.advanceTimersByTime(30000));expect(sync).toHaveBeenCalledTimes(7);
  Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
  act(()=>window.dispatchEvent(new Event('focus')));expect(sync).toHaveBeenCalledTimes(7);
  view.unmount();Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
  act(()=>window.dispatchEvent(new Event('online')));expect(sync).toHaveBeenCalledTimes(7);
});
