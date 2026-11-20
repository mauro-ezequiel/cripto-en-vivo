/* SONDA: ¿el aviso "Hay una actualización" se repite en la página publicada? Abre la página real como un teléfono,
   la deja abierta 8 minutos, recarga cada tanto, toca el aviso cuando aparece y anota todo (caché, huellas, cabeceras). */
const { execSync } = require('child_process'); execSync('npm i --no-save --no-package-lock playwright-core@1.47.2', { stdio: 'ignore' });
const { chromium } = require('playwright-core'); const fs = require('fs'); const L = []; const log = (...a) => { const s = new Date().toISOString().slice(11, 19) + ' ' + a.join(' '); L.push(s); console.log(s); };
(async () => { const b = await chromium.launch({ channel: 'chrome' }); const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage();
  const URL = 'https://mauro-ezequiel.github.io/cripto-en-vivo/';
  p.on('console', m => { const t = m.text(); if (/SWDBG|updBtn|nueva/.test(t)) log('consola', t.slice(0, 200)); });
  ctx.on('serviceworker', w => log('service worker', w.url()));
  const W = ms => p.waitForTimeout(ms), av = async () => { try { return await p.evaluate(() => !!document.getElementById('updBtn')); } catch (e) { return 'nav'; } };
  const est = async () => { try { return await p.evaluate(async () => { const k = await caches.keys(); let vis = null; for (const n of k) { const c = await caches.open(n), v = await c.match('sw-vistos'); if (v) vis = (await v.json()).map(x => x.slice(0, 8)); }
      const ctl = navigator.serviceWorker.controller; return JSON.stringify({ caches: k, vistos: vis, ctl: ctl && ctl.scriptURL, nuevo: typeof appVerCheck === 'function' && String(appVerCheck).includes('revisar'), largo: document.documentElement.outerHTML.length }); }); } catch (e) { return 'error ' + e.message; } };
  for (let k = 0; k < 3; k++) { const r = await fetch(URL, { headers: { 'Cache-Control': 'no-cache' } }); const t = await r.text(); log('cabeceras', r.headers.get('etag'), r.headers.get('last-modified'), r.headers.get('age'), r.headers.get('x-served-by'), 'largo', t.length, require('crypto').createHash('sha256').update(t).digest('hex').slice(0, 8)); }
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await W(8000); log('1ª carga', await est(), 'aviso', await av());
  await p.reload(); await W(8000); log('recarga', await est(), 'aviso', await av());
  let n = 0; for (let t = 0; t < 80; t++) { await W(6000); const a = await av(); if (a === true) { n++; log('AVISO #' + n, await est()); try { await p.click('#updBtn', { timeout: 3000 }); } catch (e) {} await W(4000); log('  después de tocar', await est(), 'aviso', await av()); }
    if (t === 30 || t === 60) { await p.reload(); await W(5000); log('recarga', await est(), 'aviso', await av()); } }
  log('avisos totales', n); fs.writeFileSync('sonda-actualizacion.json', JSON.stringify(L, null, 1)); await b.close(); })();
