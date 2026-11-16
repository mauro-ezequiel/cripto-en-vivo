const fs = require('fs');
(async () => { const j = await (await fetch('https://api.argentinadatos.com/v1/finanzas/fci/otros/ultimo')).json(); fs.writeFileSync('sonda-tasas.json', JSON.stringify(j.map(x => [x.fondo, x.tna, x.tope, x.condicionesCorto || x.condiciones, x.fecha, x.plazoMinDias]), null, 0)); })();
