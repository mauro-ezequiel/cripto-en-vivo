/* INVESTIGACIÓN · señal de ACUMULAR a largo plazo (no cambia la página: solo mide).
   ¿Comprar cuando el precio está "muy abajo para su historial" funciona? Se prueba en cripto (velas diarias de Binance desde 2017,
   incluidas monedas que fueron grandes y se hundieron) y en acciones/índices de EE. UU. (Yahoo, hasta 25 años).
   Reglas probadas (en la vela diaria cerrada, una entrada cada 30 días como máximo por activo):
     sma200s : precio bajo la media de 200 semanas (≈ 1400 días)
     mayer08 : precio / media de 200 días < 0,8
     dd50/dd70 : caída de 50 % / 70 % o más desde el máximo histórico
     rsi_s30 : RSI 14 semanal bajo 30
     combo   : dd50 y precio bajo la media de 200 días y RSI semanal < 40
   Para cada entrada: resultado a 1, 2 y 3 años, cuánto más cayó después (peor caída), y si a los 3 años seguía abajo.
   Comparación: comprar cualquier día (la misma moneda, mismo período).
   Uso: node herramientas/investigacion-acumular.js → acumular.json */
const fs = require('fs');
const DAY = 864e5, NOW = Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJ(u, h) { for (let k = 0; k < 5; k++) { try { const r = await fetch(u, h ? { headers: h } : undefined); if (r.ok) return await r.json(); if (r.status === 400 || r.status === 404) return null; } catch (e) {} await sleep(1500 * (k + 1)); } return null; }
/* cripto: las grandes de hoy + las que fueron top 20 entre 2017 y 2022 (varias se hundieron y no volvieron) */
const CRIPTO = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'SOLUSDT', 'DOGEUSDT', 'TRXUSDT', 'LTCUSDT', 'LINKUSDT', 'DOTUSDT', 'AVAXUSDT', 'BCHUSDT', 'XLMUSDT', 'ETCUSDT', 'ATOMUSDT',
  'EOSUSDT', 'NEOUSDT', 'IOTAUSDT', 'XMRUSDT', 'DASHUSDT', 'ZECUSDT', 'QTUMUSDT', 'ONTUSDT', 'ICXUSDT', 'VETUSDT', 'XTZUSDT', 'ALGOUSDT', 'FILUSDT', 'THETAUSDT', 'UNIUSDT', 'AAVEUSDT', 'MATICUSDT', 'LUNAUSDT', 'FTTUSDT', 'WAVESUSDT', 'SRMUSDT', 'OMGUSDT', 'BATUSDT', 'ZILUSDT'];
const ACC = ['SPY', 'QQQ', 'DIA', 'IWM', 'EEM', 'EWZ', 'AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'NVDA', 'TSLA', 'NFLX', 'INTC', 'CSCO', 'IBM', 'ORCL', 'KO', 'PEP', 'JNJ', 'PFE', 'MRK', 'XOM', 'CVX', 'JPM', 'BAC', 'C', 'WFC', 'GS', 'GE', 'BA', 'F', 'GM', 'T', 'VZ', 'DIS', 'WMT', 'HD', 'MCD', 'NKE', 'PYPL', 'BABA', 'NIO', 'MELI', 'GGAL', 'YPF', 'PBR', 'VALE', 'AA', 'X', 'M', 'KHC', 'WBA', 'MMM'];
async function cripto(s) { const out = []; let st = Date.parse('2017-01-01');
  while (st < NOW) { const d = await getJ(`https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=1d&startTime=${st}&limit=1000`); if (!d || !d.length) break;
    for (const k of d) out.push({ t: +k[0], c: +k[4] }); st = +d[d.length - 1][0] + DAY; if (d.length < 1000) break; await sleep(60); }
  return out.filter(b => b.t + DAY <= NOW && b.c > 0); }
async function yahoo(s) { const j = await getJ(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1d&range=25y&includePrePost=false`, { 'User-Agent': 'Mozilla/5.0' });
  const x = j && j.chart && j.chart.result && j.chart.result[0]; if (!x || !x.timestamp) return [];
  const q = (x.indicators.adjclose && x.indicators.adjclose[0] && x.indicators.adjclose[0].adjclose) || x.indicators.quote[0].close; // precio ajustado (incluye dividendos y splits)
  return x.timestamp.map((t, i) => ({ t: t * 1000, c: q[i] })).filter(b => b.c > 0); }
const sma = (v, p) => { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };
function rsiW(b) { /* RSI 14 con cierres semanales, llevado a cada día (solo semanas cerradas) */ const wk = [], idx = []; let cur = -1;
  for (let i = 0; i < b.length; i++) { const w = Math.floor((b[i].t / DAY + 3) / 7); if (w !== cur) { if (cur !== -1) wk.push(b[i - 1].c); cur = w; } idx.push(wk.length - 1); }
  const r = Array(wk.length).fill(null); let g = 0, l = 0; for (let i = 1; i < wk.length; i++) { const d = wk[i] - wk[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= 14) { g += u; l += w; if (i === 14) { g /= 14; l /= 14; r[i] = l ? 100 - 100 / (1 + g / l) : 100; } } else { g = (g * 13 + u) / 14; l = (l * 13 + w) / 14; r[i] = l ? 100 - 100 / (1 + g / l) : 100; } }
  return idx.map(k => k >= 0 ? r[k] : null); }
const RULES = {
  cualquier_dia: () => true,
  sma200s: (b, i, X) => X.s1400[i] != null && b[i].c < X.s1400[i],
  mayer08: (b, i, X) => X.s200[i] != null && b[i].c / X.s200[i] < .8,
  dd50: (b, i, X) => X.dd[i] <= -50, dd70: (b, i, X) => X.dd[i] <= -70,
  rsi_s30: (b, i, X) => X.rw[i] != null && X.rw[i] < 30,
  combo: (b, i, X) => X.dd[i] <= -50 && X.s200[i] != null && b[i].c < X.s200[i] && X.rw[i] != null && X.rw[i] < 40 };
function study(b) { const cl = b.map(x => x.c), X = { s200: sma(cl, 200), s1400: sma(cl, 1400), rw: rsiW(b), dd: [] }; let mx = 0; for (const x of b) { mx = Math.max(mx, x.c); X.dd.push((x.c / mx - 1) * 100); }
  const R = {}; for (const nm in RULES) { const L = []; let free = 0;
    for (let i = 365; i < b.length; i++) { if (b[i].t < free || !RULES[nm](b, i, X)) continue; free = b[i].t + 30 * DAY;
      const e = b[i].c, at = y => { const t = b[i].t + y * 365 * DAY; let j = i; while (j < b.length && b[j].t < t) j++; return j < b.length ? b[j].c / e - 1 : null; };
      let mn = e; const t3 = b[i].t + 3 * 365 * DAY; for (let j = i; j < b.length && b[j].t <= t3; j++) mn = Math.min(mn, b[j].c);
      L.push({ t: b[i].t, y1: at(1), y2: at(2), y3: at(3), peor: mn / e - 1, hoy: b[b.length - 1].c / e - 1 }); }
    R[nm] = L; }
  return R; }
const med = v => { if (!v.length) return null; const s = [...v].sort((a, c) => a - c); return s[s.length >> 1]; };
function resumen(L) { const f = k => L.map(x => x[k]).filter(v => v != null), pc = v => v == null ? null : +(v * 100).toFixed(1);
  const o = { entradas: L.length }; for (const k of ['y1', 'y2', 'y3']) { const v = f(k); o[k] = v.length ? { n: v.length, mediana: pc(med(v)), positivas: +(v.filter(x => x > 0).length / v.length * 100).toFixed(1), peor: pc(Math.min(...v)), mejor: pc(Math.max(...v)) } : null; }
  const p = f('peor'); o.caida_despues = p.length ? { mediana: pc(med(p)), peor: pc(Math.min(...p)) } : null;
  const h = f('hoy'); o.hasta_hoy = h.length ? { mediana: pc(med(h)), positivas: +(h.filter(x => x > 0).length / h.length * 100).toFixed(1) } : null; return o; }
(async () => { const OUT = { fecha: new Date().toISOString(), cripto: {}, acciones: {}, por_activo: {} };
  for (const [grupo, list, fn] of [['cripto', CRIPTO, cripto], ['acciones', ACC, yahoo]]) { const all = {}; let q = 0, got = [];
    await Promise.all(Array.from({ length: 4 }, async () => { while (q < list.length) { const s = list[q++]; let b = []; try { b = await fn(s); } catch (e) {} if (b.length < 900) continue; got.push(s);
      const R = study(b); OUT.por_activo[s] = { desde: new Date(b[0].t).toISOString().slice(0, 10), maximo_vs_hoy: +((b[b.length - 1].c / Math.max(...b.map(x => x.c)) - 1) * 100).toFixed(1), reglas: Object.fromEntries(Object.entries(R).filter(([k]) => k !== 'cualquier_dia').map(([k, L]) => [k, resumen(L)])) };
      for (const k in R) (all[k] = all[k] || []).push(...R[k].map(x => ({ ...x, s }))); } }));
    OUT[grupo + '_activos'] = got.sort();
    for (const k in all) OUT[grupo][k] = resumen(all[k]);
    console.log(grupo, got.length, 'activos', JSON.stringify(Object.fromEntries(Object.entries(OUT[grupo]).map(([k, v]) => [k, v.y2 && v.y2.positivas])))); }
  fs.writeFileSync('acumular.json', JSON.stringify(OUT, null, 1)); })();
