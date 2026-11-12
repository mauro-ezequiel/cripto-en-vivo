/* CRIPTO-LIVE · noticias de cada activo (noviembre 2026)
   Cada 3 h baja de Google News (en español, últimos 14 días) las noticias de cada acción de la planilla y de las 200 cripto con más volumen,
   y las deja en la rama "activos" (n/SIMBOLO.json). La página las muestra en "Datos del activo". Los nombres de las empresas salen de Wikidata
   (se renuevan una vez por semana) y los de las cripto de CoinGecko. Uso: node herramientas/noticias-activos.js prev */
const fs = require('fs'), path = require('path');
const PREV = process.argv[2] || 'prev', OUT = 'out', sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(path.join(OUT, 'n'), { recursive: true });
async function get(u, txt) { for (let k = 0; k < 3; k++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cripto-live)', 'Accept-Language': 'es-419,es' } }); if (r.ok) return txt ? r.text() : r.json(); if (r.status === 404) return null; } catch (e) {} await sleep(2000 * (k + 1)); } return null; }
const dec = s => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, '').trim();
async function news(q) { const x = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(q + ' when:14d')}&hl=es-419&gl=AR&ceid=AR:es-419`, 1); if (!x) return null; const out = [];
  for (const m of x.matchAll(/<item>([\s\S]*?)<\/item>/g)) { const g = t => (m[1].match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]; let title = dec(g('title')), src = dec(g('source'));
    const mm = title.match(/^(.*) - ([^-]{2,60})$/); if (mm) { title = mm[1].trim(); src = src || mm[2]; } const t = Date.parse(dec(g('pubDate'))), u = dec(g('link'));
    if (title && !isNaN(t)) out.push([title, src, t, u]); }
  const seen = new Set(); return out.sort((a, b) => b[2] - a[2]).filter(x => { const k = x[0].toLowerCase().slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8); }
(async () => {
  let prev = {}; try { prev = JSON.parse(fs.readFileSync(path.join(PREV, 'nombres.json'), 'utf8')); } catch (e) {}
  const SEC = JSON.parse(fs.readFileSync(path.join(__dirname, 'sectores.json'), 'utf8')); const STK = [...new Set(Object.entries(SEC).filter(([k]) => !k.startsWith('_')).flatMap(([, L]) => L))];
  /* nombres de empresas (Wikidata, una vez por semana) */
  let NS = prev.s && Date.now() - prev.ts < 7 * 864e5 ? prev.s : null;
  if (!NS) { NS = {}; for (let i = 0; i < STK.length; i += 80) { const V = STK.slice(i, i + 80).map(t => `"${t.replace('-', '.')}"`).join(' ');
      const q = `SELECT ?t ?l WHERE { ?item p:P414 ?st. ?st pq:P249 ?t. ?st ps:P414 ?ex. VALUES ?ex {wd:Q13677 wd:Q82059} VALUES ?t {${V}} ?item rdfs:label ?l. FILTER(LANG(?l)="es" || LANG(?l)="en") }`;
      const j = await get('https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(q)); for (const b of (j && j.results && j.results.bindings) || []) { const t = b.t.value.replace('.', '-'); if (!NS[t] || b.l['xml:lang'] === 'es') NS[t] = b.l.value; } await sleep(1500); }
    if (Object.keys(NS).length < 50 && prev.s) NS = prev.s; }
  /* cripto: las 200 con más volumen en Binance y sus nombres en CoinGecko */
  const tk = await get('https://data-api.binance.vision/api/v3/ticker/24hr') || [];
  const CR = tk.filter(x => /USDT$/.test(x.symbol) && !/^(USDC|FDUSD|TUSD|USDP|DAI|EUR|BUSD)/.test(x.symbol)).sort((a, b) => +b.quoteVolume - +a.quoteVolume).slice(0, 200).map(x => x.symbol);
  let NC = prev.c && Date.now() - prev.tc < 7 * 864e5 ? prev.c : null;
  if (!NC) { NC = {}; for (const p of [1, 2]) { const L = await get(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${p}`) || []; for (const x of L) { const k = String(x.symbol).toUpperCase(); if (!NC[k]) NC[k] = x.name; } await sleep(3000); }
    if (Object.keys(NC).length < 50 && prev.c) NC = prev.c; }
  fs.writeFileSync(path.join(OUT, 'nombres.json'), JSON.stringify({ ts: NS === prev.s ? prev.ts : Date.now(), tc: NC === prev.c ? prev.tc : Date.now(), s: NS, c: NC }));
  const clean = n => String(n).replace(/,? (Inc|Corp|Corporation|Ltd|plc|S\.A\.|N\.V\.|Holdings?|Company|Co|Group|SE|AG)\.?$/i, '').replace(/^The /, '').trim();
  const job = STK.map(s => [s, NS[s] ? `"${clean(NS[s])}"` + (s.length >= 3 ? ` OR "${s}"` : '') : `"${s}" acciones`])
    .concat(CR.map(s => { const b = s.replace(/USDT$/, '').replace(/^1000000|^1000/, ''); return [s, `"${NC[b] || b}" (cripto OR criptomoneda OR token)`]; }));
  let ok = 0, vac = 0, fail = 0;
  for (const [s, q] of job) { const n = await news(q); if (n == null) { fail++; try { fs.copyFileSync(path.join(PREV, 'n', s + '.json'), path.join(OUT, 'n', s + '.json')); } catch (e) {} }
    else { if (!n.length) vac++; else ok++; fs.writeFileSync(path.join(OUT, 'n', s + '.json'), JSON.stringify({ upd: Date.now(), q, n })); } await sleep(350); }
  fs.writeFileSync(path.join(OUT, 'estado.json'), JSON.stringify({ upd: Date.now(), activos: job.length, con_noticias: ok, sin_noticias: vac, fallaron: fail }));
  console.log('activos', job.length, 'con noticias', ok, 'sin', vac, 'fallaron', fail);
})().catch(e => { console.error(e); process.exit(1); });
