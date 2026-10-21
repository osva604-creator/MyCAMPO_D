// @vitest-environment jsdom
import React from 'react';
import { afterEach,it,expect,vi } from 'vitest';
import { cleanup,render } from '@testing-library/react';
import L from 'leaflet';
import MapCanvas from '../src/components/map/MapCanvas';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
it('libera las capas reemplazadas y eliminadas de sus grupos en StrictMode',()=>{
  L.Browser.svg=true;
  const groups=[],original=L.layerGroup;
  vi.spyOn(L,'layerGroup').mockImplementation((...args)=>{const group=original(...args);groups.push(group);return group;});
  vi.spyOn(L,'tileLayer').mockImplementation(()=>original());
  const props={features:[],publications:[],tracks:[],layers:{parcels:true,points:true,tracks:true},preview:[],vertices:[],onClick:vi.fn(),onSelect:vi.fn()};
  const feature={id:'feature',kind:'point',version:1,geometry:{type:'Point',coordinates:[-61,-35]}};
  const post={id:'post',latitude:-35,longitude:-61};
  const track={id:'track',status:'active',samples:[]};
  const view=render(<React.StrictMode><MapCanvas {...props} features={[feature]} publications={[post]} tracks={[track]}/></React.StrictMode>);
  // StrictMode creates one initial set and then a fresh set of groups.
  const points=groups[6],tracks=groups[7];
  expect(points.getLayers()).toHaveLength(2);expect(tracks.getLayers()).toHaveLength(1);
  view.rerender(<React.StrictMode><MapCanvas {...props} features={[{...feature,version:2}]} publications={[{...post,longitude:-62}]} tracks={[track]}/></React.StrictMode>);
  expect(points.getLayers()).toHaveLength(2);
  view.rerender(<React.StrictMode><MapCanvas {...props}/></React.StrictMode>);
  expect(points.getLayers()).toHaveLength(0);expect(tracks.getLayers()).toHaveLength(0);
});
