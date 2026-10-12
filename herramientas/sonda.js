/* Sonda: qué fuentes se alcanzan desde GitHub Actions (estado, tamaño, inicio de la respuesta y si permite CORS). Escribe sonda.json
   SONDA="url1 url2 …" para probar otras direcciones. */
const fs = require('fs'), out = {};
const L = (process.env.SONDA || 'https://fapi.binance.com/fapi/v1/ping https://data-api.binance.vision/api/v3/ping').split(/\s+/).filter(Boolean);
(async () => { for (const u of L) { try { const r = await fetch(u, { headers: { Origin: 'https://mauro-ezequiel.github.io', 'User-Agent': 'Mozilla/5.0' } }); const t = await r.text();
      if (process.env.GUARDAR) fs.writeFileSync('archivo-' + Object.keys(out).length + '.txt', t);
      out[u] = { st: r.status, len: t.length, cors: r.headers.get('access-control-allow-origin'), tipo: r.headers.get('content-type'), inicio: t.slice(0, u.includes('openapi') ? 60000 : 1500) }; } catch (e) { out[u] = { st: 'error ' + e.message }; } }
  fs.writeFileSync('sonda.json', JSON.stringify(out, null, 1)); console.log(Object.entries(out).map(([k, v]) => v.st + ' ' + v.cors + ' ' + k).join('\n')); })();
