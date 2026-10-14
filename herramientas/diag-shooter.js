/* DIAGNÓSTICO SHOOTER (no cambia la página): ¿por qué en vivo pierde más que en la simulación?
   La simulación usa SIEMPRE las 30 monedas con más volumen de HOY. En vivo, la lista se arma con el volumen del momento, y una moneda que se
   está desplomando entra a las 30 por el volumen del pánico: el bot compra su "rebote" y muchas veces sigue cayendo.
   Acá se compara, con la regla v7 de SHOOTER (1 año, velas de 15 y 30 min):
     estatica  · las 30 de hoy (lo que mide la simulación)
     dinamica  · las 30 con más volumen del día anterior (lo que pasa en vivo)
     y filtros posibles sobre la dinámica: sin pico de volumen, sin caída fuerte en 24 h, solo monedas que ya estaban entre las 30 la semana anterior.
   Uso: node herramientas/diag-shooter.js → diag-shooter.json */
const fs = require('fs'), L = require('./investigacion-trading.js');
const API = 'https://data-api.binance.vision/api/v3', DAY = 864e5, H = 36e5, NOW = Date.now(), DAYS = +(process.env.DIAS || 365), FEE = .0005;
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|USDE|USD1|PYUSD|XUSD|AEUR|EURI|BFUSD|USDS|RLUSD|USDF|FRAX|USDG)USDT$/;
(async () => { const t0 = Date.now(), R = { fecha: new Date().toISOString(), dias: DAYS };
  const T = await L.getJ(`${API}/ticker/24hr`);
  const all = T.filter(t => t.symbol.endsWith('USDT') && !STABLE.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) && +t.quoteVolume > 1e7).sort((a, b) => b.quoteVolume - a.quoteVolume).map(t => t.symbol);
  const TOP_HOY = new Set(all.slice(0, 30)), SUP = all.slice(0, +(process.env.NSUP || 100));
  /* volumen diario de cada moneda (para saber cuáles eran las 30 con más volumen cada día) */
  const DV = {}; let q = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (q < SUP.length) { const s = SUP[q++]; const d = await L.klines(s, '1d', DAY, NOW - (DAYS + 40) * DAY); DV[s] = new Map(d.map(b => [b.t, b.v * b.c])); } }));
  const days = []; for (let d = Math.floor((NOW - DAYS * DAY) / DAY) * DAY; d < NOW; d += DAY) days.push(d);
  const rankDay = {}; for (const d of days) { const prev = d - DAY, arr = SUP.map(s => [s, DV[s].get(prev) || 0]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]); rankDay[d] = new Set(arr.slice(0, 30).map(x => x[0])); }
  const avg30 = (s, d) => { let a = 0, n = 0; for (let k = 2; k <= 31; k++) { const v = DV[s].get(d - k * DAY); if (v) { a += v; n++; } } return n ? a / n : 0; };
  console.log('volumen diario listo', ((Date.now() - t0) / 1e3).toFixed(0), 's');
  /* candidatas con la regla v7 en las monedas que alguna vez estuvieron entre las 30 */
  const ever = new Set(); for (const d of days) for (const s of rankDay[d]) ever.add(s); for (const s of TOP_HOY) ever.add(s);
  const C = [], M15 = {}; q = 0; const LIST = [...ever];
  await Promise.all(Array.from({ length: 4 }, async () => { while (q < LIST.length) { const s = LIST[q++]; const m15 = await L.klines(s, '15m', 9e5, NOW - (DAYS + 20) * DAY); if (m15.length < 3000) continue; M15[s] = m15;
    const h1 = L.agg(m15.map(b => b), 1) && (() => { const out = []; let cur = null; for (const x of m15) { const k = Math.floor(x.t / H) * H; if (!cur || cur.t !== k) { if (cur && cur.n === 4) out.push(cur); cur = { ...x, t: k, n: 1 }; } else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v; cur.n++; } } return out; })(), he = L.ema(h1.map(x => x.c), 50);
    for (const [tf, mins] of [['15m', 15], ['30m', 30]]) { const b = mins === 15 ? m15 : (() => { const out = []; let cur = null; for (const x of m15) { const k = Math.floor(x.t / 18e5) * 18e5; if (!cur || cur.t !== k) { if (cur && cur.n === 2) out.push(cur); cur = { ...x, t: k, n: 1 }; } else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v; cur.n++; } } return out; })();
      const P = L.prep(b), ms = mins * 6e4, back = 60 / mins, b24 = 1440 / mins;
      for (let i = 210; i < b.length; i++) { const t = b[i].t + ms; if (t < NOW - DAYS * DAY) continue; const cb = b[i].c; if (P.r7[i] == null || !P.bs[i] || !P.atr[i] || P.e200[i] == null) continue;
        const z = (cb - P.bm[i]) / P.bs[i], drop = (cb / b[i - back].c - 1) * 100; if (!(z <= -1.8 && P.r7[i] <= 35 && drop <= -3 && cb > P.e200[i])) continue;
        const k = L.lastClosed(h1, H, t); if (!(k >= 0 && he[k] != null && h1[k].c > he[k])) continue;
        const d = Math.floor(t / DAY) * DAY, ch24 = i >= b24 ? (cb / b[i - b24].c - 1) * 100 : 0, vs = (DV[s].get(d - DAY) || 0) / (avg30(s, d) || 1);
        let wk = 0; for (let k2 = 1; k2 <= 7; k2++) if (rankDay[d - k2 * DAY] && rankDay[d - k2 * DAY].has(s)) wk++;
        C.push({ s, tf, t, d, e: cb, atrP: P.atr[i] / cb, ch24, vs, wk, j0: L.idxAfter(m15, t) }); } } } }));
  console.log('candidatas', C.length, ((Date.now() - t0) / 1e3).toFixed(0), 's');
  const O = C.map(c => { const sl = Math.min(.05, Math.max(.004, 4 * c.atrP)), o = L.sim(M15[c.s], c.j0, c.e, 1, sl, .25, 12 * H, c.t); return o ? { ...c, o, pct: 100 * 15 * (o.f - 2 * FEE) } : { ...c, o: null }; });
  const half = NOW - DAYS * DAY / 2, V = {
    estatica: c => TOP_HOY.has(c.s), dinamica: c => rankDay[c.d] && rankDay[c.d].has(c.s),
    dinamica_sin_pico: c => rankDay[c.d] && rankDay[c.d].has(c.s) && c.vs < 2, dinamica_sin_caida24: c => rankDay[c.d] && rankDay[c.d].has(c.s) && c.ch24 > -10,
    dinamica_estables: c => rankDay[c.d] && rankDay[c.d].has(c.s) && c.wk >= 5, dinamica_estables_sin_caida: c => rankDay[c.d] && rankDay[c.d].has(c.s) && c.wk >= 5 && c.ch24 > -10,
    estatica_sin_caida24: c => TOP_HOY.has(c.s) && c.ch24 > -10 };
  R.res = {}; for (const [nm, F] of Object.entries(V)) { const P = L.pickOps(O.filter(F), H); R.res[nm] = { todo: L.st(P.map(x => x.pct), DAYS), primera_mitad: L.st(P.filter(x => x.t < half).map(x => x.pct), DAYS / 2), segunda_mitad: L.st(P.filter(x => x.t >= half).map(x => x.pct), DAYS / 2) }; console.log(nm, JSON.stringify(R.res[nm].todo)); }
  /* dentro de la dinámica: cómo les va a las que entran por el pánico */
  const Pd = L.pickOps(O.filter(V.dinamica), H), grp = (nm, f) => { R.grupos = R.grupos || {}; R.grupos[nm] = L.st(Pd.filter(f).map(x => x.pct), DAYS); };
  grp('pico_volumen_>=2x', c => c.vs >= 2); grp('volumen_normal', c => c.vs < 2); grp('cayo_>10%_24h', c => c.ch24 <= -10); grp('cayo_<10%_24h', c => c.ch24 > -10); grp('nueva_en_las_30', c => c.wk < 5); grp('estable_en_las_30', c => c.wk >= 5);
  console.log(JSON.stringify(R.grupos)); R.secs = Math.round((Date.now() - t0) / 1e3); fs.writeFileSync('diag-shooter.json', JSON.stringify(R)); })().catch(e => { console.error(e); fs.writeFileSync('diag-shooter.json', JSON.stringify({ error: String(e.stack || e) })); process.exitCode = 1; });
