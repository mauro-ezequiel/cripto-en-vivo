const fs = require('fs');
(async () => { const B = 'https://api.argentinadatos.com/v1/finanzas/'; const out = {};
  out.rend = await (await fetch(B + 'rendimientos')).json();
  const u = await (await fetch(B + 'fci/mercadoDinero/ultimo')).json(), p = await (await fetch(B + 'fci/mercadoDinero/penultimo')).json();
  out.fci = u.filter(x => /mercado|ual|naranja|brubank|personal|prex|cocos|lemon|galicia|santander|bbva|macro|nacion|icbc|balanz|iol|supervielle|hsbc|fima|1822|pellegrini|delta|toronto|max/i.test(x.fondo)).map(x => { const q = p.find(y => y.fondo === x.fondo); const d = q ? (new Date(x.fecha) - new Date(q.fecha)) / 864e5 : null; return [x.fondo, x.fecha, q && d ? +(((x.vcp / q.vcp) ** (365 / d) - 1) * 100).toFixed(1) : null, Math.round(x.patrimonio / 1e9)]; }).filter(x => x[3] > 5);
  out.pf = (await (await fetch(B + 'tasas/plazoFijo')).json()).map(x => [x.entidad, x.tnaClientes, x.tnaNoClientes]);
  out.letras = (await (await fetch(B + 'letras')).json()).letras.slice(0, 12).map(x => [x.ticker, x.tnaPorcentaje, x.temPorcentaje, x.fechaVencimiento]);
  fs.writeFileSync('sonda-tasas.json', JSON.stringify(out, null, 1)); })();
