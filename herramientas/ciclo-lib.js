/* TRADE DEL CICLO · bot 24 h (octubre 2026). Mismas reglas que la página y que herramientas/investigacion-ciclo.js:
   solo BTC y ETH · × 3 · LONG en subida y acumulación, SHORT en caída (calendario de los halvings: máximo ≈ halving + 535 días,
   piso ≈ halving + 900) · entra cuando el RSI 14 diario (vela cerrada) está bajo 35 / sobre 65 · no abre en los últimos 90 días de una fase ·
   empieza con 200 USD y suma 100 USD cada vez que la pérdida llega al 50 % del margen total (hasta 30 sumas) · sale al +150 % del margen total
   (el objetivo se recalcula con cada suma) · si la fase cambia en contra, cierra. Comisión 0,05 % por lado y financiación 0,01 % cada 8 h.
   Histórico 2018-2026: 23 operaciones, 23 ganadas, +1.085 USD por operación. */
const CIC = { lev: 3, m0: 200, add: 100, cap: 30, tp: 1.5, last: 90, L: 35, S: 65, fee: .0005, fund: .0001 / (8 * 36e5), syms: ['BTCUSDT', 'ETHUSDT'] };
const DAY = 864e5, HALV = ['2012-11-28', '2016-07-09', '2020-05-11', '2024-04-20', '2028-04-15'].map(d => Date.parse(d));
function fase(t) { let k = 0; for (let i = 0; i < HALV.length; i++) if (HALV[i] <= t) k = i; const h = HALV[k], d = (t - h) / DAY;
  return d < 535 ? { f: 'subida', dir: 1, fin: h + 535 * DAY } : d < 900 ? { f: 'caida', dir: -1, fin: h + 900 * DAY } : { f: 'acumulacion', dir: 1, fin: HALV[k + 1] || h + 1440 * DAY }; }
const pnl = (o, p) => o.dir * (o.qty * p - o.cost) - o.fees - o.fund;
const addPx = o => o.dir > 0 ? (o.cost + o.fees + o.fund - .5 * o.marg) / o.qty : (o.cost - o.fees - o.fund + .5 * o.marg) / o.qty;
const tgtPx = o => o.dir > 0 ? (CIC.tp * o.marg + o.cost + o.fees + o.fund) / (o.qty * (1 - CIC.fee)) : (o.cost - o.fees - o.fund - CIC.tp * o.marg) / (o.qty * (1 + CIC.fee));
const liqPx = o => o.dir > 0 ? (o.cost + o.fees + o.fund - o.marg) / o.qty : (o.cost - o.fees - o.fund + o.marg) / o.qty;
function rsi(c) { let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0); if (i <= 14) { g += u / 14; l += w / 14; } else { g = (g * 13 + u) / 14; l = (l * 13 + w) / 14; } } return l ? 100 - 100 / (1 + g / l) : 100; }
function open(sym, dir, px, t, r) { const q = CIC.m0 * CIC.lev / px; return { id: sym + '-' + t, sym, dir, t, e0: px, qty: q, cost: q * px, fees: q * px * CIC.fee, fund: 0, marg: CIC.m0, adds: 0, last: Math.floor(t / 36e5) * 36e5 + 36e5, rsi: +r.toFixed(1), log: [{ t, px, k: 'entrada' }], state: 'open', fase: fase(t).f }; }
function close(o, px, t, why) { o.state = why; o.px = px; o.closeAt = t; o.pnl = why === 'liq' ? -o.marg : Math.round((pnl(o, px) - o.qty * px * CIC.fee) * 100) / 100; o.log.push({ t, px, k: 'salida' }); }
/* una vela cerrada de 1 h: financiación, cambio de fase, sumas, liquidación y objetivo. Devuelve los eventos para avisar. */
function step(o, b, ms = 36e5) { const ev = []; if (o.state !== 'open') return ev; const d = o.dir, adv = d > 0 ? b.l : b.h, fav = d > 0 ? b.h : b.l, a0 = o.adds; o.fund += o.qty * b.c * CIC.fund * ms;
  if (fase(b.t).dir !== d) { close(o, b.o, b.t, 'fase'); ev.push({ k: 'salida' }); return ev; }
  let g = 0; while (pnl(o, adv) <= -.5 * o.marg && o.adds < CIC.cap && g++ < 40) { const px = d > 0 ? Math.max(adv, addPx(o)) : Math.min(adv, addPx(o)), q = CIC.add * CIC.lev / px;
    o.qty += q; o.cost += q * px; o.fees += q * px * CIC.fee; o.marg += CIC.add; o.adds++; o.log.push({ t: b.t, px, k: 'suma' }); ev.push({ k: 'suma', px }); }
  if (pnl(o, adv) <= -o.marg) { close(o, liqPx(o), b.t, 'liq'); ev.push({ k: 'salida' }); return ev; }
  if (o.adds > a0) return ev; const tg = tgtPx(o); if (d * (fav - tg) >= 0) { close(o, tg, b.t, 'win'); ev.push({ k: 'salida' }); } return ev; }
module.exports = { CIC, fase, pnl, addPx, tgtPx, liqPx, rsi, open, close, step };
