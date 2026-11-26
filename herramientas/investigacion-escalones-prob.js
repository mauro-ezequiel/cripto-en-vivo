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



/* ESCALONES DE PROBABILIDAD (noviembre 2026). Para cada vela pasada se mide cuánto subió como máximo (y bajó) en las próximas H velas,
   en múltiplos del ATR. Con eso se arman escalones: el nivel al que se llegó el 80, 65, 50, 35 y 20 % de las veces.
   La pregunta: ¿se cumplen esas probabilidades en datos que no se usaron para calcularlos? Se calcula con el 70 % más viejo de cada
   moneda y se prueba en el 30 % más nuevo. Error = cuánto se aleja lo que pasó de lo prometido (en puntos). */
const PROB = [80, 65, 50, 35, 20];
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; };
(async () => { const R = { nota: 'Escalones de probabilidad: prometido vs cumplido en el 30 % más nuevo (fuera de la muestra).', tf: {} };
  const COINS = SYMS.slice(0, 20);
  for (const [tf, t0] of [['15m', Date.UTC(2025, 6, 1)], ['1h', Date.UTC(2023, 0, 1)], ['4h', Date.UTC(2020, 0, 1)], ['1d', Date.UTC(2018, 0, 1)]]) { T0 = t0;
    for (const H of [12, 30]) { const tot = { up: PROB.map(() => [0, 0]), dn: PROB.map(() => [0, 0]) };
      for (const s of COINS) { const B = await kl(s, tf); if (B.length < 800) continue; const A = atr(B, 14), U = [], D = [], I = [];
        for (let i = 20; i < B.length - H; i++) { if (!(A[i] > 0)) continue; let hh = -Infinity, ll = Infinity; for (let j = i + 1; j <= i + H; j++) { hh = Math.max(hh, B[j].h); ll = Math.min(ll, B[j].l); } U.push((hh - B[i].c) / A[i]); D.push((B[i].c - ll) / A[i]); I.push(i); }
        const cut = Math.floor(U.length * .7), qU = PROB.map(p => q(U.slice(0, cut), 1 - p / 100)), qD = PROB.map(p => q(D.slice(0, cut), 1 - p / 100));
        for (let k = cut; k < U.length; k += 3) PROB.forEach((p, z) => { tot.up[z][0] += U[k] >= qU[z] ? 1 : 0; tot.up[z][1]++; tot.dn[z][0] += D[k] >= qD[z] ? 1 : 0; tot.dn[z][1]++; });
        (R.ejemplo = R.ejemplo || {})[s + ' ' + tf + ' H' + H] = { arriba_atr: qU.map(x => +x.toFixed(2)), abajo_atr: qD.map(x => +x.toFixed(2)) }; }
      const c = side => PROB.map((p, z) => +(100 * tot[side][z][0] / tot[side][z][1]).toFixed(1));
      const ar = c('up'), ab = c('dn'), err = +(PROB.reduce((a, p, z) => a + Math.abs(ar[z] - p) + Math.abs(ab[z] - p), 0) / (2 * PROB.length)).toFixed(1);
      R.tf[tf + ' · ' + H + ' velas'] = { prometido: PROB, cumplido_arriba: ar, cumplido_abajo: ab, error_medio: err };
      console.log(tf, H, JSON.stringify(R.tf[tf + ' · ' + H + ' velas'])); fs.writeFileSync('investigacion-escalones-prob.json', JSON.stringify(R, null, 1)); } } })();
