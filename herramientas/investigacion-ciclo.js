/* INVESTIGACIÓN · sección nueva "CICLO" (no cambia la página: solo mide).
   Idea: en las cripto más grandes, buscar una entrada a favor de la fase del ciclo del halving (subida → LONG, caída → SHORT)
   y, si va en contra, sumar margen: empieza con 200 USD y cada vez que la pérdida llega al 50 % del margen total se suman 100 USD
   (mismo apalancamiento) hasta que se dé vuelta. Se sale con una ganancia sobre el margen total (fija o con seguimiento).
   Fases sin mirar el futuro (calendario de los halvings): máximo del ciclo ≈ halving + 535 días, piso ≈ halving + 900 días
   (2017-12, 2021-11 y 2025-10 fueron +526, +548 y +534; los pisos 2018-12 y 2022-11 fueron +889 y +924).
     subida = halving → +535 · caída = +535 → +900 · acumulación = +900 → próximo halving
   Se incluyen monedas que se hundieron (LUNA, FTT, EOS, NEO…) para no medir solo a las sobrevivientes.
   Costos: comisión 0,05 % por lado en cada entrada y salida, y financiación 0,01 % cada 8 h sobre la posición (se cobra siempre).
   Aprendizaje: 2017-2022 · prueba: 2023 en adelante (no se usa para elegir).
   Uso: node herramientas/investigacion-ciclo.js → investigacion-ciclo.json */
const fs = require('fs');
const API = 'https://data-api.binance.vision/api/v3', DAY = 864e5, H4 = 4 * 36e5, NOW = Date.now(), FEE = .0005, FUND = .0001 / (8 * 36e5);
const SPLIT = Date.parse('2023-01-01');
const SYMS = (process.env.SYMS || 'BTC,ETH,BNB,XRP,ADA,SOL,DOGE,LTC,LINK,TRX,DOT,AVAX,BCH,XLM,ATOM,ETC,NEAR,UNI,FIL,EOS,NEO,LUNA,FTT,IOTA,XMR').split(',').map(s => s + 'USDT');
const HALV = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20', '2028-04-15'].map(d => Date.parse(d));
function faseEnd(t) { let h = HALV[0], nx = HALV[HALV.length - 1]; for (let k = 0; k < HALV.length; k++) if (HALV[k] <= t) { h = HALV[k]; nx = HALV[k + 1] || h + 1460 * DAY; } const d = (t - h) / DAY;
  return d < 535 ? h + 535 * DAY : d < 900 ? h + 900 * DAY : nx; } // cuándo termina la fase actual
const dirF = f => f === 'caida' ? -1 : 1;
function fase(t) { let h = HALV[0]; for (const x of HALV) if (x <= t) h = x; const d = (t - h) / DAY; return d < 535 ? 'subida' : d < 900 ? 'caida' : 'acumulacion'; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJ(u) { for (let k = 0; k < 6; k++) { try { const r = await fetch(u); if (r.ok) return await r.json(); if (r.status === 400) return null; } catch (e) {} await sleep(1500 * (k + 1)); } return null; }
async function klines(s, tf, ms) { const out = []; let st = Date.parse('2017-08-01');
  while (st < NOW) { const d = await getJ(`${API}/klines?symbol=${s}&interval=${tf}&startTime=${st}&limit=1000`); if (!d || !d.length) break;
    for (const k of d) out.push({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }); st = +d[d.length - 1][0] + ms; if (d.length < 1000) break; await sleep(40); }
  return out.filter(b => b.t + ms <= NOW); }
function ema(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let pr = null, n = 0, s = 0; for (let i = 0; i < v.length; i++) { if (pr === null) { s += v[i]; if (++n === p) { pr = s / p; o[i] = pr; } } else { pr = v[i] * k + pr * (1 - k); o[i] = pr; } } return o; }
function rsi(cl, p = 14) { const n = cl.length, o = Array(n).fill(null); let g = 0, l = 0; for (let i = 1; i < n; i++) { const d = cl[i] - cl[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= p) { g += u; l += w; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (p - 1) + u) / p; l = (l * (p - 1) + w) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }
function boll(cl, p = 20) { const z = Array(cl.length).fill(null); let a = 0, q = 0; for (let i = 0; i < cl.length; i++) { a += cl[i]; q += cl[i] * cl[i]; if (i >= p) { a -= cl[i - p]; q -= cl[i - p] * cl[i - p]; }
    if (i >= p - 1) { const mu = a / p, sd = Math.sqrt(Math.max(0, q / p - mu * mu)); z[i] = sd ? (cl[i] - mu) / sd : 0; } } return z; }
const lastClosed = (arr, ms, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t + ms <= t) lo = m + 1; else hi = m; } return lo - 1; };

/* ---------- entradas (en el cierre de una vela de 4 h, con la diaria cerrada) ----------
   d = +1 LONG (solo en subida y acumulación) · −1 SHORT (solo en caída) */
const ENTRIES = {
  cualquiera: () => true, // referencia: entra apenas puede, solo con la fase
  retroceso4h: (X, i, k, d) => d > 0 ? X.r4[i] < 35 && X.r4[i - 1] >= 35 && X.dc[k] > X.d50[k] : X.r4[i] > 65 && X.r4[i - 1] <= 65 && X.dc[k] < X.d50[k],
  extremo_diario: (X, i, k, d) => d > 0 ? X.dr[k] < 35 : X.dr[k] > 65,
  ema50_diaria: (X, i, k, d) => X.d200[k] != null && (d > 0 ? X.d50[k] > X.d200[k] && X.l4[i] <= X.d50[k] && X.c4[i] > X.d50[k] : X.d50[k] < X.d200[k] && X.h4[i] >= X.d50[k] && X.c4[i] < X.d50[k]),
  bollinger4h: (X, i, k, d) => d > 0 ? X.z4[i] <= -2.2 && X.dc[k] > X.d200[k] : X.z4[i] >= 2.2 && X.dc[k] < X.d200[k],
  doble: (X, i, k, d) => d > 0 ? X.dr[k] < 40 && X.r4[i] < 30 : X.dr[k] > 60 && X.r4[i] > 70,
  btc_y_moneda: (X, i, k, d, B) => B && (d > 0 ? X.dr[k] < 40 && B.dr < 45 : X.dr[k] > 60 && B.dr > 55) };
/* ---------- gestión ---------- */
const LEVS = (process.env.LEVS || '2,3,5').split(',').map(Number), CAPS = (process.env.CAPS || '8,15,30').split(',').map(Number);
const EXITS = { tp60: { tp: .6 }, tp100: { tp: 1 }, seg: { act: .5, back: .25 } };
/* resguardo del ciclo: sin = como antes · cierra = si la fase cambia en contra, se cierra ahí · cierra90 = además no se abre en los últimos 90 días de una fase */
const GUARDS = { sin: { close: 0, last: 0 }, cierra: { close: 1, last: 0 }, cierra90: { close: 1, last: 90 } };
const ENTS = (process.env.ENTS || 'cualquiera,extremo_diario,doble,btc_y_moneda').split(',');
const UNIS = { todas: null, grandes: new Set('BTC,ETH,BNB,XRP,SOL,ADA,DOGE,LINK,LTC,TRX,BCH,DOT,AVAX'.split(',').map(x => x + 'USDT')), btc_eth: new Set(['BTCUSDT', 'ETHUSDT']) }; // tp = ganancia sobre el margen total
function run(b, j0, d, lev, cap, ex, G) { const e0 = b[j0].c; let marg = 200, qty = 200 * lev / e0, cost = qty * e0, fees = cost * FEE, adds = 0, peak = -1e9, mx = 200, fund = 0, t0 = b[j0].t;
  for (let j = j0 + 1; j < b.length; j++) { const x = b[j], adv = d > 0 ? x.l : x.h, fav = d > 0 ? x.h : x.l, a0 = adds;
    fund += qty * x.c * FUND * H4;
    if (G && G.close && dirF(fase(x.t)) !== d) { const u = d * (qty * x.o - cost) - fees - fund - qty * x.o * FEE; return { usd: u, adds, mx, dias: (x.t - t0) / DAY, fase: 1, liq: u <= -marg ? 1 : 0, end: x.t }; }
    const pnl = p => d * (qty * p - cost) - fees - fund;
    /* en contra: suma margen cada vez que la pérdida llega al 50 % del total; si ya no puede sumar y pierde todo, se liquida */
    let guard = 0;
    while (pnl(adv) <= -.5 * marg && adds < cap && guard++ < 50) { // precio exacto donde la pérdida llega al 50 % del margen total
      const px = d > 0 ? Math.max(adv, (cost - (.5 * marg - fees - fund)) / qty) : Math.min(adv, (cost + (.5 * marg - fees - fund)) / qty);
      const q = 100 * lev / px; qty += q; cost += q * px; fees += q * px * FEE; marg += 100; adds++; mx = marg; }
    if (pnl(adv) <= -marg) return { usd: -marg, adds, mx, dias: (x.t - t0) / DAY, liq: 1, end: x.t };
    if (adds > a0) continue; // si sumó en esta vela no se cuenta la salida en la misma vela (no se sabe el orden)
    const best = pnl(fav) - qty * fav * FEE;
    if (ex.tp != null && best >= ex.tp * marg) return { usd: ex.tp * marg, adds, mx, dias: (x.t - t0) / DAY, end: x.t };
    if (ex.act != null) { const now = pnl(x.c) - qty * x.c * FEE; peak = Math.max(peak, best);
      if (peak >= ex.act * marg && now <= peak - ex.back * marg) return { usd: now, adds, mx, dias: (x.t - t0) / DAY, end: x.t }; } }
  const x = b[b.length - 1]; return { usd: d * (qty * x.c - cost) - fees - fund - qty * x.c * FEE, adds, mx, dias: (x.t - t0) / DAY, open: 1, end: x.t }; }

(async () => { const OUT = { fecha: new Date().toISOString(), fases: 'subida = halving → +535 d · caída = +535 → +900 · acumulación = +900 → próximo halving', monedas: [], res: {} };
  const D = {};
  for (const s of SYMS) { const b4 = await klines(s, '4h', H4), b1 = await klines(s, '1d', DAY); if (b4.length < 1500 || b1.length < 250) { console.log(s, 'sin datos'); continue; }
    const c4 = b4.map(x => x.c), dc = b1.map(x => x.c);
    D[s] = { b4, b1, X: { c4, h4: b4.map(x => x.h), l4: b4.map(x => x.l), r4: rsi(c4), z4: boll(c4), dc, dr: rsi(dc), d50: ema(dc, 50), d200: ema(dc, 200) } };
    OUT.monedas.push(s.replace('USDT', '') + ' desde ' + new Date(b4[0].t).toISOString().slice(0, 7)); console.log(s, b4.length); }
  const BT = D.BTCUSDT;
  const R = {};
  for (const en of ENTS) for (const lev of LEVS) for (const cap of CAPS) for (const exn in EXITS) for (const gn in GUARDS) {
    const key = [en, lev, cap, exn, gn].join('|'), L = [], G = GUARDS[gn];
    for (const s in D) { const { b4, b1, X } = D[s]; let free = 0;
      for (let i = 60; i < b4.length - 1; i++) { const t = b4[i].t + H4; if (t < free) continue; const k = lastClosed(b1, DAY, t); if (k < 200 || X.d50[k] == null) continue;
        const f = fase(t), d = f === 'caida' ? -1 : 1; if (G.last && faseEnd(t) - t < G.last * DAY) continue;
        let B = null; if (BT) { const kb = lastClosed(BT.b1, DAY, t); if (kb >= 20) B = { dr: BT.X.dr[kb] }; }
        if (!ENTRIES[en](X, i, k, d, B)) continue;
        const r = run(b4, i, d, lev, cap, EXITS[exn], G); L.push({ s, t, d, f, ...r }); free = r.end + H4; if (r.open) break; } }
    R[key] = L; }
  const sum = L => { const C = L.filter(x => !x.open); if (!C.length) return { n: 0 }; const u = C.map(x => x.usd), m = C.map(x => x.mx); const tot = u.reduce((a, v) => a + v, 0);
    return { n: C.length, gan: +(100 * u.filter(v => v > 0).length / C.length).toFixed(1), usd_op: +(tot / C.length).toFixed(1), total: Math.round(tot), peor: Math.round(Math.min(...u)), liq: C.filter(x => x.liq).length,
      margen_prom: Math.round(m.reduce((a, v) => a + v, 0) / C.length), margen_max: Math.max(...m), dias: +(C.reduce((a, x) => a + x.dias, 0) / C.length).toFixed(1), abiertas: L.length - C.length,
      long: C.filter(x => x.d > 0).length, short: C.filter(x => x.d < 0).length }; };
  /* capital necesario: la suma del margen máximo de todas las operaciones abiertas a la vez (cota alta) */
  const capital = L => { const ev = []; for (const x of L) { ev.push([x.t, x.mx]); ev.push([x.end, -x.mx]); } ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); let c = 0, m = 0; for (const [, v] of ev) { c += v; m = Math.max(m, c); } return m; };
  const anio = L => { const o = {}; for (const x of L) if (!x.open) { const y = new Date(x.t).getUTCFullYear(); (o[y] = o[y] || { n: 0, usd: 0, liq: 0 }); o[y].n++; o[y].usd += x.usd; o[y].liq += x.liq || 0; } for (const y in o) o[y].usd = Math.round(o[y].usd); return o; };
  for (const k in R) for (const un in UNIS) { const U = UNIS[un], L = U ? R[k].filter(x => U.has(x.s)) : R[k]; const kk = k + '|' + un;
    OUT.res[kk] = { apr: sum(L.filter(x => x.t < SPLIT)), prueba: sum(L.filter(x => x.t >= SPLIT)), todo: sum(L), capital: capital(L), anios: anio(L) }; R[kk] = L; }
  /* las mejores según lo que pidió el usuario: ≥ 90 % ganadas en aprendizaje, ordenadas por ganancia por operación y peor operación */
  const ok = Object.entries(OUT.res).filter(([, v]) => v.apr.n >= 15 && v.apr.gan >= 90).sort((a, b) => b[1].apr.usd_op - a[1].apr.usd_op);
  OUT.mejores = ok.slice(0, 80).map(([k, v]) => ({ k, ...v }));
  const top = OUT.mejores.slice(0, 5).map(x => x.k).concat((process.env.DET || '').split(',').filter(k => R[k]));
  OUT.res_lista = Object.entries(OUT.res).map(([k, v]) => [k, v.apr.n, v.apr.gan, v.apr.usd_op, v.apr.peor, v.apr.liq, v.prueba.n, v.prueba.gan, v.prueba.usd_op, v.prueba.peor, v.prueba.liq, v.capital]); delete OUT.res; OUT.detalle = {}; for (const k of top) OUT.detalle[k] = R[k].map(x => ({ s: x.s.replace('USDT', ''), t: new Date(x.t).toISOString().slice(0, 10), d: x.d, f: x.f, usd: Math.round(x.usd), adds: x.adds, dias: +x.dias.toFixed(1), liq: x.liq || 0, open: x.open || 0 }));
  fs.writeFileSync('investigacion-ciclo.json', JSON.stringify(OUT, null, 1));
  for (const x of OUT.mejores.slice(0, 15)) console.log(x.k, JSON.stringify(x.apr), '→ prueba', JSON.stringify(x.prueba)); })();
