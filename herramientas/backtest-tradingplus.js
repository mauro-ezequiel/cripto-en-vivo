/* TRADING+ · búsqueda de filtros, apalancamiento, stop, objetivos y aviso de salida temprana.
   Candidatas = reglas de tp-x de la página (tendencia alineada, ADX ≥ 25, RSI sin extremo, ATR 0,8–3 %) que no son TRADING.
   Cada candidata se simula con todas las geometrías; después cada filtro elige sus operaciones con
   "una por moneda a la vez y 24 h entre señales". Sin salvavidas. Comisión 0,05 % por lado. Resultados en % del margen. */
(function (G) {
const API = G.BT_API || 'https://api.binance.com/api/v3';
const DAY = 864e5, NOW = G.BT_NOW || Date.now(), SPAN = 180 * DAY, TRAIN_END = NOW - 30 * DAY, FEE = .0005;
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|USDE|USD1|PYUSD|XUSD|AEUR|EURI|BFUSD|USDS|RLUSD|USDF|FRAX|USDG)USDT$/;
const M = { tf: '4h', tfMs: 4 * 36e5, htf: '1d', htfMs: DAY, res: '1h', resMs: 36e5, n: 80, cool: 24 * 36e5, maxAge: 7 * DAY };
const maxSlOf = L => .8 * (1 / L - .005);
const EXITS = ['no', 'mitad', 'ema', 'tiempo'];
const GEO = []; for (const L of [5, 10, 20]) for (const a of [1.5, 2, 3]) for (const r of [.35, .5, .75]) for (const ex of EXITS) GEO.push({ L, a, r, ex });
const FIL = []; for (const adx of [25, 30, 35]) for (const rr of [60, 70]) for (const atr of [.02, .03]) for (const htf of [0, 1]) for (const vr of [0, 1]) for (const top of [0, 1]) FIL.push({ adx, rr, atr, htf, vr, top });
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
function htfTrend(hb, hEma, k) { if (k < 4 || hEma[k] == null || hEma[k - 3] == null) return 0; const c = hb[k].close; return (c > hEma[k] ? .5 : -.5) + (hEma[k] > hEma[k - 3] ? .5 : -.5); }
/* candidata tp-x (igual que la página) con sus datos para filtrar después */
function evalCand(cc, rank) { candles = cc; const i = cc.length - 1, cl = closes(), cb = cc[i].close, atrP = wilder(trArr(), 14)[i] / cb;
  const st = calcST(10, 3).dir[i], e21 = emaArr(cl, 21)[i], e50 = emaArr(cl, 50)[i], e200 = emaArr(cl, 200)[i], r14 = calcRSI(14)[i];
  if (e200 == null || r14 == null) return null;
  const dir = st === 1 && e21 > e50 && cb > e200 ? 1 : st === -1 && e21 < e50 && cb < e200 ? -1 : 0; if (!dir) return null;
  let vs = 0; for (let j = Math.max(0, i - 19); j <= i; j++) vs += cc[j].v; const vr = cc[i].v / ((vs / Math.min(i + 1, 20)) || 1);
  const rr = dir > 0 ? r14 : 100 - r14, core = vr < 1 && atrP > .01 && atrP <= .05 / 3;
  if (core && rr < 50) return null;                       // t-pb / tp-u80 (TRADING)
  const adx = calcADX(14).adx[i]; if (adx == null || adx < 25) return null;
  if (core && rank < 40 && rr < 55) return null;          // tp-r55 (TRADING)
  if (!(rr < 70 && atrP > .008 && atrP <= .03)) return null;
  return { dir, atrP, adx, rr, vr }; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJ(url, tries = 5) { for (let k = 0; k < tries; k++) { try { const r = await fetch(url); if (r.ok) return await r.json();
      if (r.status === 429 || r.status === 418 || r.status >= 500) { await sleep(5000 * (k + 1)); continue; } throw new Error(r.status + ' ' + url); }
    catch (e) { if (k === tries - 1) throw e; await sleep(2000); } } }
const toBar = k => ({ t: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], v: +k[5] });
async function klRange(s, tf, tfMs, from, to) { const out = []; let st = from;
  while (st < to) { const d = await getJ(`${API}/klines?symbol=${s}&interval=${tf}&startTime=${st}&endTime=${to}&limit=1000`); if (!d || !d.length) break;
    for (const k of d) out.push(toBar(k)); st = d[d.length - 1][0] + tfMs; if (d.length < 1000) break; await sleep(40); }
  return out.filter(b => b.t + tfMs <= to); }
function idxAfter(rb, t) { let lo = 0, hi = rb.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (rb[mid].t < t) lo = mid + 1; else hi = mid; } return lo; }
/* resultado en % del margen. ex: 'mitad' = aviso si una vela de 1 h cierra a mitad de camino al stop;
   'ema' = aviso si cierra del otro lado de la EMA 20 de 1 h estando ya un cuarto del camino en contra;
   'tiempo' = aviso si pasaron 24 h sin el objetivo 1 y está en contra. Se sale al cierre de esa vela. */
function sim(rb, e20, j0, entry, dir, sl, tpk, L, ex, t0) { let hit = 0, real = 0, j = j0, kind = 0, px = null; const tps = tpk.map(x => entry * (1 + dir * x * sl)), stop0 = entry * (1 - dir * sl);
  for (; j < rb.length; j++) { const b = rb[j]; if (b.t - t0 > M.maxAge) { j--; break; }
    const adv = dir > 0 ? b.low : b.high, fav = dir > 0 ? b.high : b.low, stop = hit ? entry : stop0;
    if (dir * (stop - adv) >= 0) { px = stop; kind = hit ? 3 : 1; break; }
    while (hit < 3 && dir * (fav - tps[hit]) >= 0) { real += dir * (tps[hit] / entry - 1) / 3; hit++; }
    if (hit >= 3) { px = null; kind = 4; break; }
    if (!hit && ex !== 'no') { const back = dir * (entry - b.close) / entry;
      if ((ex === 'mitad' && back >= .5 * sl) || (ex === 'ema' && e20[j] != null && dir * (b.close - e20[j]) < 0 && back >= .25 * sl) || (ex === 'tiempo' && b.t + M.resMs - t0 >= DAY && back > 0)) { px = b.close; kind = 2; break; } } }
  if (kind === 0) { const jj = Math.min(Math.max(j, j0), rb.length - 1); px = rb[jj] ? rb[jj].close : entry; j = jj; }
  const ret = real + (px == null ? 0 : (1 - hit / 3) * dir * (px / entry - 1));
  return { pct: 100 * L * (ret - 2 * FEE), hit, kind, tEnd: rb[Math.min(Math.max(j, 0), rb.length - 1)] ? rb[Math.min(Math.max(j, 0), rb.length - 1)].t : t0 }; }
const R = G.__BTP = { status: 'iniciando', done: 0, total: 0, err: [], cands: [], t0: Date.now(), now: NOW };
const OUT = []; // por candidata: arrays por geometría
async function runSymbol(s, rank) { const from = NOW - SPAN;
  const tb = await klRange(s, M.tf, M.tfMs, from - 300 * M.tfMs, NOW); if (tb.length < 350) return;
  const hb = await klRange(s, M.htf, M.htfMs, from - 130 * M.htfMs, NOW); if (hb.length < 30) return;
  const rb = await klRange(s, M.res, M.resMs, from, NOW); if (rb.length < 50) return;
  const hEma = emaArr(hb.map(b => b.close), 21), e20 = emaArr(rb.map(b => b.close), 20); let k = -1;
  for (let i = 299; i < tb.length - 1; i++) { const t = tb[i].t + M.tfMs; if (t < from) continue;
    while (k + 1 < hb.length && hb[k + 1].t + M.htfMs <= t) k++;
    const c = evalCand(tb.slice(i - 298, i + 1), rank); if (!c) continue;
    const entry = tb[i].close, j0 = idxAfter(rb, t), htf = Math.sign(htfTrend(hb, hEma, k)) === c.dir ? 1 : 0;
    const res = GEO.map(g => { const sl = Math.min(maxSlOf(g.L), Math.max(.004, g.a * c.atrP)); return sim(rb, e20, j0, entry, c.dir, sl, [g.r, 2 * g.r, 3 * g.r], g.L, g.ex, t); });
    R.cands.push({ s, t, rank, adx: c.adx, rr: c.rr, atrP: c.atrP, vr: c.vr, htf, pct: Float32Array.from(res, x => x.pct), hit: Uint8Array.from(res, x => x.hit), kind: Uint8Array.from(res, x => x.kind), tEnd: Float64Array.from(res, x => x.tEnd) }); } }
function evaluate() { const bySym = {}; for (const c of R.cands) (bySym[c.s] = bySym[c.s] || []).push(c); for (const s in bySym) bySym[s].sort((a, b) => a.t - b.t);
  const rows = [];
  for (let fi = 0; fi < FIL.length; fi++) { const F = FIL[fi];
    const pass = c => c.adx >= F.adx && c.rr < F.rr && c.atrP <= F.atr && (!F.htf || c.htf) && (!F.vr || c.vr < 1) && (!F.top || c.rank < 40);
    const lists = Object.values(bySym).map(L => L.filter(pass));
    for (let gi = 0; gi < GEO.length; gi++) { const tk = [];
      for (const L of lists) { let free = 0; for (const c of L) { if (c.t < free) continue; tk.push(c); free = Math.max(c.t + M.cool, c.tEnd[gi] + M.resMs); } }
      if (!tk.length) continue; tk.sort((a, b) => a.t - b.t);
      const S = { n: 0, h: 0, sum: 0, w: 0, l: 0, trn: 0, trs: 0, trh: 0, trw: 0, trl: 0, mn: 0, ms: 0, mh: 0, wn: 0, ws: 0, eq: 0, pk: 0, dd: 0, worst: 0, early: 0, errN: 0, errS: 0 };
      for (const c of tk) { const p = c.pct[gi], h = c.hit[gi] > 0; S.n++; S.sum += p; if (h) S.h++; p > 0 ? S.w += p : S.l -= p; S.eq += p; S.pk = Math.max(S.pk, S.eq); S.dd = Math.max(S.dd, S.pk - S.eq); S.worst = Math.min(S.worst, p);
        if (!h) { S.errN++; S.errS += p; if (c.kind[gi] === 2) S.early++; }
        if (c.t < TRAIN_END) { S.trn++; S.trs += p; if (h) S.trh++; p > 0 ? S.trw += p : S.trl -= p; } else { S.mn++; S.ms += p; if (h) S.mh++; }
        if (c.t >= NOW - 7 * DAY) { S.wn++; S.ws += p; } }
      rows.push([fi, gi, S.n, S.h / S.n, S.sum / S.n, S.l ? S.w / S.l : 99, S.trn, S.trn ? S.trs / S.trn : 0, S.trn ? S.trh / S.trn : 0, S.trl ? S.trw / S.trl : 99, S.mn, S.mn ? S.ms / S.mn : 0, S.mn ? S.mh / S.mn : 0, S.wn, S.wn ? S.ws / S.wn : 0, S.dd, S.worst, S.errN ? S.early / S.errN : 0, S.errN ? S.errS / S.errN : 0]); } }
  return rows; }
async function run() { try {
  const T = await getJ(`${API}/ticker/24hr`);
  const base = T.filter(t => t.symbol.endsWith('USDT') && !STABLE.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) && +t.quoteVolume > 1e7 && Math.abs(+t.priceChangePercent) < 25).sort((a, b) => b.quoteVolume - a.quoteVolume).map(t => t.symbol).slice(0, M.n);
  R.total = base.length; R.status = 'corriendo';
  let q = 0; const worker = async () => { while (q < base.length) { const r = q++, s = base[r]; try { await runSymbol(s, r); } catch (e) { R.err.push(s + ': ' + e.message); } R.done++; } };
  await Promise.all(Array.from({ length: G.BT_PAR || 6 }, worker));
  R.status = 'evaluando'; R.rows = evaluate(); R.status = 'listo'; R.secs = (Date.now() - R.t0) / 1000;
} catch (e) { R.status = 'error'; R.err.push(e.message + ' ' + e.stack); } }
G.BTP_FIL = FIL; G.BTP_GEO = GEO; G.BTP_RUN = run;
if (!G.BT_NOAUTO) run();
})(typeof window !== 'undefined' ? window : globalThis);
