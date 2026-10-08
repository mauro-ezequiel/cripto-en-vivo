/* Investigación de SHOOTER: tendencia + retroceso en temporalidades bajas (1m, 5m, 15m, 1h).
   Guarda cada situación con los indicadores y el resultado de varias medidas de stop y objetivo, sin apalancamiento,
   para elegir la temporalidad más baja que gane plata y la X. Prueba local: BT_MOCK=1 BT_TFS=5m:10:3 node herramientas/investigacion-shooter.js */
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
  const ms = { '1m': 6e4, '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5, '1d': 864e5 }[tf], st = +q.searchParams.get('startTime'), en = +q.searchParams.get('endTime');
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
/* ---------- extras ---------- */
const r3 = x => x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000;
const barDelta = b => { const tb = b.tb != null && !isNaN(b.tb) ? b.tb : b.v / 2; return 2 * tb - b.v; };
function htfArr(bars) { candles = bars; const cl = closes(), e = emaArr(cl, 21); return cl.map((c, i) => i < 4 || e[i] == null || e[i - 3] == null ? 0 : (c > e[i] ? .5 : -.5) + (e[i] > e[i - 3] ? .5 : -.5)); }
function flowN(bars, n) { const o = Array(bars.length); let f = 0, v = 0; for (let i = 0; i < bars.length; i++) { f += barDelta(bars[i]); v += bars[i].v; if (i >= n) { f -= barDelta(bars[i - n]); v -= bars[i - n].v; } o[i] = v ? f / v : 0; } return o; }
function volRatio(bars) { let s = 0; return bars.map((b, i) => { s += b.v; if (i >= 20) s -= bars[i - 20].v; return b.v / ((s / Math.min(i + 1, 20)) || 1); }); }
function stAgeArr(dir) { let a = 0; return dir.map((d, i) => { if (i && d === dir[i - 1]) a++; else a = 0; return a; }); }
/* simulación sin apalancamiento: devuelve objetivos tocados y resultado por unidad (ya con comisión) */
function simU(rb, j0, nMax, entry, dir, sl, r) { let hit = 0, real = 0, pnl = null, j = j0, kind = 5;
  const tps = [1, 2, 3].map(k => entry * (1 + dir * k * r * sl)), fail = entry * (1 - dir * sl), val = px => real + (1 - hit / 3) * dir * (px / entry - 1);
  for (; j < rb.length && j < j0 + nMax; j++) { const b = rb[j], adv = dir > 0 ? b.low : b.high, fav = dir > 0 ? b.high : b.low, stop = hit ? entry : fail;
    if (dir * (stop - adv) >= 0) { pnl = val(stop); kind = hit ? 3 : 1; break; }
    while (hit < 3 && dir * (fav - tps[hit]) >= 0) { real += dir * (tps[hit] / entry - 1) / 3; hit++; }
    if (hit >= 3) { pnl = real; kind = 4; break; } }
  if (pnl == null) { const px = rb[Math.min(j, rb.length - 1)].close; pnl = Math.max(-sl, val(px)); }
  return [hit, kind, Math.round((pnl - 2 * FEE) * 1e5)]; } // resultado en cienmilésimos (×1e5)
const GEOS = [[3, .5], [2, .5], [3, .35], [1.5, .5]]; // [stop en ATR, objetivo 1 en fracción del stop]
const TFS = (process.env.BT_TFS || '1m:45:25,5m:180:45,15m:365:45,1h:365:45').split(',').map(x => { const [tf, d, n] = x.split(':'); return { tf, days: +d, n: +n, ms: { '1m': 6e4, '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5 }[tf] }; });
const COLS = ['t', 's', 'dir', 'rr', 'r7', 'adx', 'di', 'atrP', 'vr', 'body', 'fl3', 'fl6', 'z', 'd21', 'd50', 'd200', 's50', 'stAge', 'r6', 'r24', 'btc', 'btc1h', 'h1', 'h4', 'hr', 'mfe', 'mae', ...GEOS.flatMap((g, k) => ['H' + k, 'K' + k, 'P' + k])];
async function runTF(T, s, si, B, rows, base) {
  const FROMt = NOW - T.days * DAY, tb = await klRange(s, T.tf, T.ms, FROMt - 300 * T.ms, NOW); if (tb.length < 600) return;
  const h1 = T.ms < 36e5 ? await klRange(s, '1h', 36e5, FROMt - 300 * 36e5, NOW) : tb, h4 = await klRange(s, '4h', 144e5, FROMt - 130 * 144e5, NOW);
  candles = h1; const e1 = emaArr(closes(), 50); const h4t = htfArr(h4);
  candles = tb; const cl = closes(), atr = wilder(trArr(), 14), st = calcST(10, 3).dir, e21 = emaArr(cl, 21), e50 = emaArr(cl, 50), e200 = emaArr(cl, 200), r14 = calcRSI(14), r7 = calcRSI(7), A = calcADX(14), [bm, bs] = smaStd(cl, 20), f3 = flowN(tb, 3), f6 = flowN(tb, 6), vr = volRatio(tb), age = stAgeArr(st);
  const N = 48;
  for (let i = 300; i < tb.length - 1; i++) { const t = tb[i].t + T.ms; if (t < FROMt) continue;
    const d = st[i]; if (!d || e200[i] == null || r14[i] == null || A.adx[i] == null || !atr[i]) continue;
    const b = tb[i], cb = b.close, at = atr[i], atrP = at / cb;
    // línea de base: todas las velas en la dirección del Supertrend (cada 7 para no pesar tanto)
    if (i % 7 === 0) { const sl = Math.max(.002, 3 * atrP), o = simU(tb, i + 1, N, cb, d, sl, .5); base.n++; if (o[0] >= 1) base.h++; base.p += o[2]; }
    const al = e21[i] > e50[i] === d > 0, ab = cb > e200[i] === d > 0; if (!al || !ab) continue;
    const rr = d > 0 ? r14[i] : 100 - r14[i]; if (rr >= 62 || vr[i] >= 1.5) continue;
    const bi = lastClosed(B.b, T.ms, t), btc = bi >= 0 && B.e[bi] != null ? Math.sign(B.b[bi].close - B.e[bi]) * d : 0, bj = lastClosed(B.h1, 36e5, t), btc1h = bj >= 0 && B.e1[bj] != null ? Math.sign(B.h1[bj].close - B.e1[bj]) * d : 0;
    const k1 = lastClosed(h1, 36e5, t), k4 = lastClosed(h4, 144e5, t);
    let fav = 0, adv = 0; for (let j = i + 1; j < tb.length && j <= i + N; j++) { fav = Math.max(fav, d * ((d > 0 ? tb[j].high : tb[j].low) - cb)); adv = Math.max(adv, -d * ((d > 0 ? tb[j].low : tb[j].high) - cb)); }
    const outs = GEOS.flatMap(([a, r]) => simU(tb, i + 1, N, cb, d, Math.max(.002, a * atrP), r));
    rows.push([t, si, d, r3(rr), r3(r7[i] == null ? null : d > 0 ? r7[i] : 100 - r7[i]), r3(A.adx[i]), r3((A.pdi[i] - A.mdi[i]) / ((A.pdi[i] + A.mdi[i]) || 1) * d), r3(atrP * 100), r3(vr[i]), r3(d * (b.close - b.open) / ((b.high - b.low) || 1)), r3(d * f3[i]), r3(d * f6[i]), r3(bs[i] ? d * (cb - bm[i]) / bs[i] : 0),
      r3(d * (cb - e21[i]) / at), r3(d * (cb - e50[i]) / at), r3(d * (cb / e200[i] - 1) * 100), r3(d * (e50[i] / e50[i - 6] - 1) * 100), age[i], r3(d * (cb / tb[i - 6].close - 1) * 100), r3(d * (cb / tb[i - 24].close - 1) * 100), btc, btc1h,
      k1 >= 0 && e1[k1] != null ? Math.sign(h1[k1].close - e1[k1]) * d : 0, k4 >= 0 ? h4t[k4] * d : 0, new Date(t).getUTCHours(), r3(fav / at), r3(adv / at), ...outs]); }
}
async function main() { const t0 = Date.now(), zlib = require('zlib');
  const T = await getJ(`${API}/ticker/24hr`);
  const syms = T.filter(t => t.symbol.endsWith('USDT') && !STABLE.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) && +t.quoteVolume > 1e7 && Math.abs(+t.priceChangePercent) < 25).sort((a, b) => b.quoteVolume - a.quoteVolume).map(t => t.symbol);
  const par = +(process.env.BT_PAR || 3), summary = {};
  for (const Tf of TFS) { const FROMt = NOW - Tf.days * DAY;
    const bb = await klRange('BTCUSDT', Tf.tf, Tf.ms, FROMt - 300 * Tf.ms, NOW); candles = bb; const be = emaArr(closes(), 50);
    const bh = await klRange('BTCUSDT', '1h', 36e5, FROMt - 300 * 36e5, NOW); candles = bh; const be1 = emaArr(closes(), 50);
    const B = { b: bb, e: be, h1: bh, e1: be1 }, rows = [], base = { n: 0, h: 0, p: 0 }, list = syms.slice(0, Tf.n), err = []; let q = 0;
    await Promise.all(Array.from({ length: par }, async () => { while (q < list.length) { const r = q++; try { await runTF(Tf, list[r], r, B, rows, base); } catch (e) { err.push(list[r] + ': ' + e.message); } } }));
    summary[Tf.tf] = { filas: rows.length, base, err: err.slice(0, 5), secs: Math.round((Date.now() - t0) / 1000) }; console.log(Tf.tf, JSON.stringify(summary[Tf.tf]));
    fs.writeFileSync(`invsh_${Tf.tf}.json.gz`, zlib.gzipSync(JSON.stringify({ upd: NOW, tf: Tf.tf, days: Tf.days, cols: COLS, geos: GEOS, syms: list, base, rows }))); }
  fs.writeFileSync('invsh_resumen.json.gz', zlib.gzipSync(JSON.stringify(summary))); }
main().catch(e => { console.error(e); process.exitCode = 1; });
