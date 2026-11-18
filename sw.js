/* CRIPTO-LIVE · service worker: permite instalar la app, abrirla sin conexión y tocar los avisos */
const C='cl-v3';
const SHELL=['./','manifest.json','icon-192.png','icon-512.png','ia-core.js','herramientas/macro-lib.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)).catch(()=>{}));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
/* noviembre 2026 · apertura instantánea: si hay una copia guardada, la página abre YA con ella (antes esperaba hasta 2,5 s a la red).
   En paralelo baja la versión nueva y la guarda; si cambió, le avisa a la página para ofrecer recargar.
   Sin copia guardada (primera vez), va a la red como siempre. */
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(caches.open(C).then(async c=>{
    const old=await c.match(e.request,{ignoreSearch:true});
    const net=fetch(e.request).then(async r=>{if(r.ok){const cp=r.clone();
        if(old&&e.request.mode==='navigate'){const a=old.headers.get('etag')||old.headers.get('last-modified'),b=r.headers.get('etag')||r.headers.get('last-modified');
          if(a&&b&&a!==b){const id=e.resultingClientId||e.clientId;setTimeout(async()=>{const cl=id&&await self.clients.get(id);if(cl)cl.postMessage({type:'nueva'});},4000);}}
        await c.put(e.request,cp);}return r;});
    if(old){e.waitUntil(net.catch(()=>{}));return old;}
    return net.catch(()=>c.match('./'));}));
});
/* al tocar un aviso: abre la app en la moneda de la señal */
self.addEventListener('notificationclick',e=>{
  e.notification.close();const d=e.notification.data||{};
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){c.postMessage(Object.assign({type:'open'},d));return c.focus();}
    const q=d.sym?`?sym=${d.sym}&tf=${d.tf||''}&m=${d.m||''}`:'';return self.clients.openWindow('./'+q);
  }));
});
