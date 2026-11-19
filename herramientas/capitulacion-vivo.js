/* CAPITULACIÓN EN VIVO (noviembre 2026). El 73 % del indicador salió de una búsqueda entre ~700 combinaciones con datos de 2020-2026:
   puede estar inflado por suerte. Para saber cuánto acierta DE VERDAD, cada día se anotan las señales nuevas (solo hacia adelante,
   desde el 17/11/2026, sin rellenar el pasado) y se sigue cada una hasta que toca el objetivo (+1,5 ATR) o el stop (−1,5 ATR), o 30 días.
   Guarda capitulacion.json en la rama "datos"; la página muestra el marcador real al lado del 73 % de las pruebas. */
const fs = require('fs');
const DESDE = '2026-11-17'; /* la búsqueda corrió el 17/11 a la mañana: la vela diaria del 17 cerró después, así que ya es fuera de la muestra */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function j(u) { for (let k = 0; k < 4; k++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch (e) {} await sleep(1500); } return null; }
function rsi(c, n) { const o = []; let g = 0, l = 0; for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0); if (i <= n) { g += u / n; l += w / n; } else { g = (g * (n - 1) + u) / n; l = (l * (n - 1) + w) / n; } o[i] = i >= n ? (l ? 100 - 100 / (1 + g / l) : 100) : null; } return o; }
(async () => {
  let D = { desde: DESDE, senales: [] }; try { D = JSON.parse(fs.readFileSync('prev-cap.json', 'utf8')); } catch (e) {}
  const t24 = await j('https://data-api.binance.vision/api/v3/ticker/24hr') || [];
  const ST = /^(USDC|FDUSD|TUSD|USDP|DAI|EUR|BUSD|USD1|XUSD|PAXG|AEUR|USDE|BFUSD|RLUSD)USDT$/;
  const syms = t24.filter(x => /USDT$/.test(x.symbol) && !ST.test(x.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(x.symbol) && +x.quoteVolume > 5e6).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 120).map(x => x.symbol);
  const ya = new Set(D.senales.map(s => s.s + '|' + s.d));
  for (const s of syms) { const k = await j(`https://data-api.binance.vision/api/v3/klines?symbol=${s}&interval=1d&limit=150`); if (!k || k.length < 60) continue; await sleep(80);
    const B = k.map(x => ({ t: +x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] })).slice(0, -1); /* sin la vela de hoy (abierta) */ const n = B.length, c = B.map(b => b.c), R = rsi(c, 14);
    const A = []; { let a = 0; for (let i = 1; i < n; i++) { const tr = Math.max(B[i].h - B[i].l, Math.abs(B[i].h - B[i - 1].c), Math.abs(B[i].l - B[i - 1].c)); a = i <= 14 ? a + tr / 14 : (a * 13 + tr) / 14; A[i] = i >= 14 ? a : null; } }
    for (let i = Math.max(20, n - 3); i < n; i++) { const d = new Date(B[i].t).toISOString().slice(0, 10); if (d < DESDE || ya.has(s + '|' + d)) continue;
      let m = 0; for (let q = i - 19; q <= i; q++) m += c[q]; m /= 20; let v = 0; for (let q = i - 19; q <= i; q++) v += (c[q] - m) ** 2; const sd = Math.sqrt(v / 20) || 1e-12, rg = (B[i].h - B[i].l) || 1e-12, wk = (Math.min(B[i].o, B[i].c) - B[i].l) / rg;
      if (R[i] != null && R[i] < 30 && (c[i] - m) / sd < -1.5 && wk >= .6 && A[i]) { D.senales.push({ s, d, e: c[i], atr: A[i], tp: c[i] + 1.5 * A[i], sl: c[i] - 1.5 * A[i], st: 'abierta' }); ya.add(s + '|' + d); } }
    /* seguir las abiertas de esta moneda */
    for (const x of D.senales) { if (x.s !== s || x.st !== 'abierta') continue; const i0 = B.findIndex(b => new Date(b.t).toISOString().slice(0, 10) === x.d); if (i0 < 0) continue;
      for (let i = i0 + 1; i < n; i++) { const b = B[i]; if (b.l <= x.sl) { x.st = 'perdida'; x.fin = new Date(b.t).toISOString().slice(0, 10); break; } if (b.h >= x.tp) { x.st = 'ganada'; x.fin = new Date(b.t).toISOString().slice(0, 10); break; }
        if (i - i0 >= 30) { x.st = 'vencida'; x.fin = new Date(b.t).toISOString().slice(0, 10); x.ret = +((b.c / x.e - 1) * 100).toFixed(2); break; } } } }
  const g = D.senales.filter(x => x.st === 'ganada').length, p = D.senales.filter(x => x.st === 'perdida').length;
  D.resumen = { total: D.senales.length, ganadas: g, perdidas: p, vencidas: D.senales.filter(x => x.st === 'vencida').length, abiertas: D.senales.filter(x => x.st === 'abierta').length, acierto: g + p ? +(100 * g / (g + p)).toFixed(1) : null, t: Date.now() };
  fs.writeFileSync('capitulacion.json', JSON.stringify(D)); console.log(JSON.stringify(D.resumen), D.senales.slice(-10));
})();
