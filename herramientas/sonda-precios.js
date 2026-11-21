/* SONDA PRECIOS (21/11/2026): ¿qué acciones tiene BingX y cuánto difiere su precio del de la bolsa (data912)? ¿y cripto spot vs futuros? */
const fs = require('fs'), zlib = require('zlib'); const R = {};
(async () => {
  const U = await (await fetch('https://data912.com/live/usa_stocks')).json(); const A = await (await fetch('https://data912.com/live/usa_adrs')).json();
  const bolsa = {}; for (const x of [...U, ...A]) if (x.c > 0) bolsa[String(x.symbol).replace('.', '')] = +x.c;
  const tick = Object.keys(bolsa); const cands = []; for (const t of tick) cands.push(`NCSK${t}2USD-USDT`, `NCSI${t}2USD-USDT`, `NCS${t}2USD-USDT`, `NCSK${t}USD-USDT`, t + '-USDT', `${t}X-USDT`, `NCSK${t}X2USD-USDT`);
  const got = {};
  for (let i = 0; i < cands.length; i += 400) { const part = cands.slice(i, i + 400);
    await new Promise(res => { const ws = new WebSocket('wss://open-api-swap.bingx.com/swap-market'); ws.binaryType = 'arraybuffer'; const to = setTimeout(() => { try { ws.close(); } catch (e) {} res(); }, 25000);
      ws.onopen = () => part.forEach((c, k) => ws.send(JSON.stringify({ id: 'c' + k, reqType: 'sub', dataType: c + '@lastPrice' })));
      ws.onmessage = e => { let t; try { t = zlib.gunzipSync(Buffer.from(e.data)).toString(); } catch (x) { t = String(e.data); } if (t === 'Ping') { ws.send('Pong'); return; } try { const j = JSON.parse(t); if (j.data && j.data.s) got[j.data.s] = +j.data.c; } catch (x) {} };
      ws.onclose = () => { clearTimeout(to); res(); }; }); }
  const filas = []; for (const [k, v] of Object.entries(got)) { const m = k.match(/^NCS[A-Z]?([A-Z0-9]+?)2?USD-USDT$/) || k.match(/^([A-Z0-9]+?)X?-USDT$/); const t = m && m[1]; const b = bolsa[t]; if (!b) continue; filas.push({ k, t, bingx: v, bolsa: b, dif: +((v / b - 1) * 100).toFixed(2) }); }
  filas.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)); R.acciones = { en_bolsa: tick.length, en_bingx: filas.length, nombres: [...new Set(filas.map(f => f.k.replace(f.t, '*')))], mayores_diferencias: filas.slice(0, 40), sin_bingx_muestra: tick.filter(t => !filas.some(f => f.t === t)).slice(0, 80) };
  /* cripto: spot (lo que usa la página) contra futuros perpetuos */
  try { const sp = await (await fetch('https://data-api.binance.vision/api/v3/ticker/price')).json(); const m = {}; for (const x of sp) m[x.symbol] = +x.price;
    const bx = {}; await new Promise(res => { const ws = new WebSocket('wss://open-api-swap.bingx.com/swap-market'); ws.binaryType = 'arraybuffer'; const L = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'BNB', 'ADA', 'SUI', 'PEPE', 'LINK']; const to = setTimeout(() => { try { ws.close(); } catch (e) {} res(); }, 12000);
      ws.onopen = () => L.forEach((c, k) => ws.send(JSON.stringify({ id: 'x' + k, reqType: 'sub', dataType: c + '-USDT@lastPrice' }))); ws.onmessage = e => { let t; try { t = zlib.gunzipSync(Buffer.from(e.data)).toString(); } catch (x) { t = String(e.data); } if (t === 'Ping') { ws.send('Pong'); return; } try { const j = JSON.parse(t); if (j.data && j.data.s) bx[j.data.s] = +j.data.c; } catch (x) {} }; ws.onclose = () => { clearTimeout(to); res(); }; });
    R.cripto = Object.entries(bx).map(([k, v]) => { const s = k.replace('-', ''); return { s, spot_binance: m[s], perp_bingx: v, dif: m[s] ? +((v / m[s] - 1) * 100).toFixed(3) : null }; }); } catch (e) { R.cripto = 'error ' + e.message; }
  fs.writeFileSync('sonda-precios.json', JSON.stringify(R, null, 1)); console.log(JSON.stringify(R).slice(0, 3000)); })();
