/* SALIDA ANTICIPADA (TRADING v7, octubre 2026): cuántas de 8 señales están en contra de la operación en la última vela cerrada de 4 h.
   Señales: Supertrend (10,3), precio vs EMA 21, EMA 9 vs EMA 21, RSI 14 vs 50, histograma MACD (12,26,9), DMI (+DI vs −DI),
   flujo comprador de las últimas 3 velas y figura chartista confirmada en contra en las últimas 6 velas.
   Regla probada (1 año y 4 años, con costos): con 5 o más en contra se sale. Antes del objetivo 1 solo si la ganancia es al menos
   medio stop; después del objetivo 1, con cualquier ganancia. Las mismas cuentas que la simulación (historial-anual.js, SALIDA). */
const FIG = require('./figuras-lib.js');
const N_SALIDA = 5;
function ema(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let prev = null, cnt = 0, sum = 0;
  for (let i = 0; i < v.length; i++) { const x = v[i]; if (x == null) continue; if (prev === null) { sum += x; cnt++; if (cnt === p) { prev = sum / p; o[i] = prev; } } else { prev = x * k + prev * (1 - k); o[i] = prev; } } return o; }
function wilder(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { s /= p; o[i] = s; } } else { s = (s * (p - 1) + v[i]) / p; o[i] = s; } } return o; }
function cuenta(b) { const n = b.length, cl = b.map(x => x.close), tr = b.map((x, i) => i ? Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close)) : x.high - x.low);
  const atr = wilder(tr, 10), st = Array(n).fill(null); let fu = null, fl = null, d = 1;
  for (let i = 0; i < n; i++) { if (atr[i] == null) continue; const x = b[i], hl = (x.high + x.low) / 2, ub = hl + 3 * atr[i], lb = hl - 3 * atr[i];
    if (fu === null) { fu = ub; fl = lb; } else { const pc = b[i - 1].close; fu = (ub < fu || pc > fu) ? ub : fu; fl = (lb > fl || pc < fl) ? lb : fl; }
    if (d === 1 && x.close < fl) d = -1; else if (d === -1 && x.close > fu) d = 1; st[i] = d; }
  const e9 = ema(cl, 9), e21 = ema(cl, 21), e12 = ema(cl, 12), e26 = ema(cl, 26), mac = cl.map((_, i) => e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null), sig = ema(mac.map(v => v == null ? 0 : v), 9);
  const rsi = Array(n).fill(null); { let g = 0, l = 0; for (let i = 1; i < n; i++) { const dd = cl[i] - cl[i - 1], up = Math.max(dd, 0), dn = Math.max(-dd, 0);
      if (i <= 14) { g += up; l += dn; if (i === 14) { g /= 14; l /= 14; rsi[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } else { g = (g * 13 + up) / 14; l = (l * 13 + dn) / 14; rsi[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } } }
  const pdm = [0], mdm = [0]; for (let i = 1; i < n; i++) { const up = b[i].high - b[i - 1].high, dn = b[i - 1].low - b[i].low; pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0); }
  const sp = wilder(pdm, 14), sm = wilder(mdm, 14), fig = Array(n).fill(0);
  try { for (const f of FIG.scan(b)) if (f.conf) for (let k = f.i1; k < Math.min(n, f.i1 + 6); k++) fig[k] = f.dir; } catch (e) {}
  const j = n - 1, c = cl[j], h = mac[j] != null ? mac[j] - sig[j] : 0; let fl3 = 0; for (let k = Math.max(0, j - 2); k <= j; k++) fl3 += 2 * (b[k].tb || 0) - (b[k].v || 0);
  const dnL = [st[j] === -1, e21[j] != null && c < e21[j], e9[j] != null && e21[j] != null && e9[j] < e21[j], rsi[j] != null && rsi[j] < 50, h < 0, sp[j] != null && sm[j] != null && sm[j] > sp[j], fl3 < 0, fig[j] === -1];
  const upL = [st[j] === 1, e21[j] != null && c > e21[j], e9[j] != null && e21[j] != null && e9[j] > e21[j], rsi[j] != null && rsi[j] > 50, h > 0, sp[j] != null && sm[j] != null && sp[j] > sm[j], fl3 > 0, fig[j] === 1];
  const NOM = ['Supertrend', 'EMA 21', 'EMA 9/21', 'RSI', 'MACD', 'DMI', 'flujo', 'figura'];
  return { baja: dnL.filter(Boolean).length, sube: upL.filter(Boolean).length, nomBaja: NOM.filter((_, k) => dnL[k]), nomSube: NOM.filter((_, k) => upL[k]) }; }
/* ¿hay que salir? bars4h: velas de 4 h CERRADAS; px: cierre de la última vela de 1 h; o: {dir, entry, sl (precio), hit} */
function salir(bars4h, o, px) { if (!bars4h || bars4h.length < 60) return null; const d = o.dir, g = d * (px / o.entry - 1), sd = Math.abs(o.sl / o.entry - 1);
  if (o.hit === 0 ? !(g >= .5 * sd) : !(g > 0)) return null; const r = cuenta(bars4h), n = d > 0 ? r.baja : r.sube;
  return n >= N_SALIDA ? { n, señales: d > 0 ? r.nomBaja : r.nomSube } : null; }
module.exports = { cuenta, salir, N_SALIDA };
