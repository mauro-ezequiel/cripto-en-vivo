/* Investigación de SHOOTER: velas de 1 minuto (120 días) agrupadas en 1, 3 y 5 minutos; tres tipos de entrada
   (reversión, retroceso en tendencia y ruptura) y varias medidas de stop y objetivo, sin apalancamiento (se aplica después).
   Prueba local: BT_MOCK=1 BT_DAYS=5 BT_NS=2 node herramientas/investigacion-shooter.js */
const fs = require('fs');
const API = process.env.BT_API || 'https://data-api.binance.vision/api/v3';
const MOCK = !!process.env.BT_MOCK;
const DAY = 864e5, NOW = +(process.env.BT_NOW || Date.now()), SPAN = +(process.env.BT_DAYS || 120) * DAY, FROM = NOW - SPAN, FEE = .0005;
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|USDE|USD1|PYUSD|XUSD|AEUR|EURI|BFUSD|USDS|RLUSD|USDF|FRAX|USDG)USDT$/;
const MIN_N = 20; // con menos casos el % no se publica como acierto

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
/* ---------- SHOOTER: 1, 3 y 5 minutos a partir de velas de 1 minuto ---------- */
const M1 = 6e4, H1 = 36e5;
const r3 = x => x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000;
const barDelta = b => { const tb = b.tb != null && !isNaN(b.tb) ? b.tb : b.v / 2; return 2 * tb - b.v; };
const BASE = +(process.env.BT_BASE || 1), TFS = (process.env.BT_TFS || '1,3,5').split(',').map(Number), MAXH = +(process.env.BT_MAXH || 4), BI = BASE + 'm';
function agg(b1, k) { if (k === BASE) return b1; const out = []; let cur = null, key = null; const ms = k * M1;
  for (const x of b1) { const kk = Math.floor(x.t / ms); if (kk !== key) { key = kk; cur = { t: kk * ms, open: x.open, high: x.high, low: x.low, close: x.close, v: x.v, tb: x.tb, n: 1 }; out.push(cur); }
    else { cur.high = Math.max(cur.high, x.high); cur.low = Math.min(cur.low, x.low); cur.close = x.close; cur.v += x.v; cur.tb += x.tb; cur.n++; } }
  return out.filter(b => b.n === k / BASE); }
function htfArr(bars) { candles = bars; const cl = closes(), e = emaArr(cl, 21); return cl.map((c, i) => i < 4 || e[i] == null || e[i - 3] == null ? 0 : (c > e[i] ? .5 : -.5) + (e[i] > e[i - 3] ? .5 : -.5)); }
function flowN(bars, n) { return bars.map((b, i) => { let f = 0, v = 0; for (let j = Math.max(0, i - n + 1); j <= i; j++) { f += barDelta(bars[j]); v += bars[j].v; } return v ? f / v : 0; }); }
function volRatio(bars) { let s = 0; return bars.map((b, i) => { s += b.v; if (i >= 20) s -= bars[i - 20].v; return b.v / ((s / Math.min(i + 1, 20)) || 1); }); }
const GEOS = [[2, .5], [3, .5], [3, .35], [2, 1], [3, 1], [1.5, 1]];
const CSH = ['t', 's', 'rank', 'tf', 'typ', 'dir', 'z', 'r7', 'r14', 'adx', 'di', 'atrP', 'vr', 'body', 'fl3', 'st', 'al', 'e200', 'vw', 'h15', 'h1', 'btc1', 'btcR', 'r1h', 'hr', ...GEOS.flatMap((g, k) => ['H' + k, 'P' + k])];
const ROWS = []; let BTC = null;
async function loadBTC() { const b1 = await klRange('BTCUSDT', BI, BASE * M1, FROM - 3 * DAY, NOW); const h = agg(b1, 60); candles = h; const e = emaArr(closes(), 50); BTC = { b1, h, e }; }
const sideAt = (b, e, ms, t) => { const i = lastClosed(b, ms, t); return i >= 0 && e[i] != null ? Math.sign(b[i].close - e[i]) : 0; };
async function runCoin(s, rank) {
  const b1 = await klRange(s, BI, BASE * M1, FROM - 3 * DAY, NOW); if (b1.length < 20000 / BASE) return;
  const h15 = agg(b1, 15), h15t = htfArr(h15), hh = agg(b1, 60); candles = hh; const he = emaArr(closes(), 50);
  for (const k of TFS) { const tb = agg(b1, k), ms = k * M1; candles = tb;
    const cl = closes(), atr = wilder(trArr(), 14), r7 = calcRSI(7), r14 = calcRSI(14), A = calcADX(14), [bm, bs] = smaStd(cl, 20), st = calcST(10, 3).dir, e21 = emaArr(cl, 21), e50 = emaArr(cl, 50), e200 = emaArr(cl, 200), f3 = flowN(tb, 3), vr = volRatio(tb);
    const vw = Array(tb.length); { let day = -1, pv = 0, vv = 0; for (let i = 0; i < tb.length; i++) { const b = tb[i], dd = Math.floor(b.t / DAY); if (dd !== day) { day = dd; pv = 0; vv = 0; } const tp = (b.high + b.low + b.close) / 3; pv += tp * b.v; vv += b.v; vw[i] = vv ? pv / vv : b.close; } }
    const nb = Math.round(H1 / ms), last = [-1e9, -1e9, -1e9], cool = 6;
    for (let i = 300; i < tb.length - 1; i++) { const t = tb[i].t + ms; if (t < FROM) continue; const cb = tb[i].close, at = atr[i]; if (!at || r7[i] == null || r14[i] == null || !bs[i] || e200[i] == null || A.adx[i] == null) continue;
      const atrP = at / cb, z = (cb - bm[i]) / bs[i], b = tb[i]; const cands = [];
      { const d = z < 0 ? 1 : -1, rr = d > 0 ? r7[i] : 100 - r7[i]; if (Math.abs(z) >= 1.8 && rr <= 35) cands.push([0, d]); }
      { const d = st[i]; if (d && (e21[i] > e50[i] ? 1 : -1) === d && (cb > e200[i] ? 1 : -1) === d && (d > 0 ? r14[i] : 100 - r14[i]) < 45) cands.push([1, d]); }
      { let hi = -1e18, lo = 1e18; for (let j = i - 20; j < i; j++) { hi = Math.max(hi, tb[j].high); lo = Math.min(lo, tb[j].low); } const d = cb > hi ? 1 : cb < lo ? -1 : 0; if (d && st[i] === d && vr[i] >= 1.5) cands.push([2, d]); }
      for (const [typ, d] of cands) { if (i - last[typ] < cool) continue; last[typ] = i;
        const outs = GEOS.map(([a, r]) => { const sl = Math.min(.076, Math.max(.002, a * atrP)); return sim(tb, ms, MAXH * H1, i + 1, cb, d, sl, r, 1, 'no', null, t); });
        const k15 = lastClosed(h15, 15 * M1, t), k1 = lastClosed(hh, H1, t), bi = lastClosed(BTC.b1, BASE * M1, t), lb = 60 / BASE;
        const btcR = bi >= lb ? d * (BTC.b1[bi].close / BTC.b1[bi - lb].close - 1) * 100 : null;
        ROWS.push([t, rank, rank, k, typ, d, r3(d * z), r3(d > 0 ? r7[i] : 100 - r7[i]), r3(d > 0 ? r14[i] : 100 - r14[i]), r3(A.adx[i]), r3((A.pdi[i] - A.mdi[i]) / ((A.pdi[i] + A.mdi[i]) || 1) * d), r3(atrP * 100), r3(vr[i]),
          r3(d * (b.close - b.open) / ((b.high - b.low) || 1)), r3(d * f3[i]), st[i] * d, (e21[i] > e50[i] ? 1 : -1) * d, (cb > e200[i] ? 1 : -1) * d, r3(d * (cb - vw[i]) / at),
          k15 >= 0 ? h15t[k15] * d : 0, k1 >= 0 && he[k1] != null ? Math.sign(hh[k1].close - he[k1]) * d : 0, sideAt(BTC.h, BTC.e, H1, t) * d, r3(btcR), r3(d * (cb / tb[i - nb].close - 1) * 100), new Date(t).getUTCHours(),
          ...outs.flatMap(o => [o.hit, r3(o.pct)])]); } } } }
async function main() { const t0 = Date.now(), zlib = require('zlib');
  const T = await getJ(`${API}/ticker/24hr`);
  const base = T.filter(t => t.symbol.endsWith('USDT') && !STABLE.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) && +t.quoteVolume > 1e7 && Math.abs(+t.priceChangePercent) < 25).sort((a, b) => b.quoteVolume - a.quoteVolume);
  const syms = base.slice(0, +(process.env.BT_NS || 30)).map(t => t.symbol);
  await loadBTC(); console.log('BTC listo', BTC.b1.length);
  const err = [], par = +(process.env.BT_PAR || 3); let q = 0;
  await Promise.all(Array.from({ length: par }, async () => { while (q < syms.length) { const r = q++; try { await runCoin(syms[r], r); console.log(syms[r], ROWS.length, ((Date.now() - t0) / 1000).toFixed(0) + 's'); } catch (e) { err.push(syms[r] + ': ' + e.message); } } }));
  fs.writeFileSync('invsh.json.gz', zlib.gzipSync(JSON.stringify({ upd: NOW, desde: FROM, cols: CSH, syms, geos: GEOS, rows: ROWS })));
  console.log('filas', ROWS.length, 'errores', err.length, err.slice(0, 5), ((Date.now() - t0) / 1000).toFixed(0), 's'); }
main().catch(e => { console.error(e); process.exitCode = 1; });
