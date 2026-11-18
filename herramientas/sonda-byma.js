/* SONDA BYMA (noviembre 2026): qué devuelve data912 para el mercado argentino */
const fs = require('fs'); const R = {};
(async () => { const g = async u => { try { const r = await fetch('https://data912.com' + u); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { st: r.status, j, t: t.slice(0, 300) }; } catch (e) { return { st: 'error ' + e.message }; } };
  for (const k of ['arg_stocks', 'arg_bonds', 'arg_corp', 'arg_notes', 'arg_cedears', 'arg_options']) { const x = await g('/live/' + k); R[k] = Array.isArray(x.j) ? { n: x.j.length, muestra: x.j.slice(0, 2), simbolos: x.j.map(y => y.symbol).slice(0, 400) } : x; }
  for (const u of ['/historical/stocks/GGAL', '/historical/stocks/YPFD', '/historical/bonds/AL30', '/historical/bonds/GD30', '/historical/cedears/AAPL']) { const x = await g(u); R[u] = Array.isArray(x.j) ? { n: x.j.length, primero: x.j[0], ultimo: x.j[x.j.length - 1] } : x.j && x.j.dates ? { n: x.j.dates.length, claves: Object.keys(x.j) } : x; }
  fs.writeFileSync('sonda-byma.json', JSON.stringify(R, null, 1)); })();
