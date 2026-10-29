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
  await pg.waitForTimeout(15000);
  const L = [['medio', '4h', 'BTCUSDT'], ['medio', '1h', 'ETHUSDT'], ['medio', '1d', 'SOLUSDT'], ['tx', '4h', 'XRPUSDT'], ['x', '15m', 'BTCUSDT'], ['x', '5m', 'SOLUSDT'], ['a', '1d', null]];
  const info = [];
  for (const [m, t, s] of L) { try {
      const r = await pg.evaluate(async ([m, t, s]) => { if (mode !== m) applyMode(m); await new Promise(z => setTimeout(z, 3000)); if (s && symbol !== s) { select(s); await new Promise(z => setTimeout(z, 4000)); }
        if (tf !== t && TF_MODE[mode].includes(t)) { tf = t; renderTfs(); await loadChart(); await new Promise(z => setTimeout(z, 3000)); }
        for (const k of MODES[mode].inds) active.add(k); try { calcInd(true); } catch (e) {} try { renderChips(); layout(); ovReq(); } catch (e) {} await new Promise(z => setTimeout(z, 3000));
        const ov = document.getElementById('overlay'), ch = document.getElementById('chart'), rr = chart.timeScale().getVisibleLogicalRange();
        return { m, t, sym: symbol, velas: candles.length, rango: rr ? [Math.round(rr.from), Math.round(rr.to)] : null, chartH: ch.clientHeight, chartW: ch.clientWidth, overlayH: ov && ov.height, overlayCssH: ov && ov.clientHeight, ind: [...active] }; }, [m, t, s]);
      info.push(r); const el = await pg.$('#chartWrap') || await pg.$('#chart'); await el.screenshot({ path: `capturas/${m}-${t}.png` }); } catch (e) { info.push({ m, t, error: e.message }); } }
  /* planilla de RSI de ACCIONES en cada temporalidad */
  try { for (const tf of ['h', '4h', '12h', 'w']) { const r = await pg.evaluate(async tf => { if (mode !== 'a') applyMode('a'); await new Promise(z => setTimeout(z, 1500)); RSIX.tf = tf; await rsiLoad(); rsiRender(); await new Promise(z => setTimeout(z, 500));
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
  /* botón atrás del celular: cada paso anota la pantalla y lo abierto */
  try { const st = () => pg.evaluate(() => ({ v: document.body.dataset.v, ia: !!(document.getElementById('iaPanel') && !document.getElementById('iaPanel').hidden), trn: !!(document.getElementById('trn') && !document.getElementById('trn').hidden), toast: !!document.querySelector('.trn-toast'), url: location.href.slice(-30) }));
    const at = []; await pg.evaluate(() => { document.querySelectorAll('.trn-toast').forEach(x => x.remove()); setView('main'); });
    for (const g of ['sig', 'pil', 'cic']) { await pg.evaluate(g => document.querySelector(`#mnav [data-go="${g}"]`).click(), g); await pg.waitForTimeout(500); at.push(['abre ' + g, await st()]); }
    await pg.evaluate(() => iaShow(true)); await pg.waitForTimeout(800); at.push(['abre IA', await st()]);
    for (let i = 0; i < 6; i++) { await pg.evaluate(() => history.back()); await pg.waitForTimeout(700); at.push(['atrás ' + (i + 1), await st().catch(e => 'salió: ' + e.message.slice(0, 60))]); }
    info.push({ atras: at }); } catch (e) { info.push({ atras_error: e.message }); }
  await pg.screenshot({ path: 'capturas/pagina-completa.png', fullPage: true });
  fs.writeFileSync('capturas/errores.json', JSON.stringify({ info, errs }, null, 1)); console.log(JSON.stringify({ info, errs }, null, 1)); await br.close();
})().catch(e => { console.error(e); process.exit(1); });
