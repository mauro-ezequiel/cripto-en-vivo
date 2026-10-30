/* INVESTIGACIÓN ACCIONES "PRIMERO LA PLANILLA DE RSI" (octubre 2026). No cambia la página ni los bots: solo mide.
   Idea del usuario: la señal arranca en la planilla de RSI (RSI 14 muy bajo: 30, 25 o 20) y recién ahí se miran los demás datos;
   si acompañan (tendencia del año y del mes, el mercado y que el precio ya esté rebotando) se abre la operación.
   Se prueba en 1 h, 4 h, 1 día y 1 semana, y se compara con las reglas actuales de ACCIONES (c-reb y c-rup, S&P 500 sobre su media de 200,
   sin entrar alrededor del dato de inflación) con los mismos datos y la misma gestión de la página:
   stop 2,5 ATR (tope 15 %), objetivos 3 / 6 / 9 × stop, 1/3 en cada uno, stop a la entrada tras el objetivo 1, plazo 42 días,
   X para que el stop cueste ~40 % del margen (máx. × 20), comisión 0,1 % por lado. También una gestión más corta (objetivos 1 / 2 / 3 × stop).
   Resultados en USD con 300 USD de margen por señal. Datos: Yahoo (diarias 10 años, de 1 h 2 años).
   Uso: node herramientas/investigacion-acciones-rsi.js → investigacion-acciones-rsi.json */
const fs = require('fs'), path = require('path');
const SEC = JSON.parse(fs.readFileSync(path.join(__dirname, 'sectores.json'), 'utf8')), MAC = require('./macro-lib.js');
const LIST = [...new Set(Object.entries(SEC).filter(([k]) => !k.startsWith('_')).flatMap(([, v]) => v))].filter(s => !/^(SPY|QQQ|DIA|IWM|EEM|EWZ|XL.|GLD|SLV|TLT|ARKK|VXX|USO)$/.test(s)).slice(0, +(process.env.NA || 400));
const DAY = 864e5, H = 36e5, NOW = Date.now(), MG = 300, FEE = .001, YRS = +(process.env.ANIOS || 4);
const sleep = ms => new Promise(r => setTimeout(r, ms)), yh = s => s.replace('.', '-');
async function yahoo(sym, interval, range) { const u = `https://query1.finance.yahoo.com/v8/finance/chart/${yh(sym)}?interval=${interval}&range=${range}&includePrePost=false`;
  for (let k = 0; k < 4; k++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (r.status === 404) return null;
      if (r.ok) { const j = await r.json(), x = j && j.chart && j.chart.result && j.chart.result[0]; if (!x || !x.timestamp) return null; const q = x.indicators.quote[0], o = [];
        x.timestamp.forEach((t, i) => { if (q.close[i] == null || q.open[i] == null || q.high[i] == null) return; o.push({ t: t * 1000, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], v: q.volume[i] || 0 }); });
        return o; } } catch (e) {} await sleep(2500 * (k + 1)); } return null; }
/* ---------- indicadores ---------- */
function ema(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let pr = null, s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { pr = s / p; o[i] = pr; } } else { pr = v[i] * k + pr * (1 - k); o[i] = pr; } } return o; }
function sma(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; if (i >= p - 1) o[i] = s / p; } return o; }
function wil(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { s /= p; o[i] = s; } } else { s = (s * (p - 1) + v[i]) / p; o[i] = s; } } return o; }
const trA = b => b.map((x, i) => i ? Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close)) : x.high - x.low);
function rsi(cl, p = 14) { const o = Array(cl.length).fill(null); let g = 0, l = 0; for (let i = 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= p) { g += u; l += w; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * (p - 1) + u) / p; l = (l * (p - 1) + w) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } return o; }
function macdH(cl) { const a = ema(cl, 12), b = ema(cl, 26), m = cl.map((_, i) => a[i] != null && b[i] != null ? a[i] - b[i] : null), s = ema(m.map(x => x ?? 0), 9); return m.map((x, i) => x == null || s[i] == null ? null : x - s[i]); }
/* velas de 1 h → 4 h desde la apertura de cada día (como TradingView); diarias → semanales (lunes a viernes) */
const NYF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const ny = t => { const p = Object.fromEntries(NYF.formatToParts(new Date(t)).map(x => [x.type, x.value])); return { d: `${p.year}-${p.month}-${p.day}`, m: (+p.hour % 24) * 60 + +p.minute - 570 }; };
function agg(b, keyf) { const out = []; let key = null, cur = null; for (const x of b) { const k = keyf(x); if (k !== key) { key = k; cur = { ...x }; out.push(cur); } else { cur.high = Math.max(cur.high, x.high); cur.low = Math.min(cur.low, x.low); cur.close = x.close; cur.v += x.v; } } return out; }
const to4h = b => agg(b.filter(x => { const q = ny(x.t); return q.m >= 0 && q.m < 390; }), x => { const q = ny(x.t); return q.d + '#' + Math.floor(q.m / 240); });
const toW = b => agg(b, x => Math.floor((x.t / DAY + 3) / 7));
const idxLE = (b, t) => { let lo = 0, hi = b.length; while (lo < hi) { const m = (lo + hi) >> 1; if (b[m].t <= t) lo = m + 1; else hi = m; } return lo - 1; };

/* ---------- gestión de la página (histFollow) sobre velas de resolución rb ---------- */
function follow(rb, j0, e, sl, r, maxMs, t0) { const T = [1, 2, 3].map(k => e * (1 + k * r * sl)), fail = e * (1 - sl); let hit = 0, real = 0;
  for (let j = j0; j < rb.length; j++) { const b = rb[j];
    if (!hit && b.low <= fail) return { f: -sl, hit, end: b.t, stop: 1 };
    if (hit > 0 && b.low <= e) return { f: real, hit, end: b.t };
    while (hit < 3 && b.high >= T[hit]) { real += (T[hit] / e - 1) / 3; hit++; } if (hit === 3) return { f: real, hit, end: b.t };
    if (b.t - t0 > maxMs) { const px = (b.low + b.high) / 2; return { f: Math.max(-sl, real + (1 - hit / 3) * (px / e - 1)), hit, end: b.t }; } }
  return null; }
const levOf = sl => Math.max(1, Math.min(20, Math.floor(.4 / sl), Math.floor(.8 / sl)));
function res(o, x) { const L = levOf(o.sl); return Object.assign(o, { lev: L, usd: +(MG * L * (x.f - 2 * FEE)).toFixed(2), hit: x.hit, stop: !!x.stop, end: x.end }); }

function st(L, meses) { const D = L.filter(o => o.usd != null), n = D.length; if (!n) return { n: 0 }; const u = D.map(o => o.usd), lo = u.filter(x => x < 0);
  let w = 0, c = 0; for (const x of D.slice().sort((a, b) => a.t - b.t).map(o => o.usd)) { c = x < 0 ? c + x : 0; w = Math.min(w, c); }
  return { n, por_mes: +(n / meses).toFixed(1), gana: +(100 * (n - lo.length) / n).toFixed(1), obj1: +(100 * D.filter(o => o.hit >= 1).length / n).toFixed(1), usd_op: +(u.reduce((a, x) => a + x, 0) / n).toFixed(1),
    usd: Math.round(u.reduce((a, x) => a + x, 0)), perd_media: lo.length ? +(lo.reduce((a, x) => a + x, 0) / lo.length).toFixed(1) : 0, peor_racha: Math.round(w) }; }

(async () => {
  const spyD = await yahoo('SPY', '1d', '10y'), sC = spyD.map(x => x.close), s200 = sma(sC, 200);
  const spyOk = t => { const i = idxLE(spyD, t - DAY); return i >= 0 && s200[i] != null && spyD[i].close > s200[i]; };
  const R = {}, add = (k, o) => (R[k] = R[k] || []).push(o); let nOk = 0;
  const FROMD = NOW - YRS * 365 * DAY;
  for (let qi = 0; qi < LIST.length; qi++) { const s = LIST[qi];
    const d1 = await yahoo(s, '1d', '10y'); if (!d1 || d1.length < 400) continue; const h1 = await yahoo(s, '1h', '730d'); await sleep(120); nOk++;
    const dC = d1.map(x => x.close), dA = wil(trA(d1), 14), dE200 = ema(dC, 200), dS200 = sma(dC, 200), dS50 = sma(dC, 50), vav = sma(d1.map(x => x.v), 20), dR = rsi(dC), dM = macdH(dC);
    /* contexto diario al cierre del día anterior a t: tendencia del año (precio vs hace 252 ruedas), del mes (precio sobre su media de 21 ruedas ~ 1 mes… usamos 10 meses ≈ 210 ruedas para "mensual"), media de 200 */
    const ctx = t => { const i = idxLE(d1, t - 1); if (i < 260) return null; const c = d1[i].close;
      return { i, c, atr: dA[i], s200: dS200[i] != null && c > dS200[i], s50: dS50[i] != null && c > dS50[i], y1: c / d1[i - 252].close - 1, m10: (() => { let s = 0; for (let k = 0; k < 210; k++) s += d1[i - k].close; return c > s / 210; })(), m1: c / d1[i - 21].close - 1 }; };
    /* --- reglas actuales (diarias) --- */
    { let free = 0; for (let i = 260; i < d1.length - 1; i++) { const x = d1[i], t = x.t + DAY; if (t < FROMD || t < free) continue;
        const body = (x.close - x.open) / ((x.high - x.low) || 1); let h = 0, l = 1e18; for (let j = Math.max(0, i - 251); j <= i; j++) { h = Math.max(h, d1[j].high); l = Math.min(l, d1[j].low); }
        const c = x.close, r6 = (c / d1[i - 120].close - 1) * 100, fromHi = (c / h - 1) * 100, fromLo = (c / l - 1) * 100;
        let setup = null; if (body > .5 && r6 <= -10 && fromHi > -35 && fromLo < 100) setup = 'c-reb';
        else if (dE200[i] != null && c > dE200[i] && vav[i] && x.v > 1.5 * vav[i]) { let hh = 0; for (let j = i - 20; j < i; j++) hh = Math.max(hh, d1[j].high); if (c > hh) setup = 'c-rup'; }
        if (!setup || !spyOk(t) || MAC.bloquea(t, 24, 12, ['cpi'])) continue;
        const sl = Math.min(.15, Math.max(.004, 2.5 * dA[i] / c));
        for (const [g, r] of [['actual', 3], ['corta', 1]]) { const x2 = follow(d1, i + 1, c, sl, r, 42 * DAY, t); if (!x2) continue; add(`ACTUAL (c-reb / c-rup) · gestión ${g}`, res({ s, t, sl }, x2)); }
        const x3 = follow(d1, i + 1, c, sl, 3, 42 * DAY, t); free = x3 ? x3.end : Infinity; } }
    /* --- COMBINADA: reglas actuales + "RSI diario ≤ 25" (gestión corta) como tercera regla; una operación por acción a la vez --- */
    { let free = 0; for (let i = 260; i < d1.length - 1; i++) { const x = d1[i], t = x.t + DAY; if (t < FROMD || t < free) continue;
        const body = (x.close - x.open) / ((x.high - x.low) || 1); let h = 0, l = 1e18; for (let j = Math.max(0, i - 251); j <= i; j++) { h = Math.max(h, d1[j].high); l = Math.min(l, d1[j].low); }
        const c = x.close, r6 = (c / d1[i - 120].close - 1) * 100, fromHi = (c / h - 1) * 100, fromLo = (c / l - 1) * 100;
        let setup = null; if (body > .5 && r6 <= -10 && fromHi > -35 && fromLo < 100) setup = 'c-reb';
        else if (dE200[i] != null && c > dE200[i] && vav[i] && x.v > 1.5 * vav[i]) { let hh = 0; for (let j = i - 20; j < i; j++) hh = Math.max(hh, d1[j].high); if (c > hh) setup = 'c-rup'; }
        if (setup && !spyOk(t)) setup = null; const rsiOk = dR[i] != null && dR[i] <= 25;
        if (!setup && !rsiOk) continue; if (MAC.bloquea(t, 24, 12, ['cpi'])) continue;
        const sl = Math.min(.15, Math.max(.004, 2.5 * dA[i] / c)), [r, mx] = setup ? [3, 42 * DAY] : [1, 21 * DAY], x2 = follow(d1, i + 1, c, sl, r, mx, t);
        if (!x2) { free = Infinity; continue; } add('COMBINADA: actuales + RSI diario ≤ 25 (gestión corta)', res({ s, t, sl, setup: setup || 'c-rsi' }, x2));
        if (!setup) add('COMBINADA · solo las de RSI', res({ s, t, sl }, x2)); free = x2.end; } }
    /* --- primero la planilla de RSI --- */
    const TFS = { '1d': d1, '1w': toW(d1) }; if (h1 && h1.length > 500) { TFS['1h'] = h1.filter(x => { const q = ny(x.t); return q.m >= 0 && q.m < 390; }); TFS['4h'] = to4h(h1); }
    for (const [tf, b] of Object.entries(TFS)) { const cl = b.map(x => x.close), Rr = rsi(cl), Mh = macdH(cl), ms = tf === '1h' ? H : tf === '4h' ? 4 * H : tf === '1d' ? DAY : 7 * DAY;
      const from = tf === '1h' || tf === '4h' ? NOW - 2 * 365 * DAY : FROMD;
      for (const T of [30, 25, 20]) { let free = {};
        for (let i = 30; i < b.length - 1; i++) { const t = b[i].t + ms; if (t < from) continue; if (!(Rr[i] != null && Rr[i] <= T + 8)) continue;
          /* paso 1: la planilla marcó RSI ≤ T en alguna de las últimas 5 velas; paso 2: los demás datos (se prueban combinaciones) */
          let lowRecent = false; for (let k = 0; k < 5 && i - k >= 0; k++) if (Rr[i - k] != null && Rr[i - k] <= T) lowRecent = true; if (!lowRecent) continue;
          const C = ctx(t); if (!C || !C.atr) continue; const c = b[i].close;
          const gira = Rr[i] > Rr[i - 1] && b[i].close > b[i].open, rompe = b[i].close > b[i - 1].high, macdSube = Mh[i] != null && Mh[i - 1] != null && Mh[i] > Mh[i - 1], ahora = Rr[i] <= T;
          const F = {
            'solo RSI (entra apenas toca)': ahora,
            'RSI + gira (vela verde y RSI subiendo)': gira,
            'RSI + gira + S&P 500 sobre su media de 200': gira && spyOk(t),
            'RSI + gira + acción sobre su media de 200': gira && C.s200,
            'RSI + gira + año a favor (sube en 12 meses)': gira && C.y1 > 0,
            'RSI + gira + año a favor + sobre su media de 10 meses': gira && C.y1 > 0 && C.m10,
            'RSI + rompe el máximo de la vela anterior + año a favor + S&P 500 ok': rompe && C.y1 > 0 && spyOk(t),
            'RSI + gira + MACD sube + año a favor + S&P 500 ok': gira && macdSube && C.y1 > 0 && spyOk(t),
            'TODO: gira + MACD sube + sobre media 200 + año y 10 meses a favor + S&P 500 ok': gira && macdSube && C.s200 && C.y1 > 0 && C.m10 && spyOk(t) };
          for (const [nm, ok] of Object.entries(F)) { if (!ok) continue; const key = `${tf} · RSI ≤ ${T} · ${nm}`; if ((free[key] || 0) > t) continue; if (MAC.bloquea(t, 24, 12, ['cpi'])) continue;
            const atrP = tf === '1d' || tf === '1w' ? C.atr / C.c : (() => { const a = wil(trA(b.slice(Math.max(0, i - 60), i + 1)), 14); return a[a.length - 1] / c; })();
            const sl = Math.min(.15, Math.max(.004, 2.5 * atrP)), rb = tf === '1w' ? d1 : b, j0 = tf === '1w' ? idxLE(d1, t - 1) + 1 : i + 1;
            for (const [g, r, mx] of [['actual', 3, 42 * DAY], ['corta', 1, 21 * DAY]]) { const x2 = follow(rb, j0, c, sl, r, mx, t); if (!x2) continue; add(`${key} · gestión ${g}`, res({ s, t, sl }, x2)); if (g === 'actual') free[key] = x2.end; } } } } }
    if (qi % 20 === 0) console.log('acciones', qi, '/', LIST.length); }
  const out = { upd: NOW, acciones: nOk, nota: 'usd = 300 USD de margen por señal con la X de la página (stop ≈ 40 % del margen, máx. × 20), con comisión. 1 h y 4 h: 2 años (Yahoo no da más); 1 día y 1 semana: ' + YRS + ' años.', variantes: {} };
  for (const k in R) { const L = R[k].sort((a, b) => a.t - b.t), tf2 = /^(1h|4h)/.test(k), F0 = tf2 ? NOW - 2 * 365 * DAY : FROMD, mid = F0 + (NOW - F0) / 2, M = (NOW - F0) / DAY / 30.4;
    out.variantes[k] = { todo: st(L, M), mitad1: st(L.filter(o => o.t < mid), M / 2), mitad2: st(L.filter(o => o.t >= mid), M / 2), año: st(L.filter(o => o.t >= NOW - 365 * DAY), 12),
      actual_mismo_periodo: tf2 ? 1 : 0 }; }
  /* las reglas actuales también en los 2 últimos años, para comparar con 1 h y 4 h */
  for (const k of Object.keys(R).filter(k => k.startsWith('ACTUAL') || k.startsWith('COMBINADA'))) { const L = R[k].filter(o => o.t >= NOW - 2 * 365 * DAY), mid = NOW - 365 * DAY; out.variantes[k + ' · 2 años'] = { todo: st(L, 24), mitad1: st(L.filter(o => o.t < mid), 12), mitad2: st(L.filter(o => o.t >= mid), 12), año: st(L.filter(o => o.t >= mid), 12) }; }
  fs.writeFileSync('investigacion-acciones-rsi.json', JSON.stringify(out, null, 1));
  const rows = Object.entries(out.variantes).sort((a, b) => (b[1].todo.usd || -1e9) - (a[1].todo.usd || -1e9)); for (const [k, v] of rows.slice(0, 40)) console.log(k, JSON.stringify(v.todo), 'año', JSON.stringify(v.año));
})().catch(e => { console.error(e); process.exit(1); });
