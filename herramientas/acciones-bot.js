/* ACCIONES 24 h (octubre 2026): las señales de ACCIONES ya no las busca cada navegador por su cuenta.
   Cada 30 min (acciones24.yml) este script abre la página publicada con ?bot=acciones en un Chrome sin pantalla, le carga el estado compartido
   (datos/acciones.json: operaciones y señales), la deja buscar con exactamente las mismas reglas que siempre (velas diarias, noticias, termómetro)
   y seguir las operaciones abiertas, y publica el resultado otra vez en datos/acciones.json. Todas las cuentas y dispositivos leen ese archivo.
   Avisa por Telegram las señales nuevas y las operaciones que se cierran. Nunca borra operaciones: solo agrega o actualiza. */
const { chromium } = require('playwright-core');
const REPO = process.env.GITHUB_REPOSITORY || 'mauro-ezequiel/cripto-en-vivo', TOK = process.env.GH_TOKEN;
const TOKEN = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT, CANAL = process.env.TELEGRAM_CANAL || '@criptolive_senales';
const PAGE = 'https://mauro-ezequiel.github.io/cripto-en-vivo/?bot=acciones&t=' + Date.now();
const H = { Authorization: 'Bearer ' + TOK, Accept: 'application/vnd.github+json', 'User-Agent': 'cripto-live-acciones' }, API = 'https://api.github.com/repos/' + REPO;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fp = p => (+p).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function sendTo(chat, text) { try { const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: 'POST', body: new URLSearchParams({ chat_id: chat, text, disable_web_page_preview: 'true' }) }); const j = await r.json(); if (!j.ok) console.log('Telegram', chat, j.description); } catch (e) { console.log('Telegram', e.message); } }
async function tg(text) { if (!TOKEN || !CHAT) { console.log('[sin Telegram]', text); return; } await sendTo(CHAT, text); if (CANAL) await sendTo(CANAL, text); }
async function leer() { const r = await fetch(API + '/contents/acciones.json?ref=datos', { headers: H });
  if (r.status === 404) return { sha: null, j: { ops: [], senales: [] } };
  if (!r.ok) throw new Error('no pude leer acciones.json: ' + r.status);
  const g = await r.json(); return { sha: g.sha, j: JSON.parse(Buffer.from(g.content, 'base64').toString('utf8')) }; }
async function escribir(sha, j, msg) { const r = await fetch(API + '/contents/acciones.json', { method: 'PUT', headers: H, body: JSON.stringify(Object.assign({ message: msg, content: Buffer.from(JSON.stringify(j)).toString('base64'), branch: 'datos' }, sha ? { sha } : {})) });
  if (!r.ok) throw new Error('no pude publicar: ' + r.status + ' ' + (await r.text()).slice(0, 200)); }
(async () => {
  const { sha, j: prev } = await leer(); prev.ops = prev.ops || []; prev.senales = prev.senales || [];
  const br = await chromium.launch({ channel: process.env.CHROME_CHANNEL || 'chrome', executablePath: process.env.CHROME_PATH || undefined });
  const pg = await br.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
  await pg.addInitScript(st => { try { localStorage.clear(); localStorage.setItem('cv_ops', JSON.stringify(st.ops)); localStorage.setItem('cv_ops_arch', '[]');
      localStorage.setItem('cv_sig', JSON.stringify({ medio: [], x: [], p: [], a: st.senales })); localStorage.setItem('cv_mode', 'a'); } catch (e) {} }, prev);
  await pg.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await pg.waitForFunction(() => typeof stkReady !== 'undefined' && stkReady && typeof scanSignals === 'function', null, { timeout: 120000 });
  await pg.evaluate(() => { if (mode !== 'a') applyMode('a'); });
  await sleep(20000); // noticias y mercado (el termómetro de las acciones las usa)
  await pg.waitForFunction(() => !scanBusy, null, { timeout: 600000 });
  const t0 = Date.now(); await pg.evaluate(async () => { lastScan.a = 0; await scanSignals('a'); });
  await pg.waitForFunction(t => !scanBusy && lastScan.a >= t, t0, { timeout: 900000 });
  await pg.evaluate(async () => { await syncOps(); });
  await sleep(3000);
  const out = await pg.evaluate(() => ({ ops: OPS.filter(o => o.m === 'a'), senales: SIG.a, n: stkUniverse().length }));
  await br.close();
  /* une sin borrar: las del archivo se actualizan con lo que hizo la página y se agregan las nuevas */
  const M = new Map(prev.ops.map(o => [o.id, o])), nuevas = [], cerradas = [];
  for (const o of out.ops) { const a = M.get(o.id); if (!a) nuevas.push(o); else if (a.state === 'open' && o.state !== 'open') cerradas.push(o); M.set(o.id, o); }
  const ops = [...M.values()].sort((a, b) => a.t - b.t), senales = out.senales.filter(s => s.state === 'live' || Date.now() - (s.lostAt || s.t) < 3 * 864e5);
  console.log('acciones revisadas', out.n, '· operaciones', ops.length, '· nuevas', nuevas.length, '· cerradas', cerradas.length, '· errores de la página', errs.length);
  if (errs.length) console.log(errs.slice(0, 5).join('\n'));
  await escribir(sha, { upd: Date.now(), revisadas: out.n, nota: 'ACCIONES del bot 24 h (la página con ?bot=acciones cada 30 min). ops: todas las operaciones, nunca se borran. senales: las tarjetas de señales.', ops, senales },
    'ACCIONES 24 h: ' + ops.length + ' operaciones' + (nuevas.length ? ', ' + nuevas.length + ' nuevas' : ''));
  for (const o of nuevas) { const L = o.dir > 0, sl = Math.abs(o.fail / o.entry - 1) * 100;
    await tg(`🏛 ACCIONES · ${L ? '▲ LONG' : '▼ SHORT'} ${o.sym}\nEntrada ${fp(o.entry)} USD · objetivos ${[o.tp0, o.tp1, o.tp2].map(fp).join(' · ')}\nStop ${fp(o.fail)} (−${sl.toFixed(1)} %) · × ${o.lev}${o.reasons && o.reasons.length ? '\n' + o.reasons.slice(0, 3).join(' · ') : ''}\nℹ️ Solo informativo, no es consejo financiero.`); }
  for (const o of cerradas) await tg(`🏛 ACCIONES · ${o.pnl >= 0 ? '✓' : '✕'} cerró ${o.sym} ${o.dir > 0 ? 'LONG' : 'SHORT'}: ${o.why || o.state} · ${o.pnl >= 0 ? '+' : ''}${(+o.pnl || 0).toFixed(2)} USD`);
})().catch(e => { console.error(e); process.exit(1); });
