/* INVESTIGACIÓN · RESCATE de una operación en pérdida (noviembre 2026). No cambia la página ni los bots: solo mide.
   Pregunta: con una operación en −70 % del margen, ¿qué conviene? Cerrar, aguantar, o "rescatar":
   agregar margen para que la liquidación quede por debajo del soporte fuerte más cercano (o promediar en ese soporte) y salir en el rebote.
   Datos: 30 criptos, velas de 1 h de Binance (≈ 1 año). Entradas al azar (LONG y SHORT, × 5 a × 20, margen 100 USD), se siguen hasta −70 %.
   Los soportes salen de las velas de 4 h ANTERIORES al momento (sin mirar el futuro), con la misma regla que el indicador de la página.
   Resultado de cada estrategia en USD (sobre 100 USD de margen inicial) y cuánta plata extra hubo que poner. Plazo máximo: 10 días. */
const fs = require('fs');
const SYMS = ['BTC','ETH','SOL','XRP','BNB','DOGE','ADA','LINK','AVAX','LTC','DOT','TRX','BCH','NEAR','UNI','ATOM','APT','ARB','OP','SUI','FIL','INJ','AAVE','ETC','XLM','HBAR','TIA','SEI','WLD','PEPE'].map(s => s + 'USDT');
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function kl(s, tf, start, end) { const out = []; let t = start; while (t < end) { const u = `https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=${tf}&startTime=${t}&limit=1000`;
    let j = null; for (let k = 0; k < 3 && !j; k++) { try { const r = await fetch(u); if (r.ok) j = await r.json(); } catch (e) {} if (!j) await sleep(1500); }
    if (!j || !j.length) break; for (const x of j) out.push({ t: +x[0], open: +x[1], high: +x[2], low: +x[3], close: +x[4] }); t = +j[j.length - 1][0] + 1; await sleep(120); } return out; }
const agg = (b, k) => { const o = []; for (let i = 0; i + k <= b.length; i += k) { const s = b.slice(i, i + k); o.push({ t: s[0].t, open: s[0].open, close: s[k - 1].close, high: Math.max(...s.map(x => x.high)), low: Math.min(...s.map(x => x.low)) }); } return o; };
/* misma regla que el indicador "Soportes y resistencias fuertes" de la página */
function sop(c) { const n = c.length; if (n < 60) return null; const W = 5, tr = []; for (let i = 0; i < n; i++) { const b = c[i], pc = i ? c[i - 1].close : b.open; tr.push(Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc))); }
  const atr = [...tr.slice(-200)].sort((a, b) => a - b)[Math.floor(Math.min(200, n) / 2)], last = c[n - 1].close, tol = Math.max(.5 * atr, last * .0015);
  const P = []; for (let i = W; i < n - W; i++) { let lo = true, hi = true; for (let j = i - W; j <= i + W; j++) { if (j === i) continue; if (c[j].low < c[i].low) lo = false; if (c[j].high > c[i].high) hi = false; if (!lo && !hi) break; } if (lo) P.push({ p: c[i].low, i }); if (hi) P.push({ p: c[i].high, i }); }
  P.sort((a, b) => a.p - b.p); const G = []; for (const x of P) { const g = G[G.length - 1]; if (g && x.p - g.sum / g.m.length <= tol) { g.m.push(x); g.sum += x.p; } else G.push({ m: [x], sum: x.p }); }
  const L = []; for (const g of G) { if (g.m.length < 2) continue; const lv = g.sum / g.m.length, idx = [...new Set(g.m.map(x => x.i))].sort((a, b) => a - b); let tq = 0, lastI = -99; for (const i of idx) if (i - lastI >= W) { tq++; lastI = i; } if (tq < 2) continue;
    let fq = 0, qb = 0, side = 0; for (let i = idx[0]; i < n; i++) { const b = c[i], sd = b.close > lv + tol * .5 ? 1 : b.close < lv - tol * .5 ? -1 : 0;
      if (sd && side && sd !== side) { let ok = true; for (let j = i + 1; j <= Math.min(n - 1, i + 3); j++) { if ((c[j].close > lv ? 1 : -1) !== sd) { ok = false; break; } } if (ok) qb++; else fq++; }
      else if (side === 1 && b.low < lv - tol * .5 && b.close > lv) fq++; else if (side === -1 && b.high > lv + tol * .5 && b.close < lv) fq++; if (sd) side = sd; }
    const rec = idx.filter(i => i > n * .7).length, sc = tq + rec * .5 + fq * .5 - qb * 1.5; if (sc < 2.5) continue; L.push({ p: lv, tq, sc }); }
  const mx = Math.max(1, ...L.map(x => x.sc)); return { tol, atr, L: L.map(x => Object.assign(x, { f: x.sc / mx })) }; }
const MM = .005, M0 = 100;
const liqOf = (d, avg, qty, mg) => avg * (1 - d * Math.max(.001, mg / (qty * avg) - MM));
function run(h, i0, d, lev, S) { // h: velas 1 h desde la entrada; i0 = índice del −70 %; devuelve resultados de cada estrategia
  const e0 = h[0].open, q0 = M0 * lev / e0, R = {}, H = 240, pnl = (px, avg, q) => d * (px - avg) * q;
  const end = Math.min(h.length - 1, i0 + H), c0 = h[i0].close, liq0 = liqOf(d, e0, q0, M0);
  R.cerrar = { usd: pnl(c0, e0, q0), extra: 0 };
  { let r = null; for (let i = i0 + 1; i <= end; i++) { const b = h[i]; if (d * ((d > 0 ? b.low : b.high) - liq0) <= 0) { r = -M0; break; } if (d * ((d > 0 ? b.high : b.low) - e0) >= 0) { r = 0; break; } } R.aguantar = { usd: r ?? pnl(h[end].close, e0, q0), extra: 0 }; }
  /* soporte fuerte más cercano en contra (debajo para LONG, arriba para SHORT), sin pasarse de 3 ATR de 4 h */
  const cand = S ? S.L.filter(l => d * (c0 - l.p) > 0 && d * (c0 - l.p) <= 3 * S.atr && l.f >= .35).sort((a, b) => d * (b.p - a.p)) : [];
  const sp = cand.sort((a, b) => b.f - a.f)[0];
  const zone = sp ? sp.p - d * (S.tol * .5 + .5 * S.atr) : null; // el piso de la zona (con margen para mechas)
  for (const modo of ['margen', 'promedio']) { const k = 'rescate_' + modo;
    if (!sp) { R[k] = Object.assign({}, R.cerrar, { sin: 1 }); continue; }
    let q = q0, avg = e0, mg = M0, extra = 0, added = false, r = null;
    if (modo === 'margen') { const need = (Math.abs(avg - zone) / avg + MM) * q * avg - mg; if (need > 0) { extra = Math.ceil(need); mg += extra; added = true; } }
    for (let i = i0 + 1; i <= end && r == null; i++) { const b = h[i], lo = d > 0 ? b.low : b.high, hi = d > 0 ? b.high : b.low;
      if (modo === 'promedio' && !added && d * (lo - sp.p) <= 0) { const q2 = M0 * lev / sp.p; avg = (avg * q + sp.p * q2) / (q + q2); q += q2; mg += M0; extra = M0; added = true;
        const need = (Math.abs(avg - zone) / avg + MM) * q * avg - mg; if (need > 0) { mg += Math.ceil(need); extra += Math.ceil(need); } }
      const liq = liqOf(d, avg, q, mg); if (d * (lo - liq) <= 0) { r = -mg; break; }
      if (d * (b.close - zone) < 0) { r = pnl(b.close, avg, q); break; } // cerró del otro lado del soporte: se sale (el soporte no aguantó)
      if (d * (hi - avg) >= 0) { r = 0; break; } } // volvió al precio promedio: sale sin pérdida
    R[k] = { usd: r ?? pnl(h[end].close, avg, q), extra }; }
  /* rescate solo si vale la pena: soporte fuerte (≥ 0,6) y la plata extra no pasa el margen inicial; si no, cerrar */
  R.rescate_filtrado = sp && sp.f >= .6 && R.rescate_margen.extra <= M0 ? R.rescate_margen : Object.assign({}, R.cerrar, { sin: 1 });
  return R; }
(async () => { const END = Date.now() - 3600e3, START = END - 400 * 864e5, AGG = {}; let N = 0; let rng = 12345; const rnd = () => (rng = (rng * 16807) % 2147483647) / 2147483647;
  for (const s of SYMS) { const h = await kl(s, '1h', START, END); if (h.length < 3000) { console.log('sin datos', s); continue; } const h4 = agg(h, 4);
    for (let k = 0; k < 120; k++) { const i = 1200 + Math.floor(rnd() * (h.length - 1500)), d = rnd() < .5 ? 1 : -1, lev = [5, 6, 10, 15, 20][Math.floor(rnd() * 5)], e = h[i].open, q = M0 * lev / e;
      let i0 = -1; for (let j = i; j < Math.min(h.length - 250, i + 24 * 20); j++) { const px = d > 0 ? h[j].low : h[j].high; if (d * (px - e) * q <= -70) { i0 = j; break; } } if (i0 < 0) continue;
      const liq = liqOf(d, e, q, M0); if (d * ((d > 0 ? h[i0].low : h[i0].high) - liq) <= 0) continue; // ya liquidada en la misma vela
      const j4 = Math.floor(i0 / 4) - 1, S = sop(h4.slice(Math.max(0, j4 - 600), j4 + 1)); const R = run(h.slice(i), i0 - i, d, lev, S); N++;
      for (const [k2, v] of Object.entries(R)) { const A = AGG[k2] = AGG[k2] || { n: 0, usd: 0, extra: 0, gan0: 0, liq: 0, peor: 0, sin: 0 }; A.n++; A.usd += v.usd; A.extra += v.extra; if (v.usd >= -.5) A.gan0++; if (v.usd <= -M0 - v.extra + .5) A.liq++; A.peor = Math.min(A.peor, v.usd); if (v.sin) A.sin++; } }
    console.log(s, 'casos', N); }
  const out = { upd: Date.now(), casos: N, nota: 'USD por operación de 100 USD de margen que llegó a −70 %. extra = plata que se agregó en promedio. sin_perdida = salió en 0 o mejor. liquidadas = perdió todo el margen.', estrategias: {} };
  for (const [k, A] of Object.entries(AGG)) out.estrategias[k] = { promedio_usd: +(A.usd / A.n).toFixed(1), extra_promedio: +(A.extra / A.n).toFixed(1), sin_perdida_pct: +(100 * A.gan0 / A.n).toFixed(1), liquidadas_pct: +(100 * A.liq / A.n).toFixed(1), peor_usd: Math.round(A.peor), sin_soporte_pct: +(100 * A.sin / A.n).toFixed(1) };
  fs.writeFileSync('investigacion-rescate.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1)); })().catch(e => { console.error(e); process.exit(1); });
