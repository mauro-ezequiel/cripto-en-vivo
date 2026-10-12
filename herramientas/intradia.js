/* ACCIONES · velas de 30 minutos y planilla de RSI (corre en GitHub Actions cada 30 min con el mercado abierto).
   data912 solo tiene velas diarias, y el navegador no puede leer Yahoo directo (no permite CORS), así que esto baja de Yahoo las velas de
   30 min de los últimos 60 días de cada acción de la planilla y las publica en la rama "intradia" (la página las lee de ahí y les suma el
   precio en vivo). También calcula el RSI 14 diario (con lo necesario para que la página lo actualice en vivo) y el RSI 14 de 1 hora.
   Uso: node herramientas/intradia.js [carpeta-anterior] → escribe out/c/<ACCION>.json y out/rsi.json */
const fs = require('fs'), path = require('path');
const PREV = process.argv[2] || 'prev', OUT = 'out', SEC = JSON.parse(fs.readFileSync(path.join(__dirname, 'sectores.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms)), yh = s => s.replace('.', '-');
const LIST = [...new Set(Object.entries(SEC).filter(([k]) => !k.startsWith('_')).flatMap(([, v]) => v))];
async function yahoo(sym, interval, range) { const u = `https://query1.finance.yahoo.com/v8/finance/chart/${yh(sym)}?interval=${interval}&range=${range}&includePrePost=false`;
  for (let k = 0; k < 4; k++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (r.status === 404) return null;
      if (r.ok) { const j = await r.json(), x = j && j.chart && j.chart.result && j.chart.result[0]; if (!x || !x.timestamp) return null; const q = x.indicators.quote[0], o = { t: [], o: [], h: [], l: [], c: [], v: [] };
        x.timestamp.forEach((t, i) => { if (q.close[i] == null || q.open[i] == null) return; o.t.push(t); o.o.push(+q.open[i].toPrecision(6)); o.h.push(+q.high[i].toPrecision(6)); o.l.push(+q.low[i].toPrecision(6)); o.c.push(+q.close[i].toPrecision(6)); o.v.push(q.volume[i] || 0); });
        return o; } } catch (e) {} await sleep(2500 * (k + 1)); } return null; }
/* RSI de Wilder: devuelve el RSI y el estado (promedio de subas y bajas) para seguir calculándolo en vivo con el precio actual */
function rsiState(c, p = 14) { if (c.length < p + 2) return null; let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; g += Math.max(d, 0); l += Math.max(-d, 0); } g /= p; l /= p;
  for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; g = (g * (p - 1) + Math.max(d, 0)) / p; l = (l * (p - 1) + Math.max(-d, 0)) / p; }
  return { rsi: l === 0 ? 100 : 100 - 100 / (1 + g / l), g, l }; }
const r2 = v => v == null || !isFinite(v) ? null : +v.toFixed(2);
(async () => { fs.mkdirSync(path.join(OUT, 'c'), { recursive: true });
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(path.join(PREV, 'rsi.json'), 'utf8')); } catch (e) {}
  const today = new Date().toISOString().slice(0, 10), needDaily = !prev.dia || prev.dia !== today || process.env.DIARIO;
  const D = {}, ok = [], fail = []; let q = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (q < LIST.length) { const s = LIST[q++];
    const m = await yahoo(s, '30m', '60d'); let row = (prev.d || {})[s] || null;
    if (m && m.c.length > 20) { fs.writeFileSync(path.join(OUT, 'c', s + '.json'), JSON.stringify({ s, upd: Date.now(), ...m })); ok.push(s);
      /* RSI de 1 h con las velas de 30 min agrupadas por hora */
      const hc = []; let hk = null; m.t.forEach((t, i) => { const k = Math.floor(t / 3600); if (k !== hk) { hc.push(m.c[i]); hk = k; } else hc[hc.length - 1] = m.c[i]; });
      const h1 = rsiState(hc); row = row || []; row[4] = h1 ? r2(h1.rsi) : null; row[6] = m.c[m.c.length - 1]; }
    else { fail.push(s); const p = path.join(PREV, 'c', s + '.json'); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(OUT, 'c', s + '.json')); }
    if (needDaily) { const d = await yahoo(s, '1d', '1y'); if (d && d.c.length > 30) { const tz = new Date(d.t[d.t.length - 1] * 1000).toISOString().slice(0, 10), cl = tz === today ? d.c.slice(0, -1) : d.c; // sin la vela de hoy (la completa el precio en vivo)
        const st = rsiState(cl); if (st) { row = row || []; row[0] = r2(st.rsi); row[1] = +st.g.toPrecision(6); row[2] = +st.l.toPrecision(6); row[3] = cl[cl.length - 1]; row[5] = cl.length > 1 ? r2((cl[cl.length - 1] / cl[cl.length - 2] - 1) * 100) : null; } } }
    if (row) D[s] = row; await sleep(150); } }));
  /* d[ACCION] = [RSI diario al cierre anterior, promedio de subas, promedio de bajas, cierre anterior, RSI 1 h, cambio del día anterior %, último precio de 30 min] */
  const out = { upd: Date.now(), dia: needDaily ? today : prev.dia, cols: ['rsi_d', 'g', 'l', 'cierre', 'rsi_1h', 'cambio_ant', 'ultimo'], sectores: Object.fromEntries(Object.entries(SEC).filter(([k]) => !k.startsWith('_'))), d: D };
  fs.writeFileSync(path.join(OUT, 'rsi.json'), JSON.stringify(out));
  console.log('velas', ok.length, 'sin datos', fail.length, fail.slice(0, 30).join(' '), 'diario', needDaily); })();
