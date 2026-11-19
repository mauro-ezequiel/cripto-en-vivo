/* CRIPTO-LIVE · service worker: permite instalar la app, abrirla sin conexión y tocar los avisos */
const C='cl-v4';
const SHELL=['./','manifest.json','icon-192.png','icon-512.png','ia-core.js','herramientas/macro-lib.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(SHELL)).catch(()=>{}));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==C).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
/* noviembre 2026 · apertura instantánea: si hay una copia guardada, la página abre YA con ella.
   En paralelo baja la versión nueva. Arreglo (19/11): antes comparaba la "etiqueta" que pone GitHub, que cambia aunque la página
   sea la misma (y distintos servidores de GitHub pueden devolver versiones viejas y nuevas alternadas): el aviso volvía a salir
   cada pocos segundos. Ahora compara el CONTENIDO (una huella SHA-256) y solo avisa por una versión que nunca había visto;
   si un servidor devuelve una versión vieja ya vista, la ignora y no la guarda. */
const VISTOS='sw-vistos';
async function huella(r){const b=await r.clone().arrayBuffer();const h=await crypto.subtle.digest('SHA-256',b);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('');}
/* baja la página de la red; si es una versión NUEVA (nunca vista), la guarda y avisa a esa pestaña */
async function revisar(c,url,clientId){const old=await c.match(url,{ignoreSearch:true}),r=await fetch(url,{cache:'no-cache',credentials:'same-origin'});if(!r.ok)return r;
  const hn=await huella(r);let vis=[];try{const v=await c.match(VISTOS);if(v)vis=await v.json();}catch(x){}
  const ho=old?await huella(old):null;if(ho&&!vis.includes(ho))vis.push(ho);
  if(hn===ho||vis.includes(hn)){await c.put(VISTOS,new Response(JSON.stringify(vis.slice(-30))));return r;}  /* igual, o una vieja que ya vimos */
  vis.push(hn);await c.put(VISTOS,new Response(JSON.stringify(vis.slice(-30))));await c.put(url,r.clone());
  if(old&&clientId)setTimeout(async()=>{const cl=await self.clients.get(clientId);if(cl)cl.postMessage({type:'nueva'});},2500);
  return r;}
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);if(e.request.method!=='GET'||u.origin!==location.origin)return;
  if(e.request.mode==='navigate'){const url=u.origin+u.pathname;
    e.respondWith(caches.open(C).then(async c=>{const old=await c.match(url,{ignoreSearch:true});const net=revisar(c,url,e.resultingClientId||e.clientId);
      if(old){e.waitUntil(net.catch(()=>{}));return old;}return net.catch(()=>c.match('./'));}));return;}
  e.respondWith(caches.open(C).then(async c=>{const old=await c.match(e.request);
    const net=fetch(e.request).then(r=>{if(r.ok)c.put(e.request,r.clone());return r;});
    if(old){e.waitUntil(net.catch(()=>{}));return old;}return net;}));
});
/* la página pide revisar cada tanto (si quedó abierta mucho tiempo) */
self.addEventListener('message',e=>{if(e.data&&e.data.type==='revisar'&&e.source){const u=new URL(e.source.url);e.waitUntil(caches.open(C).then(c=>revisar(c,u.origin+u.pathname,e.source.id)).catch(()=>{}));}});
/* al tocar un aviso: abre la app en la moneda de la señal */
self.addEventListener('notificationclick',e=>{
  e.notification.close();const d=e.notification.data||{};
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    for(const c of cs){c.postMessage(Object.assign({type:'open'},d));return c.focus();}
    const q=d.sym?`?sym=${d.sym}&tf=${d.tf||''}&m=${d.m||''}`:'';return self.clients.openWindow('./'+q);
  }));
});
