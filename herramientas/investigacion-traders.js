/* INVESTIGACIÓN "TRADERS" (octubre 2026): tres estrategias públicas de traders conocidos, probadas en cripto con 300 USD × 10 por señal.
   No cambia la página ni los bots: solo mide. Datos: velas de 1 h de Binance (spot, espejo público), de ahí se arman las de 4 h y 1 día.
   · TORTUGAS (Richard Dennis y los "Turtles", mediano plazo): ruptura del máximo/mínimo de N velas (Donchian), stop 2 N (2 ATR de 20),
     salida al romper el canal contrario de M velas. LONG y SHORT.
   · KULLAMÄGI (Kristjan Kullamägi, corto/mediano plazo, solo LONG): moneda que ya subió fuerte, se comprime cerca del máximo,
     rompe con volumen. Stop en el mínimo de la vela de ruptura (como mucho 1 ATR). Vende 1/3 a los pocos días si va ganando, stop a la
     entrada y el resto sale con un cierre bajo la media de 10/20.
   · WILLIAMS (Larry Williams, corto plazo): ruptura de volatilidad: entra si el precio pasa la apertura del día ± k × el rango de ayer,
     stop en la apertura del día, sale al cierre del día (o al día siguiente). Con filtro de tendencia.
   Costos: comisión 0,05 % + deslizamiento 0,03 % por lado y financiación 0,01 % cada 8 h. Se saltea la señal si el stop queda a más
   de MAXSL (con × 10, para no acercarse a la liquidación). Una operación a la vez por moneda y estrategia.
   Uso: node herramientas/investigacion-traders.js → investigacion-traders.json */
const fs = require('fs');
const API = 'https://data-api.binance.vision/api/v3', DAY = 864e5, H = 36e5, NOW = Date.now();
const DIAS = +(process.env.DIAS || 1460), NC = +(process.env.NC || 60), LEV = 10, MARGEN = 300, COSTO = .0008, FUND = .0001, MAXSL = +(process.env.MAXSL || .05);
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|USDE|USD1|PYUSD|XUSD|AEUR|EURI|BFUSD|USDS|RLUSD|USDF|FRAX|USDG|WBTC|WBETH|BNSOL|PAXG|XAUT)USDT$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJ(u) { for (let k = 0; k < 6; k++) { try { const r = await fetch(u); if (r.ok) return await r.json(); if (r.status === 400) return null; } catch (e) {} await sleep(1500 * (k + 1)); } return null; }
const toBar = k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] * +k[4] });
async function klines(s, from) { const out = []; let st = from;
  while (st < NOW) { const d = await getJ(`${API}/klines?symbol=${s}&interval=1h&startTime=${st}&limit=1000`); if (!d || !d.length) break;
    for (const k of d) out.push(toBar(k)); st = +d[d.length - 1][0] + H; if (d.length < 1000) break; await sleep(30); }
  return out.filter(b => b.t + H <= NOW); }
function agg(b1, h) { const out = []; let cur = null;
  for (const x of b1) { const k = Math.floor(x.t / (h * H)) * h * H; if (!cur || cur.t !== k) { if (cur && cur.n === h) out.push(cur); cur = { t: k, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, n: 1 }; }
    else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v; cur.n++; } }
  if (cur && cur.n === h) out.push(cur); return out; }
function ema(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let pr = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { pr = s / p; o[i] = pr; } } else { pr = v[i] * k + pr * (1 - k); o[i] = pr; } } return o; }
function atrA(b, p) { const o = Array(b.length).fill(null); let s = 0; for (let i = 0; i < b.length; i++) { const x = b[i], tr = i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l;
    if (i < p) { s += tr; if (i === p - 1) { s /= p; o[i] = s; } } else { s = (s * (p - 1) + tr) / p; o[i] = s; } } return o; }
const hiN = (b, i, n) => { let m = -Infinity; for (let j = i - n; j < i; j++) m = Math.max(m, b[j].h); return m; };
const loN = (b, i, n) => { let m = Infinity; for (let j = i - n; j < i; j++) m = Math.min(m, b[j].l); return m; };
const idxAfter = (rb, t) => { let lo = 0, hi = rb.length; while (lo < hi) { const m = (lo + hi) >> 1; if (rb[m].t < t) lo = m + 1; else hi = m; } return lo; };
/* resultado en % del margen con costos: f = movimiento a favor (fracción del precio, ya promediado por partes), horas abierta */
const pctM = (f, hrs) => +(100 * (LEV * f - LEV * 2 * COSTO - LEV * FUND * hrs / 8)).toFixed(2);

/* ---------- TORTUGAS (sobre velas de tf): entra en la vela siguiente a la ruptura, al precio de ruptura (o a la apertura si abrió más allá) ---------- */
function tortugas(s, b, tfH, P, OUT) { const A = atrA(b, 20), E = ema(b.map(x => x.c), P.ema || 1); let free = 0;
  for (let i = Math.max(P.n, 200) + 1; i < b.length; i++) { if (b[i].t < free || !A[i - 1]) continue; const up = hiN(b, i, P.n), dn = loN(b, i, P.n);
    for (const d of [1, -1]) { if (P.solo && d !== P.solo) continue; const brk = d > 0 ? b[i].h > up : b[i].l < dn; if (!brk) continue;
      if (P.ema && (d > 0 ? b[i - 1].c < E[i - 1] : b[i - 1].c > E[i - 1])) continue;
      const e = d > 0 ? Math.max(up, b[i].o) : Math.min(dn, b[i].o), N = A[i - 1], sl = 2 * N / e * (P.k || 1); if (sl > MAXSL) continue;
      let stop = e * (1 - d * sl), j = i, x = null, xt = null;
      /* dentro de la vela de entrada solo cuenta el stop (sin saber el orden) */
      if (d * (stop - (d > 0 ? b[i].l : b[i].h)) >= 0) { x = stop; xt = b[i].t + tfH * H; }
      for (j = i + 1; x == null && j < b.length; j++) { const q = b[j], ex = d > 0 ? loN(b, j, P.m) : hiN(b, j, P.m), lv = d > 0 ? Math.max(stop, ex) : Math.min(stop, ex);
        if (d * (lv - (d > 0 ? q.l : q.h)) >= 0) { x = d > 0 ? Math.min(lv, q.o) : Math.max(lv, q.o); xt = q.t + tfH * H; } }
      if (x == null) { OUT.push({ s, t: b[i].t, d, open: true }); free = Infinity; break; }
      const f = d * (x / e - 1); OUT.push({ s, t: b[i].t, d, sl, pct: pctM(f, (xt - b[i].t) / H), stop: f <= -sl * .98, hrs: (xt - b[i].t) / H }); free = xt; break; } } }

/* ---------- KULLAMÄGI (velas de 4 h o 1 d): subida previa, compresión cerca del máximo, ruptura con volumen ---------- */
function kulla(s, b, tfH, P, OUT) { const C = b.map(x => x.c), A = atrA(b, 14), E1 = ema(C, P.e1), E2 = ema(C, P.e2), Et = ema(C, P.trail); let free = 0;
  for (let i = 220; i < b.length; i++) { if (b[i].t < free || !A[i - 1]) continue;
    /* subida previa: el máximo de las últimas P.up velas es ≥ P.sube por encima del mínimo previo */
    const k0 = i - P.base, lo = loN(b, k0, P.up), hiB = hiN(b, i, P.base), loB = loN(b, i, P.base);
    if (hiB / lo - 1 < P.sube) continue; if (hiB / loB - 1 > P.rango) continue; // base apretada
    if (!(C[i - 1] > E1[i - 1] && E1[i - 1] > E2[i - 1])) continue; // por encima de las medias, que suben
    let vs = 0; for (let j = i - 20; j < i; j++) vs += b[j].v; if (b[i].v < P.vol * vs / 20) continue; // volumen en la vela de ruptura
    /* la vela de ruptura tiene que cerrar arriba de la base; se entra a la apertura de la vela siguiente (sin mirar el futuro) */
    if (!(b[i].c > hiB) || i + 1 >= b.length) continue; const e = b[i + 1].o; if (e <= b[i].l) continue;
    let sl = Math.min((e - b[i].l) / e, A[i] / e * P.atr); if (sl < .004) sl = .004; if (sl > MAXSL) continue;
    let stop = e * (1 - sl), part = 0, real = 0, x = null, xt = null;
    for (let j = i + 1; j < b.length; j++) { const q = b[j];
      if (q.l <= stop) { x = Math.min(stop, q.o); xt = q.t + tfH * H; break; }
      if (!part && j - i >= P.dias && q.c > e) { part = 1 / 3; real += (q.c / e - 1) / 3; stop = Math.max(stop, e); }
      if (j - i >= 2 && q.c < Et[j]) { x = q.c; xt = q.t + tfH * H; break; } }
    if (x == null) { OUT.push({ s, t: b[i].t, d: 1, open: true }); free = Infinity; continue; }
    const f = real + (1 - part) * (x / e - 1); OUT.push({ s, t: b[i + 1].t, d: 1, sl, pct: pctM(f, (xt - b[i].t) / H), stop: f <= -sl * .98, hrs: (xt - b[i].t) / H }); free = xt; } }

/* ---------- WILLIAMS (ruptura de volatilidad del día, sobre velas de 1 h) ---------- */
function williams(s, b1, P, OUT) { const D = agg(b1, 24), DC = D.map(x => x.c), DE = ema(DC, P.ema); const di = new Map(D.map((x, i) => [x.t, i]));
  for (let k = P.ema + 1; k < D.length; k++) { const y = D[k - 1], rg = y.h - y.l, op = D[k].o; if (!DE[k - 1]) continue;
    const dirs = P.ambos ? [1, -1] : [DC[k - 1] > DE[k - 1] ? 1 : -1];
    const j0 = idxAfter(b1, D[k].t), jEnd = idxAfter(b1, D[k].t + DAY * P.dias); let done = false;
    for (const d of dirs) { if (done) break; if (P.tend && (d > 0 ? DC[k - 1] < DE[k - 1] : DC[k - 1] > DE[k - 1])) continue;
      const trg = op + d * P.k * rg, sl0 = Math.abs(trg - op) / trg * P.slk; if (sl0 > MAXSL || sl0 < .003) continue;
      for (let j = j0; j < Math.min(jEnd, b1.length) && j < j0 + 24; j++) { const q = b1[j]; if (!(d > 0 ? q.h >= trg : q.l <= trg)) continue;
        const e = d > 0 ? Math.max(trg, q.o) : Math.min(trg, q.o), stop = e * (1 - d * sl0); let x = null, xt = null;
        if (d * (stop - (d > 0 ? q.l : q.h)) >= 0) { x = stop; xt = q.t + H; }
        for (let m = j + 1; x == null && m < jEnd && m < b1.length; m++) { const r = b1[m]; if (d * (stop - (d > 0 ? r.l : r.h)) >= 0) { x = d > 0 ? Math.min(stop, r.o) : Math.max(stop, r.o); xt = r.t + H; } }
        if (x == null) { if (jEnd > b1.length) { OUT.push({ s, t: q.t, d, open: true }); done = true; break; } x = b1[jEnd - 1].c; xt = b1[jEnd - 1].t + H; }
        const f = d * (x / e - 1); OUT.push({ s, t: q.t, d, sl: sl0, pct: pctM(f, (xt - q.t) / H), stop: f <= -sl0 * .98, hrs: (xt - q.t) / H }); done = true; break; } } } }

function st(L, meses) { const D = L.filter(o => !o.open), n = D.length; if (!n) return { n: 0 }; const u = D.map(o => o.pct / 100 * MARGEN), lo = u.filter(x => x < 0);
  return { n, por_mes: +(n / meses).toFixed(1), gana: +(100 * (n - lo.length) / n).toFixed(1), usd_op: +(u.reduce((a, x) => a + x, 0) / n).toFixed(1), usd: Math.round(u.reduce((a, x) => a + x, 0)),
    perd_media: lo.length ? +(lo.reduce((a, x) => a + x, 0) / lo.length).toFixed(1) : 0, peor: Math.round(Math.min(0, ...u)), stops: D.filter(o => o.stop).length, long: D.filter(o => o.d > 0).length, horas: Math.round(D.reduce((a, o) => a + o.hrs, 0) / n) }; }

(async () => {
  const FROM = NOW - DIAS * DAY, T1 = NOW - 365 * DAY;
  const tk = await getJ(`${API}/ticker/24hr`), syms = tk.filter(x => /USDT$/.test(x.symbol) && !STABLE.test(x.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, NC).map(x => x.symbol);
  console.log('monedas', syms.length, syms.slice(0, 15).join(' '));
  const V = {
    'TORTUGAS 4h 55/20': (s, b1, b4, bd, O) => tortugas(s, b4, 4, { n: 55, m: 20 }, O),
    'TORTUGAS 4h 20/10': (s, b1, b4, bd, O) => tortugas(s, b4, 4, { n: 20, m: 10 }, O),
    'TORTUGAS 4h 55/20 + EMA 200': (s, b1, b4, bd, O) => tortugas(s, b4, 4, { n: 55, m: 20, ema: 200 }, O),
    'TORTUGAS 1d 20/10 (×10, stop 1 N)': (s, b1, b4, bd, O) => tortugas(s, bd, 24, { n: 20, m: 10, k: .5 }, O),
    'KULLAMÄGI 4h': (s, b1, b4, bd, O) => kulla(s, b4, 4, { up: 120, base: 18, sube: .30, rango: .15, e1: 10, e2: 20, vol: 1.5, atr: 1, dias: 18, trail: 20 }, O),
    'KULLAMÄGI 4h estricto': (s, b1, b4, bd, O) => kulla(s, b4, 4, { up: 120, base: 24, sube: .40, rango: .12, e1: 10, e2: 20, vol: 2, atr: 1, dias: 18, trail: 20 }, O),
    'KULLAMÄGI 1d': (s, b1, b4, bd, O) => kulla(s, bd, 24, { up: 40, base: 6, sube: .40, rango: .20, e1: 10, e2: 20, vol: 1.5, atr: 1, dias: 3, trail: 10 }, O),
    'WILLIAMS k 0,5 a favor de la tendencia': (s, b1, b4, bd, O) => williams(s, b1, { k: .5, ema: 20, dias: 1, slk: 1, tend: 1 }, O),
    'WILLIAMS k 0,6 + EMA 50 diaria': (s, b1, b4, bd, O) => williams(s, b1, { k: .6, ema: 50, dias: 1, slk: 1, tend: 1 }, O),
    'WILLIAMS k 0,5 stop medio': (s, b1, b4, bd, O) => williams(s, b1, { k: .5, ema: 20, dias: 1, slk: .5, tend: 1 }, O) };
  const R = Object.fromEntries(Object.keys(V).map(k => [k, []]));
  for (const s of syms) { const b1 = await klines(s, FROM - 260 * DAY); if (b1.length < 2000) { console.log('sin datos', s); continue; }
    const b4 = agg(b1, 4), bd = agg(b1, 24);
    for (const k in V) { const O = []; V[k](s, b1, b4, bd, O); R[k].push(...O.filter(o => o.t >= FROM)); }
    process.stdout.write(s + ' '); }
  const mid = FROM + (NOW - FROM) / 2, M4 = DIAS / 30.4, out = { upd: NOW, dias: DIAS, monedas: syms, nota: 'Cada señal con 300 USD × 10, con costos. usd = total; usd_op = por operación; peor = peor operación.', variantes: {} };
  for (const k in R) { const L = R[k].sort((a, b) => a.t - b.t);
    out.variantes[k] = { años4: st(L, M4), mitad1: st(L.filter(o => o.t < mid), M4 / 2), mitad2: st(L.filter(o => o.t >= mid), M4 / 2), año: st(L.filter(o => o.t >= T1), 12),
      año_m1: st(L.filter(o => o.t >= T1 && o.t < T1 + 182.5 * DAY), 6), año_m2: st(L.filter(o => o.t >= T1 + 182.5 * DAY), 6) };
    console.log('\n' + k, JSON.stringify(out.variantes[k])); }
  fs.writeFileSync('investigacion-traders.json', JSON.stringify(out, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
