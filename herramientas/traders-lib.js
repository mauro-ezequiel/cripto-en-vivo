/* BOTS DE TRADERS (octubre 2026): 5 bots que copian estrategias públicas de traders conocidos, elegidos en herramientas/investigacion-traders.js
   (4 años, 60 monedas con más volumen, 300 USD por señal, con costos). Este archivo tiene las reglas, las usan el bot (en práctica 24 h,
   herramientas/versiones.js) y la prueba de 4 años (RONDA=5 de la investigación), así las dos miden exactamente lo mismo.
   Velas: { t, o, h, l, c, v } ya cerradas (la última es la última cerrada). */
const H = 36e5, DAY = 864e5, TFMS = { '4h': 4 * H, '12h': 12 * H, '1d': DAY };
const BOTS = [
  { v: 1, k: 'sopa', tf: '4h', r: .75, lev: 10, maxsl: .05, age: 7 * DAY, nm: 'RASCHKE · Turtle Soup 4 h', quien: 'Linda Bradford Raschke',
    txt: 'Ruptura falsa: el precio hace un mínimo (máximo) nuevo de 20 velas por debajo de uno de hace 4–20 velas y vuelve a pasarlo → entra al revés. Stop bajo el mínimo nuevo; 3 objetivos a 0,75 × stop; × 10; BTC a favor.' },
  { v: 2, k: 'tort', tf: '4h', n: 20, m: 10, riesgo: .35, maxsl: .25, age: 90 * DAY, nm: 'TORTUGAS · Donchian 20/10 · 4 h', quien: 'Richard Dennis y los Turtles',
    txt: 'Reglas originales de las Tortugas: entra cuando rompe el máximo (mínimo) de 20 velas, con la EMA 200 a favor; stop 2 N (2 ATR de 20) y sale al romper el mínimo (máximo) de 10 velas. La X se ajusta al stop (35 % del margen, de × 1 a × 10). Sin objetivos fijos: deja correr la tendencia.' },
  { v: 3, k: 'sopa', tf: '12h', r: .5, lev: 10, maxsl: .05, age: 14 * DAY, nm: 'RASCHKE · Turtle Soup 12 h', quien: 'Linda Bradford Raschke',
    txt: 'La misma ruptura falsa en velas de 12 h. 3 objetivos a 0,5 × stop; × 10; BTC a favor. En la prueba de 4 años con estas mismas reglas: 71 % ganadas.' },
  { v: 4, k: 'tort', tf: '12h', n: 55, m: 20, riesgo: .35, maxsl: .25, age: 120 * DAY, nm: 'TORTUGAS · Donchian 55/20 · 12 h', quien: 'Richard Dennis y los Turtles',
    txt: 'Sistema 2 de las Tortugas en velas de 12 h: rompe el máximo (mínimo) de 55 velas con la EMA 200 a favor; stop 2 N y sale al romper 20 velas en contra. X según el stop (de × 1 a × 10).' },
  { v: 5, k: 'conn', tf: '12h', r: .5, lev: 10, maxsl: .05, adxb: 24, age: 14 * DAY, nm: 'CONNORS · RSI 2 · 12 h', quien: 'Larry Connors',
    txt: 'Compra caídas fuertes dentro de una tendencia alcista: precio sobre la media de 200 y RSI de 2 períodos bajo 10 (vende al revés). Stop 1 ATR; 3 objetivos a 0,5 × stop; × 10; BTC a favor y con fuerza (ADX 4 h ≥ 24).' }];
const DESDE = '2026-10-26T12:00:00-03:00';

function ema(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let pr = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { pr = s / p; o[i] = pr; } } else { pr = v[i] * k + pr * (1 - k); o[i] = pr; } } return o; }
function wil(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { s /= p; o[i] = s; } } else { s = (s * (p - 1) + v[i]) / p; o[i] = s; } } return o; }
const trA = b => b.map((x, i) => i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l);
const smaA = (v, p) => { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };
function rsiA(cl, p) { const o = Array(cl.length).fill(null); let g = 0, l = 0; for (let i = 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= p) { g += u; l += w; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (p - 1) + u) / p; l = (l * (p - 1) + w) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }
function adxA(b) { const tr = trA(b), at = wil(tr, 14), pd = [0], md = [0]; for (let i = 1; i < b.length; i++) { const u = b[i].h - b[i - 1].h, d = b[i - 1].l - b[i].l; pd.push(u > d && u > 0 ? u : 0); md.push(d > u && d > 0 ? d : 0); }
  const sp = wil(pd, 14), sm = wil(md, 14), dx = at.map((t, i) => { if (!t || sp[i] == null) return null; const a = sp[i] / t, c = sm[i] / t; return a + c > 0 ? 100 * Math.abs(a - c) / (a + c) : null; });
  const adx = Array(b.length).fill(null); let s = 0, c = 0, pr = null; for (let i = 0; i < b.length; i++) { if (dx[i] == null) continue; if (pr === null) { s += dx[i]; if (++c === 14) { pr = s / 14; adx[i] = pr; } } else { pr = (pr * 13 + dx[i]) / 14; adx[i] = pr; } }
  return adx; }
const hiN = (b, i, n) => { let m = -Infinity; for (let j = Math.max(0, i - n); j < i; j++) m = Math.max(m, b[j].h); return m; };
const loN = (b, i, n) => { let m = Infinity; for (let j = Math.max(0, i - n); j < i; j++) m = Math.min(m, b[j].l); return m; };
const r2 = v => v == null || !isFinite(v) ? null : +(+v).toFixed(2);

/* Qué haría el bot V al cierre de la última vela de b. Devuelve una lista de:
   { dir, lvl } = orden pendiente para la vela siguiente (entra si el precio toca lvl), o { dir, ya: true } = entra ahora (a la apertura de la siguiente).
   Cada una con lo necesario para el stop (ext, atr) y la foto de los indicadores (f). */
function plan(V, b, ctx = {}) { const p = b.length - 1; if (p < 230) return []; const Cl = b.map(x => x.c), out = [];
  const A14 = wil(trA(b), 14), a14 = A14[p]; if (!a14) return [];
  const f0 = d => feats(b, d, ctx);
  if (V.k === 'sopa') { for (const d of [1, -1]) { let ref = null; for (let k = p - 4; k >= p - 20; k--) { const ex = d > 0 ? loN(b, k + 1, 20) : hiN(b, k + 1, 20), v = d > 0 ? b[k].l : b[k].h; if (v === ex) { ref = v; break; } }
      if (ref == null) continue; if (!(d > 0 ? b[p].l < ref && b[p].l === loN(b, p + 1, 20) : b[p].h > ref && b[p].h === hiN(b, p + 1, 20))) continue;
      out.push({ dir: d, lvl: ref, ext: d > 0 ? b[p].l : b[p].h, atr: a14, f: f0(d) }); } }
  if (V.k === 'tort') { const A20 = wil(trA(b), 20), E = ema(Cl, 200); if (!E[p] || !A20[p]) return [];
    const up = hiN(b, p + 1, V.n), dn = loN(b, p + 1, V.n);
    if (Cl[p] > E[p]) out.push({ dir: 1, lvl: up, atr: A20[p], f: f0(1) }); if (Cl[p] < E[p]) out.push({ dir: -1, lvl: dn, atr: A20[p], f: f0(-1) }); }
  if (V.k === 'conn') { const r2a = rsiA(Cl, 2), S200 = smaA(Cl, 200); if (!S200[p] || r2a[p] == null) return [];
    if (Cl[p] > S200[p] && r2a[p] < 10) out.push({ dir: 1, ya: true, atr: a14, f: Object.assign(f0(1), { rsi2: r2(r2a[p]) }) });
    if (Cl[p] < S200[p] && r2a[p] > 90) out.push({ dir: -1, ya: true, atr: a14, f: Object.assign(f0(-1), { rsi2: r2(r2a[p]) }) }); }
  return out; }
/* stop (fracción del precio) y X de una entrada en e. lowSince/highSince = extremo de la vela actual hasta la entrada (Turtle Soup) */
function stopDe(V, x, e, lowSince, highSince) { let sl;
  if (V.k === 'sopa') { const ext = x.dir > 0 ? Math.min(x.ext, lowSince != null ? lowSince : x.ext) : Math.max(x.ext, highSince != null ? highSince : x.ext);
    sl = Math.min(Math.max(Math.abs(e - ext) / e + .001, .3 * x.atr / e), 2 * x.atr / e); }
  else if (V.k === 'tort') sl = 2 * x.atr / e; else sl = x.atr / e;
  if (!(sl <= V.maxsl) || sl < .002) return null;
  const lev = V.riesgo ? Math.max(1, Math.min(10, Math.floor(V.riesgo / sl))) : V.lev; return { sl, lev }; }
/* nivel de salida de las Tortugas: mínimo (máximo) de las últimas m velas cerradas */
const salidaTort = (V, b, dir) => dir > 0 ? loN(b, b.length, V.m) : hiN(b, b.length, V.m);
/* foto de los indicadores al momento de la señal (para ver qué le suma y qué le resta a cada bot) */
function feats(b, d, ctx) { const p = b.length - 1, Cl = b.map(x => x.c), E200 = ema(Cl, 200), A = wil(trA(b), 14), adx = adxA(b), r14 = rsiA(Cl, 14);
  let vs = 0; for (let j = Math.max(0, p - 19); j <= p; j++) vs += b[j].v;
  const f = { rsi14: r2(r14[p]), adx: r2(adx[p]), ema200_dist: E200[p] ? r2(d * (Cl[p] / E200[p] - 1) * 100) : null, volumen: r2(b[p].v / ((vs / Math.min(p + 1, 20)) || 1)), atr_pct: r2(A[p] / Cl[p] * 100),
    cambio_20v: p >= 20 ? r2(d * (Cl[p] / Cl[p - 20] - 1) * 100) : null, adx_btc: r2(ctx.btcAdx), btc_a_favor: ctx.btcDir != null ? (ctx.btcDir === d ? 1 : 0) : null,
    tendencia_diaria: ctx.dTrend != null ? (Math.sign(ctx.dTrend) === d ? 1 : 0) : null, hora: new Date(b[p].t + (TFMS[ctx.tf] || 0)).getUTCHours() };
  return f; }
module.exports = { BOTS, DESDE, TFMS, plan, stopDe, salidaTort, feats, ema, wil, trA, adxA };
