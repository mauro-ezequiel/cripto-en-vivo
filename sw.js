/* CRIPTO-LIVE · service worker: permite instalar la app, abrirla sin conexión y tocar los avisos */
const C='cl-v5';
const SHELL=['./','manifest.json','icon-192.png','icon-512.png','ia-core.js','herramientas/macro-lib.js','nombres-acciones.json'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>Promise.all(SHELL.map(u=>fetch(u,{cache:'reload'}).then(r=>r.ok&&c.put(u,r)).catch(()=>{})))));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
/* 20/11/2026 · aviso de actualización, versión 3 (la anterior se trababa):
   - la PÁGINA se pide primero a internet (hasta 3 s; si no hay, la copia guardada). Así al abrir o recargar siempre llega la última
     y no puede quedar "pegada" una versión vieja, que era lo que hacía volver el aviso una y otra vez.
   - se anota qué versión (huella del contenido) recibió cada pestaña. Cuando la pestaña pregunta, se compara con la de internet:
     solo hay "nueva" si es distinta Y nunca vista (GitHub a veces devuelve una copia vieja desde otro servidor: esa no cuenta). */
const VISTOS='sw-vistos',SERV='sw-servidas';
async function huella(r){const b=await r.clone().arrayBuffer();const h=await crypto.subtle.digest('SHA-256',b);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);}
async function leer(c,k){try{const v=await c.match(k);return v?await v.json():null;}catch(e){return null;}}
const guardar=(c,k,v)=>c.put(k,new Response(JSON.stringify(v)));
async function anotar(c,clientId,h){const vis=(await leer(c,VISTOS))||[];if(!vis.includes(h)){vis.push(h);await guardar(c,VISTOS,vis.slice(-40));}
  if(clientId){const sv=(await leer(c,SERV))||{};sv[clientId]=h;const ks=Object.keys(sv);if(ks.length>30)for(const k of ks.slice(0,ks.length-30))delete sv[k];await guardar(c,SERV,sv);}}
const red=(url,ms)=>Promise.race([fetch(url,{cache:'no-cache',credentials:'same-origin'}),new Promise((_,no)=>setTimeout(()=>no(new Error('lenta')),ms))]);
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
  if(e.request.mode==='navigate'){const url=u.origin+u.pathname,cid=e.resultingClientId||e.clientId;
    e.respondWith(caches.open(C).then(async c=>{
      try{const r=await red(url,3000);if(r.ok){const h=await huella(r);await c.put(url,r.clone());e.waitUntil(anotar(c,cid,h));}return r;}
      catch(x){const old=await c.match(url,{ignoreSearch:true})||await c.match('./');if(old){e.waitUntil(huella(old).then(h=>anotar(c,cid,h)));return old;}return fetch(e.request);}}));return;}
  /* el resto (íconos, ia-core.js…): copia guardada al instante y se renueva por detrás */
  e.respondWith(caches.open(C).then(async c=>{const old=await c.match(e.request);
    const net=fetch(e.request).then(r=>{if(r.ok)c.put(e.request,r.clone());return r;});
    if(old){e.waitUntil(net.catch(()=>{}));return old;}return net;}));
});
/* la pestaña pregunta "¿hay versión nueva?" */
self.addEventListener('message',e=>{if(!(e.data&&e.data.type==='revisar'&&e.source))return;const cl=e.source;
  e.waitUntil(caches.open(C).then(async c=>{const u=new URL(cl.url),url=u.origin+u.pathname;const sv=(await leer(c,SERV))||{},mia=sv[cl.id];if(!mia)return;
    const r=await fetch(url,{cache:'no-cache',credentials:'same-origin'});if(!r.ok)return;const h=await huella(r);if(h===mia)return;
    const vis=(await leer(c,VISTOS))||[];if(vis.includes(h))return;   /* una copia vieja que ya vimos */
    vis.push(h);await guardar(c,VISTOS,vis.slice(-40));await c.put(url,r.clone());cl.postMessage({type:'nueva'});}).catch(()=>{}));});
/* al tocar un aviso: abre la app en la moneda de la señal */
self.addEventListener('notificationclick',e=>{
  e.notification.close();const d=e.notification.data||{};
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){c.postMessage(Object.assign({type:'open'},d));return c.focus();}
    const q=d.sym?`?sym=${d.sym}&tf=${d.tf||''}&m=${d.m||''}`:'';return self.clients.openWindow('./'+q);
  }));
});
