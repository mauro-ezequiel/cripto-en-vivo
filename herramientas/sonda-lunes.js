/* ¿Cómo abren los lunes? Hueco entre el cierre del viernes y la apertura del lunes, y el día completo del lunes (NVDA, SPY, QQQ) */
const fs = require('fs'); const R = {};
async function serie(s) { if (s.startsWith('CEDEAR ')) { const j = await (await fetch('https://data912.com/historical/cedears/' + s.slice(7))).json(); return j.map(r => ({ d: r.date, o: +r.o, c: +r.c })); }
  const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?range=12y&interval=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json(); const r = j.chart.result[0], q = r.indicators.quote[0];
  return r.timestamp.map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), o: q.open[i], c: q.close[i] })); }
(async () => { for (const s of ['NVDA', 'SPY', 'QQQ', 'CEDEAR NVDA']) { let B; try { B = (await serie(s)).map(b => ({ ...b, w: new Date(b.d + 'T12:00:00Z').getUTCDay() })).filter(b => b.o > 0 && b.c > 0); } catch (e) { R[s] = 'error ' + e.message; continue; }
    const res = {}; for (const [nom, desde] of [['ultimas_26_semanas', -26], ['ultimas_52_semanas', -52], ['desde_2015', null]]) {
      const L = []; for (let i = 1; i < B.length; i++) if (B[i].w === 1 && B[i - 1].w === 5 && (!desde && B[i].d >= '2015' || desde)) L.push({ d: B[i].d, gap: (B[i].o / B[i - 1].c - 1) * 100, dia: (B[i].c / B[i - 1].c - 1) * 100 });
      const X = desde ? L.slice(desde) : L; const f = (k, c) => X.filter(x => c(x[k])).length; const m = k => +(X.reduce((a, x) => a + x[k], 0) / X.length).toFixed(2);
      res[nom] = { lunes: X.length, abre_arriba: f('gap', v => v > 0), abre_abajo: f('gap', v => v < 0), hueco_promedio: m('gap'), cierra_arriba_vs_viernes: f('dia', v => v > 0), cambio_dia_promedio: m('dia'), ultimos: desde === -26 ? X.slice(-8).map(x => x.d + ' ' + x.gap.toFixed(2) + '%/' + x.dia.toFixed(2) + '%') : undefined }; }
    R[s] = res; }
  fs.writeFileSync('sonda-lunes.json', JSON.stringify(R, null, 1)); console.log(JSON.stringify(R)); })();
