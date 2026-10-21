/* DVOL de Deribit (octubre 2026): índice de volatilidad implícita de BTC a 30 días (lo que esperan los que operan opciones, el "VIX" de BTC).
   API pública y gratis: www.deribit.com/api/v2/public/get_volatility_index_data. Se usa el cierre de la última vela de 1 h cerrada.
   SHOOTER v10 del bot (v8 en la página): no entra con el DVOL bajo 35 (mercado dormido): probado con 1 y 4 años, más ganancia por operación
   en las dos mitades y casi las mismas señales. Si no hay dato, no se filtra. */
const H = 36e5, SHOOTER_DVMIN = 35, URL = 'https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&resolution=3600';
async function serie(from, to) { const M = new Map();
  for (let a = from; a < to; a += 800 * H) { let j = null; for (let r = 0; r < 4 && !j; r++) { try { j = await (await fetch(`${URL}&start_timestamp=${a}&end_timestamp=${Math.min(to, a + 800 * H)}`)).json(); } catch (e) { await new Promise(z => setTimeout(z, 4000)); } }
    for (const x of (j && j.result && j.result.data) || []) M.set(Math.floor(x[0] / H), x[4]); await new Promise(z => setTimeout(z, 250)); }
  return M; }
/* valor conocido en el momento t: la vela de 1 h que cerró antes de t (busca hasta 6 h atrás) */
function at(M, t) { const h = Math.floor(t / H) - 1; for (let q = 0; q < 6; q++) { const v = M.get(h - q); if (v != null) return v; } return null; }
let CACHE = null;
async function ahora(now = Date.now()) { if (CACHE && now - CACHE.t < 10 * 6e4) return CACHE.v; let v = null; try { v = at(await serie(now - 8 * H, now), now); } catch (e) {} CACHE = { t: now, v }; return v; }
module.exports = { serie, at, ahora, SHOOTER_DVMIN };
