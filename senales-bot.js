/* CRIPTO-LIVE · servidor de señales 24 h (GitHub Actions, cada 5 minutos)
   Usa las mismas reglas que la página (TRADING v6 y SHOOTER v6) y manda por Telegram:
   señales nuevas, objetivos alcanzados, zona de salvavidas y stop.
   Necesita dos secretos del repositorio: TELEGRAM_TOKEN y TELEGRAM_CHAT. */
const fs = require('fs');
const API = 'https://data-api.binance.vision/api/v3'; // datos públicos de Binance accesibles desde los servidores de GitHub
const PAGE = 'https://mauro-ezequiel.github.io/cripto-en-vivo/';
const TOKEN = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT;
const STATE_FILE = 'estado.json';

const SIGCFG = {
  medio: { name: 'TRADING', tf: '4h', htf: '1d', min: .0125, maxAtr: .017, n: 40, cool: 24 * 36e5, maxAge: 7 * 864e5 },
  x: { name: 'SHOOTER', tf: '5m', htf: '15m', min: .016, maxAtr: .027, n: 45, cool: 1.5 * 36e5, maxAge: 4 * 36e5 }
};
const SIM = { medio: { margin: 350, lev: 15, maxLoss: 262.5 }, x: { margin: 50, lev: 18, maxLoss: 36 } };
const CAL = { medio: { p: 87, p3: 36, n: 370 }, x: { p: 80, p3: 37, n: 152 } };
const MINCERT = { medio: 75, x: 70 };
const TGTS = { medio: [.0125, .025, .0375], x: [.016, .032, .048] };
const LLTH = .65;
const STABLE = /^(USDC|FDUSD|TUSD|USDP|DAI|BUSD|EUR|USDE|USD1|PYUSD|XUSD|AEUR|EURI|BFUSD|USDS|RLUSD|USDF|FRAX|USDG)USDT$/;

/* ---------- matemáticas (idénticas a la página) ---------- */
let candles = [];
const clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));
const closes = () => candles.map(b => b.close);
function emaArr(v, p) { const o = Array(v.length).fill(null), k = 2 / (p + 1); let prev = null, cnt = 0, sum = 0;
  for (let i = 0; i < v.length; i++) { const x = v[i]; if (x == null) continue;
    if (prev === null) { sum += x; cnt++; if (cnt === p) { prev = sum / p; o[i] = prev; } } else { prev = x * k + prev * (1 - k); o[i] = prev; } }
  return o; }
function smaStd(v, p) { const m = Array(v.length).fill(null), s = Array(v.length).fill(null);
  for (let i = p - 1; i < v.length; i++) { let a = 0; for (let j = i - p + 1; j <= i; j++) a += v[j]; a /= p; let q = 0; for (let j = i - p + 1; j <= i; j++) q += (v[j] - a) ** 2; m[i] = a; s[i] = Math.sqrt(q / p); }
  return [m, s]; }
function trArr() { return candles.map((b, i) => i ? Math.max(b.high - b.low, Math.abs(b.high - candles[i - 1].close), Math.abs(b.low - candles[i - 1].close)) : b.high - b.low); }
function wilder(v, p) { const o = Array(v.length).fill(null); let s = 0; for (let i = 0; i < v.length; i++) { if (i < p) { s += v[i]; if (i === p - 1) { s /= p; o[i] = s; } } else { s = (s * (p - 1) + v[i]) / p; o[i] = s; } } return o; }
function calcRSI(p = 14) { const c = closes(), o = Array(c.length).fill(null); let g = 0, l = 0;
  for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
    if (i <= p) { g += up; l += dn; if (i === p) { g /= p; l /= p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
    else { g = (g * (p - 1) + up) / p; l = (l * (p - 1) + dn) / p; o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); } }
  return o; }
function calcADX(p = 14) { const n = candles.length, pdm = [0], mdm = [0];
  for (let i = 1; i < n; i++) { const up = candles[i].high - candles[i - 1].high, dn = candles[i - 1].low - candles[i].low; pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0); }
  const tr = wilder(trArr(), p), sp = wilder(pdm, p), sm = wilder(mdm, p);
  const pdi = tr.map((t, i) => t ? 100 * sp[i] / t : null), mdi = tr.map((t, i) => t ? 100 * sm[i] / t : null);
  const dx = pdi.map((x, i) => x != null && (x + mdi[i]) > 0 ? 100 * Math.abs(x - mdi[i]) / (x + mdi[i]) : null);
  const adx = Array(n).fill(null); let s = 0, c = 0, prev = null;
  for (let i = 0; i < n; i++) { if (dx[i] == null) continue; if (prev === null) { s += dx[i]; c++; if (c === p) { prev = s / p; adx[i] = prev; } } else { prev = (prev * (p - 1) + dx[i]) / p; adx[i] = prev; } }
  return { adx, pdi, mdi }; }
function calcST(p = 10, m = 3) { const n = candles.length, atr = wilder(trArr(), p), st = Array(n).fill(null), dir = Array(n).fill(null); let fu = null, fl = null, d = 1;
  for (let i = 0; i < n; i++) { if (atr[i] == null) continue; const b = candles[i], hl = (b.high + b.low) / 2, ub = hl + m * atr[i], lb = hl - m * atr[i];
    if (fu === null) { fu = ub; fl = lb; } else { const pc = candles[i - 1].close; fu = (ub < fu || pc > fu) ? ub : fu; fl = (lb > fl || pc < fl) ? lb : fl; }
    if (d === 1 && b.close < fl) d = -1; else if (d === -1 && b.close > fu) d = 1; st[i] = d === 1 ? fl : fu; dir[i] = d; }
  return { st, dir }; }
const barDelta = b => { const tb = b.tb != null && !isNaN(b.tb) ? b.tb : b.v / 2; return 2 * tb - b.v; };
function withCandles(cs, fn) { const prev = candles; candles = cs; try { return fn(); } finally { candles = prev; } }
function htfTrend(hc) { const h = hc.slice(0, -1), cl = h.map(b => b.close), e = emaArr(cl, 21), i = h.length - 1; if (i < 4 || e[i] == null || e[i - 3] == null) return 0; return (cl[i] > e[i] ? .5 : -.5) + (e[i] > e[i - 3] ? .5 : -.5); }
function lastBarStats(cc, i) { let fl = 0, vv = 0, vs = 0; for (let j = i - 2; j <= i; j++) { fl += barDelta(cc[j]); vv += cc[j].v; } for (let j = Math.max(0, i - 19); j <= i; j++) vs += cc[j].v;
  const b = cc[i]; return { flow: vv ? fl / vv : 0, vr: b.v / ((vs / Math.min(i + 1, 20)) || 1), body: (b.close - b.open) / ((b.high - b.low) || 1) }; }

/* ---------- reglas ---------- */
function evalShooter(cs, hc) { const cc = cs.slice(0, -1);
  return withCandles(cc, () => { const i = cc.length - 1, cl = closes(), c = cs[cs.length - 1].close, cb = cc[i].close, atr = wilder(trArr(), 14)[i], atrP = atr / cb;
    const [bm, bs] = smaStd(cl, 20), r7 = calcRSI(7)[i], htf = htfTrend(hc), z = bs[i] ? (cb - bm[i]) / bs[i] : 0;
    const out = { dir: 0, c, atr, reasons: [] };
    if (r7 == null || !(atrP > .04 / 3 && atrP <= .04 / 1.5)) return out;
    if (!(Math.abs(z) >= 2 && (z < 0 ? r7 <= 35 : r7 >= 65))) return out;
    const dir = z < 0 ? 1 : -1; if (Math.sign(htf) !== dir) return out;
    out.dir = dir; out.reasons.push(dir > 0 ? 'cerró bajo la banda inferior' : 'cerró sobre la banda superior', 'RSI 7 en ' + r7.toFixed(0), 'tendencia de 15m a favor');
    return out; }); }
function evalTrading(cs, hc) { const cc = cs.slice(0, -1);
  return withCandles(cc, () => { const i = cc.length - 1, cl = closes(), c = cs[cs.length - 1].close, cb = cc[i].close, atr = wilder(trArr(), 14)[i], atrP = atr / cb;
    const st = calcST(10, 3).dir[i], e21 = emaArr(cl, 21)[i], e50 = emaArr(cl, 50)[i], e200 = emaArr(cl, 200)[i], r14 = calcRSI(14)[i], htf = htfTrend(hc), L = lastBarStats(cc, i);
    const out = { dir: 0, c, atr, reasons: [] };
    if (e200 == null || r14 == null) return out;
    const dir = st === 1 && e21 > e50 && cb > e200 ? 1 : st === -1 && e21 < e50 && cb < e200 ? -1 : 0;
    if (!dir || !(dir > 0 ? r14 < 50 : r14 > 50) || L.vr >= 1 || !(atrP > .01 && atrP <= .05 / 3)) return out;
    out.dir = dir; out.reasons.push('tendencia alineada (Supertrend, EMA 21/50/200)', 'retroceso: RSI 14 en ' + r14.toFixed(0), 'volumen bajo en el retroceso');
    if (Math.sign(htf) === dir) out.reasons.push('tendencia diaria a favor');
    return out; }); }

/* ---------- datos ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJ(url, tries = 3) { for (let k = 0; k < tries; k++) { try { const r = await fetch(url); if (r.ok) return await r.json(); if (r.status === 429 || r.status >= 500) { await sleep(2000 * (k + 1)); continue; } throw new Error(r.status + ' ' + url); } catch (e) { if (k === tries - 1) throw e; await sleep(1500); } } }
const toBar = k => ({ t: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], v: +k[5], tb: +k[9] });
const kl = (s, t, n) => getJ(`${API}/klines?symbol=${s}&interval=${t}&limit=${n}`).then(d => d.map(toBar));
const dec = p => p >= 1000 ? 2 : p >= 1 ? 3 : p >= 0.01 ? 5 : 8;
const fp = p => (+p).toLocaleString('es-ES', { minimumFractionDigits: dec(p), maximumFractionDigits: dec(p) });
const pct = (v, e) => { const x = (v / e - 1) * 100; return (x >= 0 ? '+' : '') + x.toFixed(2) + ' %'; };
const CANAL = process.env.TELEGRAM_CANAL || '@criptolive_senales';
async function sendTo(chat, text) { try { const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: 'POST', body: new URLSearchParams({ chat_id: chat, text, disable_web_page_preview: 'true' }) }); const j = await r.json(); if (!j.ok) console.log('Telegram', chat, ':', j.description); return j.ok; } catch (e) { console.log('Telegram error', chat, e.message); return false; } }
async function tg(text, canal = true) { if (!TOKEN || !CHAT) { console.log('[sin Telegram]', text); return; }
  await sendTo(CHAT, text); if (canal && CANAL) await sendTo(CANAL, text); }

/* ---------- publica las señales en la rama "datos" para que la página las muestre ---------- */
async function ghPublish() { const tok = process.env.GH_TOKEN, repo = process.env.GITHUB_REPOSITORY; if (!tok || !repo) return false;
  const H = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'User-Agent': 'cripto-live-bot' }, api = 'https://api.github.com/repos/' + repo;
  try { if (!S.brOk) { let r = await fetch(api + '/git/ref/heads/datos', { headers: H });
      if (r.status === 404) { const mm = await (await fetch(api + '/git/ref/heads/main', { headers: H })).json(); r = await fetch(api + '/git/refs', { method: 'POST', headers: H, body: JSON.stringify({ ref: 'refs/heads/datos', sha: mm.object.sha }) }); }
      if (!r.ok) { console.log('rama datos:', r.status); return false; } S.brOk = true; }
    let sha = S.fileSha; if (!sha) { const g = await fetch(api + '/contents/senales.json?ref=datos', { headers: H }); if (g.ok) sha = (await g.json()).sha; }
    const body = JSON.stringify({ upd: Date.now(), senales: S.hist || [] });
    const r = await fetch(api + '/contents/senales.json', { method: 'PUT', headers: H, body: JSON.stringify(Object.assign({ message: 'Señales del servidor', content: Buffer.from(body).toString('base64'), branch: 'datos' }, sha ? { sha } : {})) });
    if (r.ok) { S.fileSha = (await r.json()).content.sha; console.log('Publicadas', (S.hist || []).length, 'señales'); return true; }
    console.log('publicar:', r.status, (await r.text()).slice(0, 200)); S.fileSha = null; return false; } catch (e) { console.log('publicar error', e.message); return false; } }

/* ---------- estado (para no repetir avisos) ---------- */
let S = { last: {}, open: [], boot: 0, hist: [] };
try { S = Object.assign(S, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (e) {}

async function main() {
  const now = Date.now();
  if (!S.boot && TOKEN && CHAT) { S.boot = now; await tg('✅ CRIPTO-LIVE 24 h activo\nDesde ahora reviso TRADING y SHOOTER cada 5 minutos aunque la página esté cerrada, y te aviso por acá.', false); }
  if (!S.canal && TOKEN && CHAT && CANAL) { if (await sendTo(CANAL, '📈 CRIPTO-LIVE · Señales en vivo\nAcá se publican las señales de TRADING (4 h) y SHOOTER (5 min) apenas aparecen, con entrada, objetivos, stop y salvavidas, y después cuando tocan cada objetivo o el stop.\nGráfico y detalles: ' + PAGE + '\nℹ️ Solo informativo: no es consejo financiero. Operar con apalancamiento puede hacerte perder todo el margen.')) S.canal = now; }
  if (!(S.hist && S.hist.length) && S.open.length) { S.hist = S.open.map(o => ({ m: o.m, sym: o.sym, dir: o.dir, entry: o.entry, zl: o.entry, zh: o.entry, tp: o.tp, sl: o.sl, ll: o.ll, conf: CAL[o.m].p, setup: o.m === 'medio' ? 't-pb' : 'sh-r', reasons: [], t: o.t })); S.histDirty = true; }
  const T = await getJ(`${API}/ticker/24hr`), px = {};
  for (const t of T) px[t.symbol] = +t.lastPrice;
  const base = T.filter(t => t.symbol.endsWith('USDT') && !STABLE.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) && +t.quoteVolume > 1e7 && Math.abs(+t.priceChangePercent) < 25)
    .sort((a, b) => b.quoteVolume - a.quoteVolume);

  /* 1) seguimiento de las señales ya enviadas */
  for (const o of S.open) { const p = px[o.sym]; if (!p) continue; const d = o.dir, c = o.sym.replace('USDT', ''), cfg = SIGCFG[o.m];
    while (o.hit < 3 && d * (p - o.tp[o.hit]) >= 0) { o.hit++; await tg(`✅ ${cfg.name} ${c}: llegó al objetivo ${o.hit} (${fp(o.tp[o.hit - 1])}, ${pct(o.tp[o.hit - 1], o.entry)})${o.hit === 1 ? '. Cerrá 1/3 y pasá el stop a la entrada.' : o.hit === 3 ? '. Operación completa 🎯' : '.'}`); }
    if (o.hit >= 3) { o.done = true; continue; }
    const stop = o.hit > 0 ? o.entry : o.sl;
    if (d * (stop - p) >= 0) { o.done = true; await tg(o.hit > 0 ? `↩️ ${cfg.name} ${c}: volvió a la entrada (${fp(o.entry)}) después del objetivo ${o.hit}. Se cierra sin pérdida.` : `🛑 ${cfg.name} ${c}: tocó el stop (${fp(o.sl)}, ${pct(o.sl, o.entry)}).`); continue; }
    if (!o.llSent && o.hit === 0 && d * (o.ll - p) >= 0) { o.llSent = true; await tg(`🟡🛟 ${cfg.name} ${c}: llegó a la zona del salvavidas (${fp(o.ll)}). Abrí la página para ver si los datos confirman agregar la mitad del margen.`); }
    if (now - o.t > cfg.maxAge) { o.done = true; await tg(`⌛ ${cfg.name} ${c}: pasó el plazo sin llegar al objetivo ni al stop. Precio ${fp(p)} (${pct(p, o.entry)}).`); }
  }
  S.open = S.open.filter(o => !o.done);

  /* 2) búsqueda de señales nuevas */
  for (const m of ['medio', 'x']) {
    const cfg = SIGCFG[m], U = base.slice(0, cfg.n).map(t => t.symbol); let sent = 0, btcDir = 0;
    if (m === 'medio') { try { const bk = await kl('BTCUSDT', '4h', 80), cl = bk.slice(0, -1).map(b => b.close), e = emaArr(cl, 50); btcDir = cl[cl.length - 1] > e[e.length - 1] ? 1 : -1; } catch (e) {} }
    for (const s of U) {
      if (S.last[m + s] && now - S.last[m + s] < cfg.cool) continue;
      if (S.open.some(o => o.sym === s && o.m === m)) continue;
      try {
        const [cs, hc] = await Promise.all([kl(s, cfg.tf, 300), kl(s, cfg.htf, 120)]); if (cs.length < 150 || hc.length < 30) continue;
        const e = m === 'x' ? evalShooter(cs, hc) : evalTrading(cs, hc); if (!e.dir) continue;
        const c = e.c, atrP = e.atr / c; if (!(atrP > 0) || atrP > cfg.maxAtr) continue;
        const d = e.dir; let conf = CAL[m].p;
        if (m === 'medio' && btcDir) { if (btcDir === d) { conf += 2; e.reasons.push('BTC a favor'); } else { conf -= 5; e.reasons.push('BTC en contra: algo menos confiable'); } }
        if (conf < MINCERT[m]) continue;
        const Sm = SIM[m], liqD = Sm.maxLoss / (Sm.margin * Sm.lev), tp = TGTS[m].map(x => c * (1 + d * x)), sl = c * (1 - d * liqD), ll = c * (1 - d * liqD * LLTH);
        const zone = c * Math.min(cfg.min * .15, atrP * .5), sym = s.replace('USDT', '');
        S.last[m + s] = now; S.open.push({ m, sym: s, dir: d, entry: c, tp, sl, ll, t: now, hit: 0 }); sent++;
        (S.hist = S.hist || []).push({ m, sym: s, dir: d, entry: c, zl: c - zone, zh: c + zone, tp, sl, ll, conf, setup: m === 'medio' ? 't-pb' : 'sh-r', reasons: e.reasons.slice(0, 6), t: now }); S.histDirty = true;
        await tg(`${d > 0 ? '🟢' : '🔴'} ${cfg.name}: ${d > 0 ? '▲ LONG' : '▼ SHORT'} ${sym}\nEntrada ${fp(c - zone)} – ${fp(c + zone)}\nObjetivos ${fp(tp[0])} · ${fp(tp[1])} · ${fp(tp[2])}\nStop ${fp(sl)} (${pct(sl, c)}) · Salvavidas en ${fp(ll)}\nAcierto histórico ${conf} % · ${e.reasons.join(' · ')}\n${PAGE}?sym=${s}&tf=${cfg.tf}&m=${m}\nℹ️ Solo informativo, no es consejo financiero.`);
      } catch (err) { console.log(s, err.message); }
      await sleep(80);
    }
    console.log(cfg.name, 'revisadas', U.length, 'nuevas', sent);
  }
  for (const k in S.last) if (now - S.last[k] > 3 * 864e5) delete S.last[k];
  S.hist = (S.hist || []).filter(x => now - x.t < 10 * 864e5).slice(-150);
  if (S.histDirty || !S.pubOk) { if (await ghPublish()) { S.histDirty = false; S.pubOk = true; } }
  S.run = now;
  if (TOKEN && CHAT) fs.writeFileSync(STATE_FILE, JSON.stringify(S)); else console.log('Prueba sin Telegram: no se guarda el estado.');
}
/* vuelta larga: revisa cada 5 minutos durante LOOP_MIN minutos (así no depende de la puntualidad del horario de GitHub) */
async function run() { const LOOP = +(process.env.LOOP_MIN || 0) * 6e4, start = Date.now();
  while (true) { const t0 = Date.now(); try { await main(); } catch (e) { console.error(e); }
    if (!LOOP) break; const wait = 3e5 - (Date.now() - t0); if (Date.now() - start + Math.max(0, wait) > LOOP) break; await sleep(Math.max(5000, wait)); }
  try { if (TOKEN && CHAT) fs.writeFileSync(STATE_FILE, JSON.stringify(S)); } catch (_) {} }
run();
