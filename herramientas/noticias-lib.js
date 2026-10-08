/* CRIPTO-LIVE · noticias para la IA. El bot lo llama una vez por hora: lee las mismas fuentes que la página, les pone el mismo puntaje
   (importancia y si son buenas o malas para el mercado) y guarda el clima de las últimas 12 h junto con el precio de BTC en datos/noticias.json.
   Con ese historial la IA mide, con el tiempo, si las noticias de verdad mueven el precio. */
const FEEDS = [['CoinDesk', 'https://www.coindesk.com/arc/outboundfeeds/rss/'], ['Cointelegraph', 'https://cointelegraph.com/rss'],
  ['Google News', 'https://news.google.com/rss/search?q=bitcoin+OR+crypto+OR+stablecoin+when:1d&hl=en-US&gl=US&ceid=US:en'],
  ['Google News', 'https://news.google.com/rss/search?q=%22federal+reserve%22+OR+inflation+OR+CPI+OR+tariffs+OR+SEC+OR+recession+when:1d&hl=en-US&gl=US&ceid=US:en'],
  ['CNBC', 'https://www.cnbc.com/id/100003114/device/rss/rss.html']];
const clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));
const CATS=[['Macro','#42a5f5',2,/\b(fed|fomc|powell|rate (hike|cut)s?|interest rates?|inflation|cpi|ppi|payrolls?|jobs report|unemployment|recession|gdp|treasur(y|ies)|yields?|dollar|ecb|boj|stimulus|shutdown|debt ceiling|central bank)\b/i],
 ['Regulación','#ab47bc',2,/\b(sec|cftc|regulat\w*|lawsuits?|sues?|ban(s|ned)?|etfs?|bill|senate|congress|legislation|lawmakers?|tax(es)?|custody|approv\w*)\b/i],
 ['Geopolítica','#ef5350',1.5,/\b(war|attacks?|sanctions?|conflict|missiles?|military|israel|iran|russia|ukraine|china|taiwan|tariffs?|trade war)\b/i],
 ['Mercado','#26c6da',1.5,/\b(stocks?|shares|equit(y|ies)|earnings|merval|byma|wall street|nasdaq|s&p|dow jones|ipo|dividends?|guidance|buybacks?|downgrades?|upgrades?|analysts?)\b/i],
 ['Cripto','#f7c548',1,/\b(bitcoin|btc|ethereum|ether|eth|crypto\w*|stablecoins?|blockchain|binance|coinbase|tether|usdt|solana|xrp|defi|liquidat\w*|whales?|microstrategy|blackrock)\b/i]];
const POS=/\b(approv\w*|inflows?|rall(y|ies|ied)|surg\w*|soar\w*|jump\w*|gains?|record high|all-time high|adopt\w*|rate cuts?|cuts? rates|eas(e|es|ing)|dovish|bullish|buys?|bought|accumulat\w*|partnership|rebound\w*|recover\w*|upgrade\w*|clarity|green light|wins?|optimis\w*|reserve|higher)\b/ig;
const NEG=/\b(hack\w*|exploit\w*|attack\w*|lawsuits?|sues?|sued|bans?|banned|crackdown|reject\w*|delay\w*|outflows?|crash\w*|plung\w*|tumbl\w*|drops?|dropped|falls?|fell|slump\w*|sell-?offs?|liquidations?|rate hikes?|hikes?|hawkish|recession|war|sanctions?|tariffs?|fraud|bankrupt\w*|collaps\w*|warns?|warning|fears?|bearish|vulnerab\w*|investigat\w*|probes?|shutdown|default\w*|lower|losses?|panic|risks?)\b/ig;
function scoreNews(title){let imp=0;const tags=[];for(const [n,c,w,re] of CATS)if(re.test(title)){imp+=w;tags.push([n,c]);}
  const p=(title.match(POS)||[]).length,ng=(title.match(NEG)||[]).length;if(/\b(breaking|urgent|record|historic|emergency)\b/i.test(title))imp+=1;
  return {imp,tags,sent:clamp((p-ng)/2)};}
const dec = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
async function items() { const out = [];
  for (const [src, url] of FEEDS) { try { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 cripto-live' } }); if (!r.ok) continue; const x = await r.text();
      for (const m of x.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) { const it = m[0], ti = (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1], pd = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1];
        if (!ti || !pd) continue; let title = dec(ti); const mm = title.match(/^(.*) - ([^-]{2,40})$/); if (src === 'Google News' && mm) title = mm[1]; const t = Date.parse(pd); if (isNaN(t)) continue;
        out.push({ title, src, t, ...scoreNews(title) }); } } catch (e) {} }
  const seen = new Set(); return out.filter(n => { const k = n.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60); if (seen.has(k)) return false; seen.add(k); return true; }); }
/* mismo cálculo que el termómetro de la página: promedio de las de las últimas 12 h, pesado por importancia y frescura */
async function snapshot(btc) { const now = Date.now(), L = await items(); let sw = 0, ss = 0, pos = 0, neg = 0, n = 0;
  for (const x of L) { const age = (now - x.t) / 36e5; if (age > 12 || age < -1 || x.imp < 1) continue; const w = x.imp * Math.exp(-Math.max(0, age) / 6); sw += w; ss += w * x.sent; n++; if (x.sent > 0) pos++; else if (x.sent < 0) neg++; }
  let fng = null; try { const j = await (await fetch('https://api.alternative.me/fng/?limit=1')).json(); fng = +j.data[0].value; } catch (e) {}
  const top = L.filter(x => x.imp >= 2 && now - x.t < 12 * 36e5).sort((a, b) => (b.imp + Math.abs(b.sent)) - (a.imp + Math.abs(a.sent))).slice(0, 3).map(x => [x.title.slice(0, 140), +x.sent.toFixed(2)]);
  return { t: now, s: sw ? +(clamp(ss / sw * 1.5)).toFixed(3) : 0, pos, neg, n, fng, btc, top }; }
async function record(btc) { const tok = process.env.GH_TOKEN, repo = process.env.GITHUB_REPOSITORY; if (!tok || !repo) return false;
  const H = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'User-Agent': 'cripto-live' }, api = 'https://api.github.com/repos/' + repo + '/contents/noticias.json';
  const snap = await snapshot(btc); let sha = null, data = { h: [] };
  const g = await fetch(api + '?ref=datos', { headers: H }); if (g.ok) sha = (await g.json()).sha;
  if (sha) { try { const r = await fetch(`https://raw.githubusercontent.com/${repo}/datos/noticias.json?t=${Date.now()}`); if (r.ok) data = await r.json(); } catch (e) {} } // el archivo pasa de 1 MB: se lee crudo
  if (data.upd && snap.t - data.upd < 50 * 6e4) return false; // ya hay uno de esta hora
  data.h = (data.h || []).filter(x => snap.t - x.t < 400 * 864e5).map(x => snap.t - x.t > 2 * 864e5 ? (({ top, ...r }) => r)(x) : x).concat(snap).slice(-9600); data.upd = snap.t;
  const p = await fetch(api, { method: 'PUT', headers: H, body: JSON.stringify(Object.assign({ message: 'Noticias: clima de la hora', content: Buffer.from(JSON.stringify(data)).toString('base64'), branch: 'datos' }, sha ? { sha } : {})) });
  console.log('noticias', p.status, 'n', snap.n, 's', snap.s); return p.ok; }
module.exports = { snapshot, record, items };
