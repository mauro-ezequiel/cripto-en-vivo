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

/* condiciones, en sentido LONG (d = 1) o SHORT (d = −1: espejo) */
function feats(B, btc) { const c = B.map(x => x.c), v = B.map(x => x.v), n = B.length;
  const s200 = sma(c, 200), s50 = sma(c, 50), s20 = sma(c, 20), d20 = sd(c, 20, s20), r14 = rsi(c, 14), r2 = rsi(c, 2), r84 = rsi(c, 84), A = atr(B, 14);
  const lv = v.map(x => Math.log(1 + x)), vm = sma(lv, 50), vs = sd(lv, 50, vm);
  const bt = new Map(); if (btc) { const bc = btc.map(x => x.c), b200 = sma(bc, 200); btc.forEach((x, i) => bt.set(x.t, isNaN(b200[i]) ? 0 : x.c > b200[i] ? 1 : -1)); }
  const F = { L: [], S: [] };
  for (let i = 0; i < n; i++) { if (i < 220 || isNaN(A[i])) { F.L.push(null); F.S.push(null); continue; }
    const b = B[i], rg = b.h - b.l || 1e-12, z = (c[i] - s20[i]) / (d20[i] || 1e-12), vz = (lv[i] - vm[i]) / (vs[i] || 1e-12), br = bt.get(b.t) || 0;
    /* divergencia: mínimo de las últimas 5 velas por debajo del mínimo de las 30 anteriores, con RSI más alto */
    const lo5 = Math.min(...B.slice(i - 4, i + 1).map(x => x.l)), lo30i = (() => { let k = i - 34; for (let j = i - 34; j <= i - 5; j++) if (B[j].l < B[k].l) k = j; return k; })();
    const hi5 = Math.max(...B.slice(i - 4, i + 1).map(x => x.h)), hi30i = (() => { let k = i - 34; for (let j = i - 34; j <= i - 5; j++) if (B[j].h > B[k].h) k = j; return k; })();
    const r5lo = Math.min(...r14.slice(i - 4, i + 1)), r5hi = Math.max(...r14.slice(i - 4, i + 1));
    const dn3 = c[i] < c[i - 1] && c[i - 1] < c[i - 2] && c[i - 2] < c[i - 3], up3 = c[i] > c[i - 1] && c[i - 1] > c[i - 2] && c[i - 2] > c[i - 3];
    const hi20 = Math.max(...c.slice(i - 19, i + 1)), lo20 = Math.min(...c.slice(i - 19, i + 1));
    F.L.push({ tend: c[i] > s200[i], tendS: s200[i] > s200[i - 20], bajo200: c[i] < s200[i], s50: s50[i] > s200[i], r30: r14[i] < 30, r35: r14[i] < 35, r2: r2[i] < 5, bb: z < -2, z25: z < -2.5,
      vol: vz > 2, mecha: (Math.min(b.o, b.c) - b.l) / rg > .5, caidas3: dn3, btc: br > 0, div: lo5 < B[lo30i].l && r5lo > r14[lo30i] + 3 && r5lo < 40, rLento: r84[i] < 45, lejos: (hi20 - c[i]) / A[i] > 4 });
    F.S.push({ tend: c[i] < s200[i], tendS: s200[i] < s200[i - 20], bajo200: c[i] > s200[i], s50: s50[i] < s200[i], r30: r14[i] > 70, r35: r14[i] > 65, r2: r2[i] > 95, bb: z > 2, z25: z > 2.5,
      vol: vz > 2, mecha: (b.h - Math.max(b.o, b.c)) / rg > .5, caidas3: up3, btc: br < 0, div: hi5 > B[hi30i].h && r5hi < r14[hi30i] - 3 && r5hi > 60, rLento: r84[i] > 55, lejos: (c[i] - lo20) / A[i] > 4 }); }
  return { F, A }; }

/* resultado de entrar al cierre de la vela i en sentido d: 1 = objetivo primero, 0 = stop primero, null = ninguno en 30 velas */
function out(B, A, i, d, k = 1.5, H = 30) { const e = B[i].c, tp = e + d * k * A[i], sl = e - d * k * A[i];
  for (let j = i + 1; j <= Math.min(B.length - 1, i + H); j++) { const b = B[j], hitS = d > 0 ? b.l <= sl : b.h >= sl, hitT = d > 0 ? b.h >= tp : b.l <= tp; if (hitS) return 0; if (hitT) return 1; } return null; }
const ret = (B, i, d, H) => i + H < B.length ? d * (B[i + H].c / B[i].c - 1) - .001 : null;

(async () => {
  const R = { nota: 'Acierto = toca +1,5 ATR antes que −1,5 ATR (30 velas). Base = todas las velas en ese sentido. Entrenamiento 2020-2023, prueba 2024-2026.', tf: {} };
  const keys = ['tend','tendS','bajo200','s50','r30','r35','r2','bb','z25','vol','mecha','caidas3','btc','div','rLento','lejos'];
  const combos = []; for (let a = 0; a < keys.length; a++) { combos.push([keys[a]]); for (let b = a + 1; b < keys.length; b++) { combos.push([keys[a], keys[b]]); for (let c = b + 1; c < keys.length; c++) combos.push([keys[a], keys[b], keys[c]]); } }
  for (const tf of ['4h', '1d']) { const D = {}; for (const s of SYMS) { D[s] = await kl(s, tf); console.log(tf, s, D[s].length); }
    const btc = D.BTCUSDT; const st = {}; const base = { L: { tr: [0, 0], te: [0, 0] }, S: { tr: [0, 0], te: [0, 0] } };
    const add = (o, part, w, r) => { o[part][0] += w; o[part][1]++; if (r != null) { o[part + 'R'] = (o[part + 'R'] || 0) + r; o[part + 'N'] = (o[part + 'N'] || 0) + 1; } };
    for (const s of SYMS) { const B = D[s]; if (B.length < 400) continue; const { F, A } = feats(B, s === 'BTCUSDT' ? null : btc);
      for (const side of ['L', 'S']) { const d = side === 'L' ? 1 : -1; let last = {};
        for (let i = 220; i < B.length - 1; i++) { const f = F[side][i]; if (!f) continue; const o = out(B, A, i, d); if (o == null) continue; const part = B[i].t < SPLIT ? 'tr' : 'te', r = ret(B, i, d, tf === '4h' ? 12 : 5);
          if (s === 'BTCUSDT') f.btc = side === 'L' ? f.tend : f.tend; add(base[side], part, o, r);
          for (const cb of combos) { let ok = true; for (const k of cb) if (!f[k]) { ok = false; break; } if (!ok) continue; const key = side + ':' + cb.join('+');
            if (last[key] != null && i - last[key] < 6) continue; last[key] = i; /* sin repetir la misma señal 6 velas seguidas */
            st[key] = st[key] || { tr: [0, 0], te: [0, 0], coins: new Set() }; add(st[key], part, o, r); st[key].coins.add(s); } } } }
    const pct = x => x[1] ? +(100 * x[0] / x[1]).toFixed(1) : null;
    const rows = Object.entries(st).map(([k, o]) => ({ k, trN: o.tr[1], tr: pct(o.tr), teN: o.te[1], te: pct(o.te), trRet: o.trN ? +(100 * o.trR / o.trN).toFixed(2) : null, teRet: o.teN ? +(100 * o.teR / o.teN).toFixed(2) : null, monedas: o.coins.size }));
    const minN = tf === '4h' ? 300 : 80;
    const sel = rows.filter(r => r.trN >= minN && r.monedas >= 10).sort((a, b) => b.tr - a.tr).slice(0, 40);
    R.tf[tf] = { base: { L: { tr: pct(base.L.tr), te: pct(base.L.te), teN: base.L.te[1] }, S: { tr: pct(base.S.tr), te: pct(base.S.te), teN: base.S.te[1] } },
      mejores_en_entrenamiento: sel, mejores_en_prueba_con_n: rows.filter(r => r.teN >= minN / 2 && r.trN >= minN).sort((a, b) => b.te - a.te).slice(0, 25),
      simples: rows.filter(r => !r.k.includes('+')).sort((a, b) => b.te - a.te) };
    fs.writeFileSync('investigacion-indicador.json', JSON.stringify(R, null, 1)); }
  console.log('listo');
})();
