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
  /* sección de versiones y bots de traders (con datos de prueba si todavía no hay señales reales de los bots de traders) */
  try { const r = await pg.evaluate(async () => { await verLoad(); for (let k = 0; k < 20 && !VERD; k++) await new Promise(z => setTimeout(z, 500));
      if (VERD && !(VERD.versiones || {}).trd) { const now = Date.now(), B = [[1, 'RASCHKE · Turtle Soup 4 h', 'Linda Bradford Raschke', '4h'], [2, 'TORTUGAS · Donchian 20/10 · 4 h', 'Richard Dennis y los Turtles', '4h'], [3, 'RASCHKE · Turtle Soup 12 h', 'Linda Bradford Raschke', '12h'], [4, 'TORTUGAS · Donchian 55/20 · 12 h', 'Richard Dennis y los Turtles', '12h'], [5, 'CONNORS · RSI 2 · 12 h', 'Larry Connors', '12h']];
        VERD.versiones.trd = B.map(([v, nm, quien, tf]) => ({ v, desde: '2026-10-26T12:00:00-03:00', nm, quien, tf, txt: 'Prueba de la página', margen: 300 }));
        for (let k = 0; k < 14; k++) VERD.ops.push({ id: 'trdx' + k, m: 'trd', v: k % 2 ? 3 : 2, sym: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'][k % 3], tf: '4h', dir: k % 3 ? 1 : -1, entry: 100, sl: 97, tp: k % 2 ? [101, 102, 103] : null, trail: k % 2 ? undefined : 10, lev: 10, t: now - (k + 1) * 36e5 * 5, f: { rsi14: 30 + k * 3, adx: 20 + k, volumen: 1 + k / 10, btc_a_favor: 1, hora: k }, out: k < 11 ? { c: k % 4 === 0 ? 1 : 4, hit: k % 4 === 0 ? 0 : 3, pct: k % 4 === 0 ? -30 : 12, t: now - k * 36e5 * 5 } : null }); }
      HSRC = 'live'; if (mode !== 'medio') applyMode('medio'); VERBOX = true; if (typeof setView === 'function') setView('main'); renderRes(true); await new Promise(z => setTimeout(z, 1500));
      const box = document.querySelector('.vcal.ver'); return { versiones: !!box, trd: document.querySelectorAll('[data-ver^="trd"]').length, cards: document.querySelectorAll('.ver-r').length, bt: !!TRDBT }; });
    info.push({ versiones: r }); const els = await pg.$$('details.vcal.ver'); for (let k = 0; k < els.length; k++) await els[k].screenshot({ path: `capturas/versiones-${k}.png` });
    await pg.evaluate(async () => { VERSEL = 'trd2'; renderRes(true); await new Promise(z => setTimeout(z, 800)); document.querySelector('.ver-det') && document.querySelector('.ver-det').scrollIntoView(); });
    const det = await pg.$('.ver-det'); if (det) await det.screenshot({ path: 'capturas/bot-trader-detalle.png' });
    await pg.evaluate(async () => { VERSEL = 'medio8'; renderRes(true); await new Promise(z => setTimeout(z, 800)); });
    const det2 = await pg.$('.ver-det'); if (det2) await det2.screenshot({ path: 'capturas/version-detalle.png' });
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
