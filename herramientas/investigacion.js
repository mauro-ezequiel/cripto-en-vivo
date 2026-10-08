/* Investigación: guarda cada situación candidata del último año con los valores de todos los indicadores y cómo terminó,
   para medir qué indicador ayuda de verdad a acertar (TRADING / TRADING+ en 4h y SHOOTER en 5m).
   Prueba local sin internet: BT_MOCK=1 BT_DAYS=40 BT_NT=5 BT_NS=2 node herramientas/investigacion.js */
/*HEAD*/
const fs = require('fs');
const API = process.env.BT_API || 'https://data-api.binance.vision/api/v3';
const MOCK = !!process.env.BT_MOCK;
const DAY = 864e5, NOW = +(process.env.BT_NOW || Date.now()), SPAN = +(process.env.BT_DAYS || 365) * DAY, FROM = NOW - SPAN, FEE = .0005;
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|USDE|USD1|PYUSD|XUSD|AEUR|EURI|BFUSD|USDS|RLUSD|USDF|FRAX|USDG)USDT$/;
const MIN_N = 20; // con menos casos el % no se publica como acierto
/*MATH*/
let candles = [];
const closes = () => candles.map(b => b.close);
function emaArr(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let prev = null, cnt = 0, sum = 0;
  for (let i = 0; i < v.length; i++) { const x = v[i]; if (x == null) continue;
    if (prev === null) { sum += x; cnt++; if (cnt === p) { prev = sum / p; o[i] = prev; } } else { prev = x * k + prev * (1 - k); o[i] = prev; } }
  return o; }
function trArr() { return candles.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - candles[i - 1].close), Math.abs(b.low - candles[i - 1].close)) : b.high - b.low); }
function wilder(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { s /= p; o[i] = s; } } else { s = (s * (p - 1) + v[i]) / p; o[i] = s; } } return o; }
function calcRSI(p = 14) { const c = closes(), o = Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
  return o; }
function calcADX(p = 14) { const n = candles.length, pdm = [0], mdm = [0];
  for (let i = 1; i < n; i++) { const up = candles[i].high - candles[i - 1].high, dn = candles[i - 1].low - candles[i].low; pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0); }
  const tr = wilder(trArr(), p), sp = wilder(pdm, p), sm = wilder(mdm, p);
  const pdi = tr.map((t, i) => t ? 100 * sp[i] / t : null), mdi = tr.map((t, i) => t ? 100 * sm[i] / t : null);
  const dx = pdi.map((x, i) => x != null && (x + mdi[i]) > 0 ? 100 * Math.abs(x - mdi[i]) / (x + mdi[i]) : null);
  const adx = Array(n).fill(null); let s = 0, c = 0, prev = null;
  for (let i = 0; i < n; i++) { if (dx[i] == null) continue; if (prev === null) { s += dx[i]; c++; if (c === p) { prev = s / p; adx[i] = prev; } } else { prev = (prev * (p - 1) + dx[i]) / p; adx[i] = prev; } }
  return { adx, pdi, mdi }; }
function calcST(p = 10, m = 3) { const n = candles.length, atr = wilder(trArr(), p), dir = Array(n).fill(null); let fu = null, fl = null, d = 1;
  for (let i = 0; i < n; i++) { if (atr[i] == null) continue; const b = candles[i], hl = (b.high + b.low) / 2, ub = hl + m * atr[i], lb = hl - m * atr[i];
    if (fu === null) { fu = ub; fl = lb; } else { const pc = candles[i - 1].close; fu = (ub < fu || pc > fu) ? ub : fu; fl = (lb > fl || pc < fl) ? lb : fl; }
    if (d === 1 && b.close < fl) d = -1; else if (d === -1 && b.close > fu) d = 1; dir[i] = d; }
  return { dir }; }
function smaStd(v, p) { const m = Array(v.length).fill(null), s = Array(v.length).fill(null); let a = 0, q = 0;
  for (let i = 0; i < v.length; i++) { a += v[i]; q += v[i] * v[i]; if (i >= p) { a -= v[i - p]; q -= v[i - p] * v[i - p]; }
    if (i >= p - 1) { const mu = a / p; m[i] = mu; s[i] = Math.sqrt(Math.max(0, q / p - mu * mu)); } }
  return [m, s]; }

/*DATA*/
const sleep = ms => new Promise(r => setTimeout(r, ms));
let mockSeed = 1; const rnd = () => (mockSeed = (mockSeed * 16807) % 2147483647) / 2147483647;
function mockKlines(url) { const q = new URL(url), s = q.searchParams.get('symbol'), tf = q.searchParams.get('interval');
  const ms = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 }[tf], st = +q.searchParams.get('startTime'), en = +q.searchParams.get('endTime');
  let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 1e6;
  const f = t => { const m = Math.floor(t / 3e5), n = Math.sin(m * 12.9898 + h) * 43758.5453; // mismo precio en todas las temporalidades
    return 100 * Math.exp(Math.sin(t / 2e9 + h) * .5 + Math.sin(t / 3e8 + h * 2) * .2 + Math.sin(t / 4e7 + h * 3) * .06 + Math.sin(t / 6e6 + h) * .012 + (n - Math.floor(n) - .5) * .01); };
  const out = [];
  for (let t = Math.ceil(st / ms) * ms; t <= en && out.length < 1000; t += ms) { const pts = []; for (let u = t; u < t + ms; u += 3e5) pts.push(f(u)); pts.push(f(t + ms - 1));
    out.push([t, pts[0], Math.max(...pts), Math.min(...pts), pts[pts.length - 1], 1000 + (pts.length * 37 + t / 3e5) % 1000, t + ms - 1, 0, 0, 500]); }
  return out; }
async function getJ(url, tries = 6) {
  if (MOCK) { if (url.includes('/ticker/24hr')) return Array.from({ length: 90 }, (_, k) => ({ symbol: k ? 'C' + k + 'USDT' : 'BTCUSDT', quoteVolume: String(1e9 / (k + 1)), priceChangePercent: '1' })); return mockKlines(url); }
  for (let k = 0; k < tries; k++) { try { const r = await fetch(url); if (r.ok) return await r.json();
      if (r.status === 429 || r.status === 418 || r.status >= 500) { await sleep(5000 * (k + 1)); continue; } throw new Error(r.status + ' ' + url); }
    catch (e) { if (k === tries - 1) throw e; await sleep(3000); } } }
const toBar = k => ({ t: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], v: +k[5], tb: +k[9] });
async function klRange(s, tf, tfMs, from, to) { const out = []; let st = from;
  while (st < to) { const d = await getJ(`${API}/klines?symbol=${s}&interval=${tf}&startTime=${st}&endTime=${to}&limit=1000`); if (!d || !d.length) break;
    for (const k of d) out.push(toBar(k)); st = d[d.length - 1][0] + tfMs; if (d.length < 1000) break; if (!MOCK) await sleep(60); }
  return out.filter(b => b.t + tfMs <= to); }
const idxAfter = (rb, t) => { let lo = 0, hi = rb.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (rb[mid].t < t) lo = mid + 1; else hi = mid; } return lo; };
const lastClosed = (arr, ms, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const md = (lo + hi) >> 1; if (arr[md].t + ms <= t) lo = md + 1; else hi = md; } return lo - 1; };

/* ---------- simulación de una operación (como la página) ----------
   kind: 1 stop · 2 aviso de salida (TRADING+) · 3 volvió a la entrada tras un objetivo · 4 los 3 objetivos · 5 plazo */
function sim(rb, resMs, maxAge, j0, entry, dir, sl, r, L, ex, llConf, t0) {
  let hit = 0, real = 0, j = j0, kind = 5, ae = entry, sz = 1, ll = 0, llNo = !llConf, pnl = null;
  const tps = [1, 2, 3].map(k => entry * (1 + dir * k * r * sl)); let fail = entry * (1 - dir * sl); const llAt = entry * (1 - dir * sl * .65);
  const val = px => real + (1 - hit / 3) * sz * dir * (px / ae - 1);
  for (; j < rb.length; j++) { const b = rb[j]; if (b.t - t0 > maxAge) { j--; break; }
    const adv = dir > 0 ? b.low : b.high, fav = dir > 0 ? b.high : b.low;
    if (!hit && !ll && !llNo && dir * (adv - llAt) <= 0) { if (llConf(b.t, dir)) { ae = (entry + .5 * llAt) / 1.5; sz = 1.5; fail = ae * (1 - dir * sl); ll = 1; } else llNo = true; }
    const stop = hit === 0 ? fail : ae;
    if (dir * (stop - adv) >= 0) { pnl = val(stop); kind = hit ? 3 : 1; break; }
    while (hit < 3 && dir * (fav - tps[hit]) >= 0) { real += sz * dir * (tps[hit] / ae - 1) / 3; hit++; }
    if (hit >= 3) { pnl = real; kind = 4; break; }
    if (!hit && ex === 'mitad' && dir * (entry - b.close) / entry >= .5 * sl) { pnl = val(b.close); kind = 2; break; } }
  const open = pnl == null && (j >= rb.length || !rb.length) && rb.length && rb[rb.length - 1].t - t0 <= maxAge;
  if (pnl == null) { const jj = Math.min(Math.max(j, j0), rb.length - 1), px = rb[jj] ? rb[jj].close : entry; pnl = Math.max(-sz * sl, val(px)); j = jj; }
  const end = rb[Math.min(Math.max(j, 0), rb.length - 1)];
  return { pct: 100 * L * (pnl - 2 * FEE * sz), hit, kind, ll, open, tEnd: end ? end.t + resMs : t0 }; }
const slOf = (g, atrP) => Math.min(g.cap, Math.max(g.floor, g.a * atrP));
/* ---------- extras para la investigación ---------- */
const H1 = 36e5, M5 = 3e5, M15 = 9e5, T4ms = 144e5;
const GEO = {
  core: { L: 10, a: 3, cap: .036, floor: .004, r: .5, ex: 'no', ll: true },
  plus: { L: 7, a: 3, cap: .11, floor: 0, r: .35, ex: 'mitad', ll: false },
  sh:   { L: 10, a: 3, cap: .076, floor: .004, r: .5, ex: 'no', ll: false }
};
const r3 = x => x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000;
const barDelta = b => { const tb = b.tb != null && !isNaN(b.tb) ? b.tb : b.v / 2; return 2 * tb - b.v; };
function smaArr(v, p) { const o = Array(v.length).fill(null); let s = 0, c = 0; const q = [];
  for (let i = 0; i < v.length; i++) { const x = v[i]; q.push(x); if (x != null) { s += x; c++; } if (q.length > p) { const y = q.shift(); if (y != null) { s -= y; c--; } } if (c === p) o[i] = s / p; } return o; }
function stochK(rsi, p = 14) { const raw = rsi.map((x, i) => { if (x == null || i < p) return null; let lo = 1e9, hi = -1e9; for (let j = i - p + 1; j <= i; j++) { if (rsi[j] == null) return null; lo = Math.min(lo, rsi[j]); hi = Math.max(hi, rsi[j]); } return hi > lo ? 100 * (x - lo) / (hi - lo) : 50; });
  return smaArr(raw, 3); }
function htfArr(bars) { candles = bars; const cl = closes(), e = emaArr(cl, 21); return cl.map((c, i) => i < 4 || e[i] == null || e[i - 3] == null ? 0 : (c > e[i] ? .5 : -.5) + (e[i] > e[i - 3] ? .5 : -.5)); }
function flowN(bars, n) { return bars.map((b, i) => { let f = 0, v = 0; for (let j = Math.max(0, i - n + 1); j <= i; j++) { f += barDelta(bars[j]); v += bars[j].v; } return v ? f / v : 0; }); }
function volRatio(bars) { let s = 0; return bars.map((b, i) => { s += b.v; if (i >= 20) s -= bars[i - 20].v; return b.v / ((s / Math.min(i + 1, 20)) || 1); }); }
function midHL(bars, i, p) { if (i < p - 1) return null; let h = -1e18, l = 1e18; for (let j = i - p + 1; j <= i; j++) { h = Math.max(h, bars[j].high); l = Math.min(l, bars[j].low); } return (h + l) / 2; }
function ichiPos(bars) { const n = bars.length, A = Array(n).fill(null), B = Array(n).fill(null);
  for (let i = 0; i < n; i++) { const t = midHL(bars, i, 9), k = midHL(bars, i, 26), b = midHL(bars, i, 52); if (t != null && k != null) A[i] = (t + k) / 2; B[i] = b; }
  return bars.map((b, i) => { const a = A[i - 26], bb = B[i - 26]; if (a == null || bb == null) return null; const top = Math.max(a, bb), bot = Math.min(a, bb); return b.close > top ? 1 : b.close < bot ? -1 : 0; }); }
function stAgeArr(dir) { let a = 0; return dir.map((d, i) => { if (i && d === dir[i - 1]) a++; else a = 0; return a; }); }
function macdHist(cl) { const f = emaArr(cl, 12), s = emaArr(cl, 26), m = cl.map((_, i) => f[i] != null && s[i] != null ? f[i] - s[i] : null), sg = emaArr(m, 9); return m.map((x, i) => x != null && sg[i] != null ? x - sg[i] : null); }
function poc(bars, i, n, atr) { if (i < n) return null; let h = -1e18, l = 1e18; for (let j = i - n + 1; j <= i; j++) { h = Math.max(h, bars[j].high); l = Math.min(l, bars[j].low); } if (!(h > l)) return null;
  const K = 30, bin = Array(K).fill(0); for (let j = i - n + 1; j <= i; j++) { const tp = (bars[j].high + bars[j].low + bars[j].close) / 3; bin[Math.min(K - 1, Math.floor((tp - l) / (h - l) * K))] += bars[j].v; }
  let mx = 0; for (let k = 1; k < K; k++) if (bin[k] > bin[mx]) mx = k; const p = l + (mx + .5) * (h - l) / K; return (bars[i].close - p) / atr; }
function fibPos(bars, i, n) { if (i < n) return null; let h = -1e18, l = 1e18; for (let j = i - n + 1; j <= i; j++) { h = Math.max(h, bars[j].high); l = Math.min(l, bars[j].low); } return h > l ? (bars[i].close - l) / (h - l) : .5; }
/* máximo a favor y en contra (en ATR) dentro de un plazo */
function excursion(rb, j0, t0, horizon, entry, dir, atr) { let fav = 0, adv = 0; for (let j = j0; j < rb.length && rb[j].t - t0 < horizon; j++) { const b = rb[j]; fav = Math.max(fav, dir * ((dir > 0 ? b.high : b.low) - entry)); adv = Math.max(adv, -dir * ((dir > 0 ? b.low : b.high) - entry)); } return [fav / atr, adv / atr]; }
const weekKey = t => Math.floor((t / 864e5 + 3) / 7);
function weekly(db) { const out = []; let cur = null, key = null; for (const x of db) { const k = weekKey(x.t); if (k !== key) { key = k; cur = { ...x, t: (k * 7 - 3) * 864e5 }; out.push(cur); } else { cur.high = Math.max(cur.high, x.high); cur.low = Math.min(cur.low, x.low); cur.close = x.close; cur.v += x.v; } } return out; }

let BTC = null;
async function loadBTC() {
  const b4 = await klRange('BTCUSDT', '4h', T4ms, FROM - 300 * T4ms, NOW); candles = b4; const c4 = closes();
  const b1 = await klRange('BTCUSDT', '1h', H1, FROM - 300 * H1, NOW); candles = b1; const c1 = closes();
  const bd = await klRange('BTCUSDT', '1d', DAY, FROM - 320 * DAY, NOW);
  const b5 = await klRange('BTCUSDT', '5m', M5, FROM - 50 * M5, NOW);
  candles = b4; const adx4 = calcADX(14).adx;
  BTC = { b4, e4: emaArr(c4, 50), adx4, b1, e1: emaArr(c1, 50), bd, hd: htfArr(bd), b5 }; }
const sideAt = (b, e, ms, t) => { const i = lastClosed(b, ms, t); return i >= 0 && e[i] != null ? Math.sign(b[i].close - e[i]) : 0; };
const valAt = (b, arr, ms, t) => { const i = lastClosed(b, ms, t); return i >= 0 ? arr[i] : null; };

/* ---------- 4 horas: TRADING y TRADING+ ---------- */
const C4 = ['t', 's', 'rank', 'dir', 'al', 'ab200', 'rr', 'r7', 'adx', 'di', 'atrP', 'vr', 'body', 'fl3', 'fl6', 'z', 'd21', 'd50', 'd200', 's50', 'stAge', 'mh', 'mhUp', 'sk', 'ich', 'poc', 'fib', 'htf', 'wk', 'btc4', 'btcD', 'btcAdx', 'r24', 'r7d', 'hr', 'wd', 'mfe', 'mae', 'cH', 'cK', 'cP', 'pH', 'pK', 'pP'];
const R4 = [];
async function run4h(s, rank, si) {
  const tb = await klRange(s, '4h', T4ms, FROM - 300 * T4ms, NOW); if (tb.length < 400) return;
  const rb = await klRange(s, '1h', H1, FROM, NOW); if (rb.length < 50) return;
  const db = await klRange(s, '1d', DAY, FROM - 320 * DAY, NOW);
  const dH = htfArr(db), wb = weekly(db), wH = htfArr(wb);
  candles = tb; const cl = closes(), atr = wilder(trArr(), 14), st = calcST(10, 3).dir, e21 = emaArr(cl, 21), e50 = emaArr(cl, 50), e200 = emaArr(cl, 200);
  const r14 = calcRSI(14), r7 = calcRSI(7), A = calcADX(14), [bm, bs] = smaStd(cl, 20), mh = macdHist(cl), sk = stochK(r14), ich = ichiPos(tb), f3 = flowN(tb, 3), f6 = flowN(tb, 6), vr = volRatio(tb), age = stAgeArr(st);
  const llConf = (t, dir) => { const i = lastClosed(tb, T4ms, t); return i >= 0 && e200[i] != null && (dir > 0 ? tb[i].close > e200[i] : tb[i].close < e200[i]); };
  for (let i = 300; i < tb.length; i++) { const t = tb[i].t + T4ms; if (t < FROM) continue;
    const d = st[i]; if (!d || e200[i] == null || r14[i] == null || A.adx[i] == null || !atr[i]) continue;
    const b = tb[i], cb = b.close, at = atr[i], atrP = at / cb, j0 = idxAfter(rb, t); if (j0 >= rb.length) continue;
    const di = (A.pdi[i] - A.mdi[i]) / ((A.pdi[i] + A.mdi[i]) || 1) * d;
    const z = bs[i] ? (cb - bm[i]) / bs[i] : 0, ki = lastClosed(db, DAY, t), wi = lastClosed(wb, 7 * DAY, t);
    const g1 = GEO.core, s1 = slOf(g1, atrP), o1 = sim(rb, H1, 7 * DAY, j0, cb, d, s1, g1.r, g1.L, g1.ex, llConf, t);
    const g2 = GEO.plus, s2 = slOf(g2, atrP), o2 = sim(rb, H1, 7 * DAY, j0, cb, d, s2, g2.r, g2.L, g2.ex, null, t);
    const [mfe, mae] = excursion(rb, j0, t, DAY, cb, d, at);
    const hr = new Date(t).getUTCHours(), wd = new Date(t).getUTCDay();
    R4.push([t, si, rank, d, (e21[i] > e50[i] ? 1 : -1) * d, (cb > e200[i] ? 1 : -1) * d, r3(d > 0 ? r14[i] : 100 - r14[i]), r3(r7[i] == null ? null : d > 0 ? r7[i] : 100 - r7[i]), r3(A.adx[i]), r3(di), r3(atrP), r3(vr[i]),
      r3(d * (b.close - b.open) / ((b.high - b.low) || 1)), r3(d * f3[i]), r3(d * f6[i]), r3(d * z), r3(d * (cb - e21[i]) / at), r3(d * (cb - e50[i]) / at), r3(d * (cb / e200[i] - 1)), r3(d * (e50[i] / e50[i - 6] - 1) * 100), age[i],
      r3(mh[i] == null ? null : d * mh[i] / at), mh[i] != null && mh[i - 1] != null ? (d * (mh[i] - mh[i - 1]) > 0 ? 1 : 0) : null, r3(sk[i] == null ? null : d > 0 ? sk[i] : 100 - sk[i]), ich[i] == null ? null : ich[i] * d,
      r3(poc(tb, i, 120, at) * d), r3(fibPos(tb, i, 100) == null ? null : d > 0 ? fibPos(tb, i, 100) : 1 - fibPos(tb, i, 100)),
      ki >= 0 ? dH[ki] * d : 0, wi >= 0 ? wH[wi] * d : 0, sideAt(BTC.b4, BTC.e4, T4ms, t) * d, (valAt(BTC.bd, BTC.hd, DAY, t) || 0) * d, r3(valAt(BTC.b4, BTC.adx4, T4ms, t)),
      r3(d * (cb / tb[i - 6].close - 1) * 100), r3(d * (cb / tb[i - 42].close - 1) * 100), hr, wd, r3(mfe), r3(mae),
      o1.hit, o1.open ? 0 : o1.kind, r3(o1.pct), o2.hit, o2.open ? 0 : o2.kind, r3(o2.pct)]); } }

/* ---------- 5 minutos: SHOOTER ---------- */
const CS = ['t', 's', 'rank', 'dir', 'z', 'r7', 'r14', 'adx', 'di', 'atrP', 'vr', 'body', 'fl3', 'st5', 'e200', 'vw', 'h15', 'h1', 'h1adx', 'h4', 'btc1', 'btcR', 'r1h', 'hr', 'wd', 'mfe', 'mae', 'H', 'K', 'P', 'H2', 'P2'];
const RS = [];
async function runSh(s, rank, si) {
  const tb = await klRange(s, '5m', M5, FROM - 300 * M5, NOW); if (tb.length < 2000) return;
  const hb = await klRange(s, '15m', M15, FROM - 130 * M15, NOW), h1 = await klRange(s, '1h', H1, FROM - 300 * H1, NOW), h4 = await klRange(s, '4h', T4ms, FROM - 120 * T4ms, NOW);
  const h15 = htfArr(hb), h4t = htfArr(h4); candles = h1; const c1 = closes(), e1 = emaArr(c1, 50), a1 = calcADX(14).adx;
  candles = tb; const cl = closes(), atr = wilder(trArr(), 14), r7 = calcRSI(7), r14 = calcRSI(14), A = calcADX(14), [bm, bs] = smaStd(cl, 20), st = calcST(10, 3).dir, e200 = emaArr(cl, 200), f3 = flowN(tb, 3), vr = volRatio(tb);
  // VWAP diario (se reinicia a las 00:00 UTC)
  const vw = Array(tb.length); let day = -1, pv = 0, vv = 0; for (let i = 0; i < tb.length; i++) { const b = tb[i], dd = Math.floor(b.t / DAY); if (dd !== day) { day = dd; pv = 0; vv = 0; } const tp = (b.high + b.low + b.close) / 3; pv += tp * b.v; vv += b.v; vw[i] = vv ? pv / vv : b.close; }
  for (let i = 300; i < tb.length - 1; i++) { const t = tb[i].t + M5; if (t < FROM) continue;
    const cb = tb[i].close, at = atr[i]; if (!at || r7[i] == null || !bs[i]) continue; const atrP = at / cb; if (atrP < .002) continue;
    const z = (cb - bm[i]) / bs[i]; if (Math.abs(z) < 1.8) continue; const d = z < 0 ? 1 : -1, rr7 = d > 0 ? r7[i] : 100 - r7[i]; if (rr7 > 35) continue;
    const g = GEO.sh, sl = slOf(g, atrP), o = sim(tb, M5, 4 * H1, i + 1, cb, d, sl, g.r, g.L, g.ex, null, t), o2 = sim(tb, M5, 4 * H1, i + 1, cb, d, sl, .35, g.L, g.ex, null, t);
    const [mfe, mae] = excursion(tb, i + 1, t, 4 * H1, cb, d, at);
    const k15 = lastClosed(hb, M15, t), k1 = lastClosed(h1, H1, t), k4 = lastClosed(h4, T4ms, t), b = tb[i];
    const bi = lastClosed(BTC.b5, M5, t), btcR = bi >= 12 ? d * (BTC.b5[bi].close / BTC.b5[bi - 12].close - 1) * 100 : null;
    RS.push([t, si, rank, d, r3(d * z), r3(rr7), r3(d > 0 ? r14[i] : 100 - r14[i]), r3(A.adx[i]), r3((A.pdi[i] - A.mdi[i]) / ((A.pdi[i] + A.mdi[i]) || 1) * d), r3(atrP), r3(vr[i]), r3(d * (b.close - b.open) / ((b.high - b.low) || 1)), r3(d * f3[i]),
      st[i] * d, e200[i] == null ? null : (cb > e200[i] ? 1 : -1) * d, r3(d * (cb - vw[i]) / at), k15 >= 0 ? h15[k15] * d : 0, k1 >= 0 && e1[k1] != null ? Math.sign(h1[k1].close - e1[k1]) * d : 0, r3(k1 >= 0 ? a1[k1] : null), k4 >= 0 ? h4t[k4] * d : 0,
      sideAt(BTC.b1, BTC.e1, H1, t) * d, r3(btcR), r3(d * (cb / tb[i - 12].close - 1) * 100), new Date(t).getUTCHours(), new Date(t).getUTCDay(), r3(mfe), r3(mae),
      o.hit, o.open ? 0 : o.kind, r3(o.pct), o2.hit, r3(o2.pct)]); } }

async function main() { const t0 = Date.now(), zlib = require('zlib');
  const T = await getJ(`${API}/ticker/24hr`);
  const base = T.filter(t => t.symbol.endsWith('USDT') && !STABLE.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol)).sort((a, b) => b.quoteVolume - a.quoteVolume);
  const syms = base.slice(0, +(process.env.BT_NT || 100)).map(t => [t.symbol, Math.round(+t.quoteVolume), +(+t.priceChangePercent).toFixed(1)]);
  await loadBTC(); console.log('BTC listo');
  const err = [], par = +(process.env.BT_PAR || 3);
  const pool = async (n, fn) => { let q = 0; await Promise.all(Array.from({ length: par }, async () => { while (q < n) { const r = q++; try { await fn(r); } catch (e) { err.push(syms[r][0] + ': ' + e.message); } } })); };
  await pool(syms.length, async r => run4h(syms[r][0], r, r));
  console.log('4h listo', R4.length, ((Date.now() - t0) / 1000).toFixed(0), 's');
  fs.writeFileSync('inv4h.json.gz', zlib.gzipSync(JSON.stringify({ upd: NOW, desde: FROM, cols: C4, syms, rows: R4 })));
  const nS = +(process.env.BT_NS || 50); let q = 0;
  await pool(Math.min(nS, syms.length), async r => runSh(syms[r][0], r, r));
  console.log('5m listo', RS.length, ((Date.now() - t0) / 1000).toFixed(0), 's');
  fs.writeFileSync('inv5m.json.gz', zlib.gzipSync(JSON.stringify({ upd: NOW, desde: FROM, cols: CS, syms, rows: RS })));
  console.log('errores', err.length, err.slice(0, 10)); }
main().catch(e => { console.error(e); process.exitCode = 1; });
