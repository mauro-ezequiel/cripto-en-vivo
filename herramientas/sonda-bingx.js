/* SONDA BingX (noviembre 2026): ¿se puede leer el precio de BingX desde el navegador? (REST con CORS o WebSocket) */
const fs = require('fs'); const zlib = require('zlib'); const R = {};
(async () => {
  for (const u of ['https://open-api.bingx.com/openApi/swap/v2/quote/contracts', 'https://open-api.bingx.com/openApi/swap/v2/quote/premiumIndex', 'https://open-api.bingx.com/openApi/swap/v1/ticker/price']) {
    try { const r = await fetch(u, { headers: { Origin: 'https://mauro-ezequiel.github.io' } }); const t = await r.text(); R[u] = { status: r.status, cors: r.headers.get('access-control-allow-origin'), largo: t.length, muestra: t.slice(0, 300) };
      if (/contracts/.test(u)) { try { const L = JSON.parse(t).data || []; R.acciones = L.map(x => x.symbol).filter(s => /NVDA|TSLA|AAPL|NCS|YPF/i.test(s)).slice(0, 60); R.total = L.length; } catch (e) {} }
      if (/premiumIndex/.test(u)) { try { const L = JSON.parse(t).data || []; R.nvda = L.filter(x => /NVDA/i.test(x.symbol)); } catch (e) {} }
      if (/ticker\/price/.test(u)) { try { const L = JSON.parse(t).data || []; R.nvdaLast = (Array.isArray(L) ? L : [L]).filter(x => /NVDA/i.test(x.symbol)); } catch (e) {} } } catch (e) { R[u] = 'error ' + e.message; } }
  /* nombres posibles de cada acción, todos a la vez (como hace la página), para ver que la conexión aguanta los nombres que no existen */
  try { const cands = []; for (const t of ['NVDA', 'TSLA', 'AAPL', 'YPF', 'MELI', 'GGAL', 'SPY']) cands.push(`NCSK${t}2USD-USDT`, `NCSI${t}2USD-USDT`, `NCS${t}2USD-USDT`, `NCSK${t}USD-USDT`, t + '-USDT'); cands.push('BTC-USDT');
    const got = {}, errs = []; let closed = null; await new Promise(res => { const ws = new WebSocket('wss://open-api-swap.bingx.com/swap-market'); ws.binaryType = 'arraybuffer'; const to = setTimeout(() => { try { ws.close(); } catch (e) {} res(); }, 20000);
      ws.onopen = () => cands.forEach((c, i) => ws.send(JSON.stringify({ id: 'c' + i, reqType: 'sub', dataType: c + '@lastPrice' })));
      ws.onmessage = e => { let t; try { t = zlib.gunzipSync(Buffer.from(e.data)).toString(); } catch (x) { t = String(e.data); } if (t === 'Ping') { ws.send('Pong'); return; } try { const j = JSON.parse(t); if (j.data && j.data.s) got[j.data.s] = j.data.c; else if (j.code) errs.push(t.slice(0, 160)); } catch (x) {} };
      ws.onclose = e => { closed = e.code + ' ' + (e.reason || ''); clearTimeout(to); res(); }; }); R.todos = { validos: got, errores: errs.slice(0, 8), cerro: closed }; } catch (e) { R.todos = 'error ' + e.message; }
  /* WebSocket (no tiene CORS) */
  try { const sym = (R.nvda && R.nvda[0] && R.nvda[0].symbol) || 'NCSKNVDA2USD-USDT'; R.wsSym = sym;
    const msgs = []; await new Promise(res => { const ws = new WebSocket('wss://open-api-swap.bingx.com/swap-market'); ws.binaryType = 'arraybuffer'; const to = setTimeout(() => { try { ws.close(); } catch (e) {} res(); }, 15000);
      ws.onopen = () => { ws.send(JSON.stringify({ id: 'a', reqType: 'sub', dataType: sym + '@lastPrice' })); ws.send(JSON.stringify({ id: 'b', reqType: 'sub', dataType: sym + '@markPrice' })); };
      ws.onmessage = e => { let t; try { t = zlib.gunzipSync(Buffer.from(e.data)).toString(); } catch (x) { t = String(e.data); } if (t === 'Ping') { ws.send('Pong'); return; } msgs.push(t.slice(0, 300)); if (msgs.length >= 6) { clearTimeout(to); ws.close(); res(); } };
      ws.onerror = e => { msgs.push('error ' + (e.message || '')); }; }); R.ws = msgs; } catch (e) { R.ws = 'error ' + e.message; }
  fs.writeFileSync('sonda-bingx.json', JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1).slice(0, 4000)); })();
