/* INVESTIGACIÓN TRADING y SHOOTER (no cambia nada de la página: solo mide).
   TRADING: las mismas reglas de hoy (retroceso en tendencia alineada con BTC a favor) en velas de 1 a 12 horas, con distintos
   apalancamientos (X), stops y objetivos, y con filtros nuevos: canal de tendencia y los datos que más pesan en la IA
   (distancia a la EMA 200, volumen relativo, posición en las Bollinger). SHOOTER: la regla de hoy en 15 y 30 min con los mismos filtros.
   Se elige con los primeros 2/3 del período (aprendizaje) y se mide en el último tercio (prueba), que no se usó para elegir.
   Gestión: 1/3 en cada objetivo, stop a la entrada tras el objetivo 1, plazo, comisión 0,05 % por lado. Sin salvavidas (en las dos
   versiones, la de hoy y las nuevas, así la comparación es justa).
   Uso: node herramientas/investigacion-trading.js → investigacion-trading.json */
const fs = require('fs');
const API = 'https://data-api.binance.vision/api/v3', DAY = 864e5, H = 36e5, FEE = .0005, NOW = Date.now();
const DAYS_T = +(process.env.DIAS_T || 730), DAYS_S = +(process.env.DIAS_S || 365), NT = +(process.env.NT || 60), NS = +(process.env.NS || 30);
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|USDE|USD1|PYUSD|XUSD|AEUR|EURI|BFUSD|USDS|RLUSD|USDF|FRAX|USDG)USDT$/;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJ(u) { for (let k = 0; k < 6; k++) { try { const r = await fetch(u); if (r.ok) return await r.json(); if (r.status === 400) return null; } catch (e) {} await sleep(1500 * (k + 1)); } return null; }
const toBar = k => ({ t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], tb: +k[9] });
async function klines(s, tf, ms, from) { const out = []; let st = from;
  while (st < NOW) { const d = await getJ(`${API}/klines?symbol=${s}&interval=${tf}&startTime=${st}&limit=1000`); if (!d || !d.length) break;
    for (const k of d) out.push(toBar(k)); st = +d[d.length - 1][0] + ms; if (d.length < 1000) break; await sleep(40); }
  return out.filter(b => b.t + ms <= NOW); }
/* ---------- indicadores sobre una serie ---------- */
function ema(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let pr = null, n = 0, s = 0; for (let i = 0; i < v.length; i++) { if (pr === null) { s += v[i]; if (++n === p) { pr = s / p; o[i] = pr; } } else { pr = v[i] * k + pr * (1 - k); o[i] = pr; } } return o; }
function wilder(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { s /= p; o[i] = s; } } else { s = (s * (p - 1) + v[i]) / p; o[i] = s; } } return o; }
function prep(b) { const n = b.length, cl = b.map(x => x.c), tr = b.map((x, i) => i ? Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c)) : x.h - x.l), atr = wilder(tr, 14);
  const rsi = (p) => { const o = Array(n).fill(null); let g = 0, l = 0; for (let i = 1; i < n; i++) { const d = cl[i] - cl[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
      if (i <= p) { g += u; l += w; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (p - 1) + u) / p; l = (l * (p - 1) + w) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; };
  const pdm = [0], mdm = [0]; for (let i = 1; i < n; i++) { const up = b[i].h - b[i - 1].h, dn = b[i - 1].l - b[i].l; pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0); }
  const sp = wilder(pdm, 14), sm = wilder(mdm, 14), dx = atr.map((t, i) => { if (!t || sp[i] == null) return null; const a = sp[i] / t, c = sm[i] / t; return a + c > 0 ? 100 * Math.abs(a - c) / (a + c) : null; });
  const adx = Array(n).fill(null); { let s = 0, c = 0, pr = null; for (let i = 0; i < n; i++) { if (dx[i] == null) continue; if (pr === null) { s += dx[i]; if (++c === 14) { pr = s / 14; adx[i] = pr; } } else { pr = (pr * 13 + dx[i]) / 14; adx[i] = pr; } } }
  const a10 = wilder(tr, 10), st = Array(n).fill(null); { let fu = null, fl = null, d = 1; for (let i = 0; i < n; i++) { if (a10[i] == null) continue; const hl = (b[i].h + b[i].l) / 2, ub = hl + 3 * a10[i], lb = hl - 3 * a10[i];
      if (fu === null) { fu = ub; fl = lb; } else { const pc = b[i - 1].c; fu = (ub < fu || pc > fu) ? ub : fu; fl = (lb > fl || pc < fl) ? lb : fl; } if (d === 1 && b[i].c < fl) d = -1; else if (d === -1 && b[i].c > fu) d = 1; st[i] = d; } }
  const bm = Array(n).fill(null), bs = Array(n).fill(null); { let a = 0, q = 0; for (let i = 0; i < n; i++) { a += cl[i]; q += cl[i] * cl[i]; if (i >= 20) { a -= cl[i - 20]; q -= cl[i - 20] * cl[i - 20]; } if (i >= 19) { const mu = a / 20; bm[i] = mu; bs[i] = Math.sqrt(Math.max(0, q / 20 - mu * mu)); } } }
  const vr = Array(n).fill(null); { let s = 0; for (let i = 0; i < n; i++) { s += b[i].v; if (i >= 20) s -= b[i - 20].v; if (i >= 19) vr[i] = b[i].v / ((s / 20) || 1); } }
  return { cl, atr, e21: ema(cl, 21), e50: ema(cl, 50), e200: ema(cl, 200), r14: rsi(14), r7: rsi(7), adx, st, bm, bs, vr }; }
/* canal de tendencia (como el indicador de la página, con ventana fija y sin mirar el futuro): recta de regresión de los cierres
   (escala log) de las últimas W velas, techo y piso en los extremos (96 % / 4 %). pos 0 = piso, 1 = techo; dir = alcista/bajista/lateral */
function canal(b, i, W = 60) { if (i < W) return null; let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0; for (let j = i - W + 1; j <= i; j++) { const y = Math.log(b[j].c); n++; sx += j; sy += y; sxx += j * j; sxy += j * y; }
  const m = (n * sxy - sx * sy) / ((n * sxx - sx * sx) || 1), c0 = (sy - m * sx) / n, ru = [], rl = [];
  for (let j = i - W + 1; j <= i; j++) { ru.push(Math.log(b[j].h) - (c0 + m * j)); rl.push(Math.log(b[j].l) - (c0 + m * j)); }
  ru.sort((a, c) => a - c); rl.sort((a, c) => a - c); const up = ru[Math.round(.96 * (W - 1))], lo = rl[Math.round(.04 * (W - 1))], w = up - lo || 1e-9;
  const y = Math.log(b[i].c) - (c0 + m * i), tot = m * W; return { pos: (y - lo) / w, dir: tot > .6 * w ? 1 : tot < -.6 * w ? -1 : 0 }; }
/* agrupa velas de 1 h en velas de h horas (alineadas a la hora UTC) */
function agg(b1, h) { if (h === 1) return b1; const out = []; let cur = null;
  for (const x of b1) { const k = Math.floor(x.t / (h * H)) * h * H; if (!cur || cur.t !== k) { if (cur && cur.n === h) out.push(cur); cur = { t: k, o: x.o, h: x.h, l: x.l, c: x.c, v: x.v, tb: x.tb, n: 1 }; }
    else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v; cur.tb += x.tb; cur.n++; } }
  if (cur && cur.n === h) out.push(cur); return out; }
const idxAfter = (rb, t) => { let lo = 0, hi = rb.length; while (lo < hi) { const m = (lo + hi) >> 1; if (rb[m].t < t) lo = m + 1; else hi = m; } return lo; };
const lastClosed = (arr, ms, t) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t + ms <= t) lo = m + 1; else hi = m; } return lo - 1; };
/* una operación sobre las velas de resolución (primero el stop, después los objetivos) */
function sim(rb, j0, e, d, sl, r, maxMs, t0) { const tps = [1, 2, 3].map(k => e * (1 + d * k * r * sl)), fail = e * (1 - d * sl); let hit = 0, real = 0, j = j0;
  for (; j < rb.length; j++) { const b = rb[j]; if (b.t - t0 >= maxMs) break; const adv = d > 0 ? b.l : b.h, fav = d > 0 ? b.h : b.l, stop = hit ? e : fail;
    if (d * (stop - adv) >= 0) return { f: real + (1 - hit / 3) * d * (stop / e - 1), hit, end: b.t };
    while (hit < 3 && d * (fav - tps[hit]) >= 0) { real += d * (tps[hit] / e - 1) / 3; hit++; } if (hit >= 3) return { f: real, hit, end: b.t }; }
  if (j >= rb.length && rb.length && rb[rb.length - 1].t - t0 < maxMs) return null; // todavía abierta
  const k = Math.min(Math.max(j - 1, j0), rb.length - 1); return { f: Math.max(-sl, real + (1 - hit / 3) * d * (rb[k].c / e - 1)), hit, end: rb[k].t }; }
/* GESTIÓN (MODO=gestion): la misma operación con salvavidas y/o aviso de salida.
   salvavidas: antes del objetivo 1, si el precio llega al 65 % del camino al stop y la tendencia de fondo sigue a favor (ll(t)),
   se suma medio margen más (entrada promedio mejor, stop a la misma distancia de la nueva entrada) — como la página.
   aviso: antes del objetivo 1, si una vela cierra a `cut` del camino al stop, sale. Con `semaforo`, solo sale si además la tendencia
   de fondo ya está en contra (si sigue a favor, aguanta y deja actuar al salvavidas). */
function sim2(rb, j0, e, d, sl, r, maxMs, t0, O) { const tps = [1, 2, 3].map(k => e * (1 + d * k * r * sl)), llAt = e * (1 - d * sl * .65); let fail = e * (1 - d * sl), hit = 0, real = 0, j = j0, ae = e, sz = 1, ll = 0, llNo = !O.ll;
  const val = px => real + (1 - hit / 3) * sz * d * (px / ae - 1);
  for (; j < rb.length; j++) { const b = rb[j]; if (b.t - t0 >= maxMs) break; const adv = d > 0 ? b.l : b.h, fav = d > 0 ? b.h : b.l, tc = b.t + O.res;
    if (!hit && !ll && !llNo && d * (adv - llAt) <= 0) { if (O.ll(tc)) { ae = (e + .5 * llAt) / 1.5; sz = 1.5; fail = ae * (1 - d * sl); ll = 1; } else llNo = true; }
    const stop = hit ? ae : fail;
    if (d * (stop - adv) >= 0) return { f: val(stop), hit, end: b.t, sz, ll, k: hit ? 'seguro' : 'stop' };
    while (hit < 3 && d * (fav - tps[hit]) >= 0) { real += sz * d * (tps[hit] / ae - 1) / 3; hit++; } if (hit >= 3) return { f: real, hit, end: b.t, sz, ll, k: 'obj3' };
    if (O.cut && !hit && d * (ae - b.c) / ae >= O.cut * sl && (!O.semaforo || !O.trend(tc))) return { f: val(b.c), hit, end: b.t, sz, ll, k: 'aviso' }; }
  if (j >= rb.length && rb.length && rb[rb.length - 1].t - t0 < maxMs) return null;
  const k = Math.min(Math.max(j - 1, j0), rb.length - 1); return { f: Math.max(-sz * sl, val(rb[k].c)), hit, end: rb[k].t, sz, ll, k: 'plazo' }; }
const GV = { sin: {}, salvavidas: { ll: 1 }, aviso_50: { cut: .5 }, aviso_65: { cut: .65 }, salvavidas_y_aviso_50: { ll: 1, cut: .5 }, semaforo_50: { cut: .5, semaforo: 1 }, salvavidas_y_semaforo_50: { ll: 1, cut: .5, semaforo: 1 }, salvavidas_y_semaforo_35: { ll: 1, cut: .35, semaforo: 1 } };
const GEST = process.env.MODO === 'gestion';
/* estadísticas de una lista de resultados (% del margen) */
function st(L, days) { const n = L.length; if (!n) return { n: 0 }; const lo = L.filter(v => v < 0), w = L.filter(v => v > 0).reduce((a, v) => a + v, 0), l = -lo.reduce((a, v) => a + v, 0);
  return { n, dia: +(n / days).toFixed(2), pct: +(L.reduce((a, v) => a + v, 0) / n).toFixed(2), gana: +((n - lo.length) / n * 100).toFixed(1), perd_media: lo.length ? +(l / lo.length).toFixed(1) : 0, peor: +Math.min(...L).toFixed(1), pf: l ? +(w / l).toFixed(2) : null }; }
/* una operación por moneda a la vez y espera entre señales */
function pickOps(C, cool) { const by = {}; for (const c of C) (by[c.s] = by[c.s] || []).push(c); const out = [];
  for (const s in by) { let free = 0; for (const c of by[s].sort((a, b) => a.t - b.t)) { if (c.t < free || !c.o) continue; out.push(c); free = Math.max(c.t + cool, c.o.end + 1); } } return out; }

const FILT = {
  hoy: () => true,
  canal: c => c.cn && (c.cn.dir === 0 || c.cn.dir === c.dir) && (c.dir > 0 ? c.cn.pos <= .5 : c.cn.pos >= .5),
  canal_fuerte: c => c.cn && c.cn.dir === c.dir && (c.dir > 0 ? c.cn.pos <= .35 : c.cn.pos >= .65),
  d200_8: c => c.d200 <= 8, d200_4: c => c.d200 <= 4,
  bollinger: c => c.z <= 0, volumen: c => c.vr < .7,
  canal_y_d200: c => FILT.canal(c) && c.d200 <= 8,
  canal_y_boll: c => FILT.canal(c) && c.z <= 0 };

async function main() { const t0 = Date.now(), R = { fecha: new Date().toISOString(), dias_trading: DAYS_T, dias_shooter: DAYS_S };
  const T = await getJ(`${API}/ticker/24hr`);
  const base = T.filter(t => t.symbol.endsWith('USDT') && !STABLE.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) && +t.quoteVolume > 1e7 && Math.abs(+t.priceChangePercent) < 25).sort((a, b) => b.quoteVolume - a.quoteVolume).map(t => t.symbol);
  const OFF = +(process.env.OFF || 0), OFFS = +(process.env.OFFS || 0), LT = base.slice(OFF, OFF + NT), LS = base.slice(OFFS, OFFS + NS); R.monedas = { trading: [OFF, OFF + NT], shooter: [OFFS, OFFS + NS] }; if (!LT.includes('BTCUSDT')) LT.push('BTCUSDT');
  /* ---------- TRADING ---------- */
  const B1 = {}; let q = 0; await Promise.all(Array.from({ length: 4 }, async () => { while (q < LT.length) { const s = LT[q++]; const b = await klines(s, '1h', H, NOW - (DAYS_T + 60) * DAY); if (b.length > 2000) B1[s] = b; } }));
  console.log('TRADING monedas', Object.keys(B1).length, ((Date.now() - t0) / 1e3).toFixed(0), 's');
  const FROM_T = NOW - DAYS_T * DAY, CUT_T = FROM_T + DAYS_T * DAY * 2 / 3, TFS = (process.env.TFS || '1,2,3,4,5,6,7,8,9,10,12').split(',').map(Number);
  const GRID = []; for (const L of [3, 5, 10, 15, 20]) for (const a of [2, 3, 4]) for (const r of [.5, .75, 1]) GRID.push({ L, a, r });
  R.trading = []; R.trading_base = null;
  for (const h of TFS) { const ms = h * H, sc = Math.sqrt(h / 4), BT = agg(B1.BTCUSDT, h), PB = prep(BT); const C = [];
    if (GEST && h !== 4) continue; const TR4 = {};
    for (const [ri, s] of LT.entries()) { const rank = ri + OFF; const b1 = B1[s]; if (!b1) continue; const b = agg(b1, h), P = prep(b); TR4[s] = { b, e200: P.e200 };
      for (let i = 210; i < b.length; i++) { const t = b[i].t + ms; if (t < FROM_T) continue; const cb = b[i].c, atrP = P.atr[i] / cb;
        if (P.e200[i] == null || P.r14[i] == null) continue;
        const dir = P.st[i] === 1 && P.e21[i] > P.e50[i] && cb > P.e200[i] ? 1 : P.st[i] === -1 && P.e21[i] < P.e50[i] && cb < P.e200[i] ? -1 : 0; if (!dir) continue;
        const rr = dir > 0 ? P.r14[i] : 100 - P.r14[i], core = P.vr[i] < 1 && atrP > .01 * sc && atrP <= .017 * sc, d50 = dir * (cb - P.e50[i]) / P.atr[i];
        let ok = false; if (core && rr < 50) ok = d50 >= .5; else if (core && rank < 40 && rr < 55 && P.adx[i] != null && P.adx[i] >= 25) ok = true; if (!ok) continue;
        const k = lastClosed(BT, ms, t); if (!(k >= 0 && PB.e50[k] != null && Math.sign(BT[k].c - PB.e50[k]) === dir)) continue; // BTC a favor
        C.push({ s, t, dir, e: cb, atrP, i, cn: canal(b, i), d200: dir * (cb / P.e200[i] - 1) * 100, z: P.bs[i] ? dir * (cb - P.bm[i]) / P.bs[i] : 0, vr: P.vr[i] }); } }
    const maxMs = Math.min(14 * DAY, 42 * ms), cool = Math.max(24 * H, 6 * ms), j0 = {};
    for (const c of C) c.j0 = idxAfter(B1[c.s], c.t);
    if (GEST) { R.gestion_trading = []; const trendAt = (c, t) => { const T = TR4[c.s], k = lastClosed(T.b, ms, t); return k >= 0 && T.e200[k] != null && c.dir * (T.b[k].c - T.e200[k]) > 0; };
      for (const [nm, g, F] of [['hoy', { L: 10, a: 3, r: .5 }, FILT.hoy], ['nueva', { L: 10, a: 3, r: .75 }, FILT.d200_8], ['nueva_stop4', { L: 10, a: 4, r: .75 }, FILT.d200_8]]) { const cap = .36 / g.L;
        for (const [gv, O0] of Object.entries(GV)) { const O = C.filter(F).map(c => { const sl = Math.min(cap, Math.max(.004, g.a * c.atrP)), opt = { res: H, cut: O0.cut, semaforo: O0.semaforo, ll: O0.ll ? t => trendAt(c, t) : null, trend: t => trendAt(c, t) }, o = sim2(B1[c.s], c.j0, c.e, c.dir, sl, g.r, maxMs, c.t, opt);
            return o ? { ...c, o, pct: 100 * g.L * (o.f - 2 * FEE * o.sz) } : { ...c, o: null }; });
          const P = pickOps(O, cool), A = P.filter(x => x.t < CUT_T), Te = P.filter(x => x.t >= CUT_T), cnt = L => ({ salvavidas: L.filter(x => x.o.ll).length, avisos: L.filter(x => x.o.k === 'aviso').length });
          R.gestion_trading.push({ estrategia: nm, gestion: gv, aprendizaje: { ...st(A.map(x => x.pct), DAYS_T * 2 / 3), ...cnt(A) }, prueba: { ...st(Te.map(x => x.pct), DAYS_T / 3), ...cnt(Te) } }); } }
      console.log('gestión TRADING', JSON.stringify(R.gestion_trading).slice(0, 1500)); continue; }
    for (const g of GRID) { const cap = .36 / g.L; // mismo riesgo que hoy: con × 10 el stop máximo es 3,6 % (−36 % del margen)
      const O = C.map(c => { const sl = Math.min(cap, Math.max(.004, g.a * c.atrP)), o = sim(B1[c.s], c.j0, c.e, c.dir, sl, g.r, maxMs, c.t); return o ? { ...c, o, pct: 100 * g.L * (o.f - 2 * FEE) } : { ...c, o: null }; });
      for (const [fn, F] of Object.entries(FILT)) { const P = pickOps(O.filter(F), cool), A = P.filter(x => x.t < CUT_T).map(x => x.pct), Te = P.filter(x => x.t >= CUT_T).map(x => x.pct);
        const row = { velas_h: h, X: g.L, stop_atr: g.a, objetivos: g.r, filtro: fn, aprendizaje: st(A, DAYS_T * 2 / 3), prueba: st(Te, DAYS_T / 3) };
        R.trading.push(row); if (h === 4 && g.L === 10 && g.a === 3 && g.r === .5 && fn === 'hoy') R.trading_base = row; } }
    console.log('TRADING', h, 'h', C.length, 'candidatas', ((Date.now() - t0) / 1e3).toFixed(0), 's'); }
  for (const k in B1) delete B1[k];
  /* ---------- SHOOTER ---------- */
  const FROM_S = NOW - DAYS_S * DAY, CUT_S = FROM_S + DAYS_S * DAY * 2 / 3; R.shooter = []; R.shooter_base = [];
  const SB = {}; q = 0; await Promise.all(Array.from({ length: 4 }, async () => { while (q < LS.length) { const s = LS[q++]; const m15 = await klines(s, '15m', 9e5, NOW - (DAYS_S + 20) * DAY); if (m15.length > 5000) SB[s] = m15; } }));
  console.log('SHOOTER monedas', Object.keys(SB).length, ((Date.now() - t0) / 1e3).toFixed(0), 's');
  const C = [];
  const SH1 = {};
  for (const s in SB) { const m15 = SB[s], h1 = (() => { const out = []; let cur = null; for (const x of m15) { const k = Math.floor(x.t / H) * H; if (!cur || cur.t !== k) { if (cur && cur.n === 4) out.push(cur); cur = { ...x, t: k, n: 1 }; } else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v; cur.n++; } } return out; })(), he = ema(h1.map(x => x.c), 50); SH1[s] = { h1, he };
    for (const [tf, mins] of [['15m', 15], ['30m', 30]]) { const b = mins === 15 ? m15 : (() => { const out = []; let cur = null; for (const x of m15) { const k = Math.floor(x.t / 18e5) * 18e5; if (!cur || cur.t !== k) { if (cur && cur.n === 2) out.push(cur); cur = { ...x, t: k, n: 1 }; } else { cur.h = Math.max(cur.h, x.h); cur.l = Math.min(cur.l, x.l); cur.c = x.c; cur.v += x.v; cur.n++; } } return out; })();
      const P = prep(b), ms = mins * 6e4, back = 60 / mins;
      for (let i = 210; i < b.length; i++) { const t = b[i].t + ms; if (t < FROM_S) continue; const cb = b[i].c; if (P.r7[i] == null || !P.bs[i] || !P.atr[i]) continue;
        const z = (cb - P.bm[i]) / P.bs[i], drop = (cb / b[i - back].c - 1) * 100; if (!(z <= -1.8 && P.r7[i] <= 35 && drop <= -3)) continue;
        const k = lastClosed(h1, H, t); if (!(k >= 0 && he[k] != null && h1[k].c > he[k])) continue;
        C.push({ s, tf, t, dir: 1, e: cb, atrP: P.atr[i] / cb, cn: canal(b, i), d200: P.e200[i] ? (cb / P.e200[i] - 1) * 100 : 0, z, vr: P.vr[i], j0: idxAfter(m15, t) }); } } }
  console.log('SHOOTER candidatas', C.length);
  if (GEST) { R.gestion_shooter = []; const up = (c, t) => { const T = SH1[c.s], k = lastClosed(T.h1, H, t); return k >= 0 && T.he[k] != null && T.h1[k].c > T.he[k]; };
    for (const [nm, g, F] of [['hoy', { L: 15, a: 3, r: .35 }, () => true], ['mejora_monedas1', { L: 15, a: 4, r: .25 }, c => c.d200 > 0]]) { const cap = .75 / g.L;
      for (const [gv, O0] of Object.entries(GV)) { const O = C.filter(F).map(c => { const sl = Math.min(cap, Math.max(.004, g.a * c.atrP)), opt = { res: 9e5, cut: O0.cut, semaforo: O0.semaforo, ll: O0.ll ? t => up(c, t) : null, trend: t => up(c, t) }, o = sim2(SB[c.s], c.j0, c.e, 1, sl, g.r, 12 * H, c.t, opt);
          return o ? { ...c, o, pct: 100 * g.L * (o.f - 2 * FEE * o.sz) } : { ...c, o: null }; });
        const P = pickOps(O, H), A = P.filter(x => x.t < CUT_S), Te = P.filter(x => x.t >= CUT_S), cnt = L => ({ salvavidas: L.filter(x => x.o.ll).length, avisos: L.filter(x => x.o.k === 'aviso').length });
        R.gestion_shooter.push({ estrategia: nm, gestion: gv, aprendizaje: { ...st(A.map(x => x.pct), DAYS_S * 2 / 3), ...cnt(A) }, prueba: { ...st(Te.map(x => x.pct), DAYS_S / 3), ...cnt(Te) } }); } }
    R.secs = Math.round((Date.now() - t0) / 1e3); fs.writeFileSync('investigacion-trading.json', JSON.stringify(R)); console.log('listo gestión', R.secs, 's'); return; }
  const FS = { hoy: () => true, canal: c => c.cn && c.cn.dir >= 0 && c.cn.pos <= .35, canal_lateral: c => c.cn && c.cn.dir === 0 && c.cn.pos <= .35,
    d200_bajo: c => c.d200 <= 0, d200_alto: c => c.d200 > 0, atr_bajo: c => c.atrP <= .008, atr_alto: c => c.atrP > .008, volumen_alto: c => c.vr >= 1.5,
    canal_y_atr_bajo: c => c.cn && c.cn.dir >= 0 && c.cn.pos <= .35 && c.atrP <= .008 };
  for (const L of [5, 10, 15, 20]) for (const a of [2, 3, 4]) for (const r of [.25, .35, .5]) { const cap = .75 / L; // hoy: × 15 con tope 5 % (−75 % del margen)
    const O = C.map(c => { const sl = Math.min(cap, Math.max(.004, a * c.atrP)), o = sim(SB[c.s], c.j0, c.e, 1, sl, r, 12 * H, c.t); return o ? { ...c, o, pct: 100 * L * (o.f - 2 * FEE) } : { ...c, o: null }; });
    for (const [fn, F] of Object.entries(FS)) { const P = pickOps(O.filter(F), H), A = P.filter(x => x.t < CUT_S).map(x => x.pct), Te = P.filter(x => x.t >= CUT_S).map(x => x.pct);
      const row = { X: L, stop_atr: a, objetivos: r, filtro: fn, aprendizaje: st(A, DAYS_S * 2 / 3), prueba: st(Te, DAYS_S / 3) }; R.shooter.push(row);
      if (L === 15 && a === 3 && r === .35 && fn === 'hoy') R.shooter_base = row; } }
  R.secs = Math.round((Date.now() - t0) / 1e3);
  fs.writeFileSync('investigacion-trading.json', JSON.stringify(R));
  console.log('listo', R.secs, 's', JSON.stringify({ tb: R.trading_base, sb: R.shooter_base })); }
main().catch(e => { console.error(e); fs.writeFileSync('investigacion-trading.json', JSON.stringify({ error: String(e && e.stack || e) })); process.exitCode = 1; });
