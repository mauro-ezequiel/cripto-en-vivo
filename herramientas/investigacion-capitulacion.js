/* INVESTIGACIÓN · INDICADOR NUEVO (noviembre 2026). No cambia la página ni los bots: solo mide.
   Pregunta: ¿qué combinación de condiciones (de 1 a 3) acierta más seguido la dirección del próximo movimiento?
   Datos: 30 criptos, velas de 4 h y de 1 día de Binance desde 2020. Cada condición se calcula SOLO con velas pasadas.
   "Acierto" = el precio toca primero el objetivo (+1,5 ATR a favor) antes que el stop (−1,5 ATR en contra), dentro de 30 velas.
   Con objetivo y stop iguales, tirar una moneda da 50 %: lo que importa es cuánto se pasa del 50 % y si se sostiene fuera de la muestra.
   Se elige con 2020-2023 (entrenamiento) y se verifica con 2024-2026 (prueba, datos que la selección nunca vio). */
const fs = require('fs');
const SYMS = ['BTC','ETH','SOL','XRP','BNB','DOGE','ADA','LINK','AVAX','LTC','DOT','TRX','BCH','NEAR','UNI','ATOM','APT','ARB','OP','SUI','FIL','INJ','AAVE','ETC','XLM','HBAR','TIA','SEI','WLD','PEPE'].map(s => s + 'USDT');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T0 = Date.UTC(2020, 0, 1), SPLIT = Date.UTC(2024, 0, 1), NOW = Date.now();
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
const ret = (B, i, d, H) => i + H < B.length ? d * (B[i + H].c / B[i].c - 1) - .001 : null;


/* Refinamiento del ganador de la primera búsqueda (vela diaria: RSI bajo + mecha inferior larga = "capitulación").
   Variantes de umbrales, año por año, y también en 12 h. Mismo acierto: +1,5 ATR antes que −1,5 ATR en 30 velas. */
(async () => { const R = { nota: 'Variantes del indicador Capitulación. Acierto con objetivo y stop iguales (1,5 ATR); base = cualquier vela.', tf: {} };
  for (const tf of ['1d', '12h']) { const D = {}; for (const s of SYMS) D[s] = await kl(s, tf);
    const V = []; for (const r of [25, 30, 35]) for (const w of [.4, .5, .6]) for (const z of [null, -1.5, -2]) for (const vol of [0, 1]) V.push({ r, w, z, vol });
    const st = {}, base = {};
    for (const s of SYMS) { const B = D[s]; if (B.length < 300) continue; const c = B.map(x => x.c), r14 = rsi(c, 14), s20 = sma(c, 20), d20 = sd(c, 20, s20), A = atr(B, 14), lv = B.map(x => Math.log(1 + x.v)), vm = sma(lv, 50), vs = sd(lv, 50, vm);
      const last = {};
      for (let i = 60; i < B.length - 1; i++) { if (isNaN(A[i]) || isNaN(d20[i])) continue; const o = out(B, A, i, 1); if (o == null) continue; const y = new Date(B[i].t).getUTCFullYear();
        base[y] = base[y] || [0, 0]; base[y][0] += o; base[y][1]++; const b = B[i], rg = b.h - b.l || 1e-12, wk = (Math.min(b.o, b.c) - b.l) / rg, zz = (c[i] - s20[i]) / (d20[i] || 1e-12), vz = (lv[i] - vm[i]) / (vs[i] || 1e-12), r5 = i + 5 < B.length ? B[i + 5].c / c[i] - 1 - .001 : null;
        for (const v of V) { if (!(r14[i] < v.r && wk >= v.w && (v.z == null || zz < v.z) && (!v.vol || vz > 1))) continue; const k = `RSI<${v.r} mecha≥${v.w}${v.z != null ? ' z<' + v.z : ''}${v.vol ? ' +volumen' : ''}`;
          if (last[k] != null && i - last[k] < 3) continue; last[k] = i; const e = st[k] = st[k] || { w: 0, n: 0, r: 0, rn: 0, y: {} }; e.w += o; e.n++; if (r5 != null) { e.r += r5; e.rn++; } e.y[y] = e.y[y] || [0, 0]; e.y[y][0] += o; e.y[y][1]++; } } }
    const pc = x => +(100 * x[0] / x[1]).toFixed(1);
    R.tf[tf] = { base: Object.fromEntries(Object.entries(base).map(([y, x]) => [y, pc(x)])), variantes: Object.entries(st).map(([k, e]) => ({ k, n: e.n, acierto: pc([e.w, e.n]), ret5: +(100 * e.r / e.rn).toFixed(2), por_anio: Object.fromEntries(Object.entries(e.y).map(([y, x]) => [y, pc(x) + ' (' + x[1] + ')'])), peor_anio: Math.min(...Object.values(e.y).filter(x => x[1] >= 15).map(pc)) })).filter(x => x.n >= 60).sort((a, b) => b.peor_anio - a.peor_anio) };
    fs.writeFileSync('investigacion-capitulacion.json', JSON.stringify(R, null, 1)); }
  console.log('listo'); })();
