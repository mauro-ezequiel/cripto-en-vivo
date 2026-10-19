/* INVESTIGACIÓN FIGURAS en ACCIONES (octubre 2026). No cambia la página ni los bots.
   Abre la página publicada en un Chrome sin pantalla (?bot=estudio), le pide el último año simulado de ACCIONES (las mismas reglas de siempre),
   y para cada operación mira si antes de entrar había una figura a favor, en contra o lateral en las velas diarias. Además prueba las figuras
   solas en las acciones de la lista (velas diarias, hasta ~6 años) contra entradas al azar. Escribe investigacion-figuras-acciones.json */
const fs = require('fs'), { chromium } = require('playwright-core');
const LIB = fs.readFileSync(__dirname + '/figuras-lib.js', 'utf8');
const stats = L => { const n = L.length; if (!n) return { n: 0 }; const w = L.filter(x => x.pct > 0).length, s = L.reduce((a, x) => a + x.pct, 0); return { n, gana: +(100 * w / n).toFixed(1), pct_op: +(s / n).toFixed(2), total_pct: +s.toFixed(1) }; };
(async () => {
  const br = await chromium.launch({ channel: 'chrome' }), pg = await br.newPage();
  await pg.goto('https://mauro-ezequiel.github.io/cripto-en-vivo/?bot=estudio&t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await pg.waitForFunction(() => typeof stkReady !== 'undefined' && stkReady && typeof histStocks === 'function', null, { timeout: 180000 });
  await pg.evaluate(() => { if (mode !== 'a') applyMode('a'); }); await pg.addScriptTag({ content: LIB });
  await pg.evaluate(async () => { HIST_A = null; await histStocks(); }); await pg.waitForFunction(() => Array.isArray(HIST_A) && HIST_A.length > 0, null, { timeout: 1500000 });
  const R = await pg.evaluate(async () => { const ops = HIST_A.filter(o => o.state !== 'open'), rows = [], mg = SIM.a.margin, solo = {}, rand = {}; let rnd = 7;
    const rr = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
    const COST = .002, outc = (b, i, dir, stop, obj, H = 30) => { const e = b[i].close; for (let k = i + 1; k < Math.min(b.length, i + 1 + H); k++) { const x = b[k];
        if (dir > 0 ? x.low <= stop : x.high >= stop) return dir * (stop / e - 1) - COST; if (dir > 0 ? x.high >= obj : x.low <= obj) return dir * (obj / e - 1) - COST; } const j = Math.min(b.length - 1, i + H); return dir * (b[j].close / e - 1) - COST; };
    const syms = [...new Set(ops.map(o => o.sym).concat(stkUniverse()))];
    for (const s of syms) { let b; try { b = (await stkHist(s)).map(x => ({ t: x.t, open: x.open, high: x.high, low: x.low, close: x.close })); } catch (e) { continue; } if (!b || b.length < 260) continue;
      for (const o of ops.filter(x => x.sym === s)) { let idx = -1; for (let i = b.length - 1; i >= 0; i--) if (b[i].t <= o.t) { idx = i; break; } if (idx < 60) continue;
        rows.push(Object.assign({ t: o.t, sym: s, dir: o.dir, pct: o.pnl / mg * 100 }, FIG.estado(b, idx, o.dir, 5))); }
      const half = b[Math.floor(b.length / 2)].t;
      for (const f of FIG.scan(b)) { if (!f.conf || f.i1 < 260 || f.i1 >= b.length - 2) continue; const e = b[f.i1].close, sd = Math.abs(e - f.stop) / e; if (!(sd > .005 && sd < .25)) continue;
        const od = Math.min(Math.abs(f.obj - e) / e, 3 * sd), r = outc(b, f.i1, f.dir, f.stop, e * (1 + f.dir * od)), h = b[f.i1].t < half ? 'h1' : 'h2';
        for (const k of [f.tipo, 'todas']) { solo[k] = solo[k] || { all: [], h1: [], h2: [] }; solo[k].all.push(r); solo[k][h].push(r); }
        for (let z = 0; z < 5; z++) { const i = 260 + Math.floor(rr() * (b.length - 292)), e2 = b[i].close; const r2 = outc(b, i, f.dir, e2 * (1 - f.dir * sd), e2 * (1 + f.dir * od)); for (const k of [f.tipo, 'todas']) (rand[k] = rand[k] || []).push(r2); } } }
    return { rows, solo, rand, n: ops.length }; });
  await br.close();
  const rows = R.rows.sort((a, b) => a.t - b.t), cut = rows.length ? rows[rows.length >> 1].t : 0, G = {};
  for (const r of rows) for (const g of ['todas', r.g]) { G[g] = G[g] || { all: [], h1: [], h2: [] }; G[g].all.push(r); (r.t < cut ? G[g].h1 : G[g].h2).push(r); }
  const grupos = {}; for (const g in G) grupos[g] = { año: stats(G[g].all), mitad1: stats(G[g].h1), mitad2: stats(G[g].h2) };
  const filt = (nm, keep) => { const K = rows.filter(keep); return { nombre: nm, año: stats(K), mitad1: stats(K.filter(r => r.t < cut)), mitad2: stats(K.filter(r => r.t >= cut)) }; };
  const st = a => a && a.length ? { n: a.length, gana: +(100 * a.filter(x => x > 0).length / a.length).toFixed(1), pct_op: +(100 * a.reduce((s, x) => s + x, 0) / a.length).toFixed(2) } : { n: 0 };
  const solas = {}; for (const k in R.solo) solas[k] = { figura: st(R.solo[k].all), mitad1: st(R.solo[k].h1), mitad2: st(R.solo[k].h2), azar: st(R.rand[k]) };
  fs.writeFileSync('investigacion-figuras-acciones.json', JSON.stringify({ upd: Date.now(), operaciones: R.n, analizadas: rows.length, grupos,
    filtros: [filt('sin filtro', r => true), filt('saca las que tienen figura confirmada en contra', r => r.g !== 'en_contra'), filt('saca en contra (confirmada o formándose)', r => !/en_contra/.test(r.g)),
      filt('solo con figura a favor', r => /a_favor/.test(r.g)), filt('saca en contra y laterales', r => !/en_contra|lateral/.test(r.g))], solas_diarias: solas }, null, 1));
  console.log('listo', rows.length);
})().catch(e => { console.error(e); process.exit(1); });
