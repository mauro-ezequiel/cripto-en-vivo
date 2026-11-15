/* sonda: ¿cómo se llaman YPF y NVDA en los contratos de BingX y se pueden leer desde el navegador (CORS)? */
const fs = require('fs');
(async () => { const out = {};
  for (const u of ['https://open-api.bingx.com/openApi/swap/v2/quote/contracts', 'https://open-api.bingx.com/openApi/swap/v2/quote/premiumIndex']) {
    try { const r = await fetch(u, { headers: { Origin: 'https://mauro-ezequiel.github.io' } }); const j = await r.json(); const L = j.data || [];
      out[u] = { status: r.status, cors: r.headers.get('access-control-allow-origin'), n: L.length, ypf: L.filter(x => /YPF|NVDA|GGAL|NCSI/i.test(JSON.stringify(x))).slice(0, 12) }; } catch (e) { out[u] = String(e); } }
  for (const s of ['YPF-USDT', 'NVDA-USDT', 'NCSKYPF2USD-USDT']) { try { const r = await fetch('https://open-api.bingx.com/openApi/swap/v2/quote/premiumIndex?symbol=' + s, { headers: { Origin: 'https://mauro-ezequiel.github.io' } }); out[s] = { cors: r.headers.get('access-control-allow-origin'), j: await r.json() }; } catch (e) { out[s] = String(e); } }
  fs.writeFileSync('sonda-bingx.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out).slice(0, 3000)); })();
