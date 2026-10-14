// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { act,cleanup,render,screen,waitFor,within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter,Route,Routes } from 'react-router-dom';
import { AccessProvider,useAccess } from '../src/context/AccessContext';
import { TeamContext } from '../src/context/TeamContext';
import TeamGate from '../src/components/team/TeamShell';
import ActivateAccount from '../src/components/ActivateAccount';
import Tasks from '../src/components/team/Tasks';
import AdminPanel from '../src/components/team/AdminPanel';
import { useResource } from '../src/lib/useResource';
import App from '../src/App';

const mock=vi.hoisted(()=>({auth:null,access:null,info:null,platform:vi.fn(),execute:vi.fn(),admin:vi.fn(),tables:{},from:vi.fn()}));
vi.mock('../src/context/AuthContext',()=>({useAuth:()=>mock.auth,AuthProvider:({children})=>children}));
vi.mock('../src/lib/supabase',()=>({supabase:{from:(...args)=>mock.from(...args)}}));
vi.mock('../src/lib/teamApi',async()=>{
  const actual=await vi.importActual('../src/lib/teamApi');
  return {...actual,platform:(...args)=>mock.platform(...args),directory:async()=>mock.info,feed:async()=>({posts:[],hasMore:false}),watchTeam:()=>()=>{},executeContent:(...args)=>mock.execute(...args),adminCommand:(...args)=>mock.admin(...args)};
});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
beforeEach(()=>{
  vi.clearAllMocks();window.scrollTo=vi.fn();window.history.replaceState(null,'','/');
  Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
  mock.auth={user:{id:id(1),email:'ana@example.com'},session:{access_token:'test'},loading:false,resetPassword:vi.fn(async()=>{}),signOut:vi.fn(async()=>{})};
  mock.access={user_id:id(1),member_id:id(2),organization_id:id(3),status:'active',role:'USUARIO',name:'Ana',teams:[{id:id(4),name:'Norte'}]};
  mock.info={organization:{id:id(3),name:'Campo A'},organizations:[{id:id(3),name:'Campo A',active:true}],teams:[{id:id(4),organization_id:id(3),name:'Norte',active:true}],members:[{id:id(2),user_id:id(1),organization_id:id(3),name:'Ana',role:'USUARIO'}],people:[{id:id(2),user_id:id(1),name:'Ana'}],assignments:[{member_id:id(2),team_id:id(4)}],supervisors:[]};
  mock.tables={tasks:[],posts:[],invitations:[],invitation_requests:[],task_history:[]};
  mock.from.mockImplementation(table=>{
    const filters=[];let selectOptions;
    const query={select(_cols,opts){selectOptions=opts;return this;},eq(key,value){filters.push(row=>row[key]===value);return this;},is(key,value){filters.push(row=>(row[key]??null)===value);return this;},in(key,values){filters.push(row=>values.includes(row[key]));return this;},order(){return this;},range(){return this;},limit(){return this;},ilike(){return this;},then(resolve,reject){const data=(mock.tables[table] || []).filter(row=>filters.every(f=>f(row)));return Promise.resolve({data,count:selectOptions?.count?data.length:null}).then(resolve,reject);}};
    return query;
  });
  mock.platform.mockImplementation(async body=>{
    if(body.action==='access.context')return mock.access;
    if(body.action==='messages.inbox')return {conversations:[],unread_total:0};
    if(body.action==='audit.conversations')return [{id:id(8),organization_id:id(3),user_a:id(1),user_b:id(9),created_at:'2026-10-14T10:00:00Z'}];
    if(body.action==='audit.messages')return [{id:id(10),sender_id:id(1),body:'Contenido supervisado',created_at:'2026-10-14T10:00:00Z'}];
    if(body.action==='admin.accounts')return [{id:id(1),email:'ana@example.com',email_confirmed_at:'2026-01-01'}];
    if(body.action==='invitation.activate')return {status:'activated'};
    return {};
  });mock.execute.mockResolvedValue({id:id(20)});mock.admin.mockResolvedValue({id:id(20)});
});
afterEach(cleanup);
function gate(path='/dashboard') {return render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/dashboard/*" element={<AccessProvider><TeamGate/></AccessProvider>}/><Route path="/activar-cuenta" element={<AccessProvider><ActivateAccount/></AccessProvider>}/></Routes></MemoryRouter>);}
function scope(children,path='/dashboard/tareas') {return render(<MemoryRouter initialEntries={[path]}><TeamContext.Provider value={{access:mock.access,user:mock.auth.user,info:mock.info,orgId:id(3),online:true,refreshInfo:vi.fn(async()=>{}),pending:{data:[]},inbox:{data:{conversations:[],unread_total:0}}}}>{children}</TeamContext.Provider></MemoryRouter>);}

it('shows pending approval without mounting the operational dashboard',async()=>{
  mock.access={user_id:id(1),status:'awaiting_approval',invitations:[{id:id(6),role:'USUARIO'}]};gate();
  await screen.findByRole('heading',{name:'Tu acceso está pendiente'});
  expect(screen.queryByRole('navigation',{name:'Navegación del equipo'})).toBeNull();
  expect(screen.getByRole('link',{name:/Activar invitación/}).getAttribute('href')).toContain(id(6));
});
it('does not expose administrative navigation or routes to an ordinary user',async()=>{
  gate('/dashboard/admin/usuarios');await screen.findByRole('heading',{name:'Acceso restringido'});
  expect(screen.queryByRole('link',{name:'Administración'})).toBeNull();expect(mock.admin).not.toHaveBeenCalled();
});
it('loads owner administration with organization, user and audit sections',async()=>{
  mock.access={...mock.access,role:'SUPER_ADMIN',member_id:undefined,organization_id:null,teams:[]};
  gate('/dashboard/admin');await screen.findByRole('heading',{name:'Resumen global'});
  expect(screen.getByRole('link',{name:'Auditoría de mensajes'})).toBeTruthy();
  expect(screen.getByRole('link',{name:'Roles y permisos'})).toBeTruthy();
});
it('activates only an invitation and updates the password before requesting membership',async()=>{
  mock.access={user_id:id(1),status:'awaiting_approval',invitations:[{id:id(6),delivery_status:'existing_account',role:'USUARIO'}]};
  const user=userEvent.setup();gate(`/activar-cuenta?invitacion=${id(6)}`);
  await screen.findByRole('heading',{name:'Activá tu cuenta'});
  await user.type(screen.getByLabelText('Tu nombre'),'Ana');
  await user.type(screen.getByLabelText('Contraseña',{exact:true}),'password123');
  await user.type(screen.getByLabelText('Confirmar contraseña'),'password123');
  await user.click(screen.getByRole('button',{name:'Activar acceso al equipo'}));
  await waitFor(()=>expect(mock.platform).toHaveBeenCalledWith({action:'invitation.activate',invitation_id:id(6),name:'Ana'}));
  expect(mock.auth.resetPassword).toHaveBeenCalledWith('password123');
  expect(mock.auth.resetPassword.mock.invocationCallOrder[0]).toBeLessThan(mock.platform.mock.invocationCallOrder.at(-1));
});
it('does not activate an invalid link or mismatched passwords',async()=>{
  mock.access={user_id:id(1),status:'awaiting_approval',invitations:[{id:id(6),delivery_status:'existing_account',role:'USUARIO'}]};
  const user=userEvent.setup();const view=gate('/activar-cuenta?invitacion=invalid');
  await screen.findByText(/El enlace no tiene una invitación válida/);expect(screen.queryByRole('button',{name:'Activar acceso al equipo'})).toBeNull();
  view.unmount();gate(`/activar-cuenta?invitacion=${id(6)}`);
  await user.type(await screen.findByLabelText('Tu nombre'),'Ana');await user.type(screen.getByLabelText('Contraseña',{exact:true}),'password123');await user.type(screen.getByLabelText('Confirmar contraseña'),'different123');await user.click(screen.getByRole('button',{name:'Activar acceso al equipo'}));
  await screen.findByText('Las contraseñas no coinciden.');expect(mock.auth.resetPassword).not.toHaveBeenCalled();
});
it('creates a self-assigned task without offering assignment to other members',async()=>{
  const user=userEvent.setup();scope(<Tasks/>);await user.click(screen.getByRole('button',{name:'Crear tarea'}));
  await user.selectOptions(screen.getByLabelText('Equipo'),id(4));await user.type(screen.getByLabelText('Título'),'Revisar portón');
  expect(screen.getByLabelText('Responsable').disabled).toBe(true);
  await user.click(screen.getByRole('button',{name:'Guardar tarea'}));
  await waitFor(()=>expect(mock.execute).toHaveBeenCalledWith(expect.objectContaining({action:'task.create',payload:expect.objectContaining({assignee_id:id(1),team_id:id(4),title:'Revisar portón'})})));
});
it('requires an explicit audit reason before retrieving message content',async()=>{
  mock.access={...mock.access,role:'SUPER_ADMIN'};const user=userEvent.setup();scope(<MemoryAudit/>,'/dashboard/admin/auditoria');
  const choice=await screen.findByRole('button',{name:/Ana ↔/});await user.click(choice);
  expect(mock.platform.mock.calls.some(([body])=>body.action==='audit.messages')).toBe(false);
  await user.type(screen.getByLabelText('Motivo de la consulta'),'Supervisión de incidente autorizada');
  await user.click(screen.getByRole('button',{name:'Consultar y registrar acceso'}));
  await screen.findByText('Contenido supervisado');
  expect(mock.platform).toHaveBeenCalledWith(expect.objectContaining({action:'audit.messages',reason:'Supervisión de incidente autorizada'}));
});
function MemoryAudit(){return <Routes><Route path="/dashboard/admin/*" element={<AdminPanel/>}/></Routes>;}

it('fails closed when verification is refused and removes a previously active view',async()=>{
  function Probe(){const access=useAccess();return <><p>{access.status}</p>{access.data?.status==='active'&&<p>Datos privados</p>}<button onClick={access.reload}>Verificar</button></>;}
  const user=userEvent.setup();render(<AccessProvider><Probe/></AccessProvider>);await screen.findByText('Datos privados');
  mock.platform.mockRejectedValue(new Error('Acceso retirado'));await user.click(screen.getByRole('button',{name:'Verificar'}));
  await screen.findByText('error');expect(screen.queryByText('Datos privados')).toBeNull();
});
it('rejects an active permission response without a recognized role',async()=>{
  mock.access={user_id:id(1),status:'active',role:'UNKNOWN',teams:[]};gate();
  await screen.findByRole('heading',{name:'No pudimos verificar tu acceso'});expect(screen.queryByRole('navigation',{name:'Navegación del equipo'})).toBeNull();
});
it('ignores a response belonging to an account that has already changed',async()=>{
  let resolve;mock.platform.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  function Probe(){const access=useAccess();return <p>{access.data?.name || access.status}</p>;}
  const view=render(<AccessProvider><Probe/></AccessProvider>);const previous=resolve;
  mock.auth={...mock.auth,user:{id:id(99),email:'other@example.com'},session:{access_token:'other'}};view.rerender(<AccessProvider><Probe/></AccessProvider>);
  await act(async()=>previous({...mock.access,name:'Cuenta anterior'}));expect(screen.queryByText('Cuenta anterior')).toBeNull();
  await act(async()=>resolve({user_id:id(99),status:'awaiting_approval',invitations:[]}));await screen.findByText('awaiting_approval');
});
it('clears old resource data immediately when a conversation or scope changes',async()=>{
  let next;const first=()=>Promise.resolve({text:'Conversación anterior'}),second=()=>new Promise(resolve=>{next=resolve;});
  function Probe({loader}){const resource=useResource(loader);return <p>{resource.data?.text || 'Cargando'}</p>;}
  const view=render(<Probe loader={first}/>);await screen.findByText('Conversación anterior');view.rerender(<Probe loader={second}/>);
  expect(screen.queryByText('Conversación anterior')).toBeNull();await act(async()=>next({text:'Nueva conversación'}));await screen.findByText('Nueva conversación');
});
it('opens local mode with Supabase configured without querying team permissions',async()=>{
  window.history.replaceState(null,'','/local');render(<App/>);
  await screen.findByRole('heading',{name:'Tu campo, conectado.'});
  expect(screen.getByText('Modo local · guardado en este dispositivo')).toBeTruthy();
  expect(mock.platform).not.toHaveBeenCalled();expect(mock.from).not.toHaveBeenCalled();
});
it('saves an offline team publication as a private draft without contacting the content backend',async()=>{
  const user=userEvent.setup();gate();await screen.findByRole('heading',{name:'Tu campo, conectado.'});
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  await act(async()=>{Object.defineProperty(navigator,'onLine',{value:false,configurable:true});window.dispatchEvent(new Event('offline'));});
  await user.click(within(screen.getByRole('navigation',{name:'Navegación móvil del equipo'})).getByRole('button',{name:'Nueva publicación',exact:true}));
  await user.type(screen.getByLabelText('Problema detectado'),'Molino guardado sin conexión');await user.type(screen.getByLabelText('Lote o ubicación'),'Lote Sur');
  await user.click(screen.getByRole('button',{name:'Guardar incidencia'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  await screen.findByText('Solo en este dispositivo · pendiente de publicar');expect(mock.execute).not.toHaveBeenCalled();
});
it('does not change a password when an invitation cannot be validated for this identity',async()=>{
  mock.access={user_id:id(1),status:'awaiting_approval',invitations:[]};gate(`/activar-cuenta?invitacion=${id(6)}`);
  await screen.findByText(/No pudimos verificar una invitación vigente/);
  expect(screen.queryByLabelText('Contraseña',{exact:true})).toBeNull();expect(mock.auth.resetPassword).not.toHaveBeenCalled();
});
