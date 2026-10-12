/* Investigación de ACCIONES · ¿qué estrategia y qué temporalidad rinden mejor? (corre en GitHub Actions; Yahoo no deja leer desde el navegador)
   Datos: Yahoo, velas diarias (6 años) y de 1 hora (730 días) de todas las acciones de la planilla (herramientas/sectores.json).
   Estrategias (solo LONG, como con CEDEARs):
     reb6m    rebote tras caída de 6 meses (la regla actual de la página; solo diario)
     rsi2     RSI de 2 bajo 10 con el precio sobre la media de 200 (comprar caídas cortas en tendencia alcista)
     pull21   retroceso a la EMA 21 con EMA 21 > 50 > 200 y vela alcista
     canal    rebote en el piso de un canal alcista (regresión de 50 velas, como el indicador Canal de tendencia)
     ruptura  cierre sobre el máximo de 20 velas, sobre la EMA 200 y con volumen 1,5 × el promedio
   Gestión: A = la de la página (stop 3 × ATR con tope, objetivos 0,5 / 1 / 1,5 × stop, 1/3 en cada uno, stop a la entrada tras el 1)
            B = salida rápida: stop 3 × ATR, sale al cierre cuando el precio cierra sobre la media de 5 (o al plazo)
   Una operación por acción a la vez, × 8, comisión 0,1 % por lado. Aprendizaje: primeros 2/3 del tiempo; prueba: último 1/3.
   Escribe acciones2.json */
const fs = require('fs'), path = require('path');
const SEC = JSON.parse(fs.readFileSync(path.join(__dirname, 'sectores.json'), 'utf8'));
const LIST = [...new Set(Object.entries(SEC).filter(([k]) => !k.startsWith('_') && k !== 'ETFs').flatMap(([, v]) => v))];
const L = 8, FEE = .001, sleep = ms => new Promise(r => setTimeout(r, ms));
async function yahoo(sym, interval, range) { const u = `https://query1.finance.yahoo.com/v8/finance/chart/${sym.replace('.', '-')}?interval=${interval}&range=${range}&includePrePost=false`;
  for (let k = 0; k < 4; k++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (r.status === 404) return null;
      if (r.ok) { const j = await r.json(), x = j.chart && j.chart.result && j.chart.result[0]; if (!x || !x.timestamp) return null; const q = x.indicators.quote[0], b = [];
        x.timestamp.forEach((t, i) => { if (q.close[i] == null || q.open[i] == null || q.high[i] == null || q.low[i] == null) return; b.push({ t: t * 1000, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i], v: q.volume[i] || 0 }); });
        return b; } } catch (e) {} await sleep(2500 * (k + 1)); } return null; }
const ema = (v, p) => { const o = Array(v.length).fill(null), k = 2 / (p + 1); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p - 1) { s += v[i]; continue; } if (i === p - 1) { s += v[i]; o[i] = s / p; continue; } o[i] = v[i] * k + o[i - 1] * (1 - k); } return o; };
const sma = (v, p) => { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };
function rsi(c, p) { const o = Array(c.length).fill(null); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= p) { g += u; l += w; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (p - 1) + u) / p; l = (l * (p - 1) + w) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }
function atr(b, p = 14) { const o = Array(b.length).fill(null); let s = 0; for (let i = 0; i < b.length; i++) { const tr = i ? Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)) : b[i].h - b[i].l;
    if (i < p) { s += tr; if (i === p - 1) o[i] = s / p; } else o[i] = (o[i - 1] * (p - 1) + tr) / p; } return o; }
/* canal de regresión de las últimas N velas: piso, techo y si es alcista */
function canal(b, i, N = 50) { if (i < N) return null; let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0; for (let k = i - N + 1; k <= i; k++) { const y = Math.log(b[k].c); n++; sx += k; sy += y; sxx += k * k; sxy += k * y; }
  const m = (n * sxy - sx * sy) / (n * sxx - sx * sx), c0 = (sy - m * sx) / n; const ru = [], rl = []; for (let k = i - N + 1; k <= i - 1; k++) { ru.push(Math.log(b[k].h) - (c0 + m * k)); rl.push(Math.log(b[k].l) - (c0 + m * k)); }
  ru.sort((x, y) => x - y); rl.sort((x, y) => x - y); const up = ru[Math.round(.96 * (ru.length - 1))], lo = rl[Math.round(.04 * (rl.length - 1))];
  return { alc: m * N > .6 * (up - lo), floor: Math.exp(c0 + m * i + lo) }; }
function prep(b) { const c = b.map(x => x.c), v = b.map(x => x.v); return { c, e21: ema(c, 21), e50: ema(c, 50), e200: ema(c, 200), s200: sma(c, 200), s5: sma(c, 5), r2: rsi(c, 2), atr: atr(b), vavg: sma(v, 20) }; }
const ENTRY = {
  reb6m: (b, P, i, daily) => { if (!daily || i < 252) return false; const x = b[i], body = (x.c - x.o) / ((x.h - x.l) || 1); if (!(body > .5)) return false; let h = 0, l = 1e18; for (let j = i - 251; j <= i; j++) { h = Math.max(h, b[j].h); l = Math.min(l, b[j].l); }
    const r6 = (x.c / b[i - 120].c - 1) * 100; return r6 <= -10 && (x.c / h - 1) * 100 > -35 && (x.c / l - 1) * 100 < 100; },
  rsi2: (b, P, i) => P.s200[i] != null && P.r2[i] != null && b[i].c > P.s200[i] && P.r2[i] < 10,
  pull21: (b, P, i) => P.e200[i] != null && P.e21[i] > P.e50[i] && P.e50[i] > P.e200[i] && b[i].l <= P.e21[i] && b[i].c > P.e21[i] && b[i].c > b[i].o,
  canal: (b, P, i) => { if (P.e200[i] == null || b[i].c < P.e200[i]) return false; const K = canal(b, i); return K && K.alc && b[i].l <= K.floor * (1 + .15 * P.atr[i] / b[i].c) && b[i].c > K.floor; },
  ruptura: (b, P, i) => { if (i < 21 || P.e200[i] == null || b[i].c < P.e200[i] || !P.vavg[i]) return false; let h = 0; for (let j = i - 20; j < i; j++) h = Math.max(h, b[j].h); return b[i].c > h && b[i].v > 1.5 * P.vavg[i]; },
};
/* simulación de una operación entrando al cierre de la vela i */
function sim(b, P, i, g, kind) { const e = b[i].c, a = P.atr[i]; if (!a) return null; const sl = Math.min(g.cap, Math.max(.004, 3 * a / e)), stop0 = e * (1 - sl), tps = [1, 2, 3].map(k => e * (1 + k * .5 * sl));
  let hit = 0, real = 0, j = i + 1, pnl = null;
  for (; j < b.length && j <= i + g.max; j++) { const x = b[j], stop = hit ? e : stop0;
    if (x.l <= stop) { pnl = real + (1 - hit / 3) * (stop / e - 1); break; }
    if (kind === 'A') { while (hit < 3 && x.h >= tps[hit]) { real += (tps[hit] / e - 1) / 3; hit++; } if (hit >= 3) { pnl = real; break; } }
    else if (P.s5[j] != null && x.c > P.s5[j]) { pnl = x.c / e - 1; hit = x.c > e ? 1 : 0; break; } }
  if (pnl == null) { if (j >= b.length) return null; pnl = real + (1 - hit / 3) * (b[Math.min(j, b.length - 1)].c / e - 1); }
  if (kind === 'B' && pnl > 0) hit = Math.max(hit, 1);
  return { t: b[i].t, j: Math.min(j, b.length - 1), pct: 100 * L * (Math.max(-sl, pnl) - 2 * FEE), hit, loss: pnl < 0 }; }
function run(DATA, daily) { const g = daily ? { cap: .096, max: 30 } : { cap: .05, max: 70 }, R = {};
  for (const name of Object.keys(ENTRY)) for (const kind of ['A', 'B']) { const ops = [];
    for (const [s, b] of Object.entries(DATA)) { const P = prep(b); let free = 0;
      for (let i = 210; i < b.length - 1; i++) { if (i < free) continue; if (!ENTRY[name](b, P, i, daily)) continue; const o = sim(b, P, i, g, kind); if (!o) continue; o.s = s; ops.push(o); free = o.j + 1; } }
    if (ops.length) R[name + '·' + kind] = ops; }
  return R; }
function stats(L, days) { const n = L.length; if (!n) return { n: 0 }; const tot = L.reduce((a, o) => a + o.pct, 0), w = L.filter(o => o.pct > 0).length, lo = L.filter(o => o.pct < 0);
  const gw = L.filter(o => o.pct > 0).reduce((a, o) => a + o.pct, 0), gl = -lo.reduce((a, o) => a + o.pct, 0);
  return { n, dia: +(n / days).toFixed(2), obj1: +(L.filter(o => o.hit >= 1).length / n * 100).toFixed(1), gana: +(w / n * 100).toFixed(1), pct: +(tot / n).toFixed(2), usd500: +(tot / n * 5).toFixed(1),
    perdida_media: lo.length ? +(gl / lo.length).toFixed(2) : 0, peor: +Math.min(...L.map(o => o.pct)).toFixed(1), pf: gl ? +(gw / gl).toFixed(2) : null, total_usd500: Math.round(tot * 5) }; }
(async () => { const t0 = Date.now(), D1 = {}, H1 = {}; let q = 0, ok1 = 0, okh = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (q < LIST.length) { const s = LIST[q++];
    const d = await yahoo(s, '1d', '6y'); if (d && d.length > 300) { D1[s] = d; ok1++; }
    const h = await yahoo(s, '60m', '730d'); if (h && h.length > 400) { H1[s] = h; okh++; } await sleep(120); } }));
  console.log('acciones', LIST.length, 'diario', ok1, '1 h', okh, ((Date.now() - t0) / 1000).toFixed(0), 's');
  const OUT = { fecha: new Date().toISOString(), acciones: LIST.length, con_diario: ok1, con_1h: okh, res: {} };
  for (const [tf, DATA, daily] of [['diario', D1, true], ['1h', H1, false]]) { const R = run(DATA, daily), all = Object.values(R).flat(); if (!all.length) continue;
    const t1 = Math.min(...all.map(o => o.t)), t2 = Math.max(...all.map(o => o.t)), cut = t1 + (t2 - t1) * 2 / 3, D = x => Math.max(1, x / 864e5);
    for (const [k, ops] of Object.entries(R)) { const tr = ops.filter(o => o.t < cut), te = ops.filter(o => o.t >= cut);
      OUT.res[tf + ' · ' + k] = { todo: stats(ops, D(t2 - t1)), aprendizaje: stats(tr, D(cut - t1)), prueba: stats(te, D(t2 - cut)) }; } }
  fs.writeFileSync('acciones2.json', JSON.stringify(OUT, null, 1));
  for (const [k, v] of Object.entries(OUT.res)) console.log(k.padEnd(22), 'prueba', JSON.stringify(v.prueba)); })();
