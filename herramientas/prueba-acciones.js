/* Prueba de la señal de ACCIONES (c-reb: rebote tras una caída fuerte de 6 meses) en NYSE y en NASDAQ, con la misma regla y gestión
   que la página: vela fuerte (cuerpo > 50 %), caída de 6 meses de 10 % o más, a menos de 35 % del máximo del año y a menos del doble
   del mínimo; stop 3 × ATR diario (tope 9,6 %), objetivos 0,5 / 1 / 1,5 × stop, 1/3 en cada objetivo, stop a la entrada tras el
   objetivo 1, plazo 30 ruedas, × 8, comisión 0,1 %, una señal por acción cada 15 días. Además dice qué acciones de la lista tienen datos.
   Uso: node herramientas/prueba-acciones.js  →  escribe prueba-acciones.json */
const fs = require('fs');
const D912 = 'https://data912.com', FEE = .001, L = 8, YEARS = +(process.env.BT_YEARS || 6);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ST = {}; const GAP = +(process.env.GAP || 0);
async function getJs(url) { for (let k = 0; k < 5; k++) { try { if (GAP) await sleep(GAP); const r = await fetch(url); ST[r.status] = (ST[r.status] || 0) + 1; if (r.ok) return await r.json(); if (r.status === 404) return null; } catch (e) { ST.err = (ST.err || 0) + 1; } await sleep(1500 * (k + 1)); } return null; }
const setOf = (html, name) => { const m = html.match(new RegExp('const ' + name + '=new Set\\(\\[([^\\]]+)\\]\\)')); return m ? m[1].match(/'([^']+)'/g).map(x => x.slice(1, -1)) : []; };
function wilder(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { s /= p; o[i] = s; } } else { s = (s * (p - 1) + v[i]) / p; o[i] = s; } } return o; }
async function bars(sym) {
  const [u, ce] = await Promise.all([getJs(`${D912}/historical/usa_stocks/${sym}`), getJs(`${D912}/historical/cedears/${sym}`)]);
  if (!u || !Array.isArray(u.dates) || !u.dates.length) return { err: 'sin historial en dólares' };
  const cm = new Map(), vs = []; if (Array.isArray(ce)) for (const r of ce) if (r && r.c > 0) { cm.set(r.date, r); vs.push(+r.v || 0); }
  if (cm.size <= 30) return { err: 'sin historial del CEDEAR' };
  vs.sort((a, b) => a - b); const vMed = vs.length ? (vs[vs.length >> 1] || 1) : 1, b = []; let pc = null;
  for (let i = 0; i < u.dates.length; i++) { const date = u.dates[i], c = +u.prices[i]; if (!(c > 0)) continue; const t = Date.parse(date + 'T00:00:00Z'), r = cm.get(date); let o, hh, l, v;
    if (r) { const k = c / r.c; o = r.o * k; hh = Math.max(r.h * k, c, o); l = Math.min(r.l * k, c, o); v = +r.v || vMed; } else { o = pc ?? c; hh = Math.max(o, c); l = Math.min(o, c); v = vMed; }
    b.push({ t, open: o, high: hh, low: l, close: c }); pc = c; }
  return { b }; }
function test(b) { const n = b.length, tr = b.map((x, i) => i ? Math.max(x.high - x.low, Math.abs(x.high - b[i - 1].close), Math.abs(x.low - b[i - 1].close)) : x.high - x.low), atr = wilder(tr, 14);
  const FROM = Date.now() - YEARS * 365 * 864e5, out = []; let free = 0;
  for (let i = 210; i < n - 1; i++) { const x = b[i]; if (x.t < FROM || x.t < free || !atr[i]) continue;
    const body = (x.close - x.open) / ((x.high - x.low) || 1); if (!(body > .5)) continue;
    let h = 0, l = 1e18; for (let j = Math.max(0, i - 251); j <= i; j++) { h = Math.max(h, b[j].high); l = Math.min(l, b[j].low); }
    const c = x.close, r6 = i >= 120 ? (c / b[i - 120].close - 1) * 100 : null, fromHi = (c / h - 1) * 100, fromLo = (c / l - 1) * 100;
    if (!(r6 != null && r6 <= -10 && fromHi > -35 && fromLo < 100)) continue;
    const sl = Math.min(.096, Math.max(.004, 3 * atr[i] / c)), tps = [1, 2, 3].map(k => c * (1 + k * .5 * sl)), fail = c * (1 - sl);
    let hit = 0, real = 0, pnl = null, j = i + 1;
    for (; j < n && j <= i + 30; j++) { const y = b[j], stop = hit ? c : fail;
      if (y.low <= stop) { pnl = real + (1 - hit / 3) * (stop / c - 1); break; }
      while (hit < 3 && y.high >= tps[hit]) { real += (tps[hit] / c - 1) / 3; hit++; }
      if (hit >= 3) { pnl = real; break; } }
    if (pnl == null) { if (j >= n) continue; pnl = real + (1 - hit / 3) * (b[Math.min(j, n - 1)].close / c - 1); }
    out.push({ t: x.t, hit, pct: 100 * L * (Math.max(-sl, pnl) - 2 * FEE) }); free = b[Math.min(j, n - 1)].t + 15 * 864e5; }
  return out; }
const sum = L => { const n = L.length; return n ? { n, obj1: +(L.filter(x => x.hit >= 1).length / n * 100).toFixed(1), obj3: +(L.filter(x => x.hit >= 3).length / n * 100).toFixed(1), pct: +(L.reduce((a, x) => a + x.pct, 0) / n).toFixed(2), usd500: +(L.reduce((a, x) => a + x.pct, 0) / n * 5).toFixed(1) } : { n: 0 }; };
(async () => { if (process.env.DUMP) { for (const sym of process.env.DUMP.split(',')) { for (const u of [`${D912}/historical/cedears/${sym}`, `${D912}/historical/usa_stocks/${sym}`]) { const r = await fetch(u); const t = await r.text(); console.log('DUMP', u, r.status, t.length, t.slice(0, 300).replace(/\s+/g, ' '), '…', t.slice(-200).replace(/\s+/g, ' ')); } }
    const c = await (await fetch(`${D912}/live/arg_cedears`)).json(); console.log('DUMP live cedears', JSON.stringify(c.filter(x => process.env.DUMP.split(',').some(s => x.symbol.startsWith(s))).slice(0, 12)));
    fs.writeFileSync('prueba-acciones.json', '{}'); return; }
  const html = fs.readFileSync('index.html', 'utf8'), lists = { NYSE: setOf(html, 'NYSE'), NASDAQ: setOf(html, 'NASDAQ') };
  const live = await getJs(`${D912}/live/usa_stocks`), ced = await getJs(`${D912}/live/arg_cedears`);
  const liveSet = new Set((live || []).map(x => x.symbol)), cedSet = new Set((ced || []).filter(x => x.v > 0).map(x => x.symbol));
  const R = { fecha: new Date().toISOString(), anios: YEARS, en_vivo: liveSet.size, cedears: cedSet.size, por_bolsa: {}, faltan: {}, extra_con_cedear: [...cedSet].filter(s => liveSet.has(s) && !lists.NYSE.includes(s) && !lists.NASDAQ.includes(s)).sort() };
  for (const [ex, list] of Object.entries(lists)) { const all = [], miss = [], per = {}; let q = 0;
    await Promise.all(Array.from({ length: +(process.env.CONC || 4) }, async () => { while (q < list.length) { const s = list[q++]; if (!liveSet.has(s)) { miss.push(s + ' (no está en vivo)'); continue; }
      const r = await bars(s); if (r.err) { miss.push(s + ' (' + r.err + ')'); continue; } const ops = test(r.b); per[s] = sum(ops); all.push(...ops); } }));
    const yr = {}; for (const o of all) { const y = new Date(o.t).getUTCFullYear(); (yr[y] = yr[y] || []).push(o); }
    const last = all.filter(o => o.t >= Date.now() - 365 * 864e5);
    R.por_bolsa[ex] = { acciones: list.length, con_datos: Object.keys(per).length, total: sum(all), ultimo_anio: sum(last), por_anio: Object.fromEntries(Object.entries(yr).map(([y, L]) => [y, sum(L)])), por_accion: per };
    R.faltan[ex] = miss.sort(); console.log(ex, JSON.stringify(R.por_bolsa[ex].total), 'último año', JSON.stringify(R.por_bolsa[ex].ultimo_anio), 'faltan', miss.length); }
  console.log('con CEDEAR y en vivo pero fuera de las listas:', R.extra_con_cedear.join(' '));
  R.http = ST; console.log('respuestas', JSON.stringify(ST));
  fs.writeFileSync('prueba-acciones.json', JSON.stringify(R, null, 1)); })();
