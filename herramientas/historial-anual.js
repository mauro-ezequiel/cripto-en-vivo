/* CRIPTO-LIVE · historial del último año (corre solo todos los días en GitHub Actions).
   Baja de Binance las velas de los últimos 365 días, tira las señales de TRADING, TRADING+ y SHOOTER con las mismas
   reglas y medidas que la página y el bot, y anota cómo terminó cada una (objetivos, stop, plazo).
   Como se recalcula cada día sobre los últimos 365 días, el día nuevo entra y el de hace un año sale.
   Resultado: historial.json en la rama "datos" → la página y el bot usan esos % como "acierto histórico".
   Gestión igual al bot: 1/3 en cada objetivo, tras el objetivo 1 el stop pasa a la entrada, plazo máximo.
   Comisión 0,05 % por lado. Si en una misma vela toca stop y objetivo, se asume el stop.
   Ojo: usa las monedas con más volumen de hoy (las que se hundieron en el año y ya no están no cuentan).
   Prueba local sin internet: BT_MOCK=1 node herramientas/historial-anual.js */
const fs = require('fs');
const API = process.env.BT_API || 'https://data-api.binance.vision/api/v3';
const MOCK = !!process.env.BT_MOCK;
const DAY = 864e5, NOW = +(process.env.BT_NOW || Date.now()), SPAN = +(process.env.BT_DAYS || 365) * DAY, FROM = NOW - SPAN, FEE = .0005;
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|USDE|USD1|PYUSD|XUSD|AEUR|EURI|BFUSD|USDS|RLUSD|USDF|FRAX|USDG)USDT$/;
const MIN_N = 20; // con menos casos el % no se publica como acierto

/* medidas vigentes (idénticas a la página: SIM, NEWG y PLUSG) */
const T4 = { tf: '4h', tfMs: 4 * 36e5, res: '1h', resMs: 36e5, n: +(process.env.BT_NT || 80), cool: 24 * 36e5, maxAge: 7 * DAY };
const SH = { tf: '5m', tfMs: 3e5, htf: '15m', htfMs: 9e5, n: +(process.env.BT_NS || 45), cool: 1.5 * 36e5, maxAge: 4 * 36e5 };
const GEO = {
  core: { L: 10, a: 3, cap: .036, floor: .004, r: .5, ex: 'no', ll: true, margin: 350 },   // TRADING
  plus: { L: 7, a: 3, cap: .11, floor: 0, r: .35, ex: 'mitad', ll: false, margin: 350 },  // TRADING+
  sh:   { L: 10, a: 3, cap: .076, floor: .004, r: .5, ex: 'no', ll: false, margin: 50 }   // SHOOTER
};
const SETUP_M = { 't-pb': 'medio', 'tp-r55': 'medio', 'tp-u80': 'medio', 'tp-x': 'medio', 'sh-r': 'x' };

/* ---------- matemáticas (idénticas al bot) ---------- */
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
  return { adx }; }
function calcST(p = 10, m = 3) { const n = candles.length, atr = wilder(trArr(), p), dir = Array(n).fill(null); let fu = null, fl = null, d = 1;
  for (let i = 0; i < n; i++) { if (atr[i] == null) continue; const b = candles[i], hl = (b.high + b.low) / 2, ub = hl + m * atr[i], lb = hl - m * atr[i];
    if (fu === null) { fu = ub; fl = lb; } else { const pc = candles[i - 1].close; fu = (ub < fu || pc > fu) ? ub : fu; fl = (lb > fl || pc < fl) ? lb : fl; }
    if (d === 1 && b.close < fl) d = -1; else if (d === -1 && b.close > fu) d = 1; dir[i] = d; }
  return { dir }; }
function smaStd(v, p) { const m = Array(v.length).fill(null), s = Array(v.length).fill(null); let a = 0, q = 0;
  for (let i = 0; i < v.length; i++) { a += v[i]; q += v[i] * v[i]; if (i >= p) { a -= v[i - p]; q -= v[i - p] * v[i - p]; }
    if (i >= p - 1) { const mu = a / p; m[i] = mu; s[i] = Math.sqrt(Math.max(0, q / p - mu * mu)); } }
  return [m, s]; }

/* TRADING y TRADING+ sobre la ventana de 299 velas cerradas (igual que la página y el bot) */
function classify4h(cc, rank) { candles = cc; const i = cc.length - 1, cl = closes(), cb = cc[i].close, atrP = wilder(trArr(), 14)[i] / cb;
  const st = calcST(10, 3).dir[i], e21 = emaArr(cl, 21)[i], e50 = emaArr(cl, 50)[i], e200 = emaArr(cl, 200)[i], r14 = calcRSI(14)[i];
  if (e200 == null || r14 == null) return null;
  const dir = st === 1 && e21 > e50 && cb > e200 ? 1 : st === -1 && e21 < e50 && cb < e200 ? -1 : 0; if (!dir) return null;
  let vs = 0; for (let j = Math.max(0, i - 19); j <= i; j++) vs += cc[j].v; const vr = cc[i].v / ((vs / Math.min(i + 1, 20)) || 1);
  const rr = dir > 0 ? r14 : 100 - r14, core = vr < 1 && atrP > .01 && atrP <= .05 / 3 && atrP <= .017;
  const d50 = dir * (cb - emaArr(cl, 50)[i]) / (atrP * cb); // octubre 2026: el retroceso tiene que frenar antes de la EMA 50
  if (core && rr < 50) return d50 >= .5 ? { k: 'core', dir, atrP, setup: rank < 40 ? 't-pb' : 'tp-u80' } : null;
  const adx = calcADX(14).adx[i]; if (adx == null || adx < 25) return null;
  if (core && rank < 40 && rr < 55) return { k: 'core', dir, atrP, setup: 'tp-r55' };
  let f6 = 0, v6 = 0; for (let j = i - 5; j <= i; j++) { const b = cc[j], tb = b.tb != null && !isNaN(b.tb) ? b.tb : b.v / 2; f6 += 2 * tb - b.v; v6 += b.v; }
  const fl6 = v6 ? dir * f6 / v6 : 0, r24 = dir * (cb / cc[i - 6].close - 1) * 100; // octubre 2026: TRADING+ ya moviéndose a favor y con el flujo a favor
  if (rr < 70 && adx >= 35 && vr < 1 && atrP > .008 && atrP <= .03 && r24 >= 1 && fl6 >= .01) return { k: 'plus', dir, atrP, setup: 'tp-x' };
  return null; }

/* ---------- datos ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
let mockSeed = 1; const rnd = () => (mockSeed = (mockSeed * 16807) % 2147483647) / 2147483647;
function mockKlines(url) { const q = new URL(url), s = q.searchParams.get('symbol'), tf = q.searchParams.get('interval');
  const ms = { '5m': 3e5, '15m': 9e5, '1h': 36e5, '4h': 144e5 }[tf], st = +q.searchParams.get('startTime'), en = +q.searchParams.get('endTime');
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

/* ---------- recorrido ---------- */
const CANDS = [], RAND = { medio: [], x: [] };
let BTC4 = null, BTC1 = null;
const btcDirAt = (B, ms, t) => { const i = lastClosed(B.b, ms, t); return i >= 0 && B.e[i] != null ? Math.sign(B.b[i].close - B.e[i]) : 0; };

async function run4h(s, rank) {
  const tb = await klRange(s, T4.tf, T4.tfMs, FROM - 300 * T4.tfMs, NOW); if (tb.length < 350) return;
  const rb = await klRange(s, T4.res, T4.resMs, FROM, NOW); if (rb.length < 50) return;
  candles = tb; const e200 = emaArr(closes(), 200);
  const llConf = (t, dir) => { const i = lastClosed(tb, T4.tfMs, t); return i >= 0 && e200[i] != null && (dir > 0 ? tb[i].close > e200[i] : tb[i].close < e200[i]); };
  for (let i = 299; i < tb.length; i++) { const t = tb[i].t + T4.tfMs; if (t < FROM) continue;
    const c = classify4h(tb.slice(i - 298, i + 1), rank); if (!c) continue;
    if (btcDirAt(BTC4, T4.tfMs, t) !== c.dir) continue; // solo a favor de BTC (4h vs EMA 50), como la página
    const g = GEO[c.k], sl = slOf(g, c.atrP), entry = tb[i].close;
    const res = sim(rb, T4.resMs, T4.maxAge, idxAfter(rb, t), entry, c.dir, sl, g.r, g.L, g.ex, g.ll ? llConf : null, t);
    CANDS.push({ m: 'medio', setup: c.setup, s, t, dir: c.dir, sl, cool: T4.cool, margin: g.margin, ...res }); }
  return { rb, tb, llConf }; }

async function runShooter(s) {
  const tb = await klRange(s, SH.tf, SH.tfMs, FROM - 300 * SH.tfMs, NOW); if (tb.length < 400) return;
  const hb = await klRange(s, SH.htf, SH.htfMs, FROM - 130 * SH.htfMs, NOW); if (hb.length < 30) return;
  candles = tb; const cl = closes(), atr = wilder(trArr(), 14), r7 = calcRSI(7), [bm, bs] = smaStd(cl, 20);
  const he = emaArr(hb.map(b => b.close), 21);
  for (let i = 299; i < tb.length; i++) { const t = tb[i].t + SH.tfMs; if (t < FROM) continue;
    const cb = tb[i].close, atrP = atr[i] / cb; if (r7[i] == null || !(atrP > .04 / 3 && atrP <= .04 / 1.5) || atrP > .027) continue;
    const z = bs[i] ? (cb - bm[i]) / bs[i] : 0; if (!(Math.abs(z) >= 2 && (z < 0 ? r7[i] <= 25 : r7[i] >= 75))) continue;
    const dir = z < 0 ? 1 : -1, k = lastClosed(hb, SH.htfMs, t);
    const htf = k >= 4 && he[k] != null && he[k - 3] != null ? (hb[k].close > he[k] ? .5 : -.5) + (he[k] > he[k - 3] ? .5 : -.5) : 0;
    if (Math.sign(htf) !== dir || btcDirAt(BTC1, 36e5, t) !== dir) continue;
    const g = GEO.sh, sl = slOf(g, atrP);
    const res = sim(tb, SH.tfMs, SH.maxAge, i + 1, cb, dir, sl, g.r, g.L, g.ex, null, t);
    CANDS.push({ m: 'x', setup: 'sh-r', s, t, dir, sl, cool: SH.cool, margin: g.margin, ...res }); }
  return { rb: tb, ok: j => atr[j] != null && atr[j] / tb[j].close > .04 / 3 && atr[j] / tb[j].close <= .04 / 1.5 }; }

/* entradas al azar con el mismo stop y objetivos (para medir cuánto aporta la señal) */
function randomEntries(m, s, rb, resMs, maxAge, every, slPool, g, llConf, ok) {
  if (!slPool.length || !rb.length) return;
  for (let j = 0; j < rb.length; j++) { if (rb[j].t < FROM || (ok && !ok(j)) || rnd() > 1 / every) continue;
    const dir = rnd() < .5 ? 1 : -1, sl = slPool[Math.floor(rnd() * slPool.length)], t = rb[j].t + resMs;
    const res = sim(rb, resMs, maxAge, j + 1, rb[j].close, dir, sl, g.r, g.L, g.ex, g.ll ? llConf : null, t);
    RAND[m].push({ ...res, margin: g.margin }); } }

/* una operación por moneda a la vez y espera entre señales (como el bot y la página).
   TRADING y TRADING+ son carteras separadas: una operación abierta de TRADING+ no frena una de TRADING en la misma moneda (y al revés) */
function pick() { const by = {}; for (const c of CANDS) { const k = c.m + (c.setup === 'tp-x' ? '+' : '') + c.s; (by[k] = by[k] || []).push(c); }
  const out = []; for (const k in by) { let free = 0; for (const c of by[k].sort((a, b) => a.t - b.t)) { if (c.t < free) continue; out.push(c); free = Math.max(c.t + c.cool, c.tEnd); } }
  return out.sort((a, b) => a.t - b.t); }
function stats(L) { const done = L.filter(x => !x.open), n = done.length; if (!n) return { n: 0 };
  const h1 = done.filter(x => x.hit >= 1).length, h3 = done.filter(x => x.hit >= 3).length, usd = done.reduce((a, x) => a + x.pct / 100 * x.margin, 0);
  return { p: Math.round(100 * h1 / n), p3: Math.round(100 * h3 / n), n, usd: +(usd / n).toFixed(1), ll: done.filter(x => x.ll).length }; }

async function publish(body) { const tok = process.env.GH_TOKEN, repo = process.env.GITHUB_REPOSITORY; if (!tok || !repo) return false;
  const H = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'User-Agent': 'cripto-live-historial' }, api = 'https://api.github.com/repos/' + repo;
  let r = await fetch(api + '/git/ref/heads/datos', { headers: H });
  if (r.status === 404) { const mm = await (await fetch(api + '/git/ref/heads/main', { headers: H })).json(); r = await fetch(api + '/git/refs', { method: 'POST', headers: H, body: JSON.stringify({ ref: 'refs/heads/datos', sha: mm.object.sha }) }); }
  if (!r.ok) { console.log('rama datos:', r.status); return false; }
  for (let k = 0; k < 3; k++) { const g = await fetch(api + '/contents/historial.json?ref=datos', { headers: H }), sha = g.ok ? (await g.json()).sha : null;
    const p = await fetch(api + '/contents/historial.json', { method: 'PUT', headers: H, body: JSON.stringify(Object.assign({ message: 'Historial del último año', content: Buffer.from(body).toString('base64'), branch: 'datos' }, sha ? { sha } : {})) });
    if (p.ok) return true; console.log('publicar:', p.status, (await p.text()).slice(0, 200)); await sleep(3000); }
  return false; }

async function main() { const t0 = Date.now();
  const T = await getJ(`${API}/ticker/24hr`);
  const base = T.filter(t => t.symbol.endsWith('USDT') && !STABLE.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) && +t.quoteVolume > 1e7 && Math.abs(+t.priceChangePercent) < 25)
    .sort((a, b) => b.quoteVolume - a.quoteVolume).map(t => t.symbol);
  { const b = await klRange('BTCUSDT', '4h', 144e5, FROM - 300 * 144e5, NOW); candles = b; BTC4 = { b, e: emaArr(closes(), 50) }; }
  { const b = await klRange('BTCUSDT', '1h', 36e5, FROM - 300 * 36e5, NOW); candles = b; BTC1 = { b, e: emaArr(closes(), 50) }; }
  const err = [], par = +(process.env.BT_PAR || 3);
  const pool = async (list, fn) => { let q = 0; await Promise.all(Array.from({ length: par }, async () => { while (q < list.length) { const r = q++; try { await fn(list[r], r); } catch (e) { err.push(list[r] + ': ' + e.message); } } })); };
  /* TRADING / TRADING+ */
  const keep4 = {};
  await pool(base.slice(0, T4.n), async (s, r) => { const x = await run4h(s, r); if (x) keep4[s] = x; });
  console.log('TRADING listo', ((Date.now() - t0) / 1000).toFixed(0), 's');
  const slCore = CANDS.filter(c => c.m === 'medio' && c.setup !== 'tp-x').map(c => c.sl);
  for (const s in keep4) randomEntries('medio', s, keep4[s].rb, T4.resMs, T4.maxAge, 60, slCore, GEO.core, keep4[s].llConf);
  for (const k in keep4) delete keep4[k];
  /* SHOOTER (velas de 5 min: más pesado, una moneda a la vez por memoria) */
  const shSl = [];
  await pool(base.slice(0, SH.n), async s => { const x = await runShooter(s); if (!x) return;
    const mine = CANDS.filter(c => c.s === s && c.m === 'x').map(c => c.sl); shSl.push(...mine);
    randomEntries('x', s, x.rb, SH.tfMs, SH.maxAge, 8, shSl.length ? shSl : [GEO.sh.cap], GEO.sh, null, x.ok); }); // al azar, pero con la misma volatilidad que exige SHOOTER
  console.log('SHOOTER listo', ((Date.now() - t0) / 1000).toFixed(0), 's');

  const ops = pick(), cal = { medio: {}, x: {} };
  for (const setup in SETUP_M) { const st = stats(ops.filter(o => o.setup === setup)); cal[SETUP_M[setup]][setup] = st; }
  const azar = {}; for (const m of ['medio', 'x']) { const st = stats(RAND[m]); azar[m] = st.n ? { p: st.p, n: st.n, usd: st.usd } : null; }
  const out = { upd: NOW, desde: FROM, dias: Math.round(SPAN / DAY), minN: MIN_N, monedas: { trading: Math.min(T4.n, base.length), shooter: Math.min(SH.n, base.length) },
    cal, azar, secs: Math.round((Date.now() - t0) / 1000), errores: err.slice(0, 20),
    /* cada operación: [modo, setup, moneda, inicio, dir, objetivos, cierre(1 stop · 2 aviso · 3 entrada · 4 completa · 5 plazo · 0 en curso), USD, salvavidas(1/0), fin] */
    ops: ops.map(o => [o.m, o.setup, o.s.replace('USDT', ''), o.t, o.dir, o.hit, o.open ? 0 : o.kind, +(o.pct / 100 * o.margin).toFixed(1), o.ll ? 1 : 0, o.open ? 0 : o.tEnd]) };
  const body = JSON.stringify(out);
  fs.writeFileSync('historial.json', body);
  console.log(JSON.stringify({ cal, azar, ops: ops.length, errores: err.length, secs: out.secs }, null, 1));
  if (MOCK) return;
  if (await publish(body)) console.log('Publicado historial.json en la rama datos'); else if (process.env.GH_TOKEN) { console.log('No se pudo publicar'); process.exitCode = 1; } }
main().catch(e => { console.error(e); process.exitCode = 1; });
