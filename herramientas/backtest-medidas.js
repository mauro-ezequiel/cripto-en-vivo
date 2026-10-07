/* CRIPTO-LIVE · backtest medidas viejas vs nuevas (corre en el navegador o en node con fetch).
   Reglas de entrada idénticas a senales-bot.js (TRADING v6 y SHOOTER v6). Solo cambia dónde van el stop y los objetivos.
   Gestión igual al bot: 1/3 en cada objetivo, tras el objetivo 1 el stop pasa a la entrada, plazo máximo.
   Con y sin salvavidas (igual que la página). Comisión 0,05 % por lado sobre el nocional. Si en una misma vela toca stop y objetivo, se asume el stop. */
(function (G) {
const API = G.BT_API || 'https://api.binance.com/api/v3';
const DAY = 864e5, NOW = G.BT_NOW || Date.now(), SPAN = 180 * DAY, TRAIN_END = NOW - 30 * DAY;
const FEE = .0005;
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|USDE|USD1|PYUSD|XUSD|AEUR|EURI|BFUSD|USDS|RLUSD|USDF|FRAX|USDG)USDT$/;
const MODES = {
  medio: { name: 'TRADING', tf: '4h', tfMs: 4 * 36e5, htf: '1d', htfMs: DAY, res: '1h', resMs: 36e5, n: 80, cool: 24 * 36e5, maxAge: 7 * DAY,
           margin: 350, lev: 15, oldTp: [.0125, .025, .0375], oldSl: .05, maxAtr: .017 },
  x:     { name: 'SHOOTER', tf: '5m', tfMs: 3e5, htf: '15m', htfMs: 9e5, res: '5m', resMs: 3e5, n: 45, cool: 1.5 * 36e5, maxAge: 4 * 36e5,
           margin: 50, lev: 18, oldTp: [.016, .032, .048], oldSl: .04, maxAtr: .027 }
};
/* variantes nuevas: stop = a × ATR (de la vela de la señal), objetivos = r, 2r, 3r veces el stop */
const NEWG = { medio: { a: 3, r: .5 }, x: { a: 1, r: 1.5 } };
const VARS = [{ id: 'old' }, { id: 'old_ll', ll: 1 }, { id: 'new', nw: 1 }, { id: 'new_ll', nw: 1, ll: 1 },
  { id: 'azar_old', rnd: 1 }, { id: 'azar_new', nw: 1, rnd: 1 }];

/* ---------- matemáticas (idénticas al bot) ---------- */
let candles = [];
const closes = () => candles.map(b => b.close);
function emaArr(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let prev = null, cnt = 0, sum = 0;
  for (let i = 0; i < v.length; i++) { const x = v[i]; if (x == null) continue;
    if (prev === null) { sum += x; cnt++; if (cnt === p) { prev = sum / p; o[i] = prev; } } else { prev = x * k + prev * (1 - k); o[i] = prev; } }
  return o; }
function smaStd(v, p) { const m = Array(v.length).fill(null), s = Array(v.length).fill(null);
  for (let i = p - 1; i < v.length; i++) { let a = 0; for (let j = i - p + 1; j <= i; j++) a += v[j]; a /= p; let q = 0; for (let j = i - p + 1; j <= i; j++) q += (v[j] - a) ** 2; m[i] = a; s[i] = Math.sqrt(q / p); }
  return [m, s]; }
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
const barDelta = b => { const tb = b.tb != null && !isNaN(b.tb) ? b.tb : b.v / 2; return 2 * tb - b.v; };
function lastBarStats(cc, i) { let vv = 0, vs = 0; for (let j = i - 2; j <= i; j++) vv += cc[j].v; for (let j = Math.max(0, i - 19); j <= i; j++) vs += cc[j].v;
  return { vr: cc[i].v / ((vs / Math.min(i + 1, 20)) || 1) }; }
/* tendencia superior: misma fórmula que htfTrend del bot, sobre las velas superiores ya cerradas (últimas 119) */
function htfTrendAt(hb, hEma, k) { // k = índice de la última vela superior cerrada
  if (k < 4 || hEma[k] == null || hEma[k - 3] == null) return 0; const c = hb[k].close;
  return (c > hEma[k] ? .5 : -.5) + (hEma[k] > hEma[k - 3] ? .5 : -.5); }

/* TRADING: ventana de 299 velas cerradas como en el bot (kl 300 y descarta la que se está formando) */
function evalTradingWin(cc, rank) { candles = cc; const i = cc.length - 1, cl = closes(), cb = cc[i].close, atr = wilder(trArr(), 14)[i], atrP = atr / cb;
  const st = calcST(10, 3).dir[i], e21 = emaArr(cl, 21)[i], e50 = emaArr(cl, 50)[i], e200 = emaArr(cl, 200)[i], r14 = calcRSI(14)[i], L = lastBarStats(cc, i);
  if (e200 == null || r14 == null) return null;
  const dir = st === 1 && e21 > e50 && cb > e200 ? 1 : st === -1 && e21 < e50 && cb < e200 ? -1 : 0;
  if (!dir || L.vr >= 1 || !(atrP > .01 && atrP <= .05 / 3)) return null;
  const pull = dir > 0 ? r14 < 50 : r14 > 50, soft = dir > 0 ? r14 < 55 : r14 > 45;
  let setup; if (pull) setup = rank < 40 ? 't-pb' : 'tp-u80';
  else { if (!(rank < 40 && soft)) return null; const adx = calcADX(14).adx[i]; if (!(adx != null && adx >= 25)) return null; setup = 'tp-r55'; }
  return { dir, atrP, setup }; }

/* ---------- datos ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
let reqs = 0;
async function getJ(url, tries = 5) { for (let k = 0; k < tries; k++) { try { reqs++; const r = await fetch(url); if (r.ok) return await r.json();
      if (r.status === 429 || r.status === 418 || r.status >= 500) { await sleep(5000 * (k + 1)); continue; } throw new Error(r.status + ' ' + url); }
    catch (e) { if (k === tries - 1) throw e; await sleep(2000); } } }
const toBar = k => ({ t: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], v: +k[5], tb: +k[9] });
async function klRange(s, tf, tfMs, from, to) { const out = []; let st = from;
  while (st < to) { const d = await getJ(`${API}/klines?symbol=${s}&interval=${tf}&startTime=${st}&endTime=${to}&limit=1000`); if (!d || !d.length) break;
    for (const k of d) out.push(toBar(k)); st = d[d.length - 1][0] + tfMs; if (d.length < 1000) break; await sleep(40); }
  return out.filter(b => b.t + tfMs <= to); } // solo velas cerradas

/* ---------- simulación de salida ---------- */
function geom(m, v, atrP) { const M = MODES[m];
  if (!v.nw) return { sl: M.oldSl, tp: M.oldTp };
  const P = NEWG[m], sl = Math.min(M.oldSl, Math.max(.004, P.a * atrP)); return { sl, tp: [1, 2, 3].map(k => k * P.r * sl) }; }
/* rb = velas de resolución; j0 = primera vela posterior a la entrada */
/* llConf(t, dir) -> ¿los datos siguen confirmando en el momento t? (igual que llOk de la página) */
function simTrade(m, rb, j0, entry, dir, g, t0, llConf) { const M = MODES[m], N = M.margin * M.lev; let hit = 0, real = 0, j = j0, end = 'plazo', ae = entry, sz = 1, ll = 0, llNo = !llConf;
  const tps = g.tp.map(x => entry * (1 + dir * x)), s = g.sl; let fail = entry * (1 - dir * s); const llAt = entry * (1 - dir * s * .65);
  const pnlAt = px => real + (1 - hit / 3) * sz * N * dir * (px / ae - 1); let pnl = null;
  for (; j < rb.length; j++) { const b = rb[j]; if (b.t - t0 > M.maxAge) { j--; break; }
    const adv = dir > 0 ? b.low : b.high, fav = dir > 0 ? b.high : b.low;
    if (!hit && !ll && !llNo && dir * (adv - llAt) <= 0) { if (llConf(b.t, dir)) { ae = (entry + .5 * llAt) / 1.5; sz = 1.5; fail = ae * (1 - dir * s); ll = 1; } else llNo = true; }
    if (!hit && dir * (adv - fail) <= 0) { pnl = -sz * N * s; end = 'stop'; break; }
    if (hit && dir * (adv - ae) <= 0) { pnl = real; end = 'entrada'; break; }
    while (hit < 3 && dir * (fav - tps[hit]) >= 0) { real += sz * N / 3 * dir * (tps[hit] / ae - 1); hit++; }
    if (hit >= 3) { pnl = real; end = 'obj3'; break; } }
  if (pnl == null) { const jj = Math.min(Math.max(j, j0), rb.length - 1), px = rb[jj] ? rb[jj].close : entry; pnl = Math.max(-sz * N * s, pnlAt(px)); j = jj; }
  return { hit, end, ll, usd: pnl - N * sz * FEE * 2, tEnd: rb[Math.min(j, rb.length - 1)] ? rb[Math.min(j, rb.length - 1)].t : t0 }; }
function idxAfter(rb, t) { let lo = 0, hi = rb.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (rb[mid].t < t) lo = mid + 1; else hi = mid; } return lo; }

/* ---------- motor ---------- */
const R = G.__BT = { status: 'iniciando', done: 0, total: 0, err: [], trades: { medio: {}, x: {} }, reqs: 0 };
for (const m in MODES) for (const v of VARS) R.trades[m][v.id] = [];

async function runSymbol(m, s, rank) { const M = MODES[m], from = NOW - SPAN;
  const tb = await klRange(s, M.tf, M.tfMs, from - 300 * M.tfMs, NOW); if (tb.length < 350) return;
  const hb = await klRange(s, M.htf, M.htfMs, from - 130 * M.htfMs, NOW); if (hb.length < 30) return;
  const rb = M.res === M.tf ? tb : await klRange(s, M.res, M.resMs, from, NOW);
  const hEma = emaArr(hb.map(b => b.close), 21);
  /* señales (independientes de la variante) */
  const sigs = []; let k = -1;
  candles = tb; const clAll = closes(), atrAll = wilder(trArr(), 14);
  let pre = null; if (m === 'x') pre = { atr: atrAll, bb: smaStd(clAll, 20), r7: calcRSI(7) };
  const e200 = m === 'medio' ? emaArr(clAll, 200) : null, r7all = m === 'x' ? pre.r7 : null;
  const lastClosed = (arr, ms, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const md = (lo + hi) >> 1; if (arr[md].t + ms <= t) lo = md + 1; else hi = md; } return lo - 1; };
  const llConf = (t, dir) => { const i = lastClosed(tb, M.tfMs, t); if (i < 0) return false;
    if (m === 'x') { const kk = lastClosed(hb, M.htfMs, t), r = r7all[i]; return Math.sign(htfTrendAt(hb, hEma, kk)) === dir && r != null && (dir > 0 ? r < 35 : r > 65); }
    return e200[i] != null && (dir > 0 ? tb[i].close > e200[i] : tb[i].close < e200[i]); };
  for (let i = 299; i < tb.length - 1; i++) { const tClose = tb[i].t + M.tfMs; if (tClose < from) continue;
    while (k + 1 < hb.length && hb[k + 1].t + M.htfMs <= tClose) k++;
    const entry = tb[i].close; let e = null;
    if (m === 'x') { const atrP = pre.atr[i] / entry; if (!(atrP > .04 / 3 && atrP <= .04 / 1.5)) continue; const r7 = pre.r7[i], bm = pre.bb[0][i], bs = pre.bb[1][i];
      if (r7 == null || !bs) continue; const z = (entry - bm) / bs; if (!(Math.abs(z) >= 2 && (z < 0 ? r7 <= 35 : r7 >= 65))) continue;
      const dir = z < 0 ? 1 : -1; if (Math.sign(htfTrendAt(hb, hEma, k)) !== dir) continue; e = { dir, atrP, setup: 'sh-r' }; }
    else e = evalTradingWin(tb.slice(i - 298, i + 1), rank);
    if (e && e.atrP <= M.maxAtr) sigs.push({ i, t: tClose, entry, ...e }); }
  /* cada variante con su propio enfriamiento y "una abierta por moneda" */
  /* azar: 4 entradas por señal real, en momentos y direcciones al azar, con el mismo filtro de volatilidad */
  let seed = 7; for (const ch of s) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  const cand = []; for (let i = 299; i < tb.length - 1; i++) { const tC = tb[i].t + M.tfMs; if (tC < from) continue; const aP = atrAll[i] / tb[i].close;
    const okV = m === 'x' ? aP > .04 / 3 && aP <= .04 / 1.5 : aP > .01 && aP <= .05 / 3; if (okV && aP <= M.maxAtr) cand.push(i); }
  const rsigs = []; for (let q = 0; q < sigs.length * 4 && cand.length; q++) { const i = cand[Math.floor(rnd() * cand.length)]; rsigs.push({ i, t: tb[i].t + M.tfMs, entry: tb[i].close, dir: rnd() < .5 ? 1 : -1, atrP: atrAll[i] / tb[i].close, setup: 'azar' }); }
  rsigs.sort((a, b) => a.t - b.t);
  for (const v of VARS) { let freeAt = 0; const list = v.rnd ? rsigs : sigs;
    for (const sg of list) { if (!v.rnd && sg.t < freeAt) continue; const g = geom(m, v, sg.atrP), j0 = idxAfter(rb, sg.t);
      const tr = simTrade(m, rb, j0, sg.entry, sg.dir, g, sg.t, v.ll ? llConf : null);
      R.trades[m][v.id].push({ s, t: sg.t, dir: sg.dir, setup: sg.setup, sl: g.sl, hit: tr.hit, end: tr.end, ll: tr.ll, usd: tr.usd });
      freeAt = Math.max(sg.t + M.cool, tr.tEnd + M.resMs); } } }

async function run() { try {
  const T = await getJ(`${API}/ticker/24hr`);
  const base = T.filter(t => t.symbol.endsWith('USDT') && !STABLE.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) && +t.quoteVolume > 1e7 && Math.abs(+t.priceChangePercent) < 25)
    .sort((a, b) => b.quoteVolume - a.quoteVolume).map(t => t.symbol);
  const jobs = []; for (const m of (G.BT_MODES || ['medio', 'x'])) base.slice(0, MODES[m].n).forEach((s, r) => jobs.push([m, s, r]));
  R.total = jobs.length; R.status = 'corriendo';
  let q = 0; const worker = async () => { while (q < jobs.length) { const [m, s, r] = jobs[q++]; try { await runSymbol(m, s, r); } catch (e) { R.err.push(m + ' ' + s + ': ' + e.message); } R.done++; R.reqs = reqs; } };
  await Promise.all(Array.from({ length: G.BT_PAR || 4 }, worker));
  R.summary = summarize(); R.status = 'listo';
} catch (e) { R.status = 'error'; R.err.push(e.message); } }

function stats(list) { const n = list.length; if (!n) return { n: 0 };
  let w = 0, l = 0, tot = 0, h1 = 0, h3 = 0, stp = 0, eq = 0, peak = 0, dd = 0, slSum = 0;
  for (const t of [...list].sort((a, b) => a.t - b.t)) { tot += t.usd; if (t.usd > 0) w += t.usd; else l -= t.usd; if (t.hit >= 1) h1++; if (t.hit >= 3) h3++; if (t.end === 'stop') stp++; slSum += t.sl;
    eq += t.usd; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  const r2 = x => Math.round(x * 100) / 100;
  const nll = list.filter(t => t.ll).length;
  return { n, ll: nll, obj1: r2(100 * h1 / n), obj3: r2(100 * h3 / n), stop: r2(100 * stp / n), total: r2(tot), prom: r2(tot / n), pf: l ? r2(w / l) : null, maxDD: r2(dd), slProm: r2(100 * slSum / n) }; }
function summarize() { const out = {}, W = { '1s': 7, '1m': 30, '6m': 180 };
  for (const m in R.trades) { out[m] = {};
    for (const v in R.trades[m]) { const L = R.trades[m][v]; if (!L.length && v !== 'old') continue; out[m][v] = { train: stats(L.filter(t => t.t < TRAIN_END)) };
      for (const w in W) out[m][v][w] = stats(L.filter(t => t.t >= NOW - W[w] * DAY));
      const bySet = {}; for (const t of L) (bySet[t.setup] = bySet[t.setup] || []).push(t); out[m][v].setups = Object.fromEntries(Object.entries(bySet).map(([k, a]) => [k, stats(a)])); } }
  return out; }
G.BT_RUN = run; G.BT_STATS = stats; G.BT_MODES_CFG = MODES; G.BT_VARS = VARS;
if (!G.BT_NOAUTO) run();
})(typeof window !== 'undefined' ? window : globalThis);
