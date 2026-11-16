const fs = require('fs');
(async () => { const out = {}; const B = 'https://api.argentinadatos.com/v1/';
  for (const p of ['finanzas/bonos', 'finanzas/cauciones', 'finanzas/tasas/plazoFijoUva', 'finanzas/obligaciones', 'finanzas/ons', 'finanzas/bonos/cer', 'finanzas/tasas/caucion', 'finanzas/indices/riesgo-pais/ultimo', 'finanzas/letras', 'finanzas/fci/otros/ultimo', 'finanzas/fci/rentaVariable/ultimo', 'cotizaciones/dolares']) {
    try { const r = await fetch(B + p); const t = await r.text(); out[p] = { status: r.status, ej: t.slice(0, 700) }; } catch (e) { out[p] = String(e); } }
  const L = await (await fetch(B + 'finanzas/letras')).json(); out.letras_todas = (L.letras || []).map(x => [x.ticker, x.tnaPorcentaje, x.temPorcentaje, x.fechaVencimiento]);
  for (const u of ['https://data912.com/live/arg_bonds', 'https://data912.com/live/arg_notes', 'https://data912.com/live/arg_corp']) { try { const r = await fetch(u); const j = await r.json(); out[u] = { n: j.length, ej: j.slice(0, 40).map(x => [x.symbol, x.c, x.px_bid, x.px_ask, x.pct_change]) }; } catch (e) { out[u] = String(e); } }
  fs.writeFileSync('sonda-tasas.json', JSON.stringify(out, null, 1)); })();
