/* CAPTURAS (octubre 2026): abre la página publicada con datos reales en un Chrome sin pantalla, tamaño celular, y saca capturas del gráfico
   en cada modo y temporalidad con todos los indicadores prendidos. Anota los errores de la página. No cambia nada. Escribe capturas/*.png y errores.json */
const fs = require('fs'), { chromium } = require('playwright-core');
(async () => { fs.mkdirSync('capturas', { recursive: true });
  const br = await chromium.launch({ channel: 'chrome' }), pg = await br.newPage({ viewport: { width: 412, height: 1500 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  /* Binance no atiende a servidores de EE.UU. (GitHub): los mismos datos públicos se piden por su espejo data-api.binance.vision */
  await pg.route(/https:\/\/api\.binance\.com\/api\/v3\/.*/, r => r.continue({ url: r.request().url().replace('https://api.binance.com', 'https://data-api.binance.vision') }));
  await pg.route(/wss?:\/\/.*binance.*/, r => r.abort());
  const errs = []; pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)); });
  await pg.goto((process.env.PAGE || 'https://mauro-ezequiel.github.io/cripto-en-vivo/') + '?bot=estudio&t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  const REQ = []; pg.on('request', r => { const u = r.url(); let k = u.replace(/\?.*$/, '').slice(0, 90); if (/klines|depth|premiumIndex/.test(u)) { const q = new URL(u).searchParams; k += ' ' + (q.get('symbol') || '*') + ' ' + (q.get('interval') || '') + ' ' + (q.get('limit') || ''); } REQ.push([Date.now(), k]); });
  /* rapidez: cuánto tarda en verse la lista y el gráfico (primera visita y segunda, con lo guardado) */
  const hitos = async () => pg.evaluate(async () => { const t0 = performance.timing.navigationStart, H = {}; for (let k = 0; k < 120 && !(H.lista && H.grafico); k++) { if (!H.lista && document.querySelectorAll('#list .row').length) H.lista = Date.now() - t0; if (!H.grafico && typeof candles !== 'undefined' && candles.length) H.grafico = Date.now() - t0; await new Promise(z => setTimeout(z, 100)); }
    H.dom = performance.timing.domContentLoadedEventEnd - t0; return H; });
  try { const h1 = await hitos(); await pg.waitForTimeout(25000); await pg.reload({ waitUntil: 'domcontentloaded' }); const h2 = await hitos(); await pg.waitForTimeout(6000);
    const fb = await pg.evaluate(() => !!window.firebase); globalThis.HITOS = { primera: h1, segunda: h2, firebase_cargado: fb }; } catch (e) { globalThis.HITOS = { error: e.message.slice(0, 150) }; }
  await pg.waitForTimeout(15000);
  /* rendimiento: memoria, tiempo de JavaScript y pedidos de red en 60 s sin tocar nada */
  try { const cdp = await pg.context().newCDPSession(pg); await cdp.send('Performance.enable'); const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value])); const r0 = REQ.length, t0 = Date.now();
    await pg.waitForTimeout(60000); const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(x => [x.name, x.value]));
    const urls = {}; for (const [t, u] of REQ.slice(r0)) urls[u] = (urls[u] || 0) + 1;
    const lt = await pg.evaluate(() => ({ nodos: document.getElementsByTagName('*').length, html_kb: Math.round(document.documentElement.outerHTML.length / 1024), ls_kb: Math.round(JSON.stringify(localStorage).length / 1024), carga_ms: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd) }));
    globalThis.PERF = ({ rendimiento: { heap_mb: +(m1.JSHeapUsedSize / 1e6).toFixed(1), js_s_por_min: +(m1.ScriptDuration - m0.ScriptDuration).toFixed(2), tareas_s_por_min: +(m1.TaskDuration - m0.TaskDuration).toFixed(2), layouts: m1.LayoutCount - m0.LayoutCount, pedidos_por_min: REQ.length - r0, top: Object.entries(urls).sort((a, b) => b[1] - a[1]).slice(0, 40), ...lt } }); } catch (e) { globalThis.PERF = { rendimiento_error: e.message }; }
  const L = [['medio', '4h', 'BTCUSDT'], ['medio', '1h', 'ETHUSDT'], ['medio', '1d', 'SOLUSDT'], ['tx', '4h', 'XRPUSDT'], ['x', '15m', 'BTCUSDT'], ['x', '5m', 'SOLUSDT'], ['a', '1d', null]];
  const info = []; if (globalThis.HITOS) info.push({ rapidez: globalThis.HITOS }); if (globalThis.PERF) info.push(globalThis.PERF);
  for (const [m, t, s] of L) { try {
      const r = await pg.evaluate(async ([m, t, s]) => { if (mode !== m) applyMode(m); await new Promise(z => setTimeout(z, 3000)); if (s && symbol !== s) { select(s); await new Promise(z => setTimeout(z, 4000)); }
        if (tf !== t && TF_MODE[mode].includes(t)) { tf = t; renderTfs(); await loadChart(); await new Promise(z => setTimeout(z, 3000)); }
        for (const k of MODES[mode].inds) active.add(k); try { calcInd(true); } catch (e) {} try { renderChips(); layout(); ovReq(); } catch (e) {} await new Promise(z => setTimeout(z, 3000));
        const ov = document.getElementById('overlay'), ch = document.getElementById('chart'), rr = chart.timeScale().getVisibleLogicalRange();
        return { m, t, sym: symbol, velas: candles.length, rango: rr ? [Math.round(rr.from), Math.round(rr.to)] : null, chartH: ch.clientHeight, chartW: ch.clientWidth, overlayH: ov && ov.height, overlayCssH: ov && ov.clientHeight, ind: [...active] }; }, [m, t, s]);
      info.push(r); const el = await pg.$('#chartWrap') || await pg.$('#chart'); await el.screenshot({ path: `capturas/${m}-${t}.png` }); } catch (e) { info.push({ m, t, error: e.message }); } }
  /* arrastrar la línea entre el gráfico principal y el primer panel, y entre el primer y el segundo panel */
  try { await pg.evaluate(async () => { if (mode !== 'medio') applyMode('medio'); await new Promise(z => setTimeout(z, 2500)); if (typeof setView === 'function') setView('main'); window.scrollTo(0, 0); });
    const g0 = await pg.evaluate(() => { const r = $('chart').getBoundingClientRect(), ph = r.height - chart.timeScale().height(), G = paneG(); return { x: r.left + r.width / 3, ys: G.top.map(t => r.top + ph * t), os: G.os, h: G.h, ph }; });
    const drag = async (y, dy) => { await pg.mouse.move(g0.x, y); await pg.mouse.down(); for (let k = 1; k <= 5; k++) await pg.mouse.move(g0.x, y + dy * k / 5); await pg.mouse.up(); await pg.waitForTimeout(400); };
    if (g0.ys.length >= 2) { await drag(g0.ys[0], -120); const g1 = await pg.evaluate(() => paneG()); const y1 = await pg.evaluate(() => { const r = $('chart').getBoundingClientRect(), ph = r.height - chart.timeScale().height(); return r.top + ph * paneG().top[1]; }); await drag(y1, 80);
      const g2 = await pg.evaluate(() => ({ G: paneG(), psz: PSZ, rango: chart.timeScale().getVisibleLogicalRange() }));
      info.push({ paneles: { antes: g0, tras_main: g1, final: g2 } }); try { await pg.locator('#chartWrap').screenshot({ path: 'capturas/paneles.png', timeout: 8000 }); } catch (e) {} } else info.push({ paneles: 'menos de 2 paneles', g0 }); } catch (e) { info.push({ paneles_error: e.message.slice(0, 200) }); }
  /* huellas (SRI) de los scripts externos, para que el navegador rechace un archivo cambiado */
  try { const sri = await pg.evaluate(async () => { const out = {}; for (const sc of document.querySelectorAll('script[src^="https://"]')) { try { const b = await (await fetch(sc.src, { cache: 'no-store' })).arrayBuffer(); const h = await crypto.subtle.digest('SHA-384', b);
          out[sc.src] = 'sha384-' + btoa(String.fromCharCode(...new Uint8Array(h))); } catch (e) { out[sc.src] = 'error ' + e.message; } } return out; }); info.push({ sri }); } catch (e) { info.push({ sri_error: e.message }); }
  /* historial completo en velas diarias y escala de tiempo alejada */
  try { const r = await pg.evaluate(async () => { if (mode !== 'medio') applyMode('medio'); await new Promise(z => setTimeout(z, 1500)); if (symbol !== 'BTCUSDT') select('BTCUSDT'); await new Promise(z => setTimeout(z, 1500)); tf = '1d'; renderTfs(); await loadChart(); await new Promise(z => setTimeout(z, 12000));
      chart.timeScale().fitContent(); await new Promise(z => setTimeout(z, 800)); return { velas: candles.length, desde: new Date((candles[0].time - TZ) * 1000).toISOString().slice(0, 10), noMore }; }); info.push({ historia: r });
    try { await pg.locator('#chartWrap').screenshot({ path: 'capturas/historia-1d.png', timeout: 8000 }); } catch (e) {} } catch (e) { info.push({ historia_error: e.message.slice(0, 200) }); }
  /* RSI de la planilla en las tarjetas de señales */
  try { const r = await pg.evaluate(async () => { if (mode !== 'medio') applyMode('medio'); await new Promise(z => setTimeout(z, 1000)); sigRsiHTML('ETHUSDT', 'medio'); await new Promise(z => setTimeout(z, 4000));
      try { const c = tickers.ETHUSDT.c; SIG.medio = [{ sym: 'ETHUSDT', m: 'medio', tf: '4h', dir: 1, entry: c, zl: c * .998, zh: c * 1.002, tp0: c * 1.02, tp1: c * 1.04, tp2: c * 1.06, sl: c * .97, conf: 80, setup: 't-pb', state: 'live', t: Date.now(), op: 'x-test', reasons: ['prueba'] }]; if (typeof setView === 'function') setView('sig'); renderSignals(); await new Promise(z => setTimeout(z, 500)); } catch (e) {}
      return { eth: sigRsiHTML('ETHUSDT', 'medio').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '), tarjetas: document.querySelectorAll('#sigList .sig').length, con_rsi: document.querySelectorAll('#sigList .sg-rsi .rsx').length }; }); info.push({ sigrsi: r }); try { await pg.locator('#sigList .sig').first().screenshot({ path: 'capturas/senal-rsi.png', timeout: 8000 }); } catch (e) {} await pg.evaluate(() => { SIG.medio = []; renderSignals(); if (typeof setView === 'function') setView('main'); }); } catch (e) { info.push({ sigrsi_error: e.message.slice(0, 200) }); }
  /* RSI al entrar en el detalle de una operación de Resultados */
  try { const r = await pg.evaluate(async () => { const o = { id: 'hxtest', m: 'medio', sym: 'ETHUSDT', dir: -1, t: Date.now() - 3 * 864e5, state: 'open' }; hxRsiHTML(o); await new Promise(z => setTimeout(z, 4000)); return hxRsiHTML(o).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); }); info.push({ hxrsi: r }); } catch (e) { info.push({ hxrsi_error: e.message.slice(0, 200) }); }
  /* RSI de inicio y de ahora en las filas de Resultados */
  try { const r = await pg.evaluate(async () => { if (mode !== 'medio') applyMode('medio'); HSRC = 'live'; if (typeof setView === 'function') setView('sig'); renderRes(true); await new Promise(z => setTimeout(z, 9000)); renderRes(true); await new Promise(z => setTimeout(z, 500));
      const rows = [...document.querySelectorAll('#histList .hrsi')].slice(0, 6).map(x => x.textContent.replace(/\s+/g, ' ')); const all = [...document.querySelectorAll('#histList .hrsi')].map(x => x.textContent.replace(/\s+/g, ' ')); return { filas: all.length, ej: rows, con_final: all.filter(x => /final/.test(x)).slice(0, 8), final_pend: all.filter(x => /final …/.test(x)).length, ini_pend: all.filter(x => /ini …/.test(x)).length }; }); info.push({ rowrsi: r });
    try { await pg.locator('#histList').screenshot({ path: 'capturas/resultados-rsi.png', timeout: 8000 }); } catch (e) {} } catch (e) { info.push({ rowrsi_error: e.message.slice(0, 200) }); }
  /* planilla de RSI de cripto y miedo y codicia */
  try { const r = await pg.evaluate(async () => { if (mode !== 'medio') applyMode('medio'); if (typeof setView === 'function') setView('main'); await new Promise(z => setTimeout(z, 1500)); $('rsiCx').scrollIntoView(); await new Promise(z => setTimeout(z, 500)); RSICX.d = {}; await rsiCxLoad(); const t0 = Date.now(); for (let k = 0; k < 120 && !(RSICX.d[RSICX.tf] && Object.keys(RSICX.d[RSICX.tf].v).length > 40); k++) { await new Promise(z => setTimeout(z, 500)); await rsiCxLoad(); } rsiCxRender(); await fngLoad(); RSICX.fngT = 0; await fngLoad(); rsiCxRender();
      rsiAlPaint(); return { ms: Date.now() - t0, err: RSICX.err, nerr: RSICX.nerr, n: Object.keys((RSICX.d[RSICX.tf] || { v: {} }).v).length, tf: RSICX.tf, busy: RSICX.busy, tick: Object.keys(tickers).length, aviso: document.querySelector('[data-rsial="c"]').textContent, visible: !$('rsiCx').hidden, celdas: document.querySelectorAll('#rsiCxBody td:nth-child(2)').length, fng: $('fngBox').textContent }; }); info.push({ rsicx: r });
    try { await pg.locator('#rsiCx').screenshot({ path: 'capturas/rsi-cripto.png', timeout: 8000 }); } catch (e) {} } catch (e) { info.push({ rsicx_error: e.message.slice(0, 200) }); }
  /* ACCIONES v7: simulación del último año de la página con la regla c-rsi */
  try { const r = await pg.evaluate(async () => { if (mode !== 'a') applyMode('a'); for (let k = 0; k < 40 && !stkReady; k++) await new Promise(z => setTimeout(z, 500)); for (let k = 0; k < 400 && histABusy; k++) await new Promise(z => setTimeout(z, 1000)); HIST_A = null; await histStocks(); for (let k = 0; k < 400 && histABusy; k++) await new Promise(z => setTimeout(z, 1000));
      const L = HIST_A || [], by = {}; for (const o of L) { const k = o.setup; by[k] = by[k] || { n: 0, g: 0, pnl: 0 }; if (o.state !== 'open') { by[k].n++; if (o.pnl > 0) by[k].g++; by[k].pnl += o.pnl; } }
      for (const k in by) { by[k].pnl = Math.round(by[k].pnl); by[k].gana = by[k].n ? Math.round(100 * by[k].g / by[k].n) : 0; } return by; }); info.push({ acciones_v7: r }); } catch (e) { info.push({ acciones_v7_error: e.message.slice(0, 200) }); }
  /* planilla de RSI de cripto en 8 h, 12 h y 1 mes */
  try { for (const tf of ['1h', '8h', '1M']) { const r = await pg.evaluate(async tf => { applyMode('medio'); RSICX.tf = tf; document.getElementById('rsiCx').scrollIntoView(); for (let k = 0; k < 30 && !(RSICX.d[tf] && RSICX.d[tf].t && Object.keys(RSICX.d[tf].v).length); k++) { await rsiCxLoad(); await new Promise(z => setTimeout(z, 500)); } rsiCxRender();
        const v = [...document.querySelectorAll('#rsiCxBody td:nth-child(2)')].map(x => x.textContent); return { tf, celdas: v.length, vacias: v.filter(x => x === '—').length, ej: v.slice(0, 5), botones: [...document.querySelectorAll('[data-rsicx]')].map(b => b.textContent).join('|') }; }, tf); info.push({ rsicx_tf: r }); } } catch (e) { info.push({ rsicx_tf_error: e.message.slice(0, 160) }); }
  /* planilla de RSI de ACCIONES en cada temporalidad */
  try { for (const tf of ['h', '4h', 'd', 'w', 'm']) { const r = await pg.evaluate(async tf => { if (mode !== 'a') applyMode('a'); await new Promise(z => setTimeout(z, 1500)); RSIX.tf = tf; await rsiLoad(); rsiRender(); await new Promise(z => setTimeout(z, 500));
        const v = [...document.querySelectorAll('#rsiBody td:nth-child(2)')].map(x => x.textContent); return { tf, celdas: v.length, vacias: v.filter(x => x === '—').length, ej: v.slice(0, 5) }; }, tf);
      info.push({ rsi: r }); try { await pg.locator('#rsiBox').screenshot({ path: `capturas/rsi-${tf}.png`, timeout: 8000 }); } catch (e) {} } } catch (e) { info.push({ rsi_error: e.message.slice(0, 120) }); }
  /* PILOTEAR: una acción y una cripto, y cambio de temporalidad en la operación ya creada */
  try { const r = await pg.evaluate(async () => { for (let k = 0; k < 30 && !(STK.AAPL && STK.AAPL.c); k++) await new Promise(z => setTimeout(z, 500));
      PIL = [{ id: 'AAPL-t', sym: 'AAPL', mk: 'a', tf: '1h', dir: 1, entry: STK.AAPL ? STK.AAPL.c * .99 : 200, lev: 1, margin: 1000, t: Date.now() - 864e5, state: null, ll: null, closed: false },
        { id: 'BTC-t', sym: 'BTCUSDT', mk: 'c', tf: '15m', dir: -1, entry: tickers.BTCUSDT ? tickers.BTCUSDT.c * 1.01 : 100000, lev: 10, margin: 100, t: Date.now() - 36e5, state: null, ll: null, closed: false }];
      if (typeof setView === 'function') setView('pil'); pilRender(); await pilTick(); await new Promise(z => setTimeout(z, 800));
      const st = () => PIL.map(p => ({ sym: p.sym, tf: p.tf, ok: !!p.a, title: p.a && p.a.title, why: p.a && p.a.why.slice(0, 3) }));
      const min0 = document.querySelectorAll('.pil-c.min').length, barTxt = [...document.querySelectorAll('.pil-bar')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
      document.querySelector('.pil-c[data-id="AAPL-t"] [data-a="tog"]').click(); const a = st(); document.querySelector('.pil-c[data-id="AAPL-t"] [data-a="tf"][data-tf="1d"]').click(); await new Promise(z => setTimeout(z, 300)); await pilTick(); await new Promise(z => setTimeout(z, 500));
      $('pilMk').value = 'a'; pilMkSet(); $('pilSym').value = 'NV'; pilFill(); const dd = [...document.querySelectorAll('#pilList .row')].slice(0, 3).map(x => x.dataset.s);
      let pump = {}; for (const tf of ['1h', '1w']) { try { const D = await pilData('PUMPUSDT', tf, 'c'); pump[tf] = { ok: 1, c1: D.c1 }; try { pilAnalyze({ sym: 'PUMPUSDT', mk: 'c', tf, dir: 1, entry: 0.004, lev: 8, margin: 41.7, t: Date.now() - 4e8 }, D, tickers.PUMPUSDT ? tickers.PUMPUSDT.c : D.c1); } catch (e) { pump[tf].an = e.message + ' ' + (e.stack || '').split('\n')[1]; } } catch (e) { pump[tf] = 'error ' + e.message + ' ' + (e.stack || '').split('\n')[1]; } } pump.ent = {}; for (const en of [0.003, 0.004, 0.0045, 0.005, 0.0055, 0.006, 0.007, 0.008]) for (const tf of ['1h', '1w']) { try { const D = await pilData('PUMPUSDT', tf, 'c'), q = { id: 'x', sym: 'PUMPUSDT', tf, dir: 1, entry: en, lev: 8, margin: 41.7, t: Date.parse('2026-10-23T23:10:00Z'), state: null, ll: null, closed: false }, a = pilAnalyze(q, D, tickers.PUMPUSDT.c); pump.ent[en + tf] = a.st; } catch (e) { pump.ent[en + tf] = 'ERR ' + e.message; } } pump.ticker = !!tickers.PUMPUSDT; pump.px = tickers.PUMPUSDT && tickers.PUMPUSDT.c;
      let spy = null; try { const b = await pilKl('SPY', '1d', 'a', 80); const cl = b.slice(0, -1).map(x => x.close), e = emaArr(cl, 50); spy = { n: b.length, c: b.at(-1).close, ult: cl.slice(-5), e50: e.at(-1), d0: b[0].date, ref: window.__refa }; } catch (e) { spy = 'error ' + e.message; }
      const q = PIL[1]; q.mt = 'cruzado'; q.cuenta = 0; const l1 = pilLiqPx(q); q.cuenta = 500; const l2 = pilLiqPx(q); q.mt = 'aislado'; q.extra = 100; const l3 = pilLiqPx(q); q.extra = 0; const l0 = pilLiqPx(q);
      return { min0, barTxt, abiertas: document.querySelectorAll('.pil-c:not(.min)').length, antes: a, despues: st(), lista_acciones: dd, liq: { aislado: l0, aislado_mas100: l3, cruzado_sin_saldo: String(l1), cruzado_500: l2 } }; });
    info.push({ pilotear: r }); await pg.evaluate(() => { PIL.forEach(p => p.open = false); pilRender(); const b = document.querySelector('.pil-bg'); window.__goOk = !!b; }); try { await pg.locator('#pilCards').screenshot({ path: 'capturas/pilotear-min.png', timeout: 8000 }); } catch (e) {} try { await pg.locator('#pilBox').screenshot({ path: 'capturas/pilotear.png', timeout: 8000 }); } catch (e) {} } catch (e) { info.push({ pilotear_error: e.message.slice(0, 200) }); }
  try { await pg.waitForTimeout(6000); const r = await pg.evaluate(async () => { await pilTick(); await new Promise(z => setTimeout(z, 1500)); pilRender(); return [...document.querySelectorAll('.pil-rsr')].map(x => x.textContent.replace(/\s+/g, ' ').trim()); }); info.push({ pilrsi: r }); try { await pg.locator('#pilCards').screenshot({ path: 'capturas/pilotear-rsi.png', timeout: 8000 }); } catch (e) {} } catch (e) { info.push({ pilrsi_error: e.message.slice(0, 200) }); }
  /* sección de versiones y bots de traders (con datos de prueba si todavía no hay señales reales de los bots de traders) */
  try { const r = await pg.evaluate(async () => { await verLoad(); for (let k = 0; k < 20 && !VERD; k++) await new Promise(z => setTimeout(z, 500));
      if (VERD && !(VERD.versiones || {}).trd) { const now = Date.now(), B = [[1, 'RASCHKE · Turtle Soup 4 h', 'Linda Bradford Raschke', '4h'], [2, 'TORTUGAS · Donchian 20/10 · 4 h', 'Richard Dennis y los Turtles', '4h'], [3, 'RASCHKE · Turtle Soup 12 h', 'Linda Bradford Raschke', '12h'], [4, 'TORTUGAS · Donchian 55/20 · 12 h', 'Richard Dennis y los Turtles', '12h'], [5, 'CONNORS · RSI 2 · 12 h', 'Larry Connors', '12h']];
        VERD.versiones.trd = B.map(([v, nm, quien, tf]) => ({ v, desde: '2026-10-26T12:00:00-03:00', nm, quien, tf, txt: 'Prueba de la página', margen: 300 }));
        for (let k = 0; k < 14; k++) VERD.ops.push({ id: 'trdx' + k, m: 'trd', v: k % 2 ? 3 : 2, sym: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'][k % 3], tf: '4h', dir: k % 3 ? 1 : -1, entry: 100, sl: 97, tp: k % 2 ? [101, 102, 103] : null, trail: k % 2 ? undefined : 10, lev: 10, t: now - (k + 1) * 36e5 * 5, f: { rsi14: 30 + k * 3, adx: 20 + k, volumen: 1 + k / 10, btc_a_favor: 1, hora: k }, out: k < 11 ? { c: k % 4 === 0 ? 1 : 4, hit: k % 4 === 0 ? 0 : 3, pct: k % 4 === 0 ? -30 : 12, t: now - k * 36e5 * 5 } : null }); }
      HSRC = 'live'; if (mode !== 'medio') applyMode('medio'); VERBOX = true; if (typeof setView === 'function') setView('sig'); renderRes(true); await new Promise(z => setTimeout(z, 1500));
      const box = document.querySelector('.vcal.ver'); return { versiones: !!box, trd: document.querySelectorAll('[data-ver^="trd"]').length, cards: document.querySelectorAll('.ver-r').length, bt: !!TRDBT }; });
    info.push({ versiones: r }); const nv = await pg.locator('details.vcal.ver').count(); for (let k = 0; k < nv; k++) { try { await pg.locator('details.vcal.ver').nth(k).screenshot({ path: `capturas/versiones-${k}.png`, timeout: 8000 }); } catch (e) { info.push({ cap: 'versiones ' + k, e: e.message.slice(0, 80) }); } }
    await pg.evaluate(async () => { VERSEL = 'trd2'; renderRes(true); await new Promise(z => setTimeout(z, 800)); document.querySelector('.ver-det') && document.querySelector('.ver-det').scrollIntoView(); });
    try { await pg.locator('.ver-det').first().screenshot({ path: 'capturas/bot-trader-detalle.png', timeout: 8000 }); } catch (e) { info.push({ cap: 'detalle', e: e.message.slice(0, 80) }); }
    await pg.evaluate(async () => { VERSEL = 'medio8'; renderRes(true); await new Promise(z => setTimeout(z, 800)); });
    try { await pg.locator('.ver-det').first().screenshot({ path: 'capturas/version-detalle.png', timeout: 8000 }); } catch (e) { info.push({ cap: 'detalle2', e: e.message.slice(0, 80) }); }
    await pg.evaluate(() => { VERSEL = null; renderRes(true); }); } catch (e) { info.push({ versiones_error: e.message }); }
  /* menú lateral: Mis listas (favoritos y carpetas con RSI) */
  try { const r = await pg.evaluate(async () => { const w = ms => new Promise(z => setTimeout(z, ms)); drawer(true); await w(300);
      const add = (fid, v) => { const i = document.querySelector(`#drwLists input[data-k="add-${fid}"]`); i.value = v; document.querySelector(`#drwLists [data-add="${fid}"]`).click(); };
      add('fav', 'BTC'); add('fav', 'aapl'); add('fav', 'NOEXISTE'); const msg = (document.querySelector('#drwLists details[data-f="fav"] .lst-msg:last-child') || {}).textContent;
      document.getElementById('lstPlus').click(); const n = document.querySelector('#drwLists input[data-k="new"]'); n.value = 'Prueba'; document.querySelector('#drwLists [data-a="crear"]').click();
      const fid = LSTS[LSTS.length - 1].id; add(fid, 'SOL'); add(fid, 'ETH'); add(fid, 'KO');
      const sel = document.querySelector(`#drwLists select[data-tf="${fid}"]`); sel.value = '4h'; sel.dispatchEvent(new Event('change', { bubbles: true }));
      const gi = document.querySelector('#drwLists input[data-k="add-fav"]'); gi.focus(); gi.value = 'GOOG'; gi.dispatchEvent(new Event('input', { bubbles: true })); await w(300);
      const sug = [...document.querySelectorAll('#drwLists .lst-sug[data-sug="fav"] .row')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
      try { await document.fonts.ready; } catch (e) {} window.__sugShot = 1;
      await w(9000); gi.value = ''; gi.blur(); lstRender();
      const F = [...document.querySelectorAll('#drwLists details')].map(d => ({ f: d.querySelector('.lst-n').textContent, filas: [...d.querySelectorAll('.lst-r')].map(x => x.textContent.replace(/\s+/g, ' ').trim()) }));
      drawer(false); document.querySelector('#ltabs [data-f="fav"]').click(); await w(6000); renderList();
      const favRows = [...document.querySelectorAll('#list .row')].map(x => x.textContent.replace(/\s+/g, ' ').trim()), favHead = document.getElementById('lhead').textContent;
      try { window.__favShot = 1; } catch (e) {}
      return { favHead, favRows, F, msg, sug, modos: [...document.querySelectorAll('#drwModes .mcard')].map(x => x.querySelector('b').textContent.trim()) }; }); info.push({ listas: r });
    try { await pg.locator('#list').screenshot({ path: 'capturas/favoritas-rsi.png', timeout: 8000 }); await pg.evaluate(() => document.querySelector('#ltabs [data-f="all"], #ltabs [data-f]:not([data-f="fav"])').click()); } catch (e) {}
    await pg.evaluate(() => drawer(false)); } catch (e) { info.push({ listas_error: e.message.slice(0, 300) }); }
  /* planilla de acciones ordenada por oportunidad: página 1 los extremos, la última los neutrales */
  try { const r = await pg.evaluate(async () => { const w = ms => new Promise(z => setTimeout(z, ms)); applyMode('a'); await rsiLoad(); RSIX.tf = 'd'; RSIX.pg = 0; rsiRender(); await w(400);
      const col = () => [...document.querySelectorAll('#rsiBody td:nth-child(2)')].map(x => parseFloat(x.textContent.replace(',', '.'))).filter(isFinite);
      const p1 = col(), lab1 = document.getElementById('rsiPg').textContent; RSIX.pg = 99; rsiRender(); await w(300); const pl = col(), labL = document.getElementById('rsiPg').textContent;
      const ext = L => L.length ? +(L.reduce((a, v) => a + Math.abs(v - 50), 0) / L.length).toFixed(1) : null; RSIX.pg = 0; rsiRender();
      const cx = (() => { applyMode('medio'); rsiCxRender(); return [...document.querySelectorAll('#rsiCxBody .rsi-b')].slice(0, 3).map(b => [...b.querySelectorAll('td:nth-child(2)')].map(x => x.textContent).join(' ')); })();
      return { lab1, labL, p1_primeros: p1.slice(0, 16), distancia_media_a_50: { pagina1: ext(p1), ultima: ext(pl) }, ultima_primeros: pl.slice(0, 8), cripto: cx }; }); info.push({ rsiorden: r });
    try { await pg.evaluate(() => { applyMode('a'); RSIX.pg = 0; rsiRender(); }); await pg.locator('#rsiBox').screenshot({ path: 'capturas/rsi-orden.png', timeout: 8000 }); await pg.evaluate(() => applyMode('medio')); } catch (e) {} } catch (e) { info.push({ rsiorden_error: e.message.slice(0, 200) }); }
  /* datos del activo e íconos */
  try { const out = {}; for (const [m, sy] of [['medio', 'SOLUSDT'], ['a', 'NVDA'], ['a', 'YPF']]) { const r = await pg.evaluate(async ([m, sy]) => { const w = ms => new Promise(z => setTimeout(z, ms)); applyMode(m); await w(m === 'a' ? 2500 : 500);
        try { select(sy); } catch (e) {} for (let k = 0; k < 60 && !(DAT[sy] && DAT[sy].p && DAT[sy].nt); k++) await w(500); await w(800); datPaint();
        const b = document.getElementById('datBody'); const d = b.querySelector('details'); if (d) d.open = true;
        return { titulo: document.getElementById('datHead').textContent, chips: [...b.querySelectorAll('.ad-c')].map(x => x.textContent), resumen: (b.querySelector('.ad-res') || {}).textContent, desc: ((b.querySelector('.ad-desc') || {}).textContent || '').slice(0, 220),
          ultimo: ((b.querySelector('.ad-last') || {}).textContent || '').slice(0, 160), ficha: [...b.querySelectorAll('.ad-ficha span')].map(x => x.textContent).join(' | ').slice(0, 300), noticias: b.querySelectorAll('.ad-news li').length,
          icoHead: (document.getElementById('symIco') || {}).src || null, icoLista: document.querySelectorAll('#list .row img.ico').length, nerr: DATNERR }; }, [m, sy]); out[sy] = r;
      try { await pg.evaluate(() => document.getElementById('datBox').scrollIntoView()); await pg.waitForTimeout(500); await pg.locator('#datBox').screenshot({ path: `capturas/datos-${sy}.png`, timeout: 15000 }); } catch (e) { info.push({ datos_shot: e.message.slice(0, 150) }); } }
    info.push({ datos: out }); await pg.evaluate(() => applyMode('medio')); } catch (e) { info.push({ datos_error: e.message.slice(0, 200) }); }
  /* textos pegados al borde de la pantalla (celular) */
  try { const r = await pg.evaluate(async () => { const out = [], W = innerWidth, seen = new Set();
      for (const v of ['main', 'sig', 'pil', 'cic']) { setView(v); await new Promise(z => setTimeout(z, 600));
        for (const el of document.querySelectorAll('main *, aside *')) { if (!el.childNodes.length || el.closest('#chart,canvas,svg,table,.tv-lightweight-charts,.mnav,#mnav')) continue;
          const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 2); if (!own) continue; const b = el.getBoundingClientRect(); if (!b.width || !b.height || el.offsetParent === null) continue;
          if (b.left < 6 || b.right > W - 6) { const k = (el.id ? '#' + el.id : el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName) + ' @' + v; if (seen.has(k)) continue; seen.add(k);
            out.push({ el: k, x: Math.round(b.left), r: Math.round(W - b.right), t: el.textContent.trim().slice(0, 50) }); } } }
      setView('main'); return out.slice(0, 40); }); info.push({ bordes: r }); } catch (e) { info.push({ bordes_error: e.message.slice(0, 200) }); }
  /* pilotear desde una captura de Binance (imagen de prueba armada acá, con datos inventados) */
  try { const mk = await br.newPage({ viewport: { width: 412, height: 900 }, deviceScaleFactor: 2.6 });
    const card = (h, pnl, roi, size, mg, ratio, en, mark, liq) => `${h ? `<div class=h>${h}</div>` : ''}<div class=r><span>PnL (USDT)</span><span>ROI</span></div><div class="r v"><span class=dn>${pnl}</span><span class=dn>${roi}</span></div>
      <div class=r><span>Tamaño (USDT)</span><span>Margin (USDT)</span><span>Tasa de margen</span></div><div class="r v"><span>${size}</span><span>${mg}</span><span class=up>${ratio}</span></div>
      <div class=r><span>Precio de entrada (US...</span><span>Precio de marca (USD...</span><span>Precio liq. (USDT)</span></div><div class="r v"><span>${en}</span><span>${mark}</span><span>${liq}</span></div><div class=r><span>Apalancamiento</span><span>TP/SL</span><span>Cerrar</span></div>`;
    await mk.setContent(`<style>body{background:#1e2329;color:#eaecef;font-family:Arial;margin:16px;font-size:15px}.r{display:flex;justify-content:space-between;color:#848e9c;margin:6px 0}.v{color:#eaecef;font-size:19px}.dn{color:#f6465d}.up{color:#0ecb81}.h{font-size:21px;font-weight:bold;margin:22px 0 8px}</style>
      <div class=h>ETHUSDT Perp.</div><div class=r><span>Posiciones (2)</span><span>Pendientes</span></div>` + card('B BTCUSDT Perp. Aislado 10x', '-12.50', '-25.00%', '487.50', '80.00', '4.10%', '100000.0', '97500.0', '90500.0') + `<div class=h>B XRPUSDT Perp. Aislado 5x</div><div class=r><span>PnL (USDT)</span><span>ROI</span></div>`);
    await mk.screenshot({ path: 'capturas/binance-prueba.png' });
    await mk.setContent(`<style>body{background:#1e2329;color:#eaecef;font-family:Arial;margin:16px;font-size:15px}.r{display:flex;justify-content:space-between;color:#848e9c;margin:6px 0}.v{color:#eaecef;font-size:19px}.dn{color:#f6465d}.up{color:#0ecb81}.h{font-size:21px;font-weight:bold;margin:22px 0 8px}</style>` + card('B XRPUSDT Perp. Aislado 5x', '+3.00', '+6.00%', '253.00', '50.00', '2.00%', '2.0000', '2.0240', '1.6200'));
    await mk.screenshot({ path: 'capturas/binance-prueba2.png' }); await mk.close();
    await pg.evaluate(() => { setView('pil'); PIL = PIL.filter(p => !/^(BTCUSDT|XRPUSDT)-prueba/.test(p.id)); PIL.push({ id: 'BTCUSDT-prueba', sym: 'BTCUSDT', mk: 'c', tf: '1h', mt: 'aislado', cuenta: 0, extra: 0, open: true, dir: 1, entry: 100000, lev: 10, margin: 50, t: Date.now(), state: null, ll: null, closed: false }); savePil(); pilRender(); });
    await pg.setInputFiles('#pilImgIn', ['capturas/binance-prueba.png', 'capturas/binance-prueba2.png']);
    for (let k = 0; k < 90; k++) { const t = await pg.evaluate(() => document.getElementById('pilImgOut').textContent); if (/Lo que leí|No encontré|No se pudo/.test(t)) break; await pg.waitForTimeout(1000); }
    const pre = await pg.evaluate(() => ({ texto: document.getElementById('pilImgOut').textContent.replace(/\s+/g, ' ').slice(0, 600), items: PIO.items.map(x => ({ k: x.k, sym: x.sym, c: x.c && { dir: x.c.dir, lev: x.c.lev, entry: x.c.entry, base: x.c.base, extra: x.c.extra } })) }));
    try { await pg.locator('#pilImgOut').screenshot({ path: 'capturas/pilotear-captura.png', timeout: 8000 }); } catch (e) {}
    const post = await pg.evaluate(() => { const b = document.querySelector('[data-pioa="1"]'); if (b) b.click(); const r = PIL.filter(p => ['BTCUSDT', 'XRPUSDT'].includes(p.sym) && !p.closed).map(p => ({ sym: p.sym, entry: p.entry, lev: p.lev, margin: p.margin, extra: p.extra, qty: p.qty, liq: pilLiqPx(p), prom: pilAvg(p), pnl_a_97500: +(p.dir * (97500 - pilAvg(p)) * pilQty(p)).toFixed(2) }));
      window.__pt = PIL.filter(p => p.sym === 'XRPUSDT' && p.t > Date.now() - 6e5).map(p => p.id);
      PIL = PIL.filter(p => !(p.id === 'BTCUSDT-prueba' || (p.sym === 'XRPUSDT' && p.t > Date.now() - 6e5))); savePil(); pilRender(); return r; });
    await pg.waitForTimeout(5000);
    const tfix = await pg.evaluate(() => { const r = { form_tf: !!document.getElementById('pilTf'), def_tf: pilTfOf({ mk: 'c' }) }; const p = { id: 'XRPUSDT-t', sym: 'XRPUSDT', mk: 'c', tf: '4h', entry: 2.0, t: Date.now(), tEst: 2 }; return pioEstT('XRPUSDT', tickers.XRPUSDT ? tickers.XRPUSDT.c * 1.05 : 2).then(t => Object.assign(r, { estimado: t ? new Date(t).toISOString() : null, horas_atras: t ? Math.round((Date.now() - t) / 36e5) : null })); });
    info.push({ pilcaptura: { pre, post, tfix } }); } catch (e) { info.push({ pilcaptura_error: e.message.slice(0, 200) }); }
  /* semáforo del gráfico */
  try { const r = await pg.evaluate(async () => { const w = ms => new Promise(z => setTimeout(z, ms)); applyMode('medio'); setView('main'); await w(1500);
      for (const k of ['rsi', 'macd', 'ema', 'bollinger', 'supertrend', 'adx']) active.add(k); calcInd(true); if (!SEMF) semToggle(); await w(1500);
      const bar = document.getElementById('semBar'); const pts = OS.rsi.rsi.data ? OS.rsi.rsi.data() : []; const cols = [...new Set(pts.slice(-300).map(x => x.color))];
      return { visible: !bar.hidden, texto: bar.textContent.replace(/\s+/g, ' ').trim(), colores_rsi: cols, boton: document.getElementById('semBtn').classList.contains('on') }; }); info.push({ semaforo: r });
    try { await pg.locator('#chart').screenshot({ path: 'capturas/semaforo.png', timeout: 15000 }); } catch (e) { info.push({ sem_shot: e.message.slice(0, 120) }); }
    try { await pg.locator('#semBar').screenshot({ path: 'capturas/semaforo-barra.png', timeout: 8000 }); } catch (e) {}
    const off = await pg.evaluate(() => { semToggle(); const pts = OS.rsi.rsi.data(); return { visible: !document.getElementById('semBar').hidden, colores_rsi: [...new Set(pts.slice(-50).map(x => x.color || 'normal'))] }; }); info.push({ semaforo_off: off });
  } catch (e) { info.push({ semaforo_error: e.message.slice(0, 200) }); }
  /* estado del bot 24 h (por qué no hay señales) */
  try { const r = await pg.evaluate(async () => { SRVEST = { medio: { t: Date.now() - 3e5, ultima: Date.now() - 9 * 864e5, btc: -1, btcAdx: 46, dvol: { v: 62, v24: 4 }, no: { sin_setup: 600, btc_contra: 3 } }, x: { t: Date.now() - 3e5, pausa: 'BTC está debajo de su EMA 200 de 4 h' } };
    applyMode('medio'); setView('sig'); SIG.medio = []; renderSignals(); await new Promise(z => setTimeout(z, 300)); const a = (document.querySelector('#sigList .bot-est') || {}).textContent || null;
    applyMode('x'); SIG.x = []; renderSignals(); const b = (document.querySelector('#sigList .bot-est') || {}).textContent || null; applyMode('medio'); return { medio: a, x: b }; }); info.push({ botest: r });
    try { await pg.evaluate(() => { SIG.medio = []; renderSignals(); }); await pg.locator('#sigBox').screenshot({ path: 'capturas/bot-estado.png', timeout: 8000 }); } catch (e) {} } catch (e) { info.push({ botest_error: e.message.slice(0, 200) }); }
  await pg.screenshot({ path: 'capturas/pagina-completa.png', fullPage: true });
  /* botón atrás del celular: cada paso anota la pantalla y lo abierto */
  try { const st = () => pg.evaluate(() => ({ v: document.body.dataset.v, ia: !!(document.getElementById('iaPanel') && !document.getElementById('iaPanel').hidden), trn: !!(document.getElementById('trn') && !document.getElementById('trn').hidden), toast: !!document.querySelector('.trn-toast'), url: location.href.slice(-30) }));
    const at = []; await pg.evaluate(() => { document.querySelectorAll('.trn-toast').forEach(x => x.remove()); setView('main'); });
    for (const g of ['sig', 'pil', 'cic']) { await pg.evaluate(g => document.querySelector(`#mnav [data-go="${g}"]`).click(), g); await pg.waitForTimeout(500); at.push(['abre ' + g, await st()]); }
    await pg.evaluate(() => iaShow(true)); await pg.waitForTimeout(800); at.push(['abre IA', await st()]);
    for (let i = 0; i < 6; i++) { await pg.evaluate(() => history.back()); await pg.waitForTimeout(700); at.push(['atrás ' + (i + 1), await st().catch(e => 'salió: ' + e.message.slice(0, 60))]); }
    info.push({ atras: at }); } catch (e) { info.push({ atras_error: e.message }); }
  fs.writeFileSync('capturas/errores.json', JSON.stringify({ info, errs }, null, 1)); console.log(JSON.stringify({ info, errs }, null, 1)); await br.close();
})().catch(e => { console.error(e); process.exit(1); });
