/* FIGURAS CHARTISTAS (octubre 2026). Busca figuras clásicas sobre velas {open,high,low,close} usando solo datos hasta cada vela
   (sin mirar el futuro): los pivotes se confirman K velas después. Sirve igual en la página (window.FIG) y en los bots (require).
   Figuras: doble techo / doble piso, hombro-cabeza-hombro (normal e invertido), triángulo ascendente / descendente / simétrico,
   cuña ascendente / descendente, bandera alcista / bajista y rango (rectángulo).
   Cada figura: {tipo, nombre, dir (+1 sube, −1 cae, 0 se mantiene), i0 (primera vela), i1 (vela donde se confirma), hi, lo (caja),
   conf (true si ya rompió), obj (precio objetivo), stop}. */
(function (root) {
  const K = 3; // un pivote es el máximo/mínimo de 3 velas a cada lado
  function atrArr(b, p = 14) { const o = Array(b.length).fill(null); let s = 0;
    for (let i = 0; i < b.length; i++) { const tr = i ? Math.max(b[i].high - b[i].low, Math.abs(b[i].high - b[i - 1].close), Math.abs(b[i].low - b[i - 1].close)) : b[i].high - b[i].low;
      if (i < p) { s += tr; if (i === p - 1) o[i] = s / p; } else o[i] = (o[i - 1] * (p - 1) + tr) / p; } return o; }
  /* pivotes alternados (zigzag) con un movimiento mínimo de 1,2 ATR entre uno y otro; cada uno queda "conocido" en i+K */
  function pivots(b, A) { const P = [];
    for (let i = K; i < b.length - K; i++) { let ph = true, pl = true;
      for (let j = i - K; j <= i + K; j++) { if (j === i) continue; if (b[j].high >= b[i].high) ph = false; if (b[j].low <= b[i].low) pl = false; }
      const a = A[i] || 0; if (!a) continue;
      for (const [is, t, v] of [[ph, 'H', b[i].high], [pl, 'L', b[i].low]]) { if (!is) continue; const last = P[P.length - 1];
        if (last && last.t === t) { if ((t === 'H' && v > last.v) || (t === 'L' && v < last.v)) P[P.length - 1] = { i, t, v, k: i + K }; continue; }
        if (last && Math.abs(v - last.v) < 1.2 * a) continue; P.push({ i, t, v, k: i + K }); } }
    return P; }
  const lineAt = (p, q, i) => p.v + (q.v - p.v) * (i - p.i) / ((q.i - p.i) || 1);
  function reg(pts) { const n = pts.length, mx = pts.reduce((s, p) => s + p.i, 0) / n, my = pts.reduce((s, p) => s + p.v, 0) / n; let sxy = 0, sxx = 0;
    for (const p of pts) { sxy += (p.i - mx) * (p.v - my); sxx += (p.i - mx) ** 2; } const m = sxx ? sxy / sxx : 0; return { m, c: my - m * mx, at: i => my + m * (i - mx) }; }
  const N = { dt: 'Doble techo', dp: 'Doble piso', hch: 'Hombro-cabeza-hombro', hchi: 'HCH invertido', ta: 'Triángulo ascendente', td: 'Triángulo descendente',
    ts: 'Triángulo simétrico', ca: 'Cuña ascendente', cd: 'Cuña descendente', ba: 'Bandera alcista', bb: 'Bandera bajista', rg: 'Rango' };
  /* busca figuras; maxAge: velas máximas entre el último pivote y la ruptura */
  function scan(b, opt = {}) { const A = atrArr(b), P = pivots(b, A), out = [], maxAge = opt.maxAge || 20, seen = new Set();
    const add = f => { const key = f.tipo + ':' + f.i0; if (seen.has(key)) return; seen.add(key); f.nombre = N[f.tipo]; out.push(f); };
    /* ruptura: primera vela después de que se conoce el último pivote que cierra fuera de la línea */
    const brk = (from, to, up, dn) => { for (let i = from; i <= Math.min(to, b.length - 1); i++) { const c = b[i].close; if (up != null && c > up(i)) return { i, d: 1 }; if (dn != null && c < dn(i)) return { i, d: -1 }; } return null; };
    for (let e = 2; e < P.length; e++) { const p = P.slice(Math.max(0, e - 5), e + 1), last = p[p.length - 1], a = A[last.i] || 0; if (!a) continue;
      const from = last.k, to = last.k + maxAge;
      /* doble techo / doble piso: H L H (o L H L) a la misma altura */
      { const [x, y, z] = p.slice(-3); if (x && y && z && x.t === z.t && x.t !== y.t && Math.abs(x.v - z.v) <= .6 * a && Math.abs(x.v - y.v) >= 2 * a && z.i - x.i >= 6) {
          const top = x.t === 'H', neck = y.v, h = Math.abs(x.v - y.v), r = brk(from, to, top ? null : () => neck, top ? () => neck : null);
          if (r && r.d === (top ? -1 : 1)) add({ tipo: top ? 'dt' : 'dp', dir: r.d, i0: x.i, i1: r.i, hi: Math.max(x.v, y.v, z.v), lo: Math.min(x.v, y.v, z.v), conf: true, obj: neck + r.d * h, stop: top ? Math.max(x.v, z.v) : Math.min(x.v, z.v) }); } }
      /* hombro-cabeza-hombro: H L H L H con la cabeza más alta (o invertido) */
      if (p.length >= 5) { const [s1, n1, hd, n2, s2] = p.slice(-5); if (s1.t === hd.t && hd.t === s2.t && n1.t === n2.t && s1.t !== n1.t) { const top = hd.t === 'H', sg = top ? 1 : -1;
          if (sg * (hd.v - s1.v) >= .8 * a && sg * (hd.v - s2.v) >= .8 * a && Math.abs(s1.v - s2.v) <= 1.2 * a) { const neck = i => lineAt(n1, n2, i), h = Math.abs(hd.v - neck(hd.i)), r = brk(from, to, top ? null : neck, top ? neck : null);
            if (r && r.d === -sg) add({ tipo: top ? 'hch' : 'hchi', dir: r.d, i0: s1.i, i1: r.i, hi: Math.max(s1.v, hd.v, s2.v, n1.v, n2.v), lo: Math.min(s1.v, hd.v, s2.v, n1.v, n2.v), conf: true, obj: neck(r.i) + r.d * h, stop: hd.v }); } } }
      /* triángulos, cuñas y rangos: al menos 2 máximos y 2 mínimos; líneas por los máximos y por los mínimos */
      if (p.length >= 4) { const H = p.filter(q => q.t === 'H'), L = p.filter(q => q.t === 'L'); if (H.length >= 2 && L.length >= 2) {
          const rh = reg(H), rl = reg(L), i0 = p[0].i, span = last.i - i0; if (span < 8) continue;
          const sh = rh.m / a, sl = rl.m / a, flat = .03, w0 = rh.at(i0) - rl.at(i0), w1 = rh.at(last.i) - rl.at(last.i); if (w1 <= 0 || w0 <= 0) continue;
          const conv = w1 < w0 * .85; let tipo = null, bias = 0;
          if (Math.abs(sh) < flat && Math.abs(sl) < flat) { tipo = 'rg'; bias = 0; }
          else if (Math.abs(sh) < flat && sl > flat && conv) { tipo = 'ta'; bias = 1; }
          else if (Math.abs(sl) < flat && sh < -flat && conv) { tipo = 'td'; bias = -1; }
          else if (sh < -flat && sl > flat && conv) { tipo = 'ts'; bias = 0; }
          else if (sh > flat && sl > flat && conv && sl > sh) { tipo = 'ca'; bias = -1; }
          else if (sh < -flat && sl < -flat && conv && sh < sl) { tipo = 'cd'; bias = 1; }
          if (!tipo) continue; const hh = Math.max(...H.map(q => q.v)), ll = Math.min(...L.map(q => q.v)), r = brk(from, to, rh.at, rl.at);
          if (r) { const h = w0; add({ tipo, dir: r.d, i0, i1: r.i, hi: hh, lo: ll, conf: true, bias, obj: b[r.i].close + r.d * h, stop: r.d > 0 ? rl.at(r.i) : rh.at(r.i) }); }
          else if (opt.formando && last.k >= b.length - 1 - maxAge && last.k <= b.length - 1) add({ tipo, dir: tipo === 'rg' ? 0 : bias, i0, i1: b.length - 1, hi: hh, lo: ll, conf: false, bias, obj: null, stop: null }); } } }
    /* banderas: impulso fuerte (≥ 4 ATR en ≤ 8 velas) y pausa chica (5 a 15 velas, < 45 % del impulso) que después rompe a favor */
    for (let i = 20; i < b.length - 6; i++) { const a = A[i]; if (!a) continue;
      for (const d of [1, -1]) { let j0 = -1; for (let j = i - 8; j < i; j++) if (j >= 0 && d * (b[i].close - b[j].close) >= 4 * a) { j0 = j; break; } if (j0 < 0) continue;
        if (d * (b[i + 1] ? b[i + 1].close - b[i].close : 0) > 0) continue; // la vela del mástil tiene que ser el final del impulso
        const pole = Math.abs(b[i].close - b[j0].close); let hi = -1e18, lo = 1e18;
        for (let k = i + 1; k < Math.min(b.length, i + 17); k++) { const n = k - i - 1; // velas de pausa antes de k
          if (n >= 5 && (d > 0 ? b[k].close > hi : b[k].close < lo)) { add({ tipo: d > 0 ? 'ba' : 'bb', dir: d, i0: j0, i1: k, hi: Math.max(hi, b[i].high), lo: Math.min(lo, b[j0].low), conf: true, obj: b[k].close + d * pole, stop: d > 0 ? lo : hi }); break; }
          hi = Math.max(hi, b[k].high); lo = Math.min(lo, b[k].low); if (hi - lo > .45 * pole) break; } } }
    /* una sola figura por vela de confirmación: la más específica */
    const PR = ['hch', 'hchi', 'dt', 'dp', 'ba', 'bb', 'ta', 'td', 'ca', 'cd', 'ts', 'rg'], best = new Map();
    for (const f of out) { const o = best.get(f.i1); if (!o || PR.indexOf(f.tipo) < PR.indexOf(o.tipo)) best.set(f.i1, f); }
    const res = [...best.values()].sort((x, y) => x.i1 - y.i1);
    /* la misma figura no se repite en velas seguidas (las banderas se detectaban varias veces) */
    return res.filter((f, k) => !res.slice(Math.max(0, k - 6), k).some(g => g.tipo === f.tipo && f.i1 - g.i1 <= 6)); }
  const FIG = { scan, pivots, atrArr, N };
  if (typeof module !== 'undefined' && module.exports) module.exports = FIG; else root.FIG = FIG;
})(typeof window !== 'undefined' ? window : globalThis);
