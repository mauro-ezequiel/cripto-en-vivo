/* Sonda: qué fuentes de Binance se alcanzan desde GitHub Actions y cuántas monedas hay solo en futuros perpetuos. Escribe sonda.json */
const fs = require('fs'), out = {};
const get = async u => { try { const r = await fetch(u); const t = await r.text(); return { st: r.status, len: t.length, t }; } catch (e) { return { st: 'error ' + e.message }; } };
(async () => {
  for (const u of ['https://fapi.binance.com/fapi/v1/ticker/24hr', 'https://data-api.binance.vision/api/v3/ticker/24hr', 'https://api.binance.com/api/v3/ping',
    'https://data.binance.vision/data/futures/um/monthly/klines/HYPEUSDT/4h/HYPEUSDT-4h-2026-08.zip', 'https://data.binance.vision/?prefix=data/futures/um/monthly/klines/']) {
    const r = await get(u); out[u] = { st: r.st, len: r.len, inicio: (r.t || '').slice(0, 160) }; }
  const spot = await get('https://data-api.binance.vision/api/v3/ticker/24hr'), fut = await get('https://fapi.binance.com/fapi/v1/ticker/24hr');
  try { const S = new Set(JSON.parse(spot.t).map(x => x.symbol)); const F = JSON.parse(fut.t).filter(x => /^[A-Z0-9]+USDT$/.test(x.symbol));
    const only = F.filter(x => !S.has(x.symbol)).map(x => [x.symbol, Math.round(+x.quoteVolume / 1e6), +x.priceChangePercent]).sort((a, b) => b[1] - a[1]);
    out.solo_futuros = { total: only.length, mas_de_10M: only.filter(x => x[1] > 10).length, lista: only.slice(0, 150) }; } catch (e) { out.solo_futuros = 'no se pudo: ' + e.message; }
  fs.writeFileSync('sonda.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out).slice(0, 2000)); })();
