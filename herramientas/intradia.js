/* ACCIONES · velas intradiarias y planilla de RSI (corre en GitHub Actions cada 30 min con el mercado abierto).
   data912 solo tiene velas diarias, y el navegador no puede leer Yahoo directo (no permite CORS), así que esto baja de Yahoo las velas de
   15 min de los últimos 60 días de cada acción de la planilla (de ahí se arman las de 1 h, 2 h y 4 h). Además guarda las velas diarias completas de 2 años (para las señales de ACCIONES). Publica en la rama "intradia", comprimido (la página las lee de ahí y
   les suma el precio en vivo). También calcula el RSI 14 diario (con lo necesario para seguirlo en vivo) y el RSI 14 de 1 hora.
   Uso: node herramientas/intradia.js [carpeta-anterior] → escribe out/c/<ACCION>.json.gz y out/rsi.json */
const fs = require('fs'), path = require('path');
const PREV = process.argv[2] || 'prev', OUT = 'out', SEC = JSON.parse(fs.readFileSync(path.join(__dirname, 'sectores.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms)), yh = s => s.replace('.', '-');
const zlib = require('zlib'), MAIN = new Set(Object.entries(SEC).filter(([k]) => !k.startsWith('_')).flatMap(([, v]) => v.slice(0, 8)));
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
/* hora de Nueva York de una vela (Yahoo da segundos UTC): fecha, minutos desde la apertura (9:30) */
const NYF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
function ny(t) { const p = Object.fromEntries(NYF.formatToParts(new Date(t * 1000)).map(x => [x.type, x.value])); return { d: `${p.year}-${p.month}-${p.day}`, m: (+p.hour % 24) * 60 + +p.minute - 570 }; }
/* cierres agrupados en velas de h horas. 1, 2 y 4 h: desde la apertura de cada día (como TradingView; la última del día es más corta).
   8 y 12 h: horas de mercado seguidas (6,5 h por día), contadas desde una fecha fija, así las velas no cambian de una corrida a otra */
const D0 = Date.UTC(2020, 0, 6) / 864e5; // lunes
function velasH(m, h) { const out = []; let key = null;
  m.t.forEach((t, i) => { const x = ny(t); if (x.m < 0 || x.m >= 390) return; let k;
    if (h <= 4) k = x.d + '#' + Math.floor(x.m / (h * 60));
    else { const dd = Date.parse(x.d + 'T00:00:00Z') / 864e5 - D0, wd = Math.floor(dd / 7) * 5 + Math.min(dd % 7, 5), idx = wd * 26 + Math.floor(x.m / 15); k = Math.floor(idx / (h * 4)); }
    if (k !== key) { out.push(m.c[i]); key = k; } else out[out.length - 1] = m.c[i]; });
  return out; }
/* semanal: cierres de cada semana (lunes a viernes) con las velas diarias; la semana en curso queda afuera y la completa el precio en vivo */
function semanas(d1) { const out = []; let key = null; d1.t.forEach((t, i) => { const k = Math.floor((t / 86400 + 3) / 7); if (k !== key) { out.push({ k, c: d1.c[i] }); key = k; } else out[out.length - 1].c = d1.c[i]; }); return out; }
(async () => { fs.mkdirSync(path.join(OUT, 'c'), { recursive: true });
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(path.join(PREV, 'rsi.json'), 'utf8')); } catch (e) {}
  const today = new Date().toISOString().slice(0, 10), needDaily = !prev.dia || prev.dia !== today || process.env.DIARIO;
  const D = {}, X = {}, ok = [], fail = []; let q = 0;
  await Promise.all(Array.from({ length: 4 }, async () => { while (q < LIST.length) { const s = LIST[q++];
    const m = await yahoo(s, '15m', '60d'); let row = (prev.d || {})[s] || null, old = null;
    try { const p = path.join(PREV, 'c', s + '.json.gz'); if (fs.existsSync(p)) old = JSON.parse(zlib.gunzipSync(fs.readFileSync(p))); } catch (e) {}
    /* velas diarias completas de 2 años (para las señales de ACCIONES): una vez por día; el resto de las corridas usa las de antes */
    let d1 = old && old.d1 && !needDaily ? old.d1 : null;
    if (!d1) { const d = await yahoo(s, '1d', '2y'); if (d && d.c.length > 30) d1 = d; else if (old && old.d1) d1 = old.d1; }
    if (needDaily && d1) { const tz = new Date(d1.t[d1.t.length - 1] * 1000).toISOString().slice(0, 10), cl = tz === today ? d1.c.slice(0, -1) : d1.c; // sin la vela de hoy (la completa el precio en vivo)
      const st = rsiState(cl); if (st) { row = row || []; row[0] = r2(st.rsi); row[1] = +st.g.toPrecision(6); row[2] = +st.l.toPrecision(6); row[3] = cl[cl.length - 1]; row[5] = cl.length > 1 ? r2((cl[cl.length - 1] / cl[cl.length - 2] - 1) * 100) : null; } }
    const m15 = m && m.c.length > 20 ? m : old && old.m15;
    if (m15 || d1) { fs.writeFileSync(path.join(OUT, 'c', s + '.json.gz'), zlib.gzipSync(JSON.stringify({ s, upd: Date.now(), m15, d1 }), { level: 9 })); (m && m.c.length > 20 ? ok : fail).push(s); }
    else fail.push(s);
    if (m && m.c.length > 20) { /* RSI de 1, 2, 4, 8 y 12 h con las velas de 15 min agrupadas */
      const x = X[s] = X[s] || []; [1, 2, 4, 8, 12].forEach((h, k) => { const st = rsiState(velasH(m, h)); x[k] = st ? r2(st.rsi) : null; }); }
    if (!(m && m.c.length > 20) && prev.x && prev.x[s]) { const x = X[s] = X[s] || []; for (let k = 0; k < 5; k++) x[k] = prev.x[s][k]; }
    if (d1) { const W = semanas(d1), wk = Math.floor((Date.now() / 1000 / 86400 + 3) / 7), cl = (W.length && W[W.length - 1].k === wk ? W.slice(0, -1) : W).map(w => w.c), st = rsiState(cl);
      const x = X[s] = X[s] || []; if (st) { x[5] = r2(st.rsi); x[6] = +st.g.toPrecision(6); x[7] = +st.l.toPrecision(6); x[8] = cl[cl.length - 1]; } }
    if (m && m.c.length > 20) { /* RSI de 1 h con las velas de 15 min agrupadas por hora */
      const hc = []; let hk = null; m.t.forEach((t, i) => { const k = Math.floor(t / 3600); if (k !== hk) { hc.push(m.c[i]); hk = k; } else hc[hc.length - 1] = m.c[i]; });
      const h1 = rsiState(hc); row = row || []; row[4] = h1 ? r2(h1.rsi) : null; row[6] = m.c[m.c.length - 1]; }
    if (row) D[s] = row; await sleep(150); } }));
  /* d[ACCION] = [RSI diario al cierre anterior, promedio de subas, promedio de bajas, cierre anterior, RSI 1 h, cambio del día anterior %, último precio de 30 min] */
  const out = { upd: Date.now(), dia: needDaily ? today : prev.dia, cols: ['rsi_d', 'g', 'l', 'cierre', 'rsi_1h', 'cambio_ant', 'ultimo'], sectores: Object.fromEntries(Object.entries(SEC).filter(([k]) => !k.startsWith('_'))), d: D,
    /* x[ACCION] = [RSI 1 h, 2 h, 4 h, 8 h, 12 h, RSI semanal al cierre de la semana anterior, promedio de subas, de bajas, cierre de la semana anterior] */
    xcols: ['1h', '2h', '4h', '8h', '12h', 'rsi_s', 'g_s', 'l_s', 'cierre_s'], x: Object.keys(X).length ? X : (prev.x || {}) };
  fs.writeFileSync(path.join(OUT, 'rsi.json'), JSON.stringify(out));
  /* ACUMULACIÓN: velas semanales de toda la historia de los índices (una vez por día; el resto de las corridas usa las de antes) */
  { let acu = null; try { acu = JSON.parse(fs.readFileSync(path.join(PREV, 'acum.json'), 'utf8')); } catch (e) {}
    if (!acu || acu.v !== 2 || needDaily || acu.dia !== today) { const d = {}; for (const s of ['SPY', 'QQQ', 'DIA', 'IWM']) { const y = await yahoo(s, '1d', '20y'); let w = null; // Yahoo con "max" agrupa en meses: se bajan las diarias de 20 años y se arman las semanales
        if (y && y.c.length > 1500) { w = { t: [], c: [], h: [] }; let cur = null; y.t.forEach((t, i) => { const k = Math.floor((t / 86400 + 3) / 7); if (k !== cur) { cur = k; w.t.push(t); w.c.push(y.c[i]); w.h.push(y.h[i]); } else { const n = w.c.length - 1; w.c[n] = y.c[i]; w.h[n] = Math.max(w.h[n], y.h[i]); } }); }
        if (w && w.c.length > 220) d[s] = { t: w.t, c: w.c, h: w.h }; else if (acu && acu.d && acu.d[s]) d[s] = acu.d[s]; await sleep(300); }
      acu = { v: 2, upd: Date.now(), dia: today, d }; }
    fs.writeFileSync(path.join(OUT, 'acum.json'), JSON.stringify(acu)); }
  console.log('velas', ok.length, 'sin datos', fail.length, fail.slice(0, 30).join(' '), 'diario', needDaily); })();
