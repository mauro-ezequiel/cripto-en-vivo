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
  await pg.screenshot({ path: 'capturas/pagina-completa.png', fullPage: true });
  fs.writeFileSync('capturas/errores.json', JSON.stringify({ info, errs }, null, 1)); console.log(JSON.stringify({ info, errs }, null, 1)); await br.close();
})().catch(e => { console.error(e); process.exit(1); });
