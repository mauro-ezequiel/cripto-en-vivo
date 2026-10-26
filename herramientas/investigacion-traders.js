/* INVESTIGACIÓN "TRADERS" (octubre 2026): estrategias públicas de traders conocidos, probadas en cripto con 300 USD × 10 por señal.
   No cambia la página ni los bots: solo mide. Datos: velas de Binance (spot, espejo público) de 15 min y 1 h; de ahí se arman 30 min, 4 h, 8 h, 12 h y 1 día.
   Tres plazos, como pidió el usuario: corto (15–30 min, como SHOOTER), medio (4 h, como TRADING) y largo (8 h – 1 día), y en cada plazo
   varias formas de pensar, cada una copiada de un trader conocido:
   · CONNORS (Larry Connors, RSI de 2): reversión a la media a favor de la tendencia larga. De las de mayor % de aciertos publicadas.
   · RASCHKE (Linda Bradford Raschke): "Holy Grail" (tendencia fuerte con ADX > 30, retroceso a la EMA 20 y ruptura de la vela del retroceso)
     y "Turtle Soup" (ruptura falsa del mínimo/máximo de 20 velas que vuelve adentro → entra al revés).
   · TORTUGAS (Richard Dennis): ruptura del máximo/mínimo de N velas (Donchian), stop 2 N (2 ATR de 20), con EMA 200 a favor.
   · KULLAMÄGI (Kristjan Kullamägi, solo LONG): ya subió fuerte, se comprime cerca del máximo y rompe con volumen; stop en el mínimo de la
     vela de ruptura (como mucho 1 ATR).
   · WILLIAMS (Larry Williams): ruptura de volatilidad: apertura del período ± k × rango del período anterior, a favor de la tendencia.
   Gestión: con r, la de los bots actuales: 3 objetivos a r × stop (1/3 en cada uno), stop a la entrada tras el objetivo 1, plazo maxH horas;
   sin r, la salida original del trader. BTC a favor (4 h sobre/bajo EMA 50) en todas.
   Costos: comisión 0,05 % + deslizamiento 0,03 % por lado y financiación 0,01 % cada 8 h. Se saltea la señal si el stop queda a más
   de MAXSL. Una operación a la vez por moneda y variante. En cada vela primero el stop (lo peor).
   Uso: node herramientas/investigacion-traders.js → investigacion-traders.json */
const fs = require('fs');
const API = 'https://data-api.binance.vision/api/v3', DAY = 864e5, H = 36e5, M15 = 9e5, NOW = Date.now();
const DIAS = +(process.env.DIAS || 1460), NC = +(process.env.NC || 60), NS = +(process.env.NS || 30), LEV = 10, MARGEN = 300, COSTO = .0008, FUND = .0001, MAXSL = +(process.env.MAXSL || .05);
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|USDE|USD1|PYUSD|XUSD|AEUR|EURI|BFUSD|USDS|RLUSD|USDF|FRAX|USDG|WBTC|WBETH|BNSOL|PAXG|XAUT)USDT$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJ(u) { for (let k = 0; k < 6; k++) { try { const r = await fetch(u); if (r.ok) return await r.json(); if (r.status === 400) return null; } catch (e) {} await sleep(1500 * (k + 1)); } return null; }
const toBar = k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] * +k[4] });
async function klines(s, tf, ms, from) { const out = []; let st = from;
  while (st < NOW) { const d = await getJ(`${API}/klines?symbol=${s}&interval=${tf}&startTime=${st}&limit=1000`); if (!d || !d.length) break;
    for (const k of d) out.push(toBar(k)); st = +d[d.length - 1][0] + ms; if (d.length < 1000) break; await sleep(25); }
  return out.filter(b => b.t + ms <= NOW); }
function agg(b, ms, n) { const out = []; let cur = null;
  for (const x of b) { const k = Math.floor(x.t / (ms * n)) * ms * n; if (!cur || cur.t !== k) { if (cur && cur.n === n) out.push(cur); cur = { t: k, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, n: 1 }; }
    else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v; cur.n++; } }
  if (cur && cur.n === n) out.push(cur); return out; }
function ema(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let pr = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { pr = s / p; o[i] = pr; } } else { pr = v[i] * k + pr * (1 - k); o[i] = pr; } } return o; }
function wil(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { s /= p; o[i] = s; } } else { s = (s * (p - 1) + v[i]) / p; o[i] = s; } } return o; }
const trA = b => b.map((x, i) => i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l);
function adxA(b) { const tr = trA(b), at = wil(tr, 14), pd = [0], md = [0]; for (let i = 1; i < b.length; i++) { const u = b[i].h - b[i - 1].h, d = b[i - 1].l - b[i].l; pd.push(u > d && u > 0 ? u : 0); md.push(d > u && d > 0 ? d : 0); }
  const sp = wil(pd, 14), sm = wil(md, 14), dx = at.map((t, i) => { if (!t || sp[i] == null) return null; const a = sp[i] / t, c = sm[i] / t; return a + c > 0 ? 100 * Math.abs(a - c) / (a + c) : null; });
  const adx = Array(b.length).fill(null); let s = 0, c = 0, pr = null; for (let i = 0; i < b.length; i++) { if (dx[i] == null) continue; if (pr === null) { s += dx[i]; if (++c === 14) { pr = s / 14; adx[i] = pr; } } else { pr = (pr * 13 + dx[i]) / 14; adx[i] = pr; } }
  return { adx, pdi: sp.map((v, i) => at[i] ? v / at[i] : null), mdi: sm.map((v, i) => at[i] ? v / at[i] : null), atr: at }; }
const hiN = (b, i, n) => { let m = -Infinity; for (let j = Math.max(0, i - n); j < i; j++) m = Math.max(m, b[j].h); return m; };
const loN = (b, i, n) => { let m = Infinity; for (let j = Math.max(0, i - n); j < i; j++) m = Math.min(m, b[j].l); return m; };
const idxAfter = (rb, t) => { let lo = 0, hi = rb.length; while (lo < hi) { const m = (lo + hi) >> 1; if (rb[m].t < t) lo = m + 1; else hi = m; } return lo; };
const pctM = (f, hrs) => +(100 * (LEV * f - LEV * 2 * COSTO - LEV * FUND * hrs / 8)).toFixed(2);

/* ---------- gestión ---------- */
let BTC = null;
function btcOk(t, d) { if (!BTC) return true; let lo = 0, hi = BTC.b.length; while (lo < hi) { const m = (lo + hi) >> 1; if (BTC.b[m].t + 4 * H <= t) lo = m + 1; else hi = m; } const i = lo - 1;
  if (i < 50 || !BTC.e[i]) return true; return d > 0 ? BTC.b[i].c > BTC.e[i] : BTC.b[i].c < BTC.e[i]; }
/* objetivos sobre las velas de resolución R (ms = su duración) */
function tpSim(R, ms, j0, e, d, sl, r, maxH, t0) { const tps = [1, 2, 3].map(k => e * (1 + d * k * r * sl)); let hit = 0, real = 0, j = j0;
  for (; j < R.length; j++) { const q = R[j]; if (q.t - t0 >= maxH * H) break; const stop = hit ? e : e * (1 - d * sl);
    if (d * (stop - (d > 0 ? q.l : q.h)) >= 0) return { f: real + (1 - hit / 3) * d * (stop / e - 1), end: q.t + ms, stop: !hit, hit };
    while (hit < 3 && d * ((d > 0 ? q.h : q.l) - tps[hit]) >= 0) { real += d * (tps[hit] / e - 1) / 3; hit++; } if (hit >= 3) return { f: real, end: q.t + ms, hit }; }
  if (j >= R.length) return null; const k = Math.max(j - 1, j0); return { f: real + (1 - hit / 3) * d * (R[k].c / e - 1), end: R[k].t + ms, hit, plazo: 1 }; }
function push(OUT, s, t, d, sl, x) { if (!x) { OUT.push({ s, t, d, open: true }); return Infinity; }
  OUT.push({ s, t, d, sl, pct: pctM(x.f, (x.end - t) / H), stop: !!x.stop, hit: x.hit || 0, plazo: !!x.plazo, hrs: (x.end - t) / H }); return x.end; }
/* entrada en la vela i de b (tf ms): con "lvl", disparo intravela al tocar ese precio (buscado en las velas de resolución); sin lvl, a la apertura de i */
function entrar(C, P, OUT, d, e, sl, i, lvl) { const { s, b, ms, R, rms } = C; if (P.minsl && sl < P.minsl) sl = P.minsl; if (!(sl <= MAXSL) || sl < .002) return 0; if (P.btc && !btcOk(b[i].t, d)) return 0;
  let j0 = idxAfter(R, b[i].t), te = b[i].t;
  if (lvl != null) { for (; j0 < R.length && R[j0].t < b[i].t + ms; j0++) if (d > 0 ? R[j0].h >= lvl : R[j0].l <= lvl) break; if (j0 >= R.length || R[j0].t >= b[i].t + ms) return 0; te = R[j0].t; }
  if (P.r) return push(OUT, s, te, d, sl, tpSim(R, rms, j0, e, d, sl, P.r, P.maxH, te));
  return push(OUT, s, te, d, sl, P.orig(j0, e, d, sl, te)); }

/* ---------- estrategias: cada una recorre las velas b de su temporalidad ---------- */
function tortugas(C, P, OUT) { const { b } = C, A = wil(trA(b), 20), E = ema(b.map(x => x.c), P.ema || 1); let free = 0;
  for (let i = Math.max(P.n, 210) + 1; i < b.length; i++) { if (b[i].t < free || !A[i - 1]) continue; const up = hiN(b, i, P.n), dn = loN(b, i, P.n);
    for (const d of [1, -1]) { if (!(d > 0 ? b[i].h > up : b[i].l < dn)) continue; if (P.ema && (d > 0 ? b[i - 1].c < E[i - 1] : b[i - 1].c > E[i - 1])) continue;
      const lvl = d > 0 ? up : dn, e = d > 0 ? Math.max(up, b[i].o) : Math.min(dn, b[i].o), f = entrar(C, P, OUT, d, e, 2 * A[i - 1] / e * (P.k || 1), i, lvl); if (f) { free = f; break; } } } }
function kulla(C, P, OUT) { const { b } = C, Cl = b.map(x => x.c), A = wil(trA(b), 14), E1 = ema(Cl, 10), E2 = ema(Cl, 20); let free = 0;
  for (let i = P.up + P.base + 2; i < b.length - 1; i++) { if (b[i + 1].t < free || !A[i] || !E2[i - 1]) continue;
    const lo = loN(b, i - P.base, P.up), hiB = hiN(b, i, P.base), loB = loN(b, i, P.base);
    if (hiB / lo - 1 < P.sube || hiB / loB - 1 > P.rango || !(Cl[i - 1] > E1[i - 1] && E1[i - 1] > E2[i - 1])) continue;
    let vs = 0; for (let j = i - 20; j < i; j++) vs += b[j].v; if (b[i].v < P.vol * vs / 20 || !(b[i].c > hiB)) continue;
    const e = b[i + 1].o; if (e <= b[i].l) continue; const sl = Math.max(.004, Math.min((e - b[i].l) / e, A[i] / e)), f = entrar(C, P, OUT, 1, e, sl, i + 1, null); if (f) free = f; } }
function holy(C, P, OUT) { const { b } = C, Cl = b.map(x => x.c), E = ema(Cl, 20), X = adxA(b), A = X.atr; let free = 0;
  for (let i = 60; i < b.length; i++) { if (b[i].t < free || X.adx[i - 1] == null || !E[i - 2]) continue; const p = i - 1;
    for (const d of [1, -1]) { if (X.adx[p] < P.adx || (d > 0 ? X.pdi[p] <= X.mdi[p] : X.mdi[p] <= X.pdi[p])) continue;
      if (!(d > 0 ? b[p].l <= E[p] && b[p].c >= E[p] * .995 && b[p - 1].l > E[p - 1] : b[p].h >= E[p] && b[p].c <= E[p] * 1.005 && b[p - 1].h < E[p - 1])) continue;
      const lvl = d > 0 ? b[p].h : b[p].l; if (!(d > 0 ? b[i].h > lvl : b[i].l < lvl)) continue; const e = d > 0 ? Math.max(lvl, b[i].o) : Math.min(lvl, b[i].o);
      const ext = d > 0 ? b[p].l : b[p].h, sl = Math.min(Math.abs(e - ext) / e, 1.5 * A[p] / e); const f = entrar(C, P, OUT, d, e, Math.max(sl, .3 * A[p] / e), i, lvl); if (f) { free = f; break; } } } }
function sopa(C, P, OUT) { const { b } = C, A = wil(trA(b), 14), E = ema(b.map(x => x.c), 200); let free = 0;
  for (let i = 230; i < b.length; i++) { if (b[i].t < free || !A[i - 1]) continue; const p = i - 1;
    for (const d of [1, -1]) { let ref = null; for (let k = p - 4; k >= p - 20; k--) { const ex = d > 0 ? loN(b, k + 1, 20) : hiN(b, k + 1, 20), v = d > 0 ? b[k].l : b[k].h; if (v === ex) { ref = v; break; } }
      if (ref == null) continue; if (!(d > 0 ? b[p].l < ref && b[p].l === loN(b, p + 1, 20) : b[p].h > ref && b[p].h === hiN(b, p + 1, 20))) continue;
      if (P.ema && (d > 0 ? b[p].c < E[p] : b[p].c > E[p])) continue;
      if (!(d > 0 ? b[i].h > ref : b[i].l < ref)) continue; const e = d > 0 ? Math.max(ref, b[i].o) : Math.min(ref, b[i].o), ext = d > 0 ? Math.min(b[p].l, b[i].l) : Math.max(b[p].h, b[i].h);
      const sl = Math.max(Math.abs(e - ext) / e + .001, .3 * A[p] / e), f = entrar(C, P, OUT, d, e, Math.min(sl, 2 * A[p] / e), i, ref); if (f) { free = f; break; } } } }
function williams(C, P, OUT) { const { b } = C, Cl = b.map(x => x.c), E = ema(Cl, P.ema); let free = 0;
  for (let i = P.ema + 1; i < b.length; i++) { if (b[i].t < free || !E[i - 1]) continue; const rg = b[i - 1].h - b[i - 1].l, op = b[i].o, d = Cl[i - 1] > E[i - 1] ? 1 : -1;
    const lvl = op + d * P.k * rg; if (!(d > 0 ? b[i].h >= lvl : b[i].l <= lvl)) continue; const e = d > 0 ? Math.max(lvl, op) : Math.min(lvl, op), f = entrar(C, P, OUT, d, e, Math.abs(e - op) / e * (P.slk || 1), i, lvl); if (f) free = f; } }
function rsiA(cl, p) { const o = Array(cl.length).fill(null); let g = 0, l = 0; for (let i = 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= p) { g += u; l += w; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (p - 1) + u) / p; l = (l * (p - 1) + w) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }
const smaA = (v, p) => { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; };
/* CONNORS (Larry Connors, RSI de 2): a favor de la tendencia larga (sobre/bajo la media de 200), compra cuando el RSI 2 está muy sobrevendido
   (vende cuando está muy sobrecomprado). Entra al cierre (apertura de la vela siguiente). Salida original: cierre del otro lado de la media de 5. */
function connors(C, P, OUT) { const { b, ms, R, rms } = C, Cl = b.map(x => x.c), r2 = rsiA(Cl, 2), S200 = smaA(Cl, 200), S5 = smaA(Cl, 5), A = wil(trA(b), 14); let free = 0;
  P.orig = (j0, e, d, sl, te) => { const stop = e * (1 - d * sl); for (let j = j0; j < R.length; j++) { const q = R[j]; if (q.t - te >= P.maxO * H) return { f: d * (q.c / e - 1), end: q.t + rms, plazo: 1 };
      if (d * (stop - (d > 0 ? q.l : q.h)) >= 0) return { f: d * ((d > 0 ? Math.min(stop, q.o) : Math.max(stop, q.o)) / e - 1), end: q.t + rms, stop: 1 };
      if ((q.t + rms) % ms === 0) { const bi = idxAfter(b, q.t + rms - ms); if (b[bi] && b[bi].t === q.t + rms - ms && (d > 0 ? b[bi].c > S5[bi] : b[bi].c < S5[bi])) return { f: d * (q.c / e - 1), end: q.t + rms, hit: d * (q.c / e - 1) > 0 ? 1 : 0 }; } } return null; };
  for (let i = 205; i < b.length - 1; i++) { if (b[i + 1].t < free || !S200[i] || r2[i] == null) continue;
    for (const d of [1, -1]) { if (P.solo && d !== P.solo) continue; if (d > 0 ? !(Cl[i] > S200[i] && r2[i] < P.lo) : !(Cl[i] < S200[i] && r2[i] > 100 - P.lo)) continue;
      const e = b[i + 1].o, f = entrar(C, P, OUT, d, e, P.atr * A[i] / e, i + 1, null); if (f) { free = f; break; } } } }

function st(L, meses) { const D = L.filter(o => !o.open), n = D.length; if (!n) return { n: 0 }; const u = D.map(o => o.pct / 100 * MARGEN), lo = u.filter(x => x < 0);
  return { n, por_mes: +(n / meses).toFixed(1), gana: +(100 * (n - lo.length) / n).toFixed(1), usd_op: +(u.reduce((a, x) => a + x, 0) / n).toFixed(1), usd: Math.round(u.reduce((a, x) => a + x, 0)),
    perd_media: lo.length ? +(lo.reduce((a, x) => a + x, 0) / lo.length).toFixed(1) : 0, peor: Math.round(Math.min(0, ...u)), stops: D.filter(o => o.stop).length,
    obj: [1, 2, 3].map(k => +(100 * D.filter(o => o.hit >= k).length / n).toFixed(1)), long: D.filter(o => o.d > 0).length, horas: Math.round(D.reduce((a, o) => a + o.hrs, 0) / n) }; }

(async () => {
  const FROM = NOW - DIAS * DAY, T1 = NOW - 365 * DAY;
  const tk = await getJ(`${API}/ticker/24hr`), syms = tk.filter(x => /USDT$/.test(x.symbol) && !STABLE.test(x.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, NC).map(x => x.symbol);
  console.log('monedas', syms.length, syms.slice(0, 15).join(' '));
  /* variantes: [plazo, temporalidad, estrategia, parámetros]. Las de corto plazo usan las NS monedas con más volumen y velas de 15 min para resolver */
  const O = x => Object.assign({ btc: 1 }, x), KU4 = { up: 120, base: 18, sube: .30, rango: .15, vol: 1.5 };
  const V = {
    'CORTO · CONNORS RSI 2 · 15m · obj 0,5': ['corto', '15m', connors, O({ lo: 10, atr: 1.5, r: .5, maxH: 12 })],
    'CORTO · CONNORS RSI 2 · 15m · salida original': ['corto', '15m', connors, O({ lo: 10, atr: 2, maxO: 12 })],
    'CORTO · CONNORS RSI 2 · 30m · obj 0,5': ['corto', '30m', connors, O({ lo: 10, atr: 1.5, r: .5, maxH: 12 })],
    'CORTO · CONNORS RSI 2 · 30m · salida original': ['corto', '30m', connors, O({ lo: 10, atr: 2, maxO: 12 })],
    'CORTO · RASCHKE Holy Grail · 15m · obj 0,5': ['corto', '15m', holy, O({ adx: 30, r: .5, maxH: 12 })],
    'CORTO · RASCHKE Holy Grail · 30m · obj 0,5': ['corto', '30m', holy, O({ adx: 30, r: .5, maxH: 12 })],
    'CORTO · RASCHKE Holy Grail · 30m · obj 0,3': ['corto', '30m', holy, O({ adx: 30, r: .3, maxH: 12 })],
    'CORTO · RASCHKE Turtle Soup · 15m · obj 0,5': ['corto', '15m', sopa, O({ r: .5, maxH: 12 })],
    'CORTO · RASCHKE Turtle Soup · 30m · obj 0,5': ['corto', '30m', sopa, O({ r: .5, maxH: 12 })],
    'CORTO · WILLIAMS ruptura del rango de 4 h · obj 0,5': ['corto', '4h', williams, O({ k: .5, ema: 20, r: .5, maxH: 4 })],
    /* corto plazo con stop mínimo (como SHOOTER: los costos pesan mucho con stops chicos) */
    'CORTO · CONNORS RSI 2 · 15m · stop ≥ 1 % · obj 0,3': ['corto', '15m', connors, O({ lo: 10, atr: 3, minsl: .01, r: .3, maxH: 12 })],
    'CORTO · CONNORS RSI 2 · 30m · stop ≥ 1 % · obj 0,3': ['corto', '30m', connors, O({ lo: 10, atr: 3, minsl: .01, r: .3, maxH: 12 })],
    'CORTO · CONNORS RSI 2 · 30m · stop ≥ 1,5 % · obj 0,25': ['corto', '30m', connors, O({ lo: 5, atr: 3, minsl: .015, r: .25, maxH: 24 })],
    'CORTO · RASCHKE Holy Grail · 30m · stop ≥ 1 % · obj 0,3': ['corto', '30m', holy, O({ adx: 30, minsl: .01, r: .3, maxH: 12 })],
    'CORTO · RASCHKE Holy Grail · 15m · stop ≥ 1 % · obj 0,3': ['corto', '15m', holy, O({ adx: 30, minsl: .01, r: .3, maxH: 12 })],
    'CORTO · RASCHKE Turtle Soup · 30m · stop ≥ 1 % · obj 0,3': ['corto', '30m', sopa, O({ minsl: .01, r: .3, maxH: 12 })],
    'CORTO · RASCHKE Turtle Soup · 15m · stop ≥ 1 % · obj 0,3': ['corto', '15m', sopa, O({ minsl: .01, r: .3, maxH: 12 })],
    'CORTO · WILLIAMS rango de 4 h · stop ≥ 1 % · obj 0,3': ['corto', '4h', williams, O({ k: .5, ema: 20, minsl: .01, r: .3, maxH: 8 })],
    'CORTO · WILLIAMS rango de 1 h · stop ≥ 1 % · obj 0,3': ['corto', '1h', williams, O({ k: .6, ema: 50, minsl: .01, r: .3, maxH: 4 })],
    'MEDIO · CONNORS RSI 2 · 4h · obj 0,5': ['medio', '4h', connors, O({ lo: 10, atr: 1.5, r: .5, maxH: 168 })],
    'MEDIO · CONNORS RSI 2 · 4h · salida original': ['medio', '4h', connors, O({ lo: 10, atr: 2, maxO: 168 })],
    'MEDIO · RASCHKE Holy Grail · 4h · obj 0,5': ['medio', '4h', holy, O({ adx: 30, r: .5, maxH: 168 })],
    'MEDIO · RASCHKE Holy Grail · 4h · obj 0,3': ['medio', '4h', holy, O({ adx: 30, r: .3, maxH: 168 })],
    'MEDIO · RASCHKE Turtle Soup · 4h · obj 0,5': ['medio', '4h', sopa, O({ r: .5, maxH: 168 })],
    'MEDIO · KULLAMÄGI · 4h · obj 0,5': ['medio', '4h', kulla, O(Object.assign({ r: .5, maxH: 120 }, KU4))],
    'MEDIO · KULLAMÄGI · 4h · obj 0,3': ['medio', '4h', kulla, O(Object.assign({ r: .3, maxH: 120 }, KU4))],
    'MEDIO · TORTUGAS 20 · 4h · obj 0,5': ['medio', '4h', tortugas, O({ n: 20, ema: 200, r: .5, maxH: 168 })],
    'MEDIO · TORTUGAS 55 · 4h · obj 0,5': ['medio', '4h', tortugas, O({ n: 55, ema: 200, r: .5, maxH: 168 })],
    'LARGO · CONNORS RSI 2 · 12h · obj 0,5': ['largo', '12h', connors, O({ lo: 10, atr: 1, r: .5, maxH: 336 })],
    'LARGO · CONNORS RSI 2 · 1d · obj 0,5': ['largo', '1d', connors, O({ lo: 10, atr: .75, r: .5, maxH: 504 })],
    'LARGO · CONNORS RSI 2 · 1d · salida original': ['largo', '1d', connors, O({ lo: 10, atr: 1, maxO: 504 })],
    'LARGO · RASCHKE Holy Grail · 12h · obj 0,5': ['largo', '12h', holy, O({ adx: 30, r: .5, maxH: 336 })],
    'LARGO · RASCHKE Holy Grail · 8h · obj 0,5': ['largo', '8h', holy, O({ adx: 30, r: .5, maxH: 336 })],
    'LARGO · RASCHKE Turtle Soup · 12h · obj 0,5': ['largo', '12h', sopa, O({ r: .5, maxH: 336 })],
    'LARGO · KULLAMÄGI · 8h · obj 0,5': ['largo', '8h', kulla, O({ up: 60, base: 9, sube: .35, rango: .18, vol: 1.5, r: .5, maxH: 240 })],
    'LARGO · KULLAMÄGI · 1d · obj 0,5': ['largo', '1d', kulla, O({ up: 40, base: 6, sube: .40, rango: .20, vol: 1.5, r: .5, maxH: 336 })],
    'LARGO · TORTUGAS 20 · 12h · obj 0,5': ['largo', '12h', tortugas, O({ n: 20, ema: 200, k: .6, r: .5, maxH: 336 })],
    'LARGO · TORTUGAS 20 · 1d · obj 0,4': ['largo', '1d', tortugas, O({ n: 20, ema: 200, k: .5, r: .4, maxH: 504 })],
    'LARGO · WILLIAMS · 1d · obj 0,5': ['largo', '1d', williams, O({ k: .5, ema: 20, r: .5, maxH: 24 })] };
  const VF = process.env.VAR ? new RegExp(process.env.VAR) : null; for (const k of Object.keys(V)) if (VF && !VF.test(k)) delete V[k];
  const R = Object.fromEntries(Object.keys(V).map(k => [k, []])), MS = { '1h': H, '15m': M15, '30m': 2 * M15, '4h': 4 * H, '8h': 8 * H, '12h': 12 * H, '1d': DAY };
  { const bb = agg(await klines('BTCUSDT', '1h', H, FROM - 260 * DAY), H, 4); BTC = { b: bb, e: ema(bb.map(x => x.c), 50) }; }
  for (let si = 0; si < syms.length; si++) { const s = syms[si]; const b1 = await klines(s, '1h', H, FROM - 260 * DAY); if (b1.length < 2000) { console.log('sin datos', s); continue; }
    const TF = { '1h': b1, '4h': agg(b1, H, 4), '8h': agg(b1, H, 8), '12h': agg(b1, H, 12), '1d': agg(b1, H, 24) }; let b15 = null;
    if (si < NS) { b15 = await klines(s, '15m', M15, FROM - 25 * DAY); TF['15m'] = b15; TF['30m'] = agg(b15, M15, 2); }
    for (const k in V) { if (VF && !VF.test(k)) continue; const [pl, tf, fn, P] = V[k]; if (pl === 'corto' && !b15) continue; if (!TF[tf] || TF[tf].length < 300) continue;
      const C = { s, b: TF[tf], ms: MS[tf], R: pl === 'corto' ? b15 : b1, rms: pl === 'corto' ? M15 : H }, out = [];
      try { fn(C, Object.assign({}, P), out); } catch (e) { console.log('error', k, s, e.message); } R[k].push(...out.filter(o => o.t >= FROM)); }
    process.stdout.write(s + ' '); }
  const mid = FROM + (NOW - FROM) / 2, M4 = DIAS / 30.4, out = { upd: NOW, dias: DIAS, monedas: syms, corto_monedas: NS, nota: 'Cada señal con 300 USD × 10, con costos. usd = total; usd_op = por operación; peor = peor operación; obj = % que tocó el objetivo 1, 2 y 3.', variantes: {} };
  for (const k in R) { const L = R[k].sort((a, b) => a.t - b.t);
    out.variantes[k] = { plazo: V[k][0], tf: V[k][1], años4: st(L, M4), mitad1: st(L.filter(o => o.t < mid), M4 / 2), mitad2: st(L.filter(o => o.t >= mid), M4 / 2), año: st(L.filter(o => o.t >= T1), 12),
      año_m1: st(L.filter(o => o.t >= T1 && o.t < T1 + 182.5 * DAY), 6), año_m2: st(L.filter(o => o.t >= T1 + 182.5 * DAY), 6) };
    console.log('\n' + k, JSON.stringify(out.variantes[k])); }
  fs.writeFileSync('investigacion-traders.json', JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
