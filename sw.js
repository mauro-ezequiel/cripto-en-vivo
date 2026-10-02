/* CRIPTO-LIVE · service worker: permite instalar la app, abrirla sin conexión y tocar los avisos */
const C='cl-v1';
const SHELL=['./','manifest.json','icon-192.png','icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)).catch(()=>{}));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
/* primero la red (así siempre llega la última versión); si no hay conexión, la copia guardada */
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp));}return r;})
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('./'))));
});
/* al tocar un aviso: abre la app en la moneda de la señal */
self.addEventListener('notificationclick',e=>{
  e.notification.close();const d=e.notification.data||{};
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){c.postMessage(Object.assign({type:'open'},d));return c.focus();}
    const q=d.sym?`?sym=${d.sym}&tf=${d.tf||''}&m=${d.m||''}`:'';return self.clients.openWindow('./'+q);
  }));
});
