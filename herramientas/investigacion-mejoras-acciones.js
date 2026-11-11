/* INVESTIGACIÓN MEJORAS ACCIONES (noviembre 2026). No cambia la página ni los bots: solo mide.
   En vivo la regla c-reb (rebote tras caída de 6 meses) ganó 1 de 6. Se compara ACCIONES v7 actual (c-reb + c-rup con el S&P 500 sobre su media
   de 200 días, y c-rsi: RSI diario ≤ 25 con gestión corta) contra filtros extra solo para c-reb. Misma gestión que la página.
   Resultados en USD con 300 USD de margen por señal. Datos diarios de Yahoo.
   Uso: node herramientas/investigacion-mejoras-acciones.js → investigacion-mejoras-acciones.json */
const fs = require('fs'), path = require('path');
const SEC = JSON.parse(fs.readFileSync(path.join(__dirname, 'sectores.json'), 'utf8')), MAC = require('./macro-lib.js');
const LIST = [...new Set(Object.entries(SEC).filter(([k]) => !k.startsWith('_')).flatMap(([, v]) => v))].filter(s => !/^(SPY|QQQ|DIA|IWM|EEM|EWZ|XL.|GLD|SLV|TLT|ARKK|VXX|USO)$/.test(s)).slice(0, +(process.env.NA || 400));
const DAY = 864e5, H = 36e5, NOW = Date.now(), MG = 300, FEE = .001, YRS = +(process.env.ANIOS || 4);
const sleep = ms => new Promise(r => setTimeout(r, ms)), yh = s => s.replace('.', '-');
async function yahoo(sym, interval, range) { const u = `https://query1.finance.yahoo.com/v8/finance/chart/${yh(sym)}?interval=${interval}&range=${range}&includePrePost=false`;
  for (let k = 0; k < 4; k++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (r.status === 404) return null;
      if (r.ok) { const j = await r.json(), x = j && j.chart && j.chart.result && j.chart.result[0]; if (!x || !x.timestamp) return null; const q = x.indicators.quote[0], o = [];
        x.timestamp.forEach((t, i) => { if (q.close[i] == null || q.open[i] == null || q.high[i] == null) return; o.push({ t: t * 1000, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], v: q.volume[i] || 0 }); });
        return o; } } catch (e) {} await sleep(2500 * (k + 1)); } return null; }
/* ---------- indicadores ---------- */
function ema(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let pr = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { pr = s / p; o[i] = pr; } } else { pr = v[i] * k + pr * (1 - k); o[i] = pr; } } return o; }
function sma(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; }
function wil(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { s /= p; o[i] = s; } } else { s = (s * (p - 1) + v[i]) / p; o[i] = s; } } return o; }
const trA = b => b.map((x, i) => i ? Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close)) : x.high - x.low);
function rsi(cl, p = 14) { const o = Array(cl.length).fill(null); let g = 0, l = 0; for (let i = 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= p) { g += u; l += w; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (p - 1) + u) / p; l = (l * (p - 1) + w) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }
function macdH(cl) { const a = ema(cl, 12), b = ema(cl, 26), m = cl.map((_, i) => a[i] != null && b[i] != null ? a[i] - b[i] : null), s = ema(m.map(x => x ?? 0), 9); return m.map((x, i) => x == null || s[i] == null ? null : x - s[i]); }
/* velas de 1 h → 4 h desde la apertura de cada día (como TradingView); diarias → semanales (lunes a viernes) */
const NYF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const ny = t => { const p = Object.fromEntries(NYF.formatToParts(new Date(t)).map(x => [x.type, x.value])); return { d: `${p.year}-${p.month}-${p.day}`, m: (+p.hour % 24) * 60 + +p.minute - 570 }; };
function agg(b, keyf) { const out = []; let key = null, cur = null; for (const x of b) { const k = keyf(x); if (k !== key) { key = k; cur = { ...x }; out.push(cur); } else { cur.high = Math.max(cur.high, x.high); cur.low = Math.min(cur.low, x.low); cur.close = x.close; cur.v += x.v; } } return out; }
const to4h = b => agg(b.filter(x => { const q = ny(x.t); return q.m >= 0 && q.m < 390; }), x => { const q = ny(x.t); return q.d + '#' + Math.floor(q.m / 240); });
const toW = b => agg(b, x => Math.floor((x.t / DAY + 3) / 7));
const idxLE = (b, t) => { let lo = 0, hi = b.length; while (lo < hi) { const m = (lo + hi) >> 1; if (b[m].t <= t) lo = m + 1; else hi = m; } return lo - 1; };

/* ---------- gestión de la página (histFollow) sobre velas de resolución rb ---------- */
function follow(rb, j0, e, sl, r, maxMs, t0) { const T = [1, 2, 3].map(k => e * (1 + k * r * sl)), fail = e * (1 - sl); let hit = 0, real = 0;
  for (let j = j0; j < rb.length; j++) { const b = rb[j];
    if (!hit && b.low <= fail) return { f: -sl, hit, end: b.t, stop: 1 };
    if (hit > 0 && b.low <= e) return { f: real, hit, end: b.t };
    while (hit < 3 && b.high >= T[hit]) { real += (T[hit] / e - 1) / 3; hit++; } if (hit === 3) return { f: real, hit, end: b.t };
    if (b.t - t0 > maxMs) { const px = (b.low + b.high) / 2; return { f: Math.max(-sl, real + (1 - hit / 3) * (px / e - 1)), hit, end: b.t }; } }
  return null; }
const levOf = sl => Math.max(1, Math.min(20, Math.floor(.4 / sl), Math.floor(.8 / sl)));
function res(o, x) { const L = levOf(o.sl); return Object.assign(o, { lev: L, usd: +(MG * L * (x.f - 2 * FEE)).toFixed(2), hit: x.hit, stop: !!x.stop, end: x.end }); }

function st(L, meses) { const D = L.filter(o => o.usd != null), n = D.length; if (!n) return { n: 0 }; const u = D.map(o => o.usd), lo = u.filter(x => x < 0);
  let w = 0, c = 0; for (const x of D.slice().sort((a, b) => a.t - b.t).map(o => o.usd)) { c = x < 0 ? c + x : 0; w = Math.min(w, c); }
  return { n, por_mes: +(n / meses).toFixed(1), gana: +(100 * (n - lo.length) / n).toFixed(1), obj1: +(100 * D.filter(o => o.hit >= 1).length / n).toFixed(1), usd_op: +(u.reduce((a, x) => a + x, 0) / n).toFixed(1),
    usd: Math.round(u.reduce((a, x) => a + x, 0)), perd_media: lo.length ? +(lo.reduce((a, x) => a + x, 0) / lo.length).toFixed(1) : 0, peor_racha: Math.round(w) }; }

(async () => {
  const spyD = await yahoo('SPY', '1d', '10y'), sC = spyD.map(x => x.close), s200 = sma(sC, 200), s50 = sma(sC, 50), s20 = sma(sC, 20);
  const spyAt = t => idxLE(spyD, t - DAY);
  const spyOk = t => { const i = spyAt(t); return i >= 0 && s200[i] != null && spyD[i].close > s200[i]; };
  const V = { // filtro extra para c-reb (true = se permite)
    'v7 ACTUAL': () => true,
    'c-reb solo con S&P 500 sobre su media de 50': (C, t) => { const i = spyAt(t); return s50[i] != null && spyD[i].close > s50[i]; },
    'c-reb solo con S&P 500 sobre su media de 20': (C, t) => { const i = spyAt(t); return s20[i] != null && spyD[i].close > s20[i]; },
    'c-reb solo con S&P 500 en suba el último mes': (C, t) => { const i = spyAt(t); return i > 21 && spyD[i].close > spyD[i - 21].close; },
    'c-reb solo con RSI diario de la acción ≤ 40': C => C.rsi != null && C.rsi <= 40,
    'c-reb solo si la acción cerró sobre su media de 20': C => C.s20,
    'SIN c-reb (c-rup + c-rsi)': () => false };
  const R = {}, add = (k, o) => (R[k] = R[k] || []).push(o); let nOk = 0;
  const FROMD = NOW - YRS * 365 * DAY;
  for (let qi = 0; qi < LIST.length; qi++) { const s = LIST[qi];
    const d1 = await yahoo(s, '1d', '10y'); await sleep(120); if (!d1 || d1.length < 400) continue; nOk++;
    const dC = d1.map(x => x.close), dA = wil(trA(d1), 14), dE200 = ema(dC, 200), dS20 = sma(dC, 20), vav = sma(d1.map(x => x.v), 20), dR = rsi(dC);
    for (const [vn, okF] of Object.entries(V)) { let free = 0;
      for (let i = 260; i < d1.length - 1; i++) { const x = d1[i], t = x.t + DAY; if (t < FROMD || t < free) continue;
        const body = (x.close - x.open) / ((x.high - x.low) || 1); let h = 0, l = 1e18; for (let j = Math.max(0, i - 251); j <= i; j++) { h = Math.max(h, d1[j].high); l = Math.min(l, d1[j].low); }
        const c = x.close, r6 = (c / d1[i - 120].close - 1) * 100, fromHi = (c / h - 1) * 100, fromLo = (c / l - 1) * 100;
        let setup = null; if (body > .5 && r6 <= -10 && fromHi > -35 && fromLo < 100) setup = 'c-reb';
        else if (dE200[i] != null && c > dE200[i] && vav[i] && x.v > 1.5 * vav[i]) { let hh = 0; for (let j = i - 20; j < i; j++) hh = Math.max(hh, d1[j].high); if (c > hh) setup = 'c-rup'; }
        if (setup && !spyOk(t)) setup = null;
        if (setup === 'c-reb' && !okF({ rsi: dR[i], s20: dS20[i] != null && c > dS20[i] }, t)) setup = null;
        if (!setup && dR[i] != null && dR[i] <= 25) setup = 'c-rsi';
        if (!setup || MAC.bloquea(t, 24, 12, ['cpi'])) continue;
        const sl = Math.min(.15, Math.max(.004, 2.5 * dA[i] / c)), rsiS = setup === 'c-rsi';
        const x2 = follow(d1, i + 1, c, sl, rsiS ? 1 : 3, (rsiS ? 21 : 42) * DAY, t); if (!x2) { free = Infinity; continue; }
        const o = res({ s, t, sl, setup }, x2); add(vn, o); add(vn + ' · solo ' + setup, o); free = x2.end; } }
    if (qi % 25 === 0) console.log('acciones', qi, '/', LIST.length); }
  const mid = FROMD + (NOW - FROMD) / 2, M = (NOW - FROMD) / DAY / 30.4;
  const out = { upd: NOW, acciones: nOk, anios: YRS, nota: 'usd = 300 USD de margen por señal con la X de la página (stop ≈ 40 % del margen, máx. × 20), con comisión 0,1 % por lado. Una operación por acción a la vez.', variantes: {} };
  for (const k in R) { const L = R[k].sort((a, b) => a.t - b.t);
    out.variantes[k] = { todo: st(L, M), mitad1: st(L.filter(o => o.t < mid), M / 2), mitad2: st(L.filter(o => o.t >= mid), M / 2), año: st(L.filter(o => o.t >= NOW - 365 * DAY), 12),
      año_mitad1: st(L.filter(o => o.t >= NOW - 365 * DAY && o.t < NOW - 182.5 * DAY), 6), año_mitad2: st(L.filter(o => o.t >= NOW - 182.5 * DAY), 6) }; }
  fs.writeFileSync('investigacion-mejoras-acciones.json', JSON.stringify(out, null, 1));
  for (const [k, v] of Object.entries(out.variantes)) console.log(k, JSON.stringify(v.todo), 'año', JSON.stringify(v.año));
})().catch(e => { console.error(e); process.exit(1); });
