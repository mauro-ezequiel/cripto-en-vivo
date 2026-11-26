/* NOMBRES DE LAS ACCIONES (noviembre 2026): ticker → nombre de la empresa, para mostrarlo chiquito debajo del ticker.
   Fuente: lista oficial de la SEC (EE. UU.) cruzada con las acciones que muestra la página (data912). */
const fs = require('fs');
const lindo = t => String(t).toLowerCase().replace(/\b(inc|corp|corporation|co|ltd|plc|sa|s\.a\.|nv|n\.v\.|ag|se|holdings?|group|company|limited|the|lp|l\.p\.|llc|trust|class [a-z]|\/[a-z]{2}\/?|de|adr)\b\.?/g, ' ').replace(/[,.]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/\b([a-záéíóúñ])/g, m => m.toUpperCase()).replace(/\b(Ii|Iii|Iv|Us|Usa|Ai|Etf|Spdr|Msci|S&p)\b/g, m => m.toUpperCase());
(async () => { const sec = await (await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': 'cripto-live research contacto@example.com' } })).json();
  const m = {}; for (const k in sec) { const x = sec[k]; m[String(x.ticker).toUpperCase().replace('-', '.')] = lindo(x.title); }
  const U = await (await fetch('https://data912.com/live/usa_stocks')).json(), A = await (await fetch('https://data912.com/live/usa_adrs')).json();
  const out = {}; let falt = []; for (const x of [...U, ...A]) { const s = String(x.symbol); const n = m[s] || m[s.replace('.', '')]; if (n) out[s] = n; else falt.push(s); }
  fs.writeFileSync('nombres.json', JSON.stringify(out)); console.log('con nombre', Object.keys(out).length, 'sin', falt.length, falt.slice(0, 60).join(' ')); console.log('MUESTRA', ['MELI', 'NVDA', 'GGAL', 'YPF', 'BRK.B', 'SPY', 'AAPL', 'TSLA'].map(s => s + '=' + out[s]).join(' | ')); })();
