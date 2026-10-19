/* INVESTIGACIÓN FIGURAS CHARTISTAS (octubre 2026). No cambia nada de la página ni de los bots.
   1) Para cada operación simulada de TRADING (1 año con las reglas de hoy y 4 años) y SHOOTER (1 año) mira si justo antes de entrar había una
      figura confirmada (o formándose) a favor, en contra o lateral, y compara ganadas y % por operación de cada grupo, en las dos mitades.
   2) Prueba las figuras solas como señales (entrada al cierre de la ruptura, stop y objetivo de la figura, costos reales) contra entradas al azar
      con la misma distancia de stop y objetivo.
   Escribe investigacion-figuras.json */
const fs = require('fs'), F = require('./figuras-lib.js');
const API = 'https://data-api.binance.vision/api/v3', RAW = 'https://raw.githubusercontent.com/' + (process.env.GITHUB_REPOSITORY || 'mauro-ezequiel/cripto-en-vivo');
const TF = { '4h': 144e5, '15m': 9e5 }, COST = .001 + .0008; // comisión ida y vuelta + deslizamiento
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function getJ(u) { for (let k = 0; k < 5; k++) { try { const r = await fetch(u); if (r.ok) return await r.json(); if (r.status === 400 || r.status === 404) return null; } catch (e) {} await sleep(800 * (k + 1)); } return null; }
const CACHE = {};
async function bars(sym, tf, from, to) { const key = sym + tf; if (CACHE[key] && CACHE[key].from <= from && CACHE[key].to >= to) return CACHE[key].b;
  const out = []; let s = from; while (s < to) { const d = await getJ(`${API}/klines?symbol=${sym}&interval=${tf}&startTime=${s}&limit=1000`); if (!d || !d.length) break;
    for (const k of d) out.push({ t: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] }); const nx = +d[d.length - 1][0] + TF[tf]; if (nx <= s) break; s = nx; if (d.length < 1000) break; await sleep(60); }
  CACHE[key] = { from, to, b: out }; return out; }
const stats = L => { const n = L.length; if (!n) return { n: 0 }; const w = L.filter(x => x.pct > 0).length, s = L.reduce((a, x) => a + x.pct, 0);
  return { n, gana: +(100 * w / n).toFixed(1), pct_op: +(s / n).toFixed(2), total_pct: +s.toFixed(1) }; };
/* estado de figuras justo antes de entrar: confirmada en las últimas LB velas cerradas, o formándose */
function estado(b, idx, dir, LB) { const w = b.slice(Math.max(0, idx - 400), idx + 1), off = Math.max(0, idx - 400), f = F.scan(w, { formando: true, maxAge: 20 });
  const conf = f.filter(x => x.conf && x.i1 + off >= idx - LB).pop(); if (conf) return { g: conf.dir === dir ? 'a_favor' : conf.dir === -dir ? 'en_contra' : 'lateral', tipo: conf.tipo, conf: 1 };
  const form = f.filter(x => !x.conf).pop(); if (form) return { g: form.dir === dir ? 'formando_a_favor' : form.dir === -dir ? 'formando_en_contra' : 'formando_lateral', tipo: form.tipo, conf: 0 };
  return { g: 'sin_figura' }; }
async function botStudy(ops, m, tf, LB, label) { const mg = m === 'medio' ? 350 : 50, bySym = {}; for (const o of ops) (bySym[o[2]] = bySym[o[2]] || []).push(o);
  const rows = []; let k = 0;
  for (const [sym, L] of Object.entries(bySym)) { const t0 = Math.min(...L.map(o => o[3])) - 420 * TF[tf], t1 = Math.max(...L.map(o => o[3])) + TF[tf];
    const b = await bars(sym + 'USDT', tf, t0, t1); if (!b.length) continue;
    for (const o of L) { let idx = -1; for (let i = b.length - 1; i >= 0; i--) if (b[i].t + TF[tf] <= o[3]) { idx = i; break; } if (idx < 60) continue;
      const e = estado(b, idx, o[4], LB); rows.push({ t: o[3], sym, dir: o[4], pct: o[7] / mg * 100, ...e }); }
    if (++k % 10 === 0) console.log(label, k, '/', Object.keys(bySym).length); }
  rows.sort((a, b) => a.t - b.t); const cut = rows.length ? rows[rows.length >> 1].t : 0, G = {};
  for (const r of rows) for (const g of ['todas', r.g, r.conf === 1 ? 'confirmada_' + r.g : null].filter(Boolean)) { G[g] = G[g] || { all: [], h1: [], h2: [] }; G[g].all.push(r); (r.t < cut ? G[g].h1 : G[g].h2).push(r); }
  const grupos = {}; for (const g in G) grupos[g] = { año: stats(G[g].all), mitad1: stats(G[g].h1), mitad2: stats(G[g].h2) };
  const tipos = {}; for (const r of rows) if (r.tipo) { const key = r.tipo + ':' + r.g; (tipos[key] = tipos[key] || []).push(r); } for (const t in tipos) tipos[t] = stats(tipos[t]);
  const filt = (nm, keep) => { const K = rows.filter(keep); return { nombre: nm, año: stats(K), mitad1: stats(K.filter(r => r.t < cut)), mitad2: stats(K.filter(r => r.t >= cut)) }; };
  const filtros = [filt('sin filtro', r => true), filt('saca las que tienen figura confirmada en contra', r => r.g !== 'en_contra'),
    filt('saca en contra (confirmada o formándose)', r => !/en_contra/.test(r.g)), filt('solo con figura a favor (confirmada o formándose)', r => /a_favor/.test(r.g)),
    filt('saca en contra y laterales', r => !/en_contra|lateral/.test(r.g))];
  return { bot: label, tf, ventana_velas: LB, n: rows.length, grupos, filtros, tipos }; }
/* figuras solas como señal: entrada al cierre de la ruptura, stop y objetivo de la figura (objetivo limitado a 3 veces el stop), plazo 60 velas */
function outcome(b, i, dir, stop, obj, H = 60) { const e = b[i].close; for (let k = i + 1; k < Math.min(b.length, i + 1 + H); k++) { const x = b[k];
    if (dir > 0 ? x.low <= stop : x.high >= stop) return dir * (stop / e - 1) - COST; if (dir > 0 ? x.high >= obj : x.low <= obj) return dir * (obj / e - 1) - COST; }
  const j = Math.min(b.length - 1, i + H); return dir * (b[j].close / e - 1) - COST; }
async function soloStudy(syms, tf, days) { const to = Date.now(), from = to - days * 864e5, R = {}, Z = {}; let rnd = 1;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  for (const s of syms) { const b = await bars(s, tf, from - 300 * TF[tf], to); if (b.length < 300) continue; const A = F.atrArr(b);
    for (const f of F.scan(b)) { if (!f.conf || f.i1 < 300 || f.i1 >= b.length - 2) continue; const e = b[f.i1].close, sd = Math.abs(e - f.stop) / e; if (!(sd > .002 && sd < .2)) continue;
      const od = Math.min(Math.abs(f.obj - e) / e, 3 * sd), obj = e * (1 + f.dir * od), r = outcome(b, f.i1, f.dir, f.stop, obj); const half = b[f.i1].t < (from + to) / 2 ? 'h1' : 'h2';
      for (const key of [f.tipo, 'todas']) { R[key] = R[key] || { all: [], h1: [], h2: [] }; R[key].all.push(r); R[key][half].push(r); }
      for (let z = 0; z < 5; z++) { const i = 300 + Math.floor(rand() * (b.length - 362)), e2 = b[i].close; const rr = outcome(b, i, f.dir, e2 * (1 - f.dir * sd), e2 * (1 + f.dir * od));
        for (const key of [f.tipo, 'todas']) (Z[key] = Z[key] || []).push(rr); } } }
  const st = a => a && a.length ? { n: a.length, gana: +(100 * a.filter(x => x > 0).length / a.length).toFixed(1), pct_op: +(100 * a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) } : { n: 0 };
  const out = {}; for (const k in R) out[k] = { figura: st(R[k].all), mitad1: st(R[k].h1), mitad2: st(R[k].h2), azar: st(Z[k]) }; return out; }
(async () => {
  const res = { upd: Date.now(), nota: 'pct_op de los bots = % del margen por operación (con costos). En "solas", pct_op = % del precio por operación sin apalancar, con costos.' };
  const y1 = await getJ(RAW + '/datos/historial.json'), y4 = await getJ(RAW + '/var-38957334629/historial.json');
  const ops1 = (y1 && y1.ops || []).filter(o => o[6] !== 0 && o[1] !== 'tp-x'), ops4 = (y4 && y4.ops || []).filter(o => o[6] !== 0 && o[1] !== 'tp-x');
  console.log('ops 1 año', ops1.length, '· 4 años', ops4.length);
  res.trading_1año = await botStudy(ops1.filter(o => o[0] === 'medio'), 'medio', '4h', 12, 'TRADING 1 año'); fs.writeFileSync('investigacion-figuras.json', JSON.stringify(res, null, 1));
  res.trading_4años = await botStudy(ops4.filter(o => o[0] === 'medio'), 'medio', '4h', 12, 'TRADING 4 años'); fs.writeFileSync('investigacion-figuras.json', JSON.stringify(res, null, 1));
  res.shooter_1año = await botStudy(ops1.filter(o => o[0] === 'x'), 'x', '15m', 16, 'SHOOTER 1 año'); fs.writeFileSync('investigacion-figuras.json', JSON.stringify(res, null, 1));
  const tk = await getJ(API + '/ticker/24hr'), syms = (tk || []).filter(t => /USDT$/.test(t.symbol) && !/^(USDC|FDUSD|TUSD|BUSD|DAI|EUR|USDP)/.test(t.symbol)).sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 40).map(t => t.symbol);
  res.solas_4h_4años = await soloStudy(syms, '4h', 1460); fs.writeFileSync('investigacion-figuras.json', JSON.stringify(res, null, 1));
  res.solas_15m_1año = await soloStudy(syms.slice(0, 25), '15m', 365); fs.writeFileSync('investigacion-figuras.json', JSON.stringify(res, null, 1));
  console.log('listo');
})().catch(e => { console.error(e); process.exit(1); });
