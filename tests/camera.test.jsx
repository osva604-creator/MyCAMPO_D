// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CameraCapture from '../src/components/CameraCapture';
import CreatePost from '../src/components/CreatePost';
import { readForm } from '../src/lib/offlineStore';
import { Blob as NativeBlob } from 'node:buffer';

const media=vi.hoisted(()=>({photo:vi.fn(()=> 'data:image/jpeg;base64,YQ=='),prepare:vi.fn(async()=> 'data:image/jpeg;base64,YQ=='),locate:vi.fn()}));
vi.mock('../src/lib/media',()=>({photoFromSource:media.photo,preparePhoto:media.prepare,locate:(...args)=>media.locate(...args)}));
let stop,getUserMedia;
beforeEach(()=>{
  vi.stubGlobal('Blob',NativeBlob);
  media.locate.mockReset().mockRejectedValue(new Error('Indicá el lote.'));
  stop=vi.fn();getUserMedia=vi.fn().mockResolvedValue({getTracks:()=>[{stop}],getVideoTracks:()=>[{stop}]});
  Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia},configurable:true});
  vi.spyOn(HTMLMediaElement.prototype,'play').mockResolvedValue();
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();Object.defineProperty(navigator,'onLine',{value:true,configurable:true});});

it('requests the rear camera at high resolution, captures the complete frame and releases tracks',async()=>{
  const capture=vi.fn(), ticket={request:1}, shutter=vi.fn(()=>ticket);const user=userEvent.setup();
  const view=render(<CameraCapture onCapture={capture} onShutter={shutter} onClose={vi.fn()} profile="high" setProfile={vi.fn()}/>);
  await waitFor(()=>expect(getUserMedia).toHaveBeenCalled());
  expect(getUserMedia.mock.calls[0][0].video.width.ideal).toBe(2560);
  const video=view.container.querySelector('video');
  Object.defineProperty(video,'videoWidth',{value:2560});Object.defineProperty(video,'videoHeight',{value:1920});
  fireEvent.loadedData(video);
  expect(shutter).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'Tomar foto'}));
  expect(media.photo).toHaveBeenCalledWith(video,2560,1920,'high',null);
  expect(shutter).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledWith('data:image/jpeg;base64,YQ==',expect.objectContaining({capturedAt:expect.any(String),locationTicket:ticket}));
  expect(stop).toHaveBeenCalled();
});

async function takePhoto(user, container) {
  await user.click(screen.getByRole('button',{name:'Cámara',exact:true}));
  await waitFor(()=>expect(container.querySelector('video').srcObject).toBeTruthy());
  fireEvent.loadedData(container.querySelector('video'));
  await user.click(screen.getByRole('button',{name:'Tomar foto',exact:true}));
  await screen.findByAltText('Vista previa de la incidencia');
}
it('binds fresh shutter coordinates to the photo offline and preserves their precision after reopening',async()=>{
  Object.defineProperty(navigator,'onLine',{value:false,configurable:true});
  const fix={lat:-35.1,lng:-61.2,accuracy:5,timestamp:'2026-10-19T19:00:00.000Z'};
  media.locate.mockResolvedValueOnce({lat:-34,lng:-60,accuracy:100}).mockResolvedValueOnce(fix);
  const user=userEvent.setup(),publish=vi.fn().mockResolvedValue(),close=vi.fn();
  const props={onClose:close,onPublish:publish,members:[],actor:{name:'Ana'},draftKey:'test:camera:gps'};
  const first=render(<CreatePost {...props}/>);
  await waitFor(()=>expect(screen.getByLabelText('Latitud').value).toBe('-34'));
  await user.type(screen.getByLabelText('Problema detectado'),'Evidencia GPS offline');
  await takePhoto(user,first.container);
  await screen.findByText('Ubicación capturada con la foto · precisión aproximada ±5 m');
  expect(screen.getByLabelText('Latitud').value).toBe('-35.1');
  expect(media.locate).toHaveBeenLastCalledWith({timeout:30000});
  await user.click(screen.getByRole('button',{name:'Cerrar',exact:true}));
  await waitFor(()=>expect(close).toHaveBeenCalled());first.unmount();
  const stored=await readForm(props.draftKey);
  render(<CreatePost {...props}/>);
  await waitFor(()=>expect(screen.getByLabelText('Latitud').value).toBe('-35.1'));
  await user.click(screen.getByRole('button',{name:'Guardar incidencia'}));
  await waitFor(()=>expect(publish).toHaveBeenCalled());
  expect(publish.mock.calls[0][0].gps).toEqual({...fix,source:'device'});
  expect(publish.mock.calls[0][0].capturedAt).toBe(stored.data.capturedAt);
  expect(media.locate).toHaveBeenCalledTimes(2);
});
it('discards the previous location when a new photo fix fails and requires an explicit choice to save without GPS',async()=>{
  media.locate.mockResolvedValueOnce({lat:-34,lng:-60,accuracy:20}).mockRejectedValueOnce(new Error('Sin señal GPS'));
  const user=userEvent.setup(),publish=vi.fn().mockResolvedValue();
  const view=render(<CreatePost onClose={vi.fn()} onPublish={publish} members={[]} actor={{name:'Ana'}}/>);
  await waitFor(()=>expect(screen.getByLabelText('Latitud').value).toBe('-34'));
  await user.type(screen.getByLabelText('Problema detectado'),'Foto sin ubicación');
  await user.type(screen.getByLabelText('Lote o ubicación'),'Lote 7');
  await takePhoto(user,view.container);await screen.findByText('Sin señal GPS');
  expect(screen.getByLabelText('Latitud').value).toBe('');expect(screen.getByLabelText('Longitud').value).toBe('');
  await user.click(screen.getByRole('button',{name:'Guardar incidencia'}));
  expect(publish).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button',{name:'Guardar solo el lote, sin GPS'}));
  await user.click(screen.getByRole('button',{name:'Guardar incidencia'}));
  await waitFor(()=>expect(publish).toHaveBeenCalled());expect(publish.mock.calls[0][0].gps).toBeNull();
});
it('ignores a late GPS callback after the user enters the photo coordinates manually',async()=>{
  let finish;
  media.locate.mockRejectedValueOnce(new Error('Sin GPS')).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const user=userEvent.setup(),publish=vi.fn().mockResolvedValue();
  const view=render(<CreatePost onClose={vi.fn()} onPublish={publish} members={[]} actor={{name:'Ana'}}/>);
  await screen.findByText('Sin GPS');
  await user.type(screen.getByLabelText('Problema detectado'),'Ubicación manual');
  await takePhoto(user,view.container);
  expect(screen.getByRole('button',{name:'Esperando coordenadas…'}).disabled).toBe(true);
  await user.type(screen.getByLabelText('Latitud'),'-36');await user.type(screen.getByLabelText('Longitud'),'-62');
  await act(async()=>finish({lat:-35,lng:-61,accuracy:5}));
  expect(screen.getByLabelText('Latitud').value).toBe('-36');
  await user.click(screen.getByRole('checkbox'));await user.click(screen.getByRole('button',{name:'Guardar incidencia'}));
  await waitFor(()=>expect(publish).toHaveBeenCalled());
  expect(publish.mock.calls[0][0].gps).toEqual({lat:-36,lng:-62,accuracy:null,source:'manual'});
});
it('stops a late camera stream after closing instead of leaking camera access',async()=>{
  let resolve;getUserMedia.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const view=render(<CameraCapture onCapture={vi.fn()} onClose={vi.fn()} profile="high" setProfile={vi.fn()}/>);
  view.unmount();resolve({getTracks:()=>[{stop}]});
  await waitFor(()=>expect(stop).toHaveBeenCalled());
});
it('preserves the form when camera permission is denied and provides a way back',async()=>{
  getUserMedia.mockRejectedValue(Object.assign(new Error('Denied'),{name:'NotAllowedError'}));
  const user=userEvent.setup();render(<CreatePost onClose={vi.fn()} onPublish={vi.fn()} members={[]} actor={{name:'Ana'}} requirePhoto={false}/>);
  await user.type(screen.getByLabelText('Problema detectado'),'Molino');
  await user.click(screen.getByRole('button',{name:'Cámara'}));
  expect(screen.getByRole('dialog').className).toBe('camera-dialog');
  await screen.findByText(/Permiso de cámara denegado/);
  await user.click(screen.getByRole('button',{name:'Volver al formulario'}));
  expect(screen.getByLabelText('Problema detectado').value).toBe('Molino');
});
it('restores an unfinished photo and text after closing/reopening and clears only after durable publication',async()=>{
  const user=userEvent.setup(), close=vi.fn(), publish=vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValueOnce();
  const props={onClose:close,onPublish:publish,members:[],actor:{name:'Ana'},draftKey:'test:compose:restore'};
  const first=render(<CreatePost {...props}/>);
  await waitFor(()=>expect(screen.getByLabelText('Problema detectado').closest('fieldset').disabled).toBe(false));
  await user.upload(screen.getByLabelText('Seleccionar foto'),new File(['a'],'photo.jpg',{type:'image/jpeg'}));
  await user.type(screen.getByLabelText('Problema detectado'),'Molino roto');
  await user.type(screen.getByLabelText('Lote o ubicación'),'Lote 7');
  await user.click(screen.getByRole('button',{name:'Cerrar'}));
  await waitFor(()=>expect(close).toHaveBeenCalled());first.unmount();
  render(<CreatePost {...props}/>);
  await waitFor(()=>expect(screen.getByLabelText('Problema detectado').value).toBe('Molino roto'));
  expect(screen.getByAltText('Vista previa de la incidencia').src).toContain('data:image/jpeg');
  expect(screen.getByLabelText('Lote o ubicación').value).toBe('Lote 7');
  await user.click(screen.getByRole('button',{name:'Guardar incidencia'}));
  await screen.findByText('Disk full');expect(await readForm(props.draftKey)).toBeTruthy();
  await user.click(screen.getByRole('button',{name:'Guardar incidencia'}));
  await waitFor(()=>expect(publish).toHaveBeenCalledTimes(2));
  expect(publish.mock.calls[0][0].id).toBe(publish.mock.calls[1][0].id);
  await waitFor(async()=>expect(await readForm(props.draftKey)).toBeUndefined());
});
