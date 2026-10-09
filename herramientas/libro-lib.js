/* Libro de órdenes: una foto por hora de las 30 cripto con más volumen (Binance spot, accesible desde GitHub).
   Guarda en datos/libro.json, por moneda: desequilibrio a ±0,5 / 1 / 2 % (compras − ventas) / (compras + ventas), diferencia compra/venta
   en puntos básicos, profundidad a ±1 % (log10 de USD) y el precio. La IA mide después si eso anticipa el precio de la hora siguiente. */
const API = 'https://data-api.binance.vision/api/v3';
async function getJ(u) { for (let k = 0; k < 3; k++) { try { const r = await fetch(u); if (r.ok) return await r.json(); } catch (e) {} await new Promise(z => setTimeout(z, 1500)); } return null; }
function stats(d) { const bb = +d.bids[0][0], ba = +d.asks[0][0], mid = (bb + ba) / 2;
  const side = (L, pc, s) => L.reduce((a, [p, q]) => a + ((s > 0 ? +p >= mid * (1 - pc) : +p <= mid * (1 + pc)) ? p * q : 0), 0);
  const imb = pc => { const B = side(d.bids, pc, 1), A = side(d.asks, pc, -1); return [(B - A) / ((B + A) || 1), B + A]; };
  const [i05] = imb(.005), [i1, dep] = imb(.01), [i2] = imb(.02);
  return [+i05.toFixed(4), +i1.toFixed(4), +i2.toFixed(4), +((ba - bb) / mid * 1e4).toFixed(2), +Math.log10(dep || 1).toFixed(3), +mid.toPrecision(8)]; }
async function snapshot(syms) { const t = Date.now(), rows = [];
  for (const s of syms) { const d = await getJ(`${API}/depth?symbol=${s}&limit=1000`); if (d && d.bids && d.bids.length && d.asks.length) rows.push([s.replace('USDT', ''), ...stats(d)]); await new Promise(z => setTimeout(z, 150)); }
  return { t, rows }; }
async function record(syms) { const tok = process.env.GH_TOKEN, repo = process.env.GITHUB_REPOSITORY; if (!tok || !repo) return false;
  const H = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'User-Agent': 'cripto-live' }, api = 'https://api.github.com/repos/' + repo + '/contents/libro.json';
  let sha = null, data = { cols: ['moneda', 'i05', 'i1', 'i2', 'spread_pb', 'prof1_log10', 'precio'], h: [] };
  const g = await fetch(api + '?ref=datos', { headers: H }); if (g.ok) sha = (await g.json()).sha;
  if (sha) { try { const r = await fetch(`https://raw.githubusercontent.com/${repo}/datos/libro.json?t=${Date.now()}`); if (r.ok) data = await r.json(); } catch (e) {} }
  const snap = await snapshot(syms); if (data.upd && snap.t - data.upd < 50 * 6e4) return false; // ya hay una foto de esta hora
  data.h = (data.h || []).filter(x => snap.t - x.t < 120 * 864e5).concat(snap); data.upd = snap.t;
  const p = await fetch(api, { method: 'PUT', headers: H, body: JSON.stringify(Object.assign({ message: 'Libro de órdenes: foto de la hora', content: Buffer.from(JSON.stringify(data)).toString('base64'), branch: 'datos' }, sha ? { sha } : {})) });
  console.log('libro', p.status, snap.rows.length, 'monedas'); return p.ok; }
module.exports = { snapshot, record, stats };
