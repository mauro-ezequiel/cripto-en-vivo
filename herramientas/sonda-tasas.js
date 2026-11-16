/* sonda: qué datos de tasas en Argentina se pueden leer (ArgentinaDatos) y si permiten leerse desde el navegador (CORS) */
const fs = require('fs');
(async () => { const out = {}; const B = 'https://api.argentinadatos.com/v1/finanzas/';
  for (const p of ['tasas/plazoFijo', 'fci/mercadoDinero/ultimo', 'fci/mercadoDinero/penultimo', 'fci/rentaFija/ultimo', 'rendimientos', 'indices/inflacion', 'indices/uva', 'letras', 'tasas/depositos30Dias']) {
    try { const r = await fetch(B + p, { headers: { Origin: 'https://mauro-ezequiel.github.io' } }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {}
      out[p] = { status: r.status, cors: r.headers.get('access-control-allow-origin'), n: Array.isArray(j) ? j.length : null, ej: Array.isArray(j) ? (p.startsWith('indices') ? j.slice(-2) : j.slice(0, 4)) : String(t).slice(0, 300) }; } catch (e) { out[p] = String(e); } }
  fs.writeFileSync('sonda-tasas.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out).slice(0, 2000)); })();
