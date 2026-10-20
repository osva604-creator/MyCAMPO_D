// Run against the production preview with Playwright installed, or point
// PLAYWRIGHT_MODULE at an external installation. All backend traffic is mocked.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const base = process.env.QA_URL || 'http://127.0.0.1:4173';
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
(async()=>{
 require('node:fs').mkdirSync('.qa',{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM} : {}),args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 try {
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,permissions:['camera','geolocation'],geolocation:{latitude:-34.6,longitude:-60.9}});
 let offline=false, commands=[], uploads=[];const errors=[];
 const uploadedFiles=new Map();
 const failUpload = process.env.FAIL_UPLOAD_ONCE === '1';
 const user={id:id(1),email:'offline-test@example.invalid',email_confirmed_at:new Date().toISOString(),app_metadata:{provider:'email'},user_metadata:{},aud:'authenticated',role:'authenticated'};
 const access={user_id:user.id,status:'active',member_id:id(2),organization_id:id(3),name:'Prueba offline',role:'GERENTE',teams:[{id:id(4),name:'Equipo prueba'}]};
 const fixtures={organizations:[{id:id(3),name:'Campo de prueba',active:true}],teams:[{id:id(4),organization_id:id(3),name:'Equipo prueba',active:true}],organization_members:[{id:id(2),user_id:user.id,organization_id:id(3),name:'Prueba offline',role:'GERENTE',ended_at:null}],team_members:[],team_supervisors:[],work_teams:[],posts:[],post_comments:[],post_reactions:[],post_mentions:[],tasks:[],attachments:[]};
 const sample=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5ioAAAAASUVORK5CYII=','base64');
 fixtures.posts=[{id:id(30),organization_id:id(3),team_id:id(4),author_id:user.id,body:'Referencia descargada',created_at:new Date().toISOString(),status:'Pendiente',category:'Otra',latitude:null,longitude:null,location:'Lote 1'}];
 fixtures.attachments=[{id:id(31),organization_id:id(3),post_id:id(30),object_path:'test/reference.png',mime_type:'image/png',size_bytes:sample.length,ready:true}];
 await context.route('**/*.supabase.co/**',async route=>{
  if(offline)return route.abort('internetdisconnected');
  const req=route.request(),url=new URL(req.url());let body={};
  if(url.pathname.startsWith('/storage/v1/object/')) {
   const file=uploadedFiles.get(url.pathname.split('/').pop());
   return route.fulfill({status:200,contentType:file?'image/jpeg':'image/png',headers:{'Access-Control-Allow-Origin':'*'},body:file || sample});
  }
  if(url.pathname.endsWith('/campo-platform')){
   const input=req.postDataJSON();
   if(input.action==='access.context')body={data:access};
   else if(input.action==='messages.inbox')body={data:{conversations:[],unread_total:0}};
   else if(input.action==='content.command'){
    commands.push(input);const p=input.payload;
    if(!fixtures.posts.some(post=>post.id===input.operation_id)){
     fixtures.posts.unshift({id:input.operation_id,organization_id:p.organization_id,team_id:p.team_id,author_id:user.id,body:p.body,
      created_at:new Date().toISOString(),captured_at:p.captured_at,status:'Pendiente',category:p.category,location:p.location,
      latitude:p.latitude,longitude:p.longitude,gps_accuracy:p.gps_accuracy,gps_source:p.gps_source});
     fixtures.attachments.push({...p.attachment,organization_id:p.organization_id,post_id:input.operation_id,object_path:`test/${p.attachment.id}`,ready:false});
    }
    body={data:{id:input.operation_id,post_id:input.operation_id}};
   }
   else throw new Error('Unexpected action '+input.action);
  } else if(url.pathname.endsWith('/campo-attachment')){
   uploads.push(req.postDataBuffer().length);
   if(failUpload && uploads.length===1)return route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({error:'simulated_upload_interruption'})});
   const attachment=req.headers()['x-attachment-id'];uploadedFiles.set(attachment,req.postDataBuffer());
   fixtures.attachments.find(file=>file.id===attachment).ready=true;
   body={data:{uploaded:true}};
  }
  else if(url.pathname.startsWith('/rest/v1/'))body=fixtures[url.pathname.split('/').pop()]||[];
  else if(url.pathname==='/auth/v1/user')body=user;
  else throw new Error('Unexpected URL '+url.pathname);
  await route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify(body)});
 });
 await context.routeWebSocket('**',socket=>socket.close());
 const token=[{alg:'HS256',typ:'JWT'},{sub:user.id,exp:Math.floor(Date.now()/1000)+86400,role:'authenticated',session_id:id(5)}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.')+'.fake';
 await context.addInitScript(({token,user})=>{
  if(!localStorage.getItem('qa-seeded')){localStorage.setItem('qa-seeded','yes');localStorage.setItem('sb-kocbcvqhzwpjhewrongf-auth-token',JSON.stringify({access_token:token,refresh_token:'fake-refresh',expires_at:Math.floor(Date.now()/1000)+86400,token_type:'bearer',user}));}
 },{token,user});
 let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/dashboard`);
 await page.getByRole('heading',{name:'Tu campo, conectado.'}).waitFor();
 await page.getByAltText('Referencia descargada').waitFor();
 await page.evaluate(()=>navigator.serviceWorker.ready);
 await page.reload();await page.getByRole('heading',{name:'Tu campo, conectado.'}).waitFor();
 await page.waitForFunction(()=>localStorage.getItem('mycampo-d:last-verified-user'));
 offline=true;await context.setOffline(true);await page.close();
 page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/dashboard`);
 await page.getByRole('heading',{name:'Tu campo, conectado.'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('img[alt="Referencia descargada"]')?.naturalWidth>0);
 await page.getByRole('navigation',{name:'Navegación móvil del equipo'}).getByRole('button',{name:'Nueva publicación',exact:true}).click();
 let dialog=page.getByRole('dialog');await dialog.getByLabel('Problema detectado').fill('Evidencia sin conexión');
 await dialog.getByRole('button',{name:'Cámara',exact:true}).click();
 await dialog.getByRole('button',{name:'Tomar foto',exact:true}).waitFor();
 await page.waitForFunction(()=>!document.querySelector('.camera-shutter').disabled);
 const photoFix={latitude:-34.7101,longitude:-60.9202,accuracy:9};
 await context.setGeolocation(photoFix);
 const box=await dialog.boundingBox();assert.equal(box.width,390);assert.equal(box.height,844);
 await page.screenshot({path:'.qa/camera-mobile.png'});
 await dialog.getByRole('button',{name:'Tomar foto',exact:true}).click();
 await dialog.getByAltText('Vista previa de la incidencia').waitFor();
 await dialog.getByText(/Ubicación capturada con la foto/).waitFor();
 assert.equal(await dialog.getByLabel('Latitud',{exact:true}).inputValue(),String(photoFix.latitude));
 assert.equal(await dialog.getByLabel('Longitud',{exact:true}).inputValue(),String(photoFix.longitude));
 await dialog.getByLabel('Lote o ubicación').fill('Lote 7');
 await dialog.getByText('Borrador guardado en este dispositivo',{exact:true}).waitFor();
 await page.screenshot({path:'.qa/captured-mobile.png'});
 await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
 await page.reload();await page.getByRole('heading',{name:'Tu campo, conectado.'}).waitFor();
 await page.getByRole('navigation',{name:'Navegación móvil del equipo'}).getByRole('button',{name:'Nueva publicación',exact:true}).click();
 dialog=page.getByRole('dialog');await dialog.getByText('Borrador recuperado y guardado en este dispositivo').waitFor();
 assert.equal(await dialog.getByLabel('Problema detectado').inputValue(),'Evidencia sin conexión');
 const photo=await dialog.getByAltText('Vista previa de la incidencia').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight}));assert(photo.width>0);
 await dialog.getByRole('button',{name:'Guardar incidencia'}).click();await dialog.waitFor({state:'detached'});
 await page.getByText('Solo en este dispositivo · pendiente de publicar').waitFor();
 assert.equal(commands.length,0);
 const inspect=()=>page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('mycampo-d-team-v2');r.onsuccess=()=>{const d=r.result,t=d.transaction('drafts');const q=t.objectStore('drafts').getAll();q.onsuccess=()=>resolve(q.result.map(x=>({id:x.id,blob:x.operation.media instanceof Blob,bytes:x.operation.media?.size})));q.onerror=reject;};r.onerror=reject;}));
 const pending=await inspect();assert.equal(pending.length,1);assert(pending[0].blob);assert(pending[0].bytes>0);
 await page.getByRole('navigation',{name:'Navegación móvil del equipo'}).getByRole('link',{name:'Mi cuenta',exact:true}).click();
 assert.equal(await page.getByRole('link',{name:'Abrir recorridos en Mapa',exact:true}).getAttribute('href'),'/dashboard/mapa');
 assert.equal(await page.getByRole('button',{name:'Activar GPS en segundo plano',exact:true}).isDisabled(),true);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar borradores',exact:true}).click();
 const download=await downloadPromise;await download.saveAs('.qa/drafts-export.json');
 const exported=JSON.parse(require('node:fs').readFileSync('.qa/drafts-export.json','utf8'));
 assert.equal(Buffer.from(exported[0].operation.media.split(',')[1],'base64').length,pending[0].bytes);
 await page.getByRole('navigation',{name:'Navegación móvil del equipo'}).getByRole('link',{name:'Inicio',exact:true}).click();
 offline=false;await context.setOffline(false);
 if(failUpload){
  for(let attempt=0;attempt<100 && uploads.length===0;attempt++)await page.waitForTimeout(100);
  assert.equal((await inspect()).length,1,'Interrupted upload must retain its photo in the queue');
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('button',{name:'Sincronizar ahora',exact:true}).click();
 }
  for(let attempt=0;attempt<100 && (await inspect()).length;attempt++)await page.waitForTimeout(100);
  assert.equal(commands.length,failUpload?2:1);assert.equal(uploads.length,failUpload?2:1);assert.equal(uploads[0],pending[0].bytes);
  assert.equal(new Set(commands.map(c=>c.operation_id)).size,1,'Retry must reuse the same operation');
  assert.equal(new Set(commands.map(c=>c.payload.attachment.id)).size,1,'Retry must reuse the same attachment');
  assert(uploads.every(bytes=>bytes===pending[0].bytes));
  assert.equal(commands[0].payload.latitude,photoFix.latitude);assert.equal(commands[0].payload.longitude,photoFix.longitude);
  assert.equal(commands[0].payload.gps_accuracy,photoFix.accuracy);assert.equal(commands[0].payload.gps_source,'device');
  assert.equal(fixtures.posts.filter(post=>post.id===pending[0].id).length,1);
  await page.getByAltText('Evidencia sin conexión').waitFor();
  await page.waitForFunction(()=>document.querySelector('img[alt="Evidencia sin conexión"]')?.naturalWidth>0);
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'Sincronizar ahora',exact:true}).click();
 await page.screenshot({path:'.qa/desktop-sync.png'});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);
 assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,coldOfflineReopen:true,offlineDownload:true,binaryExport:true,shutterCoordinates:true,feedRefreshed:true,interruptedUploadRetried:failUpload,restoredPhoto:photo,queuedBinaryBytes:pending[0].bytes,serverCommands:commands.length,photoUploads:uploads.length,desktopSync:true,errors}));
 await context.close();
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
