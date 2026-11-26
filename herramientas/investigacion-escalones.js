/* INVESTIGACIÓN · ESCALONES (noviembre 2026). Solo mide. */
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


/* ESCALONES (noviembre 2026): ¿hay niveles donde el precio FRENA más que en un nivel cualquiera a la misma distancia?
   En cada punto de muestra se arman niveles arriba y abajo con distintos métodos, solo con velas pasadas. Para cada nivel entre 0,5 y 6 ATR:
   - llegó: el precio lo tocó en las próximas 60 velas;
   - frenó: después de tocarlo, el precio volvió 1 ATR hacia atrás antes de pasarlo por 1 ATR.
   Se compara contra niveles al azar a la misma distancia (base). La diferencia "frenó - base" es la ventaja real del método. */
function pivotes(B, k) { const P = []; for (let j = k; j < B.length - k; j++) { let hi = true, lo = true; for (let q = 1; q <= k; q++) { if (B[j].h <= B[j - q].h || B[j].h <= B[j + q].h) hi = false; if (B[j].l >= B[j - q].l || B[j].l >= B[j + q].l) lo = false; } if (hi) P.push({ j, p: B[j].h, c: j + k }); if (lo) P.push({ j, p: B[j].l, c: j + k }); } return P; }
function redondo(p, a) { const paso0 = Math.max(a * 1.5, p * .002); const e = Math.pow(10, Math.floor(Math.log10(paso0))); for (const m of [1, 2, 2.5, 5, 10]) if (m * e >= paso0) return m * e; return 10 * e; }
function niveles(B, i, A, P, met) { const W = 300, c = B[i].c, a = A[i], L = [];
  if (met === 'pivotes' || met === 'combo') { const pv = P.filter(x => x.c <= i && x.j >= i - W); const used = new Array(pv.length).fill(false);
    for (let x = 0; x < pv.length; x++) { if (used[x]) continue; let s = 0, n = 0; for (let y = x; y < pv.length; y++) if (!used[y] && Math.abs(pv[y].p - pv[x].p) < .35 * a) { used[y] = true; s += pv[y].p; n++; } if (n >= 2) L.push({ p: s / n, w: n, f: 'pivotes' }); } }
  if (met === 'volumen' || met === 'combo') { let lo = Infinity, hi = -Infinity; for (let j = i - W; j <= i; j++) { lo = Math.min(lo, B[j].l); hi = Math.max(hi, B[j].h); } const bw = .3 * a, nb = Math.max(10, Math.min(400, Math.ceil((hi - lo) / bw))), H = new Array(nb).fill(0);
    for (let j = i - W; j <= i; j++) { const k = Math.min(nb - 1, Math.floor(((B[j].h + B[j].l + B[j].c) / 3 - lo) / (hi - lo) * nb)); H[k] += B[j].v * B[j].c; } const mx = Math.max(...H);
    for (let k = 2; k < nb - 2; k++) if (H[k] >= H[k - 1] && H[k] >= H[k + 1] && H[k] >= H[k - 2] && H[k] >= H[k + 2] && H[k] > .35 * mx) L.push({ p: lo + (k + .5) / nb * (hi - lo), w: H[k] / mx * 3, f: 'volumen' }); }
  if (met === 'redondos' || met === 'combo') { const st = redondo(c, a); for (let q = -6; q <= 6; q++) { const p = (Math.floor(c / st) + q) * st; if (p > 0) L.push({ p, w: 1, f: 'redondos' }); } }
  if (met === 'extremos' || met === 'combo') { for (const n of [20, 60, 120]) { let hh = -Infinity, ll = Infinity; for (let j = i - n; j < i; j++) { hh = Math.max(hh, B[j].h); ll = Math.min(ll, B[j].l); } L.push({ p: hh, w: 1.5, f: 'extremos' }, { p: ll, w: 1.5, f: 'extremos' }); } }
  if (met === 'combo') { /* se juntan los niveles cercanos y se suma su peso */ L.sort((x, y) => x.p - y.p); const out = []; for (const x of L) { const z = out[out.length - 1]; if (z && Math.abs(x.p - z.p) < .3 * a) { z.p = (z.p * z.w + x.p * x.w) / (z.w + x.w); z.w += x.w; z.n++; } else out.push({ p: x.p, w: x.w, n: 1 }); } return out.filter(x => x.n >= 2); }
  return L; }
function evaluar(B, i, A, lv, H) { const c = B[i].c, a = A[i], up = lv > c, d = up ? 1 : -1; let toco = -1;
  for (let j = i + 1; j <= Math.min(B.length - 1, i + H); j++) { const b = B[j];
    if (toco < 0) { if (up ? b.h >= lv : b.l <= lv) toco = j; else continue; }
    if (up ? b.h >= lv + a : b.l <= lv - a) return { llego: 1, freno: 0 }; if (up ? b.l <= lv - a : b.h >= lv + a) return { llego: 1, freno: 1 }; }
  return { llego: toco >= 0 ? 1 : 0, freno: null }; }
(async () => { const R = { nota: 'frenó = tras tocar el nivel volvió 1 ATR antes de pasarlo 1 ATR. base = niveles al azar a la misma distancia. ventaja = frenó - base (puntos).', tf: {} };
  const COINS = SYMS.slice(0, 20), METS = ['pivotes', 'volumen', 'redondos', 'extremos', 'combo'];
  for (const [tf, t0, paso] of [['1h', Date.UTC(2023, 0, 1), 12], ['4h', Date.UTC(2020, 0, 1), 4], ['1d', Date.UTC(2018, 0, 1), 1]]) { T0 = t0; const st = {}; let rnd = 12345; const rand = () => (rnd = (rnd * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const s of COINS) { const B = await kl(s, tf); if (B.length < 500) continue; const A = atr(B, 14), P = pivotes(B, 3);
      for (let i = 320; i < B.length - 61; i += paso) { const a = A[i], c = B[i].c; if (!(a > 0)) continue;
        for (const met of METS) { const L = niveles(B, i, A, P, met); for (const x of L) { const dist = Math.abs(x.p - c) / a; if (dist < .5 || dist > 6) continue;
            const e = evaluar(B, i, A, x.p, 60), z = Math.random() < 2 ? null : null; const k = met + (met === 'combo' ? (x.w >= 6 ? ' fuerte' : ' normal') : '');
            const o = st[k] = st[k] || { n: 0, llego: 0, fr: 0, frN: 0, bfr: 0, bfrN: 0, dist: 0 }; o.n++; o.dist += dist; o.llego += e.llego; if (e.freno != null) { o.fr += e.freno; o.frN++; }
            /* base: un nivel al azar a la misma distancia, del mismo lado */ const bl = c + Math.sign(x.p - c) * (dist + (rand() - .5) * .6) * a; const eb = evaluar(B, i, A, bl, 60); if (eb.freno != null) { o.bfr += eb.freno; o.bfrN++; } } } } }
    R.tf[tf] = Object.fromEntries(Object.entries(st).map(([k, o]) => [k, { niveles: o.n, dist_media_atr: +(o.dist / o.n).toFixed(2), llego: +(100 * o.llego / o.n).toFixed(1), freno: +(100 * o.fr / o.frN).toFixed(1), base: +(100 * o.bfr / o.bfrN).toFixed(1), ventaja: +(100 * o.fr / o.frN - 100 * o.bfr / o.bfrN).toFixed(1) }]));
    console.log(tf, JSON.stringify(R.tf[tf])); fs.writeFileSync('investigacion-escalones.json', JSON.stringify(R, null, 1)); } })();
