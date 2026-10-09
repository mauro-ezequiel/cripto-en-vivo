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
const IA = require('../ia-core.js'), IAON = !!process.env.IA; // con IA=1 también guarda el recorrido de cada señal para que la IA estudie
const IAD = { tr: { ent: [], ops: [] }, sh: { ent: [], ops: [] } };
const API = process.env.BT_API || 'https://data-api.binance.vision/api/v3';
const MOCK = !!process.env.BT_MOCK;
const DAY = 864e5, NOW = +(process.env.BT_NOW || Date.now()), SPAN = +(process.env.BT_DAYS || 365) * DAY, FROM = NOW - SPAN, FEE = .0005;
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|USDE|USD1|PYUSD|XUSD|AEUR|EURI|BFUSD|USDS|RLUSD|USDF|FRAX|USDG)USDT$/;
const MIN_N = 20; // con menos casos el % no se publica como acierto

/* medidas vigentes (idénticas a la página: SIM, NEWG y PLUSG) */
const T4 = { tf: '4h', tfMs: 4 * 36e5, res: '1h', resMs: 36e5, n: +(process.env.BT_NT || 80), cool: 24 * 36e5, maxAge: 7 * DAY };
/* SHOOTER v4 (octubre 2026): velas de 15 y 30 min (antes 3 min). Una operación por moneda a la vez entre las dos temporalidades. */
const SH = { tfs: (process.env.SH_TFS || '15m,30m').split(','), htf: '1h', htfMs: 36e5, n: +(process.env.BT_NS || 30), cool: 36e5, maxAge: 12 * 36e5 };
const TFMIN = { '3m': 3, '5m': 5, '15m': 15, '30m': 30 };
/* universo (probado en octubre 2026 con 14 variantes): todas las cripto con más de 10 M USD de volumen para TRADING y TRADING+,
   y las 30 con más volumen para SHOOTER. Sumar las de menos volumen (2–10 M) o más monedas en SHOOTER empeoró todos los modos:
   esas son las "impredecibles". El filtro de rango de 1 h (BT_WILD) no mejoró nada y queda apagado. */
const UNI = process.env.BT_UNI || 'all', MINVOL = +(process.env.BT_MINVOL || 1e7), WILD = +(process.env.BT_WILD || 0);
function wildArr(hb) { const out = Array(hb.length).fill(null); let s = 0; for (let i = 0; i < hb.length; i++) { s += (hb[i].high - hb[i].low) / hb[i].close * 100; if (i >= 168) s -= (hb[i - 168].high - hb[i - 168].low) / hb[i - 168].close * 100; if (i >= 167) out[i] = s / 168; } return out; }
const tooWild = (hb, W, t) => { if (!WILD) return false; const i = lastClosed(hb, 36e5, t); return i >= 0 && W[i] != null && W[i] > WILD; };
const GEO = {
  core: { L: 10, a: 3, cap: .036, floor: .004, r: .5, ex: 'no', ll: true, margin: 350 },   // TRADING
  plus: { L: +(process.env.PLUS_LEV || 10), a: 3, cap: +(process.env.PLUS_CAP || .076), floor: 0, r: .35, ex: 'mitad', ll: false, margin: 350 },  // TRADING+ (× 10 desde octubre 2026)
  sh:   { L: +(process.env.SH_LEV || 15), a: 3, cap: +(process.env.SH_CAP || .05), floor: .004, r: +(process.env.SH_R || .35), ex: 'no', ll: false, margin: 50 }   // SHOOTER × 15
};
const SH_SKIP = (process.env.SH_CAPMODE || 'cap') === 'skip'; // por defecto el stop se recorta al tope (5 % con × 15); 'skip' no opera
const SETUP_M = { 't-pb': 'medio', 'tp-r55': 'medio', 'tp-u80': 'medio', 'tp-x': 'medio', 'sh-c': 'x' };

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
  const ms = { '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': 36e5, '4h': 144e5 }[tf], st = +q.searchParams.get('startTime'), en = +q.searchParams.get('endTime');
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
const toBar = k => ({ t: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], v: +k[5], tb: +k[9] });
/* PRUEBA FUT=1: monedas que solo están en futuros perpetuos. Desde GitHub la API de futuros está bloqueada (EE. UU.), así que las velas
   salen del archivo público de Binance (data.binance.vision): un zip por mes y, para el mes en curso, uno por día. */
const FUTON = !!process.env.FUT, FUTSET = new Set(), VIS = 'https://data.binance.vision/data/futures/um';
async function getZipCsv(url) { for (let k = 0; k < 4; k++) { try { const r = await fetch(url); if (r.status === 404) return null; if (!r.ok) { await sleep(2000 * (k + 1)); continue; }
      const buf = Buffer.from(await r.arrayBuffer()), tmp = require('os').tmpdir() + '/k' + Math.random().toString(36).slice(2) + '.zip'; fs.writeFileSync(tmp, buf);
      const txt = require('child_process').execFileSync('unzip', ['-p', tmp], { maxBuffer: 1 << 28 }).toString(); fs.unlinkSync(tmp);
      return txt.split('\n').filter(l => /^\d/.test(l)).map(l => l.split(',')); } catch (e) { await sleep(2000); } } return null; }
const ym = t => new Date(t).toISOString().slice(0, 7);
async function klZip(s, tf, tfMs, from, to) { const out = [], cur = ym(NOW);
  for (let d = new Date(ym(from) + '-01T00:00:00Z'); ym(+d) < cur; d.setUTCMonth(d.getUTCMonth() + 1)) { const m = ym(+d), rows = await getZipCsv(`${VIS}/monthly/klines/${s}/${tf}/${s}-${tf}-${m}.zip`); if (rows) for (const k of rows) out.push(toBar(k)); }
  for (let t = Date.parse(cur + '-01T00:00:00Z'); t + DAY <= NOW; t += DAY) { const dd = new Date(t).toISOString().slice(0, 10), rows = await getZipCsv(`${VIS}/daily/klines/${s}/${tf}/${s}-${tf}-${dd}.zip`); if (rows) for (const k of rows) out.push(toBar(k)); }
  return out.filter(b => b.t >= from && b.t + tfMs <= to).sort((a, b) => a.t - b.t); }
async function futOnlyList(spot) { const syms = []; let marker = '';
  for (let k = 0; k < 20; k++) { const r = await fetch(`https://s3-ap-northeast-1.amazonaws.com/data.binance.vision?delimiter=/&prefix=data/futures/um/monthly/klines/${marker ? '&marker=' + encodeURIComponent(marker) : ''}`), x = await r.text();
    const P = [...x.matchAll(/<Prefix>data\/futures\/um\/monthly\/klines\/([A-Z0-9]+)\/<\/Prefix>/g)].map(m => m[1]); syms.push(...P);
    if (!/<IsTruncated>true/.test(x) || !P.length) break; marker = 'data/futures/um/monthly/klines/' + P[P.length - 1] + '/'; }
  const cand = syms.filter(s => /^[A-Z0-9]+USDT$/.test(s) && !spot.has(s) && !STABLE.test(s)), last = new Date(Date.parse(ym(NOW) + '-01T00:00:00Z') - DAY), lm = ym(+last), out = [];
  let q = 0; await Promise.all(Array.from({ length: 6 }, async () => { while (q < cand.length) { const s = cand[q++]; const rows = await getZipCsv(`${VIS}/monthly/klines/${s}/1d/${s}-1d-${lm}.zip`);
    if (!rows || rows.length < 20) continue; const qv = rows.reduce((a, k) => a + +k[7], 0) / rows.length; if (qv > MINVOL) out.push([s, qv]); } }));
  console.log('solo futuros: en el archivo', syms.length, 'candidatas', cand.length, 'con más de', MINVOL / 1e6, 'M por día:', out.length);
  return out.sort((a, b) => b[1] - a[1]).map(x => x[0]); }
/* EXPERIMENTO IAX=1: datos de futuros al momento de cada entrada (del archivo público de Binance, cada 5 min):
   interés abierto (cambio en 1 h y 24 h), flujo comprador/vendedor de la última hora, posición de los traders grandes, posición de los minoristas
   y el último funding. Los que van a favor de la dirección se multiplican por ella. Se agregan al final de cada fila de entradas. */
const IAX = !!process.env.IAX, IAXN = +(process.env.IAX_N || 30), MET = {};
async function loadMetrics(s) { if (MET[s]) return MET[s]; const R = []; const days = []; for (let t = Math.floor(FROM / DAY) * DAY - DAY; t + DAY <= NOW; t += DAY) days.push(new Date(t).toISOString().slice(0, 10));
  let q = 0; await Promise.all(Array.from({ length: 6 }, async () => { while (q < days.length) { const d = days[q++]; const rows = await getZipCsv(`${VIS}/daily/metrics/${s}/${s}-metrics-${d}.zip`);
    if (rows) for (const r of rows) { const t = Date.parse(r[0].replace(' ', 'T') + 'Z'); if (t > 0) R.push([t, +r[3], +r[5], +r[6], +r[7]]); } } }));
  R.sort((a, b) => a[0] - b[0]); const F = [];
  for (let d = new Date(ym(FROM - 31 * DAY) + '-01T00:00:00Z'); ym(+d) < ym(NOW); d.setUTCMonth(d.getUTCMonth() + 1)) { const rows = await getZipCsv(`${VIS}/monthly/fundingRate/${s}/${s}-fundingRate-${ym(+d)}.zip`); if (rows) for (const r of rows) F.push([+r[0], +r[2]]); }
  F.sort((a, b) => a[0] - b[0]); return (MET[s] = { R, F }); }
function metX(M, t, d) { const N = Array(6).fill(null); if (!M || !M.R.length) return N; const R = M.R; let lo = 0, hi = R.length; while (lo < hi) { const m = (lo + hi) >> 1; if (R[m][0] <= t) lo = m + 1; else hi = m; } const i = lo - 1;
  if (i < 288 || t - R[i][0] > 15 * 6e4) return N; const L = v => v > 0 ? Math.log(v) : 0; let tk = 0; for (let k = i - 11; k <= i; k++) tk += L(R[k][4]); tk /= 12;
  let f = null; { const F = M.F; let a = 0, b = F.length; while (a < b) { const m = (a + b) >> 1; if (F[m][0] <= t) a = m + 1; else b = m; } if (a > 0) f = F[a - 1][1]; }
  return [R[i - 288][1] ? R[i][1] / R[i - 288][1] - 1 : 0, R[i - 12][1] ? R[i][1] / R[i - 12][1] - 1 : 0, d * tk, d * L(R[i][2]), d * L(R[i][3]), f == null ? null : d * f * 1e4].map(v => v == null || !isFinite(v) ? null : +v.toFixed(5)); }
async function klRange(s, tf, tfMs, from, to) { if (FUTSET.has(s)) return klZip(s, tf, tfMs, from, to); const out = []; let st = from;
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
  const MX = IAX && IAON && rank < IAXN ? await loadMetrics(s) : null;
  const tb = await klRange(s, T4.tf, T4.tfMs, FROM - 300 * T4.tfMs, NOW); if (tb.length < 350) return;
  const rb = await klRange(s, T4.res, T4.resMs, FROM - 300 * T4.resMs, NOW); if (rb.length < 50) return; const W1 = wildArr(rb);
  candles = tb; const e200 = emaArr(closes(), 200);
  const P1 = IAON ? IA.prep(rb) : null, P4 = IAON ? IA.prep(tb) : null;
  const llConf = (t, dir) => { const i = lastClosed(tb, T4.tfMs, t); return i >= 0 && e200[i] != null && (dir > 0 ? tb[i].close > e200[i] : tb[i].close < e200[i]); };
  for (let i = 299; i < tb.length; i++) { const t = tb[i].t + T4.tfMs; if (t < FROM) continue;
    if (IAON) iaEntry4h(P4, P1, rb, i, t, llConf, rank);
    const c = classify4h(tb.slice(i - 298, i + 1), rank); if (!c) continue;
    if (btcDirAt(BTC4, T4.tfMs, t) !== c.dir) continue; // solo a favor de BTC (4h vs EMA 50), como la página
    if (tooWild(rb, W1, t)) continue; // moneda impredecible esa semana
    const g = GEO[c.k], sl = slOf(g, c.atrP), entry = tb[i].close, j0 = idxAfter(rb, t);
    const res = sim(rb, T4.resMs, T4.maxAge, j0, entry, c.dir, sl, g.r, g.L, g.ex, g.ll ? llConf : null, t);
    CANDS.push({ m: 'medio', setup: c.setup, s, t, dir: c.dir, sl, entry, r: g.r, L: g.L, cool: T4.cool, margin: g.margin, ...res,
      ia: IAON ? iaPath(P1, j0, entry, c.dir, sl, g.r, T4.maxAge, t, T4.resMs) : null }); }
  return { rb, tb, llConf }; }

async function runShooter(s, rank = 0) {
  const MX = IAX && IAON && rank < IAXN ? await loadMetrics(s) : null;
  const hb = await klRange(s, SH.htf, SH.htfMs, FROM - 300 * SH.htfMs, NOW); if (hb.length < 200) return;
  const he = emaArr(hb.map(b => b.close), 50), W1 = wildArr(hb); let first = null;
  for (const tf of SH.tfs) { const tfMs = TFMIN[tf] * 6e4, back = Math.round(60 / TFMIN[tf]);
    const tb = await klRange(s, tf, tfMs, FROM - 300 * tfMs, NOW); if (tb.length < 400) continue;
    candles = tb; const cl = closes(), atr = wilder(trArr(), 14), r7 = calcRSI(7), [bm, bs] = smaStd(cl, 20), P3 = IAON ? IA.prep(tb) : null;
    for (let i = 299; i < tb.length; i++) { const t = tb[i].t + tfMs; if (t < FROM) continue;
      const cb = tb[i].close, atrP = atr[i] / cb; if (r7[i] == null || !bs[i] || !(atrP > 0)) continue;
      const z = (cb - bm[i]) / bs[i];
      if (IAON && z <= -1.8 && r7[i] <= 35 && rnd() < .3) { // candidatas para aprender a entrar
        const g = GEO.sh, o = sim(tb, tfMs, SH.maxAge, i + 1, cb, 1, slOf(g, atrP), g.r, g.L, g.ex, null, t);
        if (!o.open) IAD.sh.ent.push([t, ...IA.entryX(P3, i, 1, btcDirAt(BTC1, 36e5, t)).map(v => +v.toFixed(3)), o.hit >= 1 ? 1 : 0, 0, +o.pct.toFixed(2), rank, 1, TFMIN[tf], ...(IAX ? metX(MX, t, 1) : [])]); }
      const drop = (cb / tb[i - back].close - 1) * 100; if (!(z <= -1.8 && r7[i] <= 35 && drop <= -3)) continue;
      const k = lastClosed(hb, SH.htfMs, t); if (!(k >= 0 && he[k] != null && hb[k].close > he[k])) continue; // tendencia de 1 h a favor
      if (tooWild(hb, W1, t)) continue;
      const dir = 1, g = GEO.sh; if (SH_SKIP && g.a * atrP > g.cap) continue; const sl = slOf(g, atrP);
      const res = sim(tb, tfMs, SH.maxAge, i + 1, cb, dir, sl, g.r, g.L, g.ex, null, t);
      CANDS.push({ m: 'x', setup: 'sh-c', tf, s, t, dir, sl, entry: cb, r: g.r, L: g.L, cool: SH.cool, margin: g.margin, ...res,
        ia: IAON ? iaPath(P3, i + 1, cb, dir, sl, g.r, SH.maxAge, t, tfMs) : null }); }
    if (!first) first = { rb: tb, tfMs, ok: j => atr[j] != null }; }
  return first; }

/* ---------- datos para la IA ---------- */
/* recorrido de una operación vela a vela (hasta 1,5 × el plazo): lo que veía la IA en cada cierre y el precio que vino después */
function iaPath(P, j0, entry, dir, sl, r, maxAge, t0, resMs) {
  const X = [], B = [], tps = [1, 2, 3].map(k => entry * (1 + dir * k * r * sl)); let peak = entry, hits = 0;
  for (let j = j0; j < P.bars.length && j < j0 + Math.ceil(1.5 * maxAge / resMs); j++) { const b = P.bars[j];
    peak = dir > 0 ? Math.max(peak, b.high) : Math.min(peak, b.low); while (hits < 3 && dir * (peak - tps[hits]) >= 0) hits++;
    const tc = b.t + resMs;
    X.push(IA.exitX(P, j, { dir, entry, sl, peak, hits, age: (tc - t0) / maxAge }, btcDirAt(BTC1, 36e5, tc)).map(v => +v.toFixed(3)));
    B.push([b.high, b.low, b.close, +(P.atr[j] || 0).toPrecision(5)]); }
  return { X, B }; }
/* entradas posibles de 4h (tendencia alineada) y si llegaron al objetivo 1 con las medidas de TRADING */
function iaEntry4h(P4, P1, rb, i, t, llConf, rank) { const b = P4.bars[i], st = P4.st[i];
  if (!st || P4.e200[i] == null || P4.e21[i] == null || P4.e50[i] == null) return;
  if (Math.sign(P4.e21[i] - P4.e50[i]) !== st || Math.sign(b.close - P4.e200[i]) !== st || rnd() > .5) return;
  const g = GEO.core, atrP = (P4.atr[i] || 0) / b.close, o = sim(rb, T4.resMs, T4.maxAge, idxAfter(rb, t), b.close, st, slOf(g, atrP), g.r, g.L, g.ex, g.ll ? llConf : null, t);
  if (!o.open) IAD.tr.ent.push([t, ...IA.entryX(P4, i, st, btcDirAt(BTC4, T4.tfMs, t)).map(v => +v.toFixed(3)), o.hit >= 1 ? 1 : 0, 0, +o.pct.toFixed(2), rank, st, ...(IAX ? metX(MX, t, st) : [])]); }

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

/* ---------- SUPLEMENTOS EN PRUEBA (no cambian las señales): ¿qué pasaría si se agregaran? ----------
   Se mide sobre las mismas operaciones del año. Las reglas fijas (calendario y límite) se miden en todo el año; las que se eligen
   mirando los datos (horas y volatilidad) se eligen con los primeros 2/3 y se miden solo en el último tercio, para no hacer trampa. */
/* datos económicos de EE. UU. (hora de Nueva York): inflación (CPI) y empleo a las 8:30, decisión de la Fed a las 14:00.
   Fuentes: calendarios oficiales de la oficina de estadísticas de EE. UU. (BLS) y de la Reserva Federal. Octubre 2025 se canceló por el cierre del gobierno. */
const MACRO = { cpi: ['2025-10-24', '2025-12-18', '2026-01-13', '2026-02-13', '2026-03-11', '2026-04-10', '2026-05-12', '2026-06-10', '2026-07-14', '2026-08-12', '2026-09-11', '2026-10-14', '2026-11-10', '2026-12-10'],
  nfp: ['2025-11-20', '2025-12-16', '2026-01-09', '2026-02-11', '2026-03-06', '2026-04-03', '2026-05-08', '2026-06-05', '2026-07-02', '2026-08-07', '2026-09-04', '2026-10-02', '2026-11-06', '2026-12-04'],
  fomc: ['2025-10-29', '2025-12-10', '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'] };
const etUtc = (d, hh, mm) => { const t = Date.parse(d + 'T00:00:00Z'), y = +d.slice(0, 4), sec = (m, k) => { const x = new Date(Date.UTC(y, m, 1)); return Date.UTC(y, m, 1 + (7 - x.getUTCDay()) % 7 + 7 * (k - 1)); };
  const edt = t >= sec(2, 2) && t < sec(10, 1); return t + ((hh + (edt ? 4 : 5)) * 60 + mm) * 6e4; };
const MACRO_T = [...MACRO.cpi.map(d => etUtc(d, 8, 30)), ...MACRO.nfp.map(d => etUtc(d, 8, 30)), ...MACRO.fomc.map(d => etUtc(d, 14, 0))].sort((a, b) => a - b);
const nearMacro = t => MACRO_T.some(e => t >= e - 36e5 && t < e + 2 * 36e5); // de 1 h antes a 2 h después
function suplementos(ops) {
  const modo = o => o.m === 'x' ? 'SHOOTER' : o.setup === 'tp-x' ? 'TRADING+' : 'TRADING', usd = o => o.pct / 100 * o.margin;
  const done = ops.filter(o => !o.open).sort((a, b) => a.t - b.t), cut = done.length ? done[Math.floor(done.length * 2 / 3)].t : NOW;
  /* volatilidad de BTC al entrar: rango promedio de 1 h de las últimas 24 h, comparado con los 30 días anteriores (percentil) */
  const B = BTC1 && BTC1.b || [], rg = B.map(b => (b.high - b.low) / b.close), vol = t => { const i = lastClosed(B, 36e5, t); if (i < 744) return null;
    let a = 0; for (let k = i - 23; k <= i; k++) a += rg[k]; a /= 24; let below = 0, n = 0; for (let k = i - 743; k <= i - 24; k += 6) { let b = 0; for (let j = k - 23; j <= k; j++) b += rg[j]; below += b / 24 < a; n++; } return below / n; };
  for (const o of done) { o._v = vol(o.t); o._h = new Date(o.t).getUTCHours(); o._mac = nearMacro(o.t); o._fut = FUTSET.has(o.s); }
  const st = (L, days) => { const n = L.length; if (!n) return { n: 0 }; const u = L.reduce((a, o) => a + usd(o), 0);
    return { n, dia: +(n / (days || SPAN / DAY)).toFixed(2), obj1: +(L.filter(o => o.hit >= 1).length / n * 100).toFixed(1), usd: +(u / n).toFixed(2), total: Math.round(u), peor: +Math.min(...L.map(usd)).toFixed(1) }; };
  const by = (L, f, days) => { const o = {}; for (const m of ['TRADING', 'TRADING+', 'SHOOTER']) o[m] = st(L.filter(x => modo(x) === m && f(x)), days); return o; };
  const spot = done.filter(o => !o._fut), test = spot.filter(o => o.t >= cut), train = spot.filter(o => o.t < cut);
  /* límite: como mucho 3 operaciones abiertas a la vez en la misma dirección (las cripto se mueven juntas) */
  const expo = L => { const keep = [], live = []; for (const o of L) { for (let i = live.length - 1; i >= 0; i--) if (live[i].tEnd <= o.t) live.splice(i, 1);
      if (live.filter(x => x.dir === o.dir).length >= 3) continue; keep.push(o); live.push(o); } return keep; };
  /* horas (bloques de 4 h, hora UTC) y volatilidad: se eligen con el aprendizaje */
  const badH = {}, volCut = {};
  for (const m of ['TRADING', 'TRADING+', 'SHOOTER']) { const T = train.filter(o => modo(o) === m); badH[m] = [];
    for (let h = 0; h < 24; h += 4) { const L = T.filter(o => o._h >= h && o._h < h + 4); if (L.length >= 15 && L.reduce((a, o) => a + usd(o), 0) < 0) badH[m].push(h); }
    let best = [null, T.reduce((a, o) => a + usd(o), 0)]; for (const c of [.5, .6, .7, .8, .9]) { const L = T.filter(o => o._v == null || o._v <= c), u = L.reduce((a, o) => a + usd(o), 0); if (L.length >= T.length * .5 && u > best[1]) best = [c, u]; }
    volCut[m] = best[0]; }
  const okH = o => !badH[modo(o)].includes(Math.floor(o._h / 4) * 4), okV = o => volCut[modo(o)] == null || o._v == null || o._v <= volCut[modo(o)];
  const ex = expo(spot), exSet = new Set(ex), exT = new Set(expo(test));
  const TD = Math.max(1, (NOW - cut) / DAY);
  const res = { desde_prueba: cut, horas_malas_utc: badH, vol_max_percentil: volCut, eventos: MACRO_T.length,
    anio: { bots: by(spot, () => true), calendario: by(spot, o => !o._mac), limite3: by(spot, o => exSet.has(o)), calendario_y_limite: by(expo(spot.filter(o => !o._mac)), () => true) },
    prueba: { bots: by(test, () => true, TD), horas: by(test, okH, TD), volatilidad: by(test, okV, TD), calendario: by(test, o => !o._mac, TD), limite3: by(test, o => exT.has(o), TD),
      todo: by(expo(test.filter(o => !o._mac && okH(o) && okV(o))), () => true, TD) } };
  if (FUTSET.size) { res.futuros = { solo_spot: by(spot, () => true), solo_futuros: by(done.filter(o => o._fut), () => true), juntas: by(done, () => true) }; }
  return res; }

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
  const base = T.filter(t => t.symbol.endsWith('USDT') && !STABLE.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) && +t.quoteVolume > MINVOL && Math.abs(+t.priceChangePercent) < 25)
    .sort((a, b) => b.quoteVolume - a.quoteVolume).map(t => t.symbol);
  let n4 = UNI === 'all' ? base.length : T4.n, nS = Math.min(SH.n, base.length); console.log('monedas', base.length, 'TRADING', n4, 'SHOOTER', nS);
  /* con FUT=1 las de solo futuros se SUMAN al final: las de spot quedan igual que siempre y se comparan por separado */
  let shList = base.slice(0, nS), trList = base.slice(0, n4);
  if (FUTON) { let F = []; try { F = await futOnlyList(new Set(T.map(t => t.symbol))); } catch (e) { console.log('no se pudo listar las de futuros:', e.message); } F.forEach(s => FUTSET.add(s)); trList = trList.concat(F); shList = shList.concat(F); console.log('se suman', F.length, F.join(' ')); }
  { const b = await klRange('BTCUSDT', '4h', 144e5, FROM - 300 * 144e5, NOW); candles = b; BTC4 = { b, e: emaArr(closes(), 50) }; }
  { const b = await klRange('BTCUSDT', '1h', 36e5, FROM - 300 * 36e5, NOW); candles = b; BTC1 = { b, e: emaArr(closes(), 50) }; }
  const err = [], par = +(process.env.BT_PAR || 3);
  const pool = async (list, fn) => { let q = 0; await Promise.all(Array.from({ length: par }, async () => { while (q < list.length) { const r = q++; try { await fn(list[r], r); } catch (e) { err.push(list[r] + ': ' + e.message); } } })); };
  /* TRADING / TRADING+ */
  const keep4 = {};
  await pool(trList, async (s, r) => { const x = await run4h(s, r); if (x) keep4[s] = x; });
  console.log('TRADING listo', ((Date.now() - t0) / 1000).toFixed(0), 's');
  const slCore = CANDS.filter(c => c.m === 'medio' && c.setup !== 'tp-x').map(c => c.sl);
  for (const s in keep4) randomEntries('medio', s, keep4[s].rb, T4.resMs, T4.maxAge, 60, slCore, GEO.core, keep4[s].llConf);
  for (const k in keep4) delete keep4[k];
  /* SHOOTER (velas de 5 min: más pesado, una moneda a la vez por memoria) */
  const shSl = [];
  await pool(shList, async (s, r) => { const x = await runShooter(s, r); if (!x) return;
    const mine = CANDS.filter(c => c.s === s && c.m === 'x').map(c => c.sl); shSl.push(...mine);
    randomEntries('x', s, x.rb, x.tfMs, SH.maxAge, 30, shSl.length ? shSl : [GEO.sh.cap], GEO.sh, null, x.ok); }); // al azar con el mismo stop
  console.log('SHOOTER listo', ((Date.now() - t0) / 1000).toFixed(0), 's');

  const ops = pick(), cal = { medio: {}, x: {} };
  for (const setup in SETUP_M) { const st = stats(ops.filter(o => o.setup === setup)); cal[SETUP_M[setup]][setup] = st; }
  const azar = {}; for (const m of ['medio', 'x']) { const st = stats(RAND[m]); azar[m] = st.n ? { p: st.p, n: st.n, usd: st.usd } : null; }
  const out = { upd: NOW, desde: FROM, dias: Math.round(SPAN / DAY), minN: MIN_N, monedas: { trading: n4, shooter: nS, universo: UNI, volMin: MINVOL, impredecible: WILD }, medidas: { plus: { L: GEO.plus.L, cap: GEO.plus.cap }, sh: { L: GEO.sh.L, cap: GEO.sh.cap, r: GEO.sh.r, tfs: SH.tfs } },
    cal, azar, secs: Math.round((Date.now() - t0) / 1000), errores: err.slice(0, 20), suplementos: (() => { try { return suplementos(ops); } catch (e) { console.log('suplementos:', e.message); return null; } })(), soloFuturos: [...FUTSET].map(x => x.replace('USDT', '')),
    /* cada operación: [modo, setup, moneda, inicio, dir, objetivos, cierre(1 stop · 2 aviso · 3 entrada · 4 completa · 5 plazo · 0 en curso), USD, salvavidas(1/0), fin] */
    ops: ops.map(o => [o.m, o.setup, o.s.replace('USDT', ''), o.t, o.dir, o.hit, o.open ? 0 : o.kind, +(o.pct / 100 * o.margin).toFixed(1), o.ll ? 1 : 0, o.open ? 0 : o.tEnd]) };
  const body = JSON.stringify(out);
  fs.writeFileSync('historial.json', body);
  if (IAON) { const zlib = require('zlib');
    for (const o of ops) if (o.ia && !o.open) (o.m === 'x' ? IAD.sh : IAD.tr).ops.push({ m: o.m, setup: o.setup, s: o.s, t: o.t, dir: o.dir, entry: o.entry, sl: o.sl, r: o.r, L: o.L,
      tf: o.tf || '4h', maxAge: o.m === 'x' ? SH.maxAge : T4.maxAge, botPct: +o.pct.toFixed(3), botHit: o.hit, kind: o.kind, X: o.ia.X, B: o.ia.B });
    fs.writeFileSync('ia-datos.json.gz', zlib.gzipSync(JSON.stringify({ upd: NOW, fee: FEE, exitF: IA.EXIT_F, entryF: IA.ENTRY_F, syms: base.slice(0, Math.max(n4, nS)).map(x => x.replace('USDT', '')), ...IAD })));
    console.log('IA: operaciones', IAD.tr.ops.length, IAD.sh.ops.length, 'entradas', IAD.tr.ent.length, IAD.sh.ent.length); }
  console.log(JSON.stringify({ cal, azar, ops: ops.length, errores: err.length, secs: out.secs }, null, 1));
  console.log('suplementos', JSON.stringify(out.suplementos));
  if (MOCK || process.env.NO_PUBLISH) return;
  if (await publish(body)) console.log('Publicado historial.json en la rama datos'); else if (process.env.GH_TOKEN) { console.log('No se pudo publicar'); process.exitCode = 1; } }
main().catch(e => { console.error(e); process.exitCode = 1; });
