/* CRIPTO-LIVE · IA: motor común (lo usan la página y el estudio diario en GitHub).
   Calcula los indicadores de cada vela, el estado de una operación abierta y evalúa los modelos (árboles) que aprende la IA.
   Todo lo que la IA "mira" sale de acá, así lo que aprende y lo que usa en vivo es exactamente lo mismo. */
(function (root) {
  const IA = { ver: 1 };
  const N = x => (x == null || !isFinite(x) ? 0 : x);
  function ema(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let prev = null, cnt = 0, sum = 0;
    for (let i = 0; i < v.length; i++) { const x = v[i]; if (x == null) continue;
      if (prev === null) { sum += x; cnt++; if (cnt === p) { prev = sum / p; o[i] = prev; } } else { prev = x * k + prev * (1 - k); o[i] = prev; } }
    return o; }
  function wilder(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { s /= p; o[i] = s; } } else { s = (s * (p - 1) + v[i]) / p; o[i] = s; } } return o; }
  const trs = b => b.map((x, i) => i ? Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close)) : x.high - x.low);
  function rsi(c, p) { const o = Array(c.length).fill(null); let g = 0, l = 0;
    for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
      else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    return o; }
  function adx(b, p) { const n = b.length, pdm = [0], mdm = [0];
    for (let i = 1; i < n; i++) { const up = b[i].high - b[i - 1].high, dn = b[i - 1].low - b[i].low; pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0); }
    const tr = wilder(trs(b), p), sp = wilder(pdm, p), sm = wilder(mdm, p);
    const pdi = tr.map((t, i) => t ? 100 * sp[i] / t : null), mdi = tr.map((t, i) => t ? 100 * sm[i] / t : null);
    const dx = pdi.map((x, i) => x != null && (x + mdi[i]) > 0 ? 100 * Math.abs(x - mdi[i]) / (x + mdi[i]) : null);
    const a = Array(n).fill(null); let s = 0, c = 0, prev = null;
    for (let i = 0; i < n; i++) { if (dx[i] == null) continue; if (prev === null) { s += dx[i]; c++; if (c === p) { prev = s / p; a[i] = prev; } } else { prev = (prev * (p - 1) + dx[i]) / p; a[i] = prev; } }
    return { adx: a, pdi, mdi }; }
  function supertrend(b, p, m) { const n = b.length, atr = wilder(trs(b), p), dir = Array(n).fill(0); let fu = null, fl = null, d = 1;
    for (let i = 0; i < n; i++) { if (atr[i] == null) continue; const x = b[i], hl = (x.high + x.low) / 2, ub = hl + m * atr[i], lb = hl - m * atr[i];
      if (fu === null) { fu = ub; fl = lb; } else { const pc = b[i - 1].close; fu = (ub < fu || pc > fu) ? ub : fu; fl = (lb > fl || pc < fl) ? lb : fl; }
      if (d === 1 && x.close < fl) d = -1; else if (d === -1 && x.close > fu) d = 1; dir[i] = d; }
    return dir; }
  function smaStd(v, p) { const m = Array(v.length).fill(null), s = Array(v.length).fill(null); let a = 0, q = 0;
    for (let i = 0; i < v.length; i++) { a += v[i]; q += v[i] * v[i]; if (i >= p) { a -= v[i - p]; q -= v[i - p] * v[i - p]; }
      if (i >= p - 1) { const mu = a / p; m[i] = mu; s[i] = Math.sqrt(Math.max(0, q / p - mu * mu)); } }
    return [m, s]; }
  const delta = x => { const tb = x.tb != null && !isNaN(x.tb) ? x.tb : x.v / 2; return 2 * tb - x.v; };
  function flow(b, n) { return b.map((x, i) => { let f = 0, v = 0; for (let j = Math.max(0, i - n + 1); j <= i; j++) { f += delta(b[j]); v += b[j].v; } return v ? f / v : 0; }); }
  function volRatio(b) { let s = 0; return b.map((x, i) => { s += x.v; if (i >= 20) s -= b[i - 20].v; return x.v / ((s / Math.min(i + 1, 20)) || 1); }); }

  /* indicadores de todas las velas (se calcula una vez por moneda y temporalidad) */
  IA.prep = function (bars) {
    const cl = bars.map(x => x.close), A = adx(bars, 14), [bm, bs] = smaStd(cl, 20);
    return { bars, cl, atr: wilder(trs(bars), 14), r14: rsi(cl, 14), r7: rsi(cl, 7), adx: A.adx, pdi: A.pdi, mdi: A.mdi, st: supertrend(bars, 10, 3),
      e21: ema(cl, 21), e50: ema(cl, 50), e200: ema(cl, 200), bm, bs, f6: flow(bars, 6), vr: volRatio(bars) };
  };
  /* lo que ve la IA de la vela j, todo "a favor de la operación" (dir = 1 long, −1 short) */
  function mkt(P, j, d) { const b = P.bars[j], c = b.close, at = P.atr[j] || c * .01;
    return { r14: P.r14[j] == null ? 50 : d > 0 ? P.r14[j] : 100 - P.r14[j], r7: P.r7[j] == null ? 50 : d > 0 ? P.r7[j] : 100 - P.r7[j],
      adx: N(P.adx[j]), di: P.pdi[j] == null ? 0 : d * (P.pdi[j] - P.mdi[j]) / ((P.pdi[j] + P.mdi[j]) || 1),
      d21: P.e21[j] == null ? 0 : d * (c - P.e21[j]) / at, d50: P.e50[j] == null ? 0 : d * (c - P.e50[j]) / at, d200: P.e200[j] == null ? 0 : d * (c / P.e200[j] - 1) * 100,
      st: (P.st[j] || 0) * d, fl6: d * N(P.f6[j]), r6: j >= 6 ? d * (c / P.cl[j - 6] - 1) / (at / c) : 0, vr: N(P.vr[j]),
      z: P.bs[j] ? d * (c - P.bm[j]) / P.bs[j] : 0, body: d * (b.close - b.open) / ((b.high - b.low) || 1), atrP: at / c * 100 }; }

  /* ENTRADA: ¿esta señal va a llegar al objetivo 1? */
  IA.ENTRY_F = ['r14', 'r7', 'adx', 'di', 'd21', 'd50', 'd200', 'st', 'fl6', 'r6', 'vr', 'z', 'body', 'atrP', 'btc'];
  IA.entryX = function (P, j, d, btc) { const m = mkt(P, j, d); m.btc = N(btc) * d; return IA.ENTRY_F.map(k => m[k]); };

  /* SALIDA: estado de la operación + mercado. pos = {dir, entry, sl (fracción), peak (mejor precio desde la entrada), hits, age (0–1+)} */
  IA.EXIT_F = ['gR', 'peakR', 'ddR', 'hits', 'age', 'r14', 'r7', 'adx', 'di', 'd21', 'd50', 'st', 'fl6', 'r6', 'vr', 'z', 'body', 'atrP', 'btc'];
  IA.exitX = function (P, j, pos, btc) { const d = pos.dir, c = P.bars[j].close, sd = pos.sl * pos.entry, m = mkt(P, j, d);
    m.gR = d * (c - pos.entry) / sd; m.peakR = d * (pos.peak - pos.entry) / sd; m.ddR = m.peakR - m.gR; m.hits = pos.hits; m.age = pos.age; m.btc = N(btc) * d;
    return IA.EXIT_F.map(k => m[k]); };

  /* árboles aprendidos (gradient boosting) → probabilidad */
  IA.predict = function (M, x) { if (!M) return null; let s = M.init;
    for (const T of M.trees) { let n = 0; while (T.l[n] !== -1) n = x[T.f[n]] <= T.t[n] ? T.l[n] : T.r[n]; s += M.lr * T.v[n]; }
    return 1 / (1 + Math.exp(-s)); };
  /* qué indicadores empujan esta decisión: cambia cada uno por su valor típico y mira cuánto se mueve la probabilidad */
  IA.explain = function (M, x, names) { const p0 = IA.predict(M, x), out = [];
    for (let k = 0; k < x.length; k++) { const y = x.slice(); y[k] = M.med[k]; out.push([names[k], p0 - IA.predict(M, y)]); }
    return out.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])); };
  IA.NAMES = { gR: 'ganancia actual', peakR: 'máximo alcanzado', ddR: 'retroceso desde el máximo', hits: 'objetivos tocados', age: 'tiempo en la operación',
    r14: 'RSI 14', r7: 'RSI 7', adx: 'ADX (fuerza)', di: 'DMI (quién empuja)', d21: 'distancia a la EMA 21', d50: 'distancia a la EMA 50', d200: 'distancia a la EMA 200',
    st: 'Supertrend', fl6: 'CVD (flujo de órdenes)', r6: 'impulso reciente', vr: 'volumen', z: 'Bollinger', body: 'última vela', atrP: 'volatilidad', btc: 'BTC' };
  /* la IA "en práctica" sobre una operación: recorre las velas cerradas desde la entrada y decide igual que en el estudio diario
     (stop del bot; al tocar el objetivo 1 el stop pasa a la entrada y después al objetivo anterior; sale si la probabilidad de seguir
     a favor cae bajo el umbral). pos = {dir, entry, sl, r, maxAge, t0, resMs}; btcAt(t) = lado de BTC (1 / −1) en ese momento.
     Devuelve la ganancia como fracción del precio (sin apalancamiento ni comisión). */
  /* Gestión de la IA (igual que manage() del estudio diario). Variantes:
     A posición entera · B asegura 1/3 en el objetivo 1 · C como B pero nunca corta antes del objetivo 1 ·
     D plan del bot (1/3 en cada objetivo, cierra en el 3 o al plazo) y la IA solo corrige: sale antes después del objetivo 1 si la
       probabilidad cae bajo theta y en el objetivo 3 se queda con el último tercio si la probabilidad sigue alta (>= hold). */
  IA.shadow = function (P, j0, pos, E, btcAt) {
    const d = pos.dir, e = pos.entry, tps = [1, 2, 3].map(k => e * (1 + d * k * pos.r * pos.sl)), lim = j0 + Math.ceil(1.5 * pos.maxAge / pos.resMs),
      limBot = Math.ceil(pos.maxAge / pos.resMs), V = E.variant || 'A', hold = E.hold != null ? E.hold : .55;
    let stop = e * (1 - d * pos.sl), size = 1, real = 0, hits = 0, peak = e, last = null, kept = false, pp = 0;
    const n = Math.min(P.bars.length, lim);
    for (let j = j0, k = 0; j < n; j++, k++) { const b = P.bars[j], adv = d > 0 ? b.low : b.high, fav = d > 0 ? b.high : b.low, tc = b.t + pos.resMs;
      if (d * (stop - adv) >= 0) return { done: true, frac: real + size * d * (stop / e - 1), hits, k, kind: hits ? 'seguro' : 'stop', px: stop, t: tc };
      while (hits < 3 && d * (fav - tps[hits]) >= 0) {
        if (V === 'D') {
          if (hits < 2) { real += d * (tps[hits] / e - 1) / 3; size -= 1 / 3; }
          else if (pp >= hold) kept = true;
          else { real += size * d * (tps[2] / e - 1); size = 0; return { done: true, frac: real, hits: 3, k, kind: 'obj3', px: tps[2], t: tc }; }
        } else if ((V === 'B' || V === 'C') && hits === 0) { real += d * (tps[0] / e - 1) / 3; size -= 1 / 3; }
        hits++; stop = hits === 1 ? e : tps[hits - 2]; }
      peak = d > 0 ? Math.max(peak, b.high) : Math.min(peak, b.low);
      const x = IA.exitX(P, j, { dir: d, entry: e, sl: pos.sl, peak, hits, age: (tc - pos.t0) / pos.maxAge }, btcAt(tc)), p = IA.predict(E.model, x);
      const early = V === 'C' || V === 'D' ? hits >= 1 : true;
      if (early && k + 1 >= E.minhold && p < E.theta) return { done: true, frac: real + size * d * (b.close / e - 1), hits, k, kind: 'ia', px: b.close, t: tc, p, x };
      if (V === 'D' && !kept && k + 1 >= limBot) return { done: true, frac: real + size * d * (b.close / e - 1), hits, k, kind: 'plazo', px: b.close, t: tc, p, x };
      pp = p; last = { p, x, c: b.close, t: tc }; }
    if (!last) return { done: false, frac: 0, hits: 0, k: 0, stop, p: null };
    return { done: n >= lim, frac: real + size * d * (last.c / e - 1), hits, k: n - j0 - 1, kind: n >= lim ? 'plazo' : null, px: last.c, t: last.t, stop, size, p: last.p, x: last.x };
  };
  IA._ = { ema, wilder, rsi, adx, supertrend, smaStd, flow, volRatio };
  if (typeof module !== 'undefined' && module.exports) module.exports = IA; else root.IA = IA;
})(typeof self !== 'undefined' ? self : this);
