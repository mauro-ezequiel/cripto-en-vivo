/* INVESTIGACIÓN · TEMPORALIDAD CON MÁS ACIERTO DE CADA INDICADOR (noviembre 2026). Solo mide. */
const fs = require('fs');
const SYMS = ['BTC','ETH','SOL','XRP','BNB','DOGE','ADA','LINK','AVAX','LTC','DOT','TRX','BCH','NEAR','UNI','ATOM','APT','ARB','OP','SUI','FIL','INJ','AAVE','ETC','XLM','HBAR','TIA','SEI','WLD','PEPE'].map(s => s + 'USDT');
const sleep = ms => new Promise(r => setTimeout(r, ms));
let T0 = Date.UTC(2020, 0, 1); const SPLIT = Date.UTC(2024, 0, 1), NOW = Date.now();
async function kl(s, tf) { const out = []; let t = T0; while (t < NOW) { const u = `https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=${tf}&startTime=${t}&limit=1000`;
    let j = null; for (let k = 0; k < 4 && !j; k++) { try { const r = await fetch(u); if (r.ok) j = await r.json(); } catch (e) {} if (!j) await sleep(2000); }
    if (!j || !j.length) break; for (const x of j) out.push({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5] }); t = +j[j.length - 1][0] + 1; await sleep(100); } return out; }

const sma = (a, n) => { const o = Array(a.length).fill(NaN); let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; if (i >= n - 1) o[i] = s / n; } return o; };
const sd = (a, n, m) => a.map((_, i) => { if (i < n - 1) return NaN; let s = 0; for (let j = i - n + 1; j <= i; j++) s += (a[j] - m[i]) ** 2; return Math.sqrt(s / n); });
function rsi(c, n) { const o = Array(c.length).fill(NaN); let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= n) { g += up / n; l += dn / n; if (i === n) o[i] = l ? 100 - 100 / (1 + g / l) : 100; } else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o[i] = l ? 100 - 100 / (1 + g / l) : 100; } } return o; }
function atr(b, n) { const o = Array(b.length).fill(NaN); let a = 0; for (let i = 1; i < b.length; i++) { const tr = Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)); a = i <= n ? a + tr / n : (a * (n - 1) + tr) / n; if (i >= n) o[i] = a; } return o; }

/* resultado de entrar al cierre de la vela i en sentido d: 1 = objetivo primero, 0 = stop primero, null = ninguno en 30 velas */
function out(B, A, i, d, k = 1.5, H = 30) { const e = B[i].c, tp = e + d * k * A[i], sl = e - d * k * A[i];
  for (let j = i + 1; j <= Math.min(B.length - 1, i + H); j++) { const b = B[j], hitS = d > 0 ? b.l <= sl : b.h >= sl, hitT = d > 0 ? b.h >= tp : b.l <= tp; if (hitS) return 0; if (hitT) return 1; } return null; }

/* Para cada indicador del gráfico: en qué temporalidad acierta más.
   Cada indicador se traduce a una señal concreta (la que se suele operar con él) y se mide con la misma regla para todos:
   acierto = el precio toca +1,5 ATR a favor antes que −1,5 ATR en contra (dentro de 30 velas). Al azar da ~50 %. Largos y cortos juntos.
   Indicadores que son zonas o dibujos sin una señal única (zonas de liquidación, perfil de volumen, figuras) no se miden. */
const ema = (a, n) => { const o = []; const k = 2 / (n + 1); let e = a[0]; for (let i = 0; i < a.length; i++) { e = i ? a[i] * k + e * (1 - k) : a[0]; o.push(e); } return o; };
function sigs(B) { const n = B.length, c = B.map(x => x.c), h = B.map(x => x.h), l = B.map(x => x.l), A = atr(B, 14), r14 = rsi(c, 14), s20 = sma(c, 20), d20 = sd(c, 20, s20);
  const e21 = ema(c, 21), e50 = ema(c, 50), e200 = ema(c, 200), m12 = ema(c, 12), m26 = ema(c, 26), mac = m12.map((x, i) => x - m26[i]), msig = ema(mac, 9);
  /* supertrend 10,3 */ const A10 = atr(B, 10), st = Array(n).fill(0); { let up = 0, dn = 0, dir = 1; for (let i = 1; i < n; i++) { if (isNaN(A10[i])) continue; const m = (h[i] + l[i]) / 2, bu = m - 3 * A10[i], bd = m + 3 * A10[i];
      up = c[i - 1] > up ? Math.max(bu, up) : bu; dn = c[i - 1] < dn ? Math.min(bd, dn) : bd; if (dir === 1 && c[i] < up) dir = -1; else if (dir === -1 && c[i] > dn) dir = 1; st[i] = dir; } }
  /* ADX/DMI 14 */ const pdi = Array(n).fill(NaN), mdi = Array(n).fill(NaN), adx = Array(n).fill(NaN); { let tr = 0, pd = 0, md = 0, ax = 0; for (let i = 1; i < n; i++) { const up = h[i] - h[i - 1], dw = l[i - 1] - l[i], t = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
      const p = up > dw && up > 0 ? up : 0, m = dw > up && dw > 0 ? dw : 0; tr = tr - tr / 14 + t; pd = pd - pd / 14 + p; md = md - md / 14 + m; if (i >= 14) { pdi[i] = 100 * pd / tr; mdi[i] = 100 * md / tr; const dx = 100 * Math.abs(pdi[i] - mdi[i]) / ((pdi[i] + mdi[i]) || 1); ax = i === 14 ? dx : (ax * 13 + dx) / 14; adx[i] = ax; } } }
  /* StochRSI 14: K y D */ const sk = Array(n).fill(NaN); for (let i = 28; i < n; i++) { const w = r14.slice(i - 13, i + 1), mn = Math.min(...w), mx = Math.max(...w); sk[i] = mx > mn ? 100 * (r14[i] - mn) / (mx - mn) : 50; } const K = sma(sk.map(x => isNaN(x) ? 50 : x), 3), Dd = sma(K.map(x => isNaN(x) ? 50 : x), 3);
  /* Ichimoku 9/26/52 */ const mid = (i, p) => { let a = -Infinity, b = Infinity; for (let j = i - p + 1; j <= i; j++) { a = Math.max(a, h[j]); b = Math.min(b, l[j]); } return (a + b) / 2; };
  /* VWAP de 20 velas */ const pv = B.map(x => (x.h + x.l + x.c) / 3 * x.v), vsm = sma(B.map(x => x.v), 20), vw = sma(pv, 20).map((x, i) => x / (vsm[i] || 1));
  const S = {}; const put = (k, i, d) => { (S[k] = S[k] || []).push([i, d]); };
  for (let i = 210; i < n - 1; i++) { if (isNaN(A[i])) continue;
    if (r14[i - 1] < 30 && r14[i] >= 30) put('rsi', i, 1); if (r14[i - 1] > 70 && r14[i] <= 70) put('rsi', i, -1);
    if (st[i] !== st[i - 1] && st[i - 1]) put('supertrend', i, st[i]);
    if (e21[i - 1] <= e50[i - 1] && e21[i] > e50[i]) put('ema', i, 1); if (e21[i - 1] >= e50[i - 1] && e21[i] < e50[i]) put('ema', i, -1);
    if (mac[i - 1] <= msig[i - 1] && mac[i] > msig[i]) put('kon', i, 1); if (mac[i - 1] >= msig[i - 1] && mac[i] < msig[i]) put('kon', i, -1);
    if (adx[i] > 20 && pdi[i - 1] <= mdi[i - 1] && pdi[i] > mdi[i]) put('adx', i, 1); if (adx[i] > 20 && pdi[i - 1] >= mdi[i - 1] && pdi[i] < mdi[i]) put('adx', i, -1);
    const lo = s20[i] - 2 * d20[i], hi = s20[i] + 2 * d20[i], lo1 = s20[i - 1] - 2 * d20[i - 1], hi1 = s20[i - 1] + 2 * d20[i - 1];
    if (c[i - 1] < lo1 && c[i] > lo) put('bollinger', i, 1); if (c[i - 1] > hi1 && c[i] < hi) put('bollinger', i, -1);
    if (K[i - 1] <= Dd[i - 1] && K[i] > Dd[i] && K[i] < 20) put('stochrsi', i, 1); if (K[i - 1] >= Dd[i - 1] && K[i] < Dd[i] && K[i] > 80) put('stochrsi', i, -1);
    { const t = mid(i, 9), k = mid(i, 26), t1 = mid(i - 1, 9), k1 = mid(i - 1, 26), sa = (mid(i - 26, 9) + mid(i - 26, 26)) / 2, sb = mid(i - 26, 52), top = Math.max(sa, sb), bot = Math.min(sa, sb);
      if (t1 <= k1 && t > k && c[i] > top) put('ichimoku', i, 1); if (t1 >= k1 && t < k && c[i] < bot) put('ichimoku', i, -1); }
    if (c[i - 1] <= vw[i - 1] && c[i] > vw[i] && c[i] > e200[i]) put('vwap', i, 1); if (c[i - 1] >= vw[i - 1] && c[i] < vw[i] && c[i] < e200[i]) put('vwap', i, -1);
    { let hh = -Infinity, ll = Infinity; for (let j = i - 20; j < i; j++) { hh = Math.max(hh, h[j]); ll = Math.min(ll, l[j]); } if (c[i] > hh && c[i - 1] <= hh) put('trend', i, 1); if (c[i] < ll && c[i - 1] >= ll) put('trend', i, -1); }
    { /* canal: regresión lineal de 50 velas ± 2 desvíos; toque del borde y vuelta adentro */ const N = 50; let sx = 0, sy = 0, sxy = 0, sxx = 0; for (let j = 0; j < N; j++) { const y = c[i - N + 1 + j]; sx += j; sy += y; sxy += j * y; sxx += j * j; }
      const b = (N * sxy - sx * sy) / (N * sxx - sx * sx), a = (sy - b * sx) / N; let v = 0; for (let j = 0; j < N; j++) v += (c[i - N + 1 + j] - (a + b * j)) ** 2; const sdv = Math.sqrt(v / N), f = a + b * (N - 1);
      if (l[i] < f - 2 * sdv && c[i] > f - 2 * sdv) put('canal', i, 1); if (h[i] > f + 2 * sdv && c[i] < f + 2 * sdv) put('canal', i, -1); }
    { /* fibonacci: tendencia de 100 velas y rebote en el 61,8 % */ let hh = -Infinity, ll = Infinity, ih = 0, il = 0; for (let j = i - 100; j < i; j++) { if (h[j] > hh) { hh = h[j]; ih = j; } if (l[j] < ll) { ll = l[j]; il = j; } }
      if (il < ih) { const f = hh - .618 * (hh - ll); if (l[i] <= f && c[i] > f) put('fib', i, 1); } else { const f = ll + .618 * (hh - ll); if (h[i] >= f && c[i] < f) put('fib', i, -1); } }
    { /* smart money: vuelta a un FVG de las últimas 20 velas */ for (let j = i - 20; j < i - 2; j++) { if (l[j + 2] > h[j] && l[i] <= l[j + 2] && c[i] > h[j] && l[i - 1] > l[j + 2]) { put('smc', i, 1); break; } if (h[j + 2] < l[j] && h[i] >= h[j + 2] && c[i] < l[j] && h[i - 1] < h[j + 2]) { put('smc', i, -1); break; } } }
    { /* soporte fuerte: nivel tocado 3+ veces en 100 velas (± 0,5 ATR), rebote al tocarlo */ const tol = .5 * A[i]; const piv = []; for (let j = i - 100; j < i - 2; j++) { if (l[j] < l[j - 1] && l[j] < l[j + 1]) piv.push([l[j], 1]); if (h[j] > h[j - 1] && h[j] > h[j + 1]) piv.push([h[j], -1]); }
      for (const [p, t] of piv) { const q = piv.filter(x => Math.abs(x[0] - p) < tol).length; if (q < 3) continue; if (p < c[i - 1] && l[i] <= p + tol && c[i] > p) { put('sop', i, 1); break; } if (p > c[i - 1] && h[i] >= p - tol && c[i] < p) { put('sop', i, -1); break; } } }
    { /* divergencia de RSI (igual que en la investigación del indicador) */ let k = i - 34; for (let j = i - 34; j <= i - 5; j++) if (l[j] < l[k]) k = j; const lo5 = Math.min(...l.slice(i - 4, i + 1)), r5 = Math.min(...r14.slice(i - 4, i + 1));
      if (lo5 < l[k] && r5 > r14[k] + 3 && r5 < 40 && c[i] > c[i - 1]) put('div', i, 1); let m = i - 34; for (let j = i - 34; j <= i - 5; j++) if (h[j] > h[m]) m = j; const hi5 = Math.max(...h.slice(i - 4, i + 1)), r5h = Math.max(...r14.slice(i - 4, i + 1));
      if (hi5 > h[m] && r5h < r14[m] - 3 && r5h > 60 && c[i] < c[i - 1]) put('div', i, -1); }
    { /* CVD: compradores agresivos dominan 3 velas seguidas */ if (B[i].tb != null && i > 3) { const rr = j => B[j].v ? B[j].tb / B[j].v : .5; if (rr(i) > .55 && rr(i - 1) > .55 && rr(i - 2) > .55) put('cvd', i, 1); if (rr(i) < .45 && rr(i - 1) < .45 && rr(i - 2) < .45) put('cvd', i, -1); } }
  }
  return { S, A }; }

(async () => { const COINS = SYMS.slice(0, 15); const R = { nota: 'Acierto por indicador y temporalidad: toca +1,5 ATR antes que −1,5 ATR (30 velas). Al azar ~50 %. Largos y cortos juntos; sin repetir la misma señal 3 velas seguidas.', tf: {} };
  const TFS = [['15m', Date.UTC(2025, 5, 1)], ['1h', Date.UTC(2023, 0, 1)], ['4h', Date.UTC(2020, 0, 1)], ['12h', Date.UTC(2020, 0, 1)], ['1d', Date.UTC(2018, 0, 1)], ['1w', Date.UTC(2018, 0, 1)]];
  const tot = {};
  for (const [tf, t0] of TFS) { T0 = t0; for (const s of COINS) { const B = await kl2(s, tf); if (B.length < 300) continue; const { S, A } = sigs(B);
      for (const [k, L] of Object.entries(S)) { let last = -9; for (const [i, d] of L) { if (i - last < 3) continue; last = i; const o = out(B, A, i, d); if (o == null) continue; const e = ((tot[k] = tot[k] || {})[tf] = tot[k][tf] || [0, 0]); e[0] += o; e[1]++; } } }
    console.log(tf, 'listo'); }
  for (const [k, T] of Object.entries(tot)) R.tf[k] = Object.fromEntries(Object.entries(T).map(([tf, [w, n]]) => [tf, { acierto: +(100 * w / n).toFixed(1), n }]));
  fs.writeFileSync('investigacion-temporalidades.json', JSON.stringify(R, null, 1)); console.log(JSON.stringify(R)); })();
/* como kl pero guardando también el volumen comprador (para el CVD) */
async function kl2(s, tf) { const out = []; let t = T0; while (t < NOW) { const u = `https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=${tf}&startTime=${t}&limit=1000`;
    let j = null; for (let k = 0; k < 4 && !j; k++) { try { const r = await fetch(u); if (r.ok) j = await r.json(); } catch (e) {} if (!j) await sleep(2000); }
    if (!j || !j.length) break; for (const x of j) out.push({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4], v: +x[5], tb: +x[9] }); t = +j[j.length - 1][0] + 1; await sleep(60); } return out; }
