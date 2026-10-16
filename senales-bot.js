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
  medio: { name: 'TRADING', tf: '4h', htf: '1d', min: .0125, maxAtr: .017, n: 999, cool: 24 * 36e5, maxAge: 7 * 864e5 },
  x: { name: 'SHOOTER', tf: '15m', htf: '1h', min: .016, maxAtr: .027, n: 30, cool: 36e5, maxAge: 12 * 36e5 } // SHOOTER v4: 15 y 30 min, las 30 con más volumen
};
/* octubre 2026 · medidas nuevas v2: apalancamiento, stop y objetivos elegidos juntos (más aciertos sin ganar menos).
   Stop = 3 × ATR con tope en el 80 % de la distancia a la liquidación; objetivos 0,5 / 1 / 1,5 × stop.
   Backtest 6 meses (Binance, con salvavidas y comisiones):
   TRADING × 20, stop máx. 3,6 % → 75 % al objetivo 1, +8.767 USD (vieja × 15: 84 %, +4.096 USD).
   SHOOTER × 10, stop máx. 7,6 % → 66 % al objetivo 1, +350 USD (vieja × 18: 71 %, −327 USD).
   SHOOTER va sin salvavidas: ganaba lo mismo y agrandaba las pérdidas.
   TRADING v3: × 10 y solo a favor de BTC → 81 % al objetivo 1, +10 % del margen por operación, peor racha −2,1 márgenes. */
const SIM = { medio: { margin: 350, lev: 10 }, x: { margin: 50, lev: 15 } };
/* octubre 2026 v7: TRADING objetivos 0,75 × stop (antes 0,5) · SHOOTER stop 4 ATR (antes 3) y objetivos 0,25 × stop (antes 0,35) */
const GEOM = { medio: { a: 3, r: .75, maxSl: .036 }, x: { a: 4, r: .25, maxSl: .05 } };
/* universo (octubre 2026, 14 variantes probadas): TRADING todas con más de 10 M USD de volumen, SHOOTER las 30 con más volumen.
   Las de menos volumen eran las impredecibles. El filtro de rango de 1 h no mejoró nada: apagado (WILD_MAX = 0). */
const MINVOL = 1e7, WILD_MAX = 0, WILDC = {};
async function wildOK(s, hc) { if (!WILD_MAX) return true; const c = WILDC[s]; if (!hc && c && Date.now() - c.t < 36e5) return c.ok;
  try { const b = (hc && hc.length >= 169 ? hc : await kl(s, '1h', 170)).slice(0, -1).slice(-168); if (b.length < 100) return true; const v = b.reduce((a, x) => a + (x.high - x.low) / x.close, 0) / b.length * 100; WILDC[s] = { t: Date.now(), ok: v <= WILD_MAX }; return v <= WILD_MAX; } catch (e) { return true; } }
const CAL = { medio: { p: 81, p3: 30, n: 140 }, x: { p: 71, p3: 17, n: 70 } };
const CALSET = { 't-pb': 86, 'tp-r55': 79, 'tp-u80': 72, 'sh-r': 71, 'sh-c': 77 };
const MINCERT = { medio: 62, x: 56 };
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
/* SHOOTER v4 (octubre 2026, igual que la página): velas de 15 y 30 min, solo LONG. Cayó 3 % o más en la última hora, cerró bajo la
   banda inferior de Bollinger (z ≤ −1,8) con RSI 7 ≤ 35 y la tendencia de 1 h a favor. Stop 3 ATR con tope del 5 % (× 15). */
function evalShooter(cs, hc, mins = 15) { const cc = cs.slice(0, -1), back = Math.round(60 / mins);
  return withCandles(cc, () => { const i = cc.length - 1, cl = closes(), c = cs[cs.length - 1].close, cb = cc[i].close, atr = wilder(trArr(), 14)[i], atrP = atr / cb;
    const [bm, bs] = smaStd(cl, 20), r7 = calcRSI(7)[i], z = bs[i] ? (cb - bm[i]) / bs[i] : 0;
    const h = hc.slice(0, -1), he = emaArr(h.map(b => b.close), 50), hk = h.length - 1, up1h = hk >= 0 && he[hk] != null && h[hk].close > he[hk];
    const drop = i >= back ? (cb / cc[i - back].close - 1) * 100 : 0;
    const out = { dir: 0, c, atr, reasons: [], setup: null };
    if (r7 == null || !(atrP > 0)) return out; // el stop se recorta al tope (5 %)
    if (!(z <= -1.8 && r7 <= 35 && drop <= -3 && up1h)) return out;
    const e200 = emaArr(cl, 200)[i]; if (!(e200 != null && cb > e200)) return out; // octubre 2026 v7: solo con el precio sobre la EMA 200
    out.dir = 1; out.setup = 'sh-c'; out.reasons.push('cayó ' + Math.abs(drop).toFixed(1) + ' % en la última hora (velas de ' + mins + ' min)', 'cerró bajo la banda inferior de Bollinger', 'RSI 7 en ' + r7.toFixed(0) + ' (sobreventa)', 'la tendencia de 1 h sigue a favor');
    return out; }); }
/* octubre 2026 · CICLO DEL HALVING: TRADING solo da SHORTS en la fase de caída del ciclo de BTC (del máximo del ciclo hasta ~400 días después).
   4 años de simulación: los shorts en las fases de subida (2022-11 → 2025-10) daban −3,9 % y −7,2 % del margen por operación con 55–59 % ganadas;
   en la caída, +13,5 % y 72 %. Sin ellos: 64 → 69 % ganadas y +3.884 → +6.597 USD en 4 años (mejoró en las dos mitades). Los longs no cambian. */
const CYC_TOPS = ['2013-12-04', '2017-12-17', '2021-11-10', '2025-10-06'].map(d => Date.parse(d + 'T00:00:00Z')), cycFall = t => CYC_TOPS.some(a => t >= a && t < a + 400 * 864e5);
function evalTrading(cs, hc, rank = 0) { const cc = cs.slice(0, -1);
  return withCandles(cc, () => { const i = cc.length - 1, cl = closes(), c = cs[cs.length - 1].close, cb = cc[i].close, atr = wilder(trArr(), 14)[i], atrP = atr / cb;
    const st = calcST(10, 3).dir[i], e21 = emaArr(cl, 21)[i], e50 = emaArr(cl, 50)[i], e200 = emaArr(cl, 200)[i], r14 = calcRSI(14)[i], htf = htfTrend(hc), L = lastBarStats(cc, i);
    const out = { dir: 0, c, atr, reasons: [], setup: null };
    if (e200 == null || r14 == null) return out;
    const dir = st === 1 && e21 > e50 && cb > e200 ? 1 : st === -1 && e21 < e50 && cb < e200 ? -1 : 0;
    if (!dir || L.vr >= 1 || !(atrP > .01 && atrP <= .05 / 3)) return out;
    if (dir < 0 && !cycFall(Date.now())) return out; // shorts solo en la fase de caída del ciclo del halving
    if (dir * (cb / e200 - 1) * 100 > 8) return out; // octubre 2026 v7: no entrar si el precio ya se alejó más de 8 % de la EMA 200
    const pull = dir > 0 ? r14 < 50 : r14 > 50, soft = dir > 0 ? r14 < 55 : r14 > 45, adx = calcADX(14).adx[i];
    if (pull && dir * (cb - e50) / atr < .5) return out; // octubre 2026: el retroceso tiene que frenar al menos media ATR antes de la EMA 50
    if (pull) out.setup = rank < 40 ? 't-pb' : 'tp-u80';
    else if (rank < 40 && soft && adx != null && adx >= 25) out.setup = 'tp-r55';
    else return out;
    out.dir = dir; out.reasons.push(out.setup === 'tp-r55' ? 'tendencia alineada y fuerte (ADX ' + adx.toFixed(0) + ')' : 'tendencia alineada (Supertrend, EMA 21/50/200)', 'retroceso: RSI 14 en ' + r14.toFixed(0), 'volumen bajo en el retroceso');
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
async function ghPublish() { return ghPut('senales.json', JSON.stringify({ upd: Date.now(), senales: S.hist || [] }), 'fileSha', 'Señales del servidor', (S.hist || []).length + ' señales'); }
async function ghPut(file, body, shaKey, msg, info) { const tok = process.env.GH_TOKEN, repo = process.env.GITHUB_REPOSITORY; if (!tok || !repo) return false;
  const H = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'User-Agent': 'cripto-live-bot' }, api = 'https://api.github.com/repos/' + repo;
  try { if (!S.brOk) { let r = await fetch(api + '/git/ref/heads/datos', { headers: H });
      if (r.status === 404) { const mm = await (await fetch(api + '/git/ref/heads/main', { headers: H })).json(); r = await fetch(api + '/git/refs', { method: 'POST', headers: H, body: JSON.stringify({ ref: 'refs/heads/datos', sha: mm.object.sha }) }); }
      if (!r.ok) { console.log('rama datos:', r.status); return false; } S.brOk = true; }
    let sha = S[shaKey]; if (!sha) { const g = await fetch(api + '/contents/' + file + '?ref=datos', { headers: H }); if (g.ok) sha = (await g.json()).sha; }
    const r = await fetch(api + '/contents/' + file, { method: 'PUT', headers: H, body: JSON.stringify(Object.assign({ message: msg, content: Buffer.from(body).toString('base64'), branch: 'datos' }, sha ? { sha } : {})) });
    if (r.ok) { S[shaKey] = (await r.json()).content.sha; console.log('Publicado', file, info || ''); return true; }
    console.log('publicar', file, r.status, (await r.text()).slice(0, 200)); S[shaKey] = null; return false; } catch (e) { console.log('publicar error', file, e.message); return false; } }

/* ---------- BITÁCORA PERMANENTE (octubre 2026) ----------
   Cada señal del bot queda guardada para siempre en datos/bitacora.json con: la versión de las reglas que la dio, una foto del libro de órdenes
   en ese momento (desequilibrio ±0,5 / 1 / 2 %, diferencia compra/venta, profundidad, precio) y cómo terminó (código como el historial:
   1 stop · 3 volvió a la entrada tras un objetivo · 4 los 3 objetivos · 5 venció el plazo; objetivos tocados, precio y % del margen con comisión).
   Nunca se borra nada: la IA la estudia todos los días junto con la simulación. */
const VER = { medio: 'v7+ciclo', x: 'v8' };
const bitId = x => x.sym + '-' + x.t;
const bitRec = x => ({ id: bitId(x), m: x.m, sym: x.sym, dir: x.dir, entry: x.entry, tp: x.tp, sl: x.sl, ll: x.ll == null ? null : x.ll, setup: x.setup || null, conf: x.conf || null, t: x.t, v: x.v || null, libro: x.libro || null, out: null });
async function bitLoad() { if (Array.isArray(S.bit)) return true;
  try { const r = await fetch('https://raw.githubusercontent.com/' + (process.env.GITHUB_REPOSITORY || 'mauro-ezequiel/cripto-en-vivo') + '/datos/bitacora.json?t=' + Date.now());
    if (r.ok) { const j = await r.json(); S.bit = Array.isArray(j.ops) ? j.ops : []; } else if (r.status === 404) S.bit = []; else return false; } catch (e) { return false; } // si falla la lectura no se pisa nada: se reintenta
  for (const x of S.hist || []) if (!S.bit.some(b => b.id === bitId(x))) S.bit.push(bitRec(x)); // las de los últimos 10 días que ya estaban publicadas
  S.bit.sort((a, b) => a.t - b.t); S.bitDirty = true; return true; }
/* resultado como % del margen (1/3 de la posición en cada objetivo, el resto al precio de salida), con 0,05 % de comisión por lado */
function bitPct(r, hit, px) { const lev = SIM[r.m].lev, d = r.dir; let v = 0; for (let k = 0; k < hit; k++) v += d * (r.tp[k] / r.entry - 1) / 3; v += (1 - hit / 3) * d * (px / r.entry - 1); return +((v - .001) * lev * 100).toFixed(2); }
function bitClose(id, c, hit, px, t) { const r = (S.bit || []).find(b => b.id === id); if (!r || r.out) return; r.out = { c, hit, p: px, t, pct: bitPct(r, hit, px) }; S.bitDirty = true; }
/* las que no se siguieron en vivo (por ejemplo de antes de la bitácora) se resuelven con velas de 15 min, igual que el seguimiento del bot */
async function bitResolve(r) { const maxAge = SIGCFG[r.m].maxAge, d = r.dir; let hit = 0;
  const k = await kl15From(r.sym, r.t); if (!k) return;
  for (const b of k) { if (b.t + 9e5 <= r.t) continue; const adv = d > 0 ? b.low : b.high, fav = d > 0 ? b.high : b.low;
    if (!hit && d * (adv - r.sl) <= 0) return bitClose(r.id, 1, 0, r.sl, b.t);
    if (hit && d * (adv - r.entry) <= 0) return bitClose(r.id, 3, hit, r.entry, b.t);
    while (hit < 3 && d * (fav - r.tp[hit]) >= 0) hit++;
    if (hit === 3) return bitClose(r.id, 4, 3, r.tp[2], b.t);
    if (b.t - r.t > maxAge) return bitClose(r.id, 5, hit, b.close, b.t); } }
const kl15From = (s, t) => getJ(`${API}/klines?symbol=${s}&interval=15m&startTime=${t - 9e5}&limit=1000`).then(d => d.map(toBar)).catch(() => null);

/* ---------- 🔄 TRADE DEL CICLO (octubre 2026): el bot opera BTC y ETH a favor de la fase del halving y suma margen si va en contra ---------- */
const CL = require('./herramientas/ciclo-lib.js');
async function cicState() { if (S.cic && Array.isArray(S.cic.ops)) return true;
  try { const r = await fetch('https://raw.githubusercontent.com/' + (process.env.GITHUB_REPOSITORY || 'mauro-ezequiel/cripto-en-vivo') + '/datos/ciclo.json?t=' + Date.now());
    if (r.ok) { const j = await r.json(); S.cic = { ops: Array.isArray(j.ops) ? j.ops : [] }; } else if (r.status === 404) S.cic = { ops: [] }; else return false; } catch (e) { return false; } // si falla la lectura no se pisa nada
  return true; }
const cicName = s => s.replace('USDT', '');
async function ciclo(now, px) { if (!(await cicState())) return; const C = S.cic, Q = CL.CIC; let ch = false;
  /* 1) seguimiento vela a vela (1 h cerrada) de las abiertas: sumas, objetivo, cambio de fase */
  for (const o of C.ops.filter(x => x.state === 'open')) { let k = null; try { k = await getJ(`${API}/klines?symbol=${o.sym}&interval=1h&startTime=${o.last}&limit=1000`); } catch (e) {}
    for (const r of k || []) { const b = { t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4] }; if (b.t < o.last || b.t + 36e5 > now) continue; const ev = CL.step(o, b); o.last = b.t + 36e5; ch = true;
      const sm = ev.filter(e => e.k === 'suma'); if (sm.length) { const avg = o.cost / o.qty;
        await tg(`➕ TRADE DEL CICLO ${cicName(o.sym)}: ${sm.length > 1 ? sm.length + ' sumas' : 'suma'} de 100 USD (${o.adds}/${Q.cap}) en ${fp(sm[sm.length - 1].px)}
Margen total ${o.marg} USD · entrada promedio ${fp(avg)}
Nuevo objetivo ${fp(CL.tgtPx(o))}${o.adds < Q.cap ? ` · próxima suma en ${fp(CL.addPx(o))}` : ' · ya no quedan sumas'}`); }
      if (o.state !== 'open') { await tg(o.state === 'win' ? `✅ TRADE DEL CICLO ${cicName(o.sym)}: llegó al objetivo en ${fp(o.px)}. Ganancia ${o.pnl.toFixed(2)} USD (+150 % del margen total de ${o.marg} USD) 🎯`
          : o.state === 'fase' ? `🔄 TRADE DEL CICLO ${cicName(o.sym)}: cambió la fase del ciclo, se cierra en ${fp(o.px)}. Resultado ${o.pnl >= 0 ? '+' : ''}${o.pnl.toFixed(2)} USD.`
          : `🛑 TRADE DEL CICLO ${cicName(o.sym)}: se usaron las ${Q.cap} sumas y llegó a la liquidación (${fp(o.px)}). Pérdida ${o.pnl.toFixed(2)} USD.`); break; } } }
  /* 2) RSI diario (velas cerradas) una vez por hora */
  if (!C.rsiT || now - C.rsiT >= 36e5) { const R = {}; for (const s of Q.syms) { try { const d = (await kl(s, '1d', 400)).filter(b => b.t + 864e5 <= now); R[s] = +CL.rsi(d.map(b => b.close)).toFixed(1); } catch (e) {} }
    if (Object.keys(R).length) { C.rsi = R; C.rsiT = now; ch = true; } }
  /* 3) entradas: a favor de la fase, no en sus últimos 90 días, con el RSI diario en extremo */
  const F = CL.fase(now);
  if (F.fin - now >= Q.last * 864e5) for (const s of Q.syms) { const r = C.rsi && C.rsi[s], p = px[s]; if (r == null || !p || C.ops.some(o => o.sym === s && o.state === 'open')) continue;
    if (F.dir > 0 ? r < Q.L : r > Q.S) { const o = CL.open(s, F.dir, p, now, r); C.ops.push(o); ch = true;
      await tg(`🔄 TRADE DEL CICLO: ${F.dir > 0 ? '🟢 ▲ LONG' : '🔴 ▼ SHORT'} ${cicName(s)}\nEntrada ${fp(p)} · 200 USD × ${Q.lev}\nObjetivo ${fp(CL.tgtPx(o))} (+150 % del margen total, se recalcula con cada suma)\nSi va en contra: suma 100 USD en ${fp(CL.addPx(o))} (hasta ${Q.cap} sumas, reserva de hasta 3.200 USD)\nFase ${F.f === 'caida' ? 'caída' : F.f === 'acumulacion' ? 'acumulación' : 'subida'} del ciclo · RSI diario ${r.toFixed(0)}\n${PAGE}?sym=${s}&tf=1d\nℹ️ Solo informativo, no es consejo financiero.`); } }
  /* 4) publica para la página (en cada cambio y cada 6 h) */
  if ((ch || !C.pubT || now - C.pubT >= 6 * 36e5) && process.env.GH_TOKEN) {
    if (await ghPut('ciclo.json', JSON.stringify({ upd: now, rsi: C.rsi || {}, reglas: 'BTC y ETH · × 3 · RSI diario < 35 LONG / > 65 SHORT a favor de la fase del halving · suma 100 USD al −50 % del margen total (hasta 30) · sale al +150 % · cierra si cambia la fase', ops: C.ops }), 'cicSha', 'Trade del ciclo', C.ops.length + ' operaciones')) C.pubT = now; } }

/* ---------- estado (para no repetir avisos) ---------- */
let S = { last: {}, open: [], boot: 0, hist: [] };
try { S = Object.assign(S, JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); } catch (e) {}

/* % de acierto del último año (los recalcula herramientas/historial-anual.js cada día) */
async function calYear() { try { const r = await fetch('https://raw.githubusercontent.com/' + (process.env.GITHUB_REPOSITORY || 'mauro-ezequiel/cripto-en-vivo') + '/datos/historial.json?t=' + Date.now()); if (!r.ok) return;
    const j = await r.json(), minN = j.minN || 20; for (const m in j.cal || {}) for (const s in j.cal[m]) { const x = j.cal[m][s]; if (x && x.n >= minN && s in CALSET) CALSET[s] = x.p; } } catch (e) {} }

/* 🧠 IA 24 h: piensa y practica todo el tiempo (herramientas/ia-bot.js) */
const IAB = require('./herramientas/ia-bot.js'), IAD = { getJ, kl, API, cycFall, tg, fp, ghPut, sleep, M: null };
/* 🧪 todas las versiones de TRADING y SHOOTER en práctica 24 h (herramientas/versiones.js); a Telegram solo llegan las de la versión actual */
const VERM = require('./herramientas/versiones.js'), VD = { withCandles, closes, emaArr, calcRSI, calcADX, calcST, smaStd, wilder, trArr, htfTrend, lastBarStats, kl, getJ, API, ghPut, sleep };
/* 📬 resumen semanal por Telegram (los lunes desde las 9 de España): bots, versiones, Trade del ciclo, IA y la billetera simulada */
function walletSim(L, cap0 = 1000, frac = .1) { let c = cap0, peak = cap0, dd = 0; for (const x of L.sort((a, b) => a.end - b.end)) { c += c * frac * x.pct / 100; peak = Math.max(peak, c); dd = Math.min(dd, c / peak - 1); } return { c, dd }; }
async function semanal(now) { const d = new Date(now), wk = Math.floor((now - 4 * 864e5) / (7 * 864e5)); if (d.getUTCDay() !== 1 || d.getUTCHours() < 7 || S.semW === wk) return; S.semW = wk;
  const t0 = now - 7 * 864e5, pc = v => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',') + ' %', st = L => { const n = L.length; if (!n) return null; const w = L.filter(x => x.pct > 0).length; return { n, w: Math.round(w / n * 100), avg: L.reduce((a, x) => a + x.pct, 0) / n }; };
  const B = (S.bit || []).filter(r => r.out && r.out.t >= t0).map(r => ({ m: r.m, pct: r.out.pct, end: r.out.t })), lines = ['📬 RESUMEN SEMANAL · CRIPTO-LIVE', ''];
  for (const [m, nm] of [['medio', 'TRADING'], ['x', 'SHOOTER']]) { const s2 = st(B.filter(x => x.m === m)); lines.push(`${m === 'medio' ? '📈' : '⚡'} ${nm} (versión actual): ${s2 ? `${s2.n} cerradas · ${s2.w} % ganadas · ${pc(s2.avg)} del margen por operación` : 'sin operaciones cerradas'}`); }
  const V = (S.ver && S.ver.ops || []).filter(o => o.out && o.out.t >= t0);
  for (const [m, nm] of [['medio', 'TRADING'], ['x', 'SHOOTER']]) { const R = VERM.VERS[m].map(v => ({ v: v.v, s: st(V.filter(o => o.m === m && o.v === v.v).map(o => ({ pct: o.out.pct }))) })).filter(x => x.s && x.s.n >= 3).sort((a, b) => b.s.avg - a.s.avg);
    if (R.length) lines.push(`🧪 ${nm} por versión (práctica): ` + R.map(x => `v${x.v}${x.v === VERM.VERS[m].length ? ' actual' : ''} ${x.s.w} % / ${pc(x.s.avg)}`).join(' · ')); }
  const C = (S.cic && S.cic.ops) || [], co = C.filter(o => o.state === 'open'), cc = C.filter(o => o.state !== 'open' && o.closeAt >= t0);
  lines.push(`🔄 Trade del ciclo: ${co.length ? co.map(o => `${o.sym.replace('USDT', '')} ${o.dir > 0 ? 'LONG' : 'SHORT'} abierta, ${o.adds} sumas, margen ${o.marg} USD`).join(' · ') : 'sin operación abierta'}${cc.length ? ` · cerró ${cc.length} (${cc.reduce((a, o) => a + o.pnl, 0).toFixed(0)} USD)` : ''}`);
  const I = (S.ia && S.ia.ops || []).filter(o => o.st !== 'open' && o.closeT >= t0), ir = st(I.filter(o => !o.pr).map(o => ({ pct: o.pnl / o.mg * 100 }))), ip = st(I.filter(o => o.pr).map(o => ({ pct: o.pnl / o.mg * 100 })));
  lines.push(`🧠 IA: reales ${ir ? `${ir.n} · ${ir.w} % ganadas · ${pc(ir.avg)}` : 'ninguna'} · práctica ${ip ? `${ip.n} · ${ip.w} % ganadas · ${pc(ip.avg)}` : 'ninguna'}`);
  const W = walletSim(B.concat(I.filter(o => !o.pr).map(o => ({ pct: o.pnl / o.mg * 100, end: o.closeT }))));
  lines.push('', `💼 Billetera simulada (1.000 USD, 10 % del capital por operación, todas las señales actuales): ${W.c.toFixed(0)} USD (${pc((W.c / 1000 - 1) * 100)}) · peor caída ${pc(W.dd * 100)}`, `${PAGE}`, 'ℹ️ Solo informativo, no es consejo financiero.');
  await tg(lines.join('\n'), false); }

let calT = 0;
async function main() {
  const now = Date.now();
  if (now - calT > 6 * 36e5) { await calYear(); calT = now; }
  if (!S.boot && TOKEN && CHAT) { S.boot = now; await tg('✅ CRIPTO-LIVE 24 h activo\nDesde ahora reviso TRADING y SHOOTER cada 5 minutos aunque la página esté cerrada, y te aviso por acá.', false); }
  if (!S.canal && TOKEN && CHAT && CANAL) { if (await sendTo(CANAL, '📈 CRIPTO-LIVE · Señales en vivo\nAcá se publican las señales de TRADING (4 h) y SHOOTER (5 min) apenas aparecen, con entrada, objetivos, stop y salvavidas, y después cuando tocan cada objetivo o el stop.\nGráfico y detalles: ' + PAGE + '\nℹ️ Solo informativo: no es consejo financiero. Operar con apalancamiento puede hacerte perder todo el margen.')) S.canal = now; }
  if (!(S.hist && S.hist.length) && S.open.length) { S.hist = S.open.map(o => ({ m: o.m, sym: o.sym, dir: o.dir, entry: o.entry, zl: o.entry, zh: o.entry, tp: o.tp, sl: o.sl, ll: o.ll, conf: CAL[o.m].p, setup: o.m === 'medio' ? 't-pb' : 'sh-r', reasons: [], t: o.t })); S.histDirty = true; }
  const T = await getJ(`${API}/ticker/24hr`), px = {};
  for (const t of T) px[t.symbol] = +t.lastPrice;
  if (!S.newsT || now - S.newsT >= 36e5) { S.newsT = now; try { await require('./herramientas/noticias-lib.js').record(px.BTCUSDT); } catch (e) { console.log('noticias', e.message); } } // la IA aprende de las noticias
  const base = T.filter(t => t.symbol.endsWith('USDT') && !STABLE.test(t.symbol) && !/(UP|DOWN|BULL|BEAR)USDT$/.test(t.symbol) && +t.quoteVolume > MINVOL && Math.abs(+t.priceChangePercent) < 25)
    .sort((a, b) => b.quoteVolume - a.quoteVolume);
  if (!S.bookT || now - S.bookT >= 36e5) { S.bookT = now; try { await require('./herramientas/libro-lib.js').record(base.slice(0, 30).map(t => t.symbol)); } catch (e) { console.log('libro', e.message); } } // foto del libro de órdenes

  /* 1) seguimiento de las señales ya enviadas */
  for (const o of S.open) { const p = px[o.sym]; if (!p) continue; const d = o.dir, c = o.sym.replace('USDT', ''), cfg = SIGCFG[o.m];
    const bid = o.sym + '-' + o.t;
    while (o.hit < 3 && d * (p - o.tp[o.hit]) >= 0) { o.hit++; await tg(`✅ ${cfg.name} ${c}: llegó al objetivo ${o.hit} (${fp(o.tp[o.hit - 1])}, ${pct(o.tp[o.hit - 1], o.entry)})${o.hit === 1 ? '. Cerrá 1/3 y pasá el stop a la entrada.' : o.hit === 3 ? '. Operación completa 🎯' : '.'}`); }
    if (o.hit >= 3) { o.done = true; bitClose(bid, 4, 3, o.tp[2], now); continue; }
    const stop = o.hit > 0 ? o.entry : o.sl;
    if (d * (stop - p) >= 0) { o.done = true; bitClose(bid, o.hit > 0 ? 3 : 1, o.hit, stop, now); await tg(o.hit > 0 ? `↩️ ${cfg.name} ${c}: volvió a la entrada (${fp(o.entry)}) después del objetivo ${o.hit}. Se cierra sin pérdida.` : `🛑 ${cfg.name} ${c}: tocó el stop (${fp(o.sl)}, ${pct(o.sl, o.entry)}).`); continue; }
    if (o.ll != null && !o.llSent && o.hit === 0 && d * (o.ll - p) >= 0) { o.llSent = true; await tg(`🟡🛟 ${cfg.name} ${c}: llegó a la zona del salvavidas (${fp(o.ll)}). Abrí la página para ver si los datos confirman agregar la mitad del margen.`); }
    if (now - o.t > cfg.maxAge) { o.done = true; bitClose(bid, 5, o.hit, p, now); await tg(`⌛ ${cfg.name} ${c}: pasó el plazo sin llegar al objetivo ni al stop. Precio ${fp(p)} (${pct(p, o.entry)}).`); }
  }
  S.open = S.open.filter(o => !o.done);
  /* ACUMULACIÓN (largo plazo): BTC, ETH y los índices. Aviso por Telegram cuando entran en zona de acumulación (cada 6 h se revisa) */
  if (!S.acuT || now - S.acuT >= 6 * 36e5) { S.acuT = now; S.acu = S.acu || {};
    for (const [s, nm, cr] of [['BTCUSDT', 'Bitcoin', 1], ['ETHUSDT', 'Ethereum', 1], ['SPY', 'S&P 500 (SPY)', 0], ['QQQ', 'Nasdaq 100 (QQQ)', 0], ['DIA', 'Dow Jones (DIA)', 0], ['IWM', 'Russell 2000 (IWM)', 0]]) {
      try { let c, h; if (cr) { const w = await kl(s, '1w', 1000); c = w.map(b => b.close); h = w.map(b => b.high); }
        else { const j = await (await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${s}?interval=1d&range=20y`, { headers: { 'User-Agent': 'Mozilla/5.0' } })).json(); const x = j.chart.result[0], q = x.indicators.quote[0]; c = []; h = []; let cur = null;
          x.timestamp.forEach((t, i) => { if (q.close[i] == null) return; const k = Math.floor((t / 86400 + 3) / 7); if (k !== cur) { cur = k; c.push(q.close[i]); h.push(q.high[i] || q.close[i]); } else { c[c.length - 1] = q.close[i]; h[h.length - 1] = Math.max(h[h.length - 1], q.high[i] || 0); } }); }
        if (c.length < 210) continue; const p = c[c.length - 1], done = c.slice(0, -1), sma = done.slice(-200).reduce((a, v) => a + v, 0) / 200, ath = Math.max(...h);
        let g = 0, l = 0; for (let i = 1; i < done.length; i++) { const d = done[i] - done[i - 1], u = Math.max(d, 0), w2 = Math.max(-d, 0); if (i <= 14) { g += u / 14; l += w2 / 14; } else { g = (g * 13 + u) / 14; l = (l * 13 + w2) / 14; } }
        const rsi = l ? 100 - 100 / (1 + g / l) : 100, dd = p / ath - 1, dist = p / sma - 1, z = dist < 0 || rsi < 30 || (cr && dd <= -.5) ? 'g' : dist < .1 || rsi < 40 || (cr && dd <= -.35) ? 'y' : 'w';
        if (z === 'g' && S.acu[s] && S.acu[s] !== 'g') await tg(`🟢 ACUMULACIÓN · ${nm}\nEntró en zona de acumulación a largo plazo: ${dist < 0 ? 'bajo la media de 200 semanas' : ''}${rsi < 30 ? ' · RSI semanal ' + rsi.toFixed(0) : ''}${cr && dd <= -.5 ? ' · ' + (dd * 100).toFixed(0) + ' % desde el máximo' : ''}.\nComprá de a partes (por ejemplo una vez por semana) y sin apalancamiento: puede seguir bajando antes de volver.`);
        S.acu[s] = z; } catch (e) { console.log('acumulación', s, e.message); } } }

  try { await ciclo(now, px); } catch (e) { console.log('ciclo', e.message); }
  /* 2) búsqueda de señales nuevas */
  for (const m of ['medio', 'x']) {
/* octubre 2026 · SHOOTER v8: la lista de monedas era la del volumen del momento y una moneda que se desploma entra a "las 30 con más volumen"
   por el pánico: el bot compraba su rebote y seguía cayendo. Diagnóstico de 1 año: con la lista del momento 82,7 % ganadas y +2,6 % por operación;
   usando solo monedas que están entre las 30 con más volumen PROMEDIO de los últimos 7 días y que no cayeron más de 10 % en 24 h:
   84,8 % y +3,7 % (mejor en las dos mitades del año). Las que cayeron más de 10 % en 24 h daban 50 % ganadas y −30 % por operación. */
    if (m === 'x' && (!S.sh7 || now - S.sh7.t > 36e5)) { const avg = []; for (const t of base.slice(0, 70)) { try { const k = await getJ(`${API}/klines?symbol=${t.symbol}&interval=1d&limit=8`); const c = k.slice(0, -1).slice(-7); if (c.length >= 5) avg.push([t.symbol, c.reduce((a, x) => a + +x[7], 0) / c.length]); } catch (e) {} await sleep(40); }
      if (avg.length >= 30) S.sh7 = { t: now, set: avg.sort((a, b) => b[1] - a[1]).slice(0, 30).map(x => x[0]) }; }
    const cfg = SIGCFG[m], U = (m === 'x' && S.sh7 ? base.filter(t => S.sh7.set.includes(t.symbol) && +t.priceChangePercent > -10) : base).slice(0, cfg.n).map(t => t.symbol); let sent = 0, btcDir = 0; const rankOf = {}; U.forEach((s, k) => rankOf[s] = k);
    if (m === 'x') { try { const bk = await kl('BTCUSDT', '1h', 80), cl = bk.slice(0, -1).map(b => b.close), e = emaArr(cl, 50); btcDir = cl[cl.length - 1] > e[e.length - 1] ? 1 : -1; } catch (e) {} }
    if (m === 'medio') { try { const bk = await kl('BTCUSDT', '4h', 80), cl = bk.slice(0, -1).map(b => b.close), e = emaArr(cl, 50); btcDir = cl[cl.length - 1] > e[e.length - 1] ? 1 : -1; } catch (e) {} }
    for (const s of U) {
      if (S.last[m + s] && now - S.last[m + s] < cfg.cool) continue;
      if (S.open.some(o => o.sym === s && o.m === m)) continue;
      try {
        let e;
        if (m === 'x') { const [c15, c30, hc] = await Promise.all([kl(s, '15m', 300), kl(s, '30m', 300), kl(s, '1h', 200)]); if (c15.length < 150 || hc.length < 60) continue;
          e = evalShooter(c15, hc, 15); if (!e.dir) e = evalShooter(c30, hc, 30); if (!e.dir || !(await wildOK(s, hc))) continue; }
        else { const [cs, hc] = await Promise.all([kl(s, cfg.tf, 300), kl(s, cfg.htf, 120)]); if (cs.length < 150 || hc.length < 30) continue;
          e = evalTrading(cs, hc, rankOf[s]); if (!e.dir || !(await wildOK(s))) continue; }
        const c = e.c, atrP = e.atr / c; if (!(atrP > 0) || atrP > cfg.maxAtr) continue;
        const d = e.dir, setup = e.setup || (m === 'medio' ? 't-pb' : 'sh-r'); let conf = CALSET[setup] || CAL[m].p;
        if (m === 'medio') { if (btcDir !== d) continue; conf += 2; e.reasons.push('BTC a favor'); } // TRADING solo a favor de BTC (SHOOTER v3 no lo usa)
        if (conf < MINCERT[m]) continue;
        const G = GEOM[m], liqD = Math.min(G.maxSl, Math.max(.004, G.a * atrP)), tp = [1, 2, 3].map(k => c * (1 + d * k * G.r * liqD)), sl = c * (1 - d * liqD), ll = m === 'x' ? null : c * (1 - d * liqD * LLTH); // SHOOTER sin salvavidas
        const zone = c * Math.min(cfg.min * .15, atrP * .5), sym = s.replace('USDT', '');
        S.last[m + s] = now; S.open.push({ m, sym: s, dir: d, entry: c, tp, sl, ll, t: now, hit: 0 }); sent++;
        const hx = { m, sym: s, dir: d, entry: c, zl: c - zone, zh: c + zone, tp, sl, ll, conf, setup, reasons: e.reasons.slice(0, 6), t: now, v: VER[m] };
        (S.hist = S.hist || []).push(hx); S.histDirty = true;
        let libro = null; try { const dp = await getJ(`${API}/depth?symbol=${s}&limit=1000`); if (dp && dp.bids && dp.bids.length && dp.asks.length) libro = require('./herramientas/libro-lib.js').stats(dp); } catch (er) {} // foto del libro en el momento de la señal
        if (Array.isArray(S.bit)) { S.bit.push(bitRec(Object.assign({}, hx, { libro }))); S.bitDirty = true; } else (S.bitPend = S.bitPend || []).push(bitRec(Object.assign({}, hx, { libro })));
        await tg(`${d > 0 ? '🟢' : '🔴'} ${cfg.name}: ${d > 0 ? '▲ LONG' : '▼ SHORT'} ${sym}\nEntrada ${fp(c - zone)} – ${fp(c + zone)}\nObjetivos ${fp(tp[0])} · ${fp(tp[1])} · ${fp(tp[2])}\nStop ${fp(sl)} (${pct(sl, c)})${ll != null ? ` · Salvavidas en ${fp(ll)}` : ''}\nAcierto histórico ${conf} % · ${e.reasons.join(' · ')}\n${PAGE}?sym=${s}&tf=${cfg.tf}&m=${m}\nℹ️ Solo informativo, no es consejo financiero.`);
      } catch (err) { console.log(s, err.message); }
      await sleep(80);
    }
    console.log(cfg.name, 'revisadas', U.length, 'nuevas', sent);
  }
  try { VD.S = S; await VERM.run(now, base, S.sh7 ? new Set(S.sh7.set) : null, VD); } catch (e) { console.log('versiones', e.message); }
  try { await semanal(now); } catch (e) { console.log('semanal', e.message); }
  try { IAD.S = S; await IAB.run(now, { tr: base.map(t => t.symbol), sh: (S.sh7 ? base.filter(t => S.sh7.set.includes(t.symbol) && +t.priceChangePercent > -10) : base).slice(0, 30).map(t => t.symbol) }, IAD); } catch (e) { console.log('IA', e.message); }
  for (const k in S.last) if (now - S.last[k] > 3 * 864e5) delete S.last[k];
  S.hist = (S.hist || []).filter(x => now - x.t < 10 * 864e5).slice(-150);
  if (S.histDirty || !S.pubOk) { if (await ghPublish()) { S.histDirty = false; S.pubOk = true; } }
  if (await bitLoad()) { if (S.bitPend) { for (const r of S.bitPend) if (!S.bit.some(b => b.id === r.id)) S.bit.push(r); S.bitPend = null; S.bitDirty = true; }
    let k = 0; for (const r of S.bit) { if (r.out || S.open.some(o => o.sym + '-' + o.t === r.id) || now - r.t < 36e5 || !SIGCFG[r.m] || !Array.isArray(r.tp)) continue; if (k++ >= 6) break; try { await bitResolve(r); } catch (e) {} await sleep(100); }
    if (S.bitDirty && (!S.bitT || now - S.bitT >= 15 * 6e4) && process.env.GH_TOKEN) { const cerr = S.bit.filter(r => r.out).length;
      if (await ghPut('bitacora.json', JSON.stringify({ upd: now, nota: 'Todas las señales del bot 24 h, nunca se borran. libro = [i05, i1, i2, spread_pb, prof1_log10, precio] en el momento de la señal. out.c: 1 stop · 3 volvió a la entrada tras un objetivo · 4 los 3 objetivos · 5 venció el plazo; out.pct = % del margen con comisión, sin salvavidas.', ops: S.bit }), 'bitSha', 'Bitácora del bot 24 h', S.bit.length + ' señales, ' + cerr + ' cerradas')) { S.bitDirty = false; S.bitT = now; } } }
  S.run = now;
  if (TOKEN && CHAT) fs.writeFileSync(STATE_FILE, JSON.stringify(S)); else console.log('Prueba sin Telegram: no se guarda el estado.');
}
/* vuelta larga: revisa cada 5 minutos durante LOOP_MIN minutos (así no depende de la puntualidad del horario de GitHub) */
async function run() { const LOOP = +(process.env.LOOP_MIN || 0) * 6e4, start = Date.now();
  while (true) { const t0 = Date.now(); try { await main(); } catch (e) { console.error(e); }
    if (!LOOP) break; const wait = 3e5 - (Date.now() - t0); /* cada 5 minutos (SHOOTER usa velas de 15 y 30 min) */ if (Date.now() - start + Math.max(0, wait) > LOOP) break; await sleep(Math.max(5000, wait)); }
  try { if (TOKEN && CHAT) fs.writeFileSync(STATE_FILE, JSON.stringify(S)); } catch (_) {} }
run();
