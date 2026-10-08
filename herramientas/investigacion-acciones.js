/* Investigación de ACCIONES: cada vela diaria alcista de los últimos 6 años con todos los indicadores y cómo terminó.
   Lee la lista de acciones de NYSE desde index.html para usar la misma que la página. */
const fs = require('fs');
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
/* ---------- ACCIONES (NYSE, velas diarias armadas como en la página: cierre de NYSE + forma del CEDEAR) ---------- */
const D912 = 'https://data912.com';
const FEE_S = .001;
const r3 = x => x == null || !isFinite(x) ? null : Math.round(x * 1000) / 1000;
const barDelta = b => { const tb = b.tb != null && !isNaN(b.tb) ? b.tb : b.v / 2; return 2 * tb - b.v; };
function htfArr(bars) { candles = bars; const cl = closes(), e = emaArr(cl, 21); return cl.map((c, i) => i < 4 || e[i] == null || e[i - 3] == null ? 0 : (c > e[i] ? .5 : -.5) + (e[i] > e[i - 3] ? .5 : -.5)); }
function flowN(bars, n) { return bars.map((b, i) => { let f = 0, v = 0; for (let j = Math.max(0, i - n + 1); j <= i; j++) { f += barDelta(bars[j]); v += bars[j].v; } return v ? f / v : 0; }); }
function volRatio(bars) { let s = 0; return bars.map((b, i) => { s += b.v; if (i >= 20) s -= bars[i - 20].v; return b.v / ((s / Math.min(i + 1, 20)) || 1); }); }
function macdHist(cl) { const f = emaArr(cl, 12), s = emaArr(cl, 26), m = cl.map((_, i) => f[i] != null && s[i] != null ? f[i] - s[i] : null), sg = emaArr(m, 9); return m.map((x, i) => x != null && sg[i] != null ? x - sg[i] : null); }
const weekKey = t => Math.floor((t / 864e5 + 3) / 7);
function weeklyIdx(b) { const out = [], map = []; let cur = null, key = null; for (const x of b) { const k = weekKey(x.t); if (k !== key) { key = k; cur = { ...x }; out.push(cur); } else { cur.high = Math.max(cur.high, x.high); cur.low = Math.min(cur.low, x.low); cur.close = x.close; cur.v += x.v; } map.push(out.length - 1); } return [out, map]; }
async function getJs(url) { for (let k = 0; k < 5; k++) { try { const r = await fetch(url); if (r.ok) return await r.json(); if (r.status === 404) return null; } catch (e) {} await sleep(2000 * (k + 1)); } return null; }
async function stkBars(sym) {
  const [u, ce] = await Promise.all([getJs(`${D912}/historical/usa_stocks/${sym}`), getJs(`${D912}/historical/cedears/${sym}`)]);
  if (!u || !Array.isArray(u.dates) || !u.dates.length) return null;
  const cm = new Map(), vs = []; if (Array.isArray(ce)) for (const r of ce) if (r && r.c > 0) { cm.set(r.date, r); vs.push(+r.v || 0); }
  if (cm.size <= 30) return null;
  vs.sort((a, b) => a - b); const vMed = vs.length ? (vs[vs.length >> 1] || 1) : 1, b = []; let pc = null;
  for (let i = 0; i < u.dates.length; i++) { const date = u.dates[i], c = +u.prices[i]; if (!(c > 0)) continue; const t = Date.parse(date + 'T00:00:00Z'), r = cm.get(date); let o, hh, l, v, real = 0;
    if (r) { const k = c / r.c; o = r.o * k; hh = Math.max(r.h * k, c, o); l = Math.min(r.l * k, c, o); v = +r.v || vMed; real = 1; } else { o = pc ?? c; hh = Math.max(o, c); l = Math.min(o, c); v = vMed; }
    b.push({ t, open: o, high: hh, low: l, close: c, v, tb: hh > l ? v * (c - l) / (hh - l) : v / 2, date, real }); pc = c; }
  return b; }
/* misma gestión que la página, con comisión de acciones */
function simS(rb, j0, entry, dir, sl, r, L, maxBars) { let hit = 0, real = 0, kind = 5, pnl = null, j = j0;
  const tps = [1, 2, 3].map(k => entry * (1 + dir * k * r * sl)), fail = entry * (1 - dir * sl), val = px => real + (1 - hit / 3) * dir * (px / entry - 1);
  for (; j < rb.length && j < j0 + maxBars; j++) { const b = rb[j], adv = dir > 0 ? b.low : b.high, fav = dir > 0 ? b.high : b.low, stop = hit ? entry : fail;
    if (dir * (stop - adv) >= 0) { pnl = val(stop); kind = hit ? 3 : 1; break; }
    while (hit < 3 && dir * (fav - tps[hit]) >= 0) { real += dir * (tps[hit] / entry - 1) / 3; hit++; }
    if (hit >= 3) { pnl = real; kind = 4; break; } }
  const open = pnl == null && j >= rb.length; if (pnl == null) { const px = rb[Math.min(j, rb.length - 1)].close; pnl = Math.max(-sl, val(px)); }
  return { pct: 100 * L * (pnl - 2 * FEE_S), hit, kind: open ? 0 : kind }; }
const CA = ['t', 's', 'dir', 'adx', 'di', 'mh', 'mhUp', 'rsi', 'rsi1', 'vr', 'body', 'fl3', 'wk', 'spy', 'spyW', 'st', 'al', 'ab200', 'atrP', 'z', 'd21', 'r5', 'r20', 'hi52', 'gap', 'wd', 'H', 'K', 'P', 'H2', 'P2', 'lo52', 'ath', 'h3y', 'r60', 'r120', 'r250', 'dd20', 'spyDD', 'H3', 'P3'];
async function main() { const t0 = Date.now(), zlib = require('zlib');
  const html = fs.readFileSync('index.html', 'utf8'), m = html.match(/const NYSE=new Set\(\[([^\]]+)\]\)/); const list = m[1].match(/'([^']+)'/g).map(x => x.slice(1, -1));
  const spyJ = await getJs(`${D912}/historical/usa_stocks/SPY`); const spyD = spyJ.dates, spyC = spyJ.prices.map(Number); const spyE = emaArr(spyC, 50);
  const spyB = spyD.map((d, i) => ({ t: Date.parse(d + 'T00:00:00Z'), open: spyC[i], high: spyC[i], low: spyC[i], close: spyC[i], v: 1 })); const [spyWk, spyMap] = weeklyIdx(spyB), spyWH = htfArr(spyWk);
  const spyDD = new Map(); { for (let i = 0; i < spyC.length; i++) { let h = 0; for (let j = Math.max(0, i - 251); j <= i; j++) h = Math.max(h, spyC[j]); spyDD.set(spyD[i], (spyC[i] / h - 1) * 100); } }
  const spyAt = new Map(spyD.map((d, i) => [d, [spyE[i] == null ? 0 : Math.sign(spyC[i] - spyE[i]), spyMap[i] > 0 ? spyWH[spyMap[i] - 1] : 0]]));
  const FROM = Date.now() - +(process.env.BT_YEARS || 6) * 365 * 864e5, rows = [], syms = []; let q = 0, ok = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (q < list.length) { const sym = list[q++]; try {
    const b = await stkBars(sym); if (!b || b.length < 260) continue; const si = syms.length; syms.push(sym); ok++;
    candles = b; const cl = closes(), atr = wilder(trArr(), 14), A = calcADX(14), R = calcRSI(14), mh = macdHist(cl), st = calcST(10, 3).dir, e21 = emaArr(cl, 21), e50 = emaArr(cl, 50), e200 = emaArr(cl, 200), [bm, bs] = smaStd(cl, 20), f3 = flowN(b, 3), vr = volRatio(b);
    const [wk, wmap] = weeklyIdx(b), wH = htfArr(wk); const ath = []; { let m = 0; for (const y of b) { m = Math.max(m, y.high); ath.push(m); } }
    for (let i = 210; i < b.length - 1; i++) { const x = b[i]; if (x.t < FROM || !x.real) continue; if (A.adx[i] == null || mh[i] == null || mh[i - 1] == null || R[i] == null || !atr[i]) continue;
      const body = (x.close - x.open) / ((x.high - x.low) || 1); if (body < .2) continue; // solo velas que cierran arriba (ACCIONES es solo long)
      const atrP = atr[i] / x.close, sl = Math.min(.096, 3 * atrP), o = simS(b, i + 1, x.close, 1, sl, 1, 8, 42), o2 = simS(b, i + 1, x.close, 1, Math.min(.096, 2 * atrP), 1, 8, 42);
      let h52 = 0, l52 = 1e18, h3 = 0, mn20 = 1e18; for (let j = Math.max(0, i - 251); j <= i; j++) { h52 = Math.max(h52, b[j].high); l52 = Math.min(l52, b[j].low); }
      for (let j = Math.max(0, i - 755); j <= i; j++) h3 = Math.max(h3, b[j].high); let hh20 = 0; for (let j = Math.max(0, i - 19); j <= i; j++) hh20 = Math.max(hh20, b[j].high);
      const o3 = simS(b, i + 1, x.close, 1, sl, .5, 8, 42), sdd = spyDD.get(x.date); const sp = spyAt.get(x.date) || [0, 0];
      rows.push([x.t, si, 1, r3(A.adx[i]), r3((A.pdi[i] - A.mdi[i]) / ((A.pdi[i] + A.mdi[i]) || 1)), r3(mh[i] / atr[i]), mh[i] > mh[i - 1] ? 1 : 0, r3(R[i]), r3(R[i - 1]), r3(vr[i]), r3(body), r3(f3[i]),
        wmap[i] > 0 ? wH[wmap[i] - 1] : 0, sp[0], sp[1], st[i], e21[i] > e50[i] ? 1 : -1, e200[i] == null ? null : x.close > e200[i] ? 1 : -1, r3(atrP), r3(bs[i] ? (x.close - bm[i]) / bs[i] : 0), r3((x.close - e21[i]) / atr[i]),
        r3((x.close / b[i - 5].close - 1) * 100), r3((x.close / b[i - 20].close - 1) * 100), r3((x.close / h52 - 1) * 100), r3((x.open / b[i - 1].close - 1) * 100), new Date(x.t).getUTCDay(),
        o.hit, o.kind, r3(o.pct), o2.hit, r3(o2.pct), r3((x.close / l52 - 1) * 100), r3((x.close / ath[i] - 1) * 100), r3((x.close / h3 - 1) * 100), r3((x.close / b[i - 60].close - 1) * 100), r3((x.close / b[i - 120].close - 1) * 100), r3((x.close / b[i - 250].close - 1) * 100), r3((x.close / hh20 - 1) * 100), sdd == null ? null : r3(sdd), o3.hit, r3(o3.pct)]); } } catch (e) { console.log(sym, e.message); } } }));
  console.log('acciones', ok, 'filas', rows.length, ((Date.now() - t0) / 1000).toFixed(0), 's');
  fs.writeFileSync('invacc.json.gz', zlib.gzipSync(JSON.stringify({ upd: Date.now(), cols: CA, syms, rows }))); }
main().catch(e => { console.error(e); process.exitCode = 1; });
