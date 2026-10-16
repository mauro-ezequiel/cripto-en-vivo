/* IA 24 h (octubre 2026): la IA piensa y practica todo el tiempo dentro del bot 24 h, aunque la página esté cerrada.
   Cada vela recién cerrada (15 y 30 min SHOOTER, 4 h TRADING) mira las candidatas de cada modo con el modelo que aprendió en el estudio diario (ia.json).
   - Operaciones REALES: solo si en la prueba sus entradas propias ganaron ≥ 1 % del margen por operación y acertaron al menos como los bots
     (TRADING 70 %, SHOOTER 80 %) y el puntaje supera su umbral. Se ven en la página y avisan por Telegram (solo al chat privado).
   - Operaciones de PRÁCTICA: con un umbral un poco más bajo y sin esas condiciones, para que aprenda de lo que pasa en vivo. No avisan.
   Todas se siguen con velas de 1 min (primero el stop, después los objetivos; tocado el objetivo 1 el stop pasa a la entrada) y quedan guardadas
   en datos/ia-ops.json. El estudio diario mide su acierto real por puntaje y ajusta el umbral en vivo (ia.json → vivo). */
const IA = require('../ia-core.js');
const CFG = { tr: { nm: 'TRADING', mg: 350, lev: 10, age: 7 * 864e5, cool: 24 * 36e5, max: 4, maxP: 8, tfs: ['4h'], a: 3, r: .75, cap: .036, wmin: 70 },
  sh: { nm: 'SHOOTER', mg: 50, lev: 15, age: 12 * 36e5, cool: 36e5, max: 6, maxP: 12, tfs: ['15m', '30m'], a: 4, r: .25, cap: .05, wmin: 80 } };
const FEE = .0008, TFMS = { '15m': 9e5, '30m': 18e5, '4h': 144e5 }, PRACT = .85; // práctica: desde el 85 % del umbral
function gates(E, f) { const PR = E && E.test && E.test.propias; return !!(E && E.thr != null && PR && PR.pct >= 1 && PR.pct > PR.base_pct && (PR.gana || PR.obj1 || 0) >= CFG[f].wmin); }
function close(x, px, st, why, t) { x.real += x.dir * (px / x.entry - 1) * (3 - x.hit) / 3; x.st = st; x.why = why; x.closeT = t; x.closePx = px; x.res = x.real; x.pnl = +Math.max(-x.mg, x.mg * x.lev * (x.real - FEE)).toFixed(2); }
function step(x, k) { if (x.st !== 'open') return null; const d = x.dir, stop = x.hit ? x.entry : x.stop;
  if (d > 0 ? k.low <= stop : k.high >= stop) { close(x, stop, x.hit ? 'win' : 'fail', x.hit ? `Tocó ${x.hit}/3 objetivos y salió en la entrada` : 'Tocó el stop', k.t + 6e4); return 'close'; }
  let ev = null; while (x.hit < 3 && (d > 0 ? k.high >= x.tps[x.hit] : k.low <= x.tps[x.hit])) { x.real += d * (x.tps[x.hit] / x.entry - 1) / 3; x.hit++; ev = 'hit'; }
  if (x.hit >= 3) { x.st = 'win'; x.why = 'Llegó a los 3 objetivos'; x.closeT = k.t + 6e4; x.closePx = x.tps[2]; x.res = x.real; x.pnl = +(x.mg * x.lev * (x.real - FEE)).toFixed(2); return 'close'; }
  return ev; }
/* deps: { S, getJ, kl, API, cycFall, tg, fp, ghPut, sleep } */
async function run(now, U, D) { const { S, getJ, kl, API, cycFall, tg, fp, sleep } = D;
  if (!S.ia) { try { const r = await fetch('https://raw.githubusercontent.com/' + (process.env.GITHUB_REPOSITORY || 'mauro-ezequiel/cripto-en-vivo') + '/datos/ia-ops.json?t=' + now);
      if (r.ok) { const j = await r.json(); S.ia = { ops: Array.isArray(j.ops) ? j.ops : [] }; } else if (r.status === 404) S.ia = { ops: [] }; else return; } catch (e) { return; } }
  const A = S.ia; let ch = false;
  /* modelo del estudio diario, cada 3 h */
  if (!A.mT || now - A.mT > 3 * 36e5) { try { const r = await fetch('https://raw.githubusercontent.com/' + (process.env.GITHUB_REPOSITORY || 'mauro-ezequiel/cripto-en-vivo') + '/datos/ia.json?t=' + now); if (r.ok) { D.M = await r.json(); A.mT = now; } } catch (e) {} }
  const M = D.M; const nm = x => `${x.sym.replace('USDT', '')} ${x.dir > 0 ? 'LONG' : 'SHORT'} (${CFG[x.f].nm} ${x.tf})`;
  /* 1) seguimiento con velas de 1 min */
  for (const x of A.ops.filter(o => o.st === 'open')) { let from = x.chk || x.t;
    for (let g = 0; g < 4 && x.st === 'open'; g++) { let b = null; try { b = (await getJ(`${API}/klines?symbol=${x.sym}&interval=1m&startTime=${from}&limit=1000`)).map(k => ({ t: +k[0], high: +k[2], low: +k[3], close: +k[4] })); } catch (e) {}
      if (!b || !b.length) break; let n = 0;
      for (const k of b) { if (k.t + 6e4 > now || k.t >= x.t + x.age) break; n++; const h0 = x.hit, ev = step(x, k); from = k.t + 6e4;
        if (!x.pr && ev === 'hit' && x.st === 'open') await tg(`🧠 IA · 🎯 objetivo ${x.hit} en ${nm(x)}: cerró 1/3 en ${fp(x.tps[x.hit - 1])}${h0 === 0 ? '. El stop pasa a la entrada.' : '.'}`, false);
        if (ev === 'close') break; }
      x.chk = from; ch = true; if (b.length < 1000 || !n || x.st !== 'open') break; }
    if (x.st === 'open' && now >= x.t + x.age) { let p = x.entry; try { const t = await getJ(`${API}/ticker/price?symbol=${x.sym}`); p = +t.price || p; } catch (e) {} close(x, p, x.hit || x.dir * (p - x.entry) > 0 ? 'win' : 'exp', 'Se cumplió el tiempo máximo', now); ch = true; }
    if (x.st !== 'open' && !x.pr && !x.sent) { x.sent = 1; await tg(`🧠 IA · ${x.pnl >= 0 ? '✓' : '✕'} cerró ${nm(x)}: ${x.why} · ${x.pnl >= 0 ? '+' : ''}${x.pnl.toFixed(2)} USD (${x.mg} USD × ${x.lev})`, false); }
    await sleep(60); }
  /* 2) búsqueda en cada vela recién cerrada */
  if (M && M.tr && M.sh) { A.last = A.last || {};
    for (const f of ['tr', 'sh']) { const C = CFG[f], E = M[f] && M[f].entry; if (!E || !E.model || E.thr == null) continue;
      const real = gates(E, f), thr = Math.max(E.thr, (M.vivo && M.vivo[f] && M.vivo[f].thr) || 0), thrP = E.thr * PRACT;
      for (const tf of C.tfs) { const ms = TFMS[tf], bar = Math.floor(now / ms) * ms; if (A.last[f + tf] === bar || now - bar < 60e3) continue; A.last[f + tf] = bar; ch = true; if (now - bar > 20 * 6e4) continue; // solo velas recién cerradas: precio de entrada real
        let bs = 0; try { const b = (await kl('BTCUSDT', tf, 80)).slice(0, -1), e = IA._.ema(b.map(x => x.close), 50); bs = b[b.length - 1].close > e[e.length - 1] ? 1 : -1; } catch (e) {}
        const out = [];
        for (const s of U[f]) { try { const b = (await kl(s, tf, 300)).slice(0, -1); if (b.length < 220) continue; const P = IA.prep(b), j = b.length - 1, c = b[j].close; let d = 0;
            if (f === 'tr') { const st = P.st[j]; if (st && P.e200[j] != null && Math.sign(P.e21[j] - P.e50[j]) === st && Math.sign(c - P.e200[j]) === st) d = st; if (d < 0 && !cycFall(now)) d = 0; }
            else { const z = P.bs[j] ? (c - P.bm[j]) / P.bs[j] : 0; if (z <= -1.8 && P.r7[j] != null && P.r7[j] <= 35) d = 1; }
            if (!d) continue; const p = IA.predict(E.model, IA.entryX(P, j, d, bs)); if (!(p >= thrP)) continue;
            const sl = Math.min(C.cap, Math.max(.004, C.a * (P.atr[j] || 0) / c));
            out.push({ id: s + '-' + f + '-' + tf + '-' + b[j].t, f, tf, sym: s, dir: d, p: +p.toFixed(4), entry: c, sl, tps: [1, 2, 3].map(k => c * (1 + d * k * C.r * sl)), stop: c * (1 - d * sl), t: b[j].t + ms, pr: !(real && p >= thr) ? 1 : 0,
              why: IA.explain(E.model, IA.entryX(P, j, d, bs), IA.ENTRY_F).slice(0, 3) }); } catch (e) {} await sleep(50); }
        for (const x of out.sort((a, b) => b.p - a.p)) { if (A.ops.some(y => y.id === x.id) || A.ops.some(y => y.sym === x.sym && y.f === x.f && !!y.pr === !!x.pr && (y.st === 'open' || x.t - y.t < C.cool))) continue;
          if (A.ops.filter(y => y.f === x.f && !!y.pr === !!x.pr && y.st === 'open').length >= (x.pr ? C.maxP : C.max)) continue;
          Object.assign(x, { mg: C.mg, lev: C.lev, age: C.age, hit: 0, real: 0, st: 'open', thr: +thr.toFixed(4), bot: 1 }); A.ops.push(x); ch = true;
          if (!x.pr) await tg(`🧠 IA · nueva operación ${nm(x)}\nEntrada ${fp(x.entry)} · objetivos ${x.tps.map(fp).join(' · ')}\nStop ${fp(x.stop)} · puntaje ${Math.round(x.p * 100)} % · ${C.mg} USD × ${C.lev}\nℹ️ Solo informativo, no es consejo financiero.`, false); } } } }
  /* 3) guarda (las últimas 3000) y publica cuando cambia algo, como mucho cada 10 min */
  if (A.ops.length > 3000) A.ops = A.ops.slice(-3000);
  if (ch) A.dirty = true;
  if (A.dirty && (!A.pubT || now - A.pubT >= 10 * 6e4) && process.env.GH_TOKEN) { const cl = A.ops.filter(o => o.st !== 'open');
    if (await D.ghPut('ia-ops.json', JSON.stringify({ upd: now, nota: 'Operaciones de la IA en el bot 24 h. pr = 1: práctica (no se avisa). st: open / win / fail / exp. pnl en USD con comisión.', ops: A.ops }), 'iaSha', 'IA 24 h', A.ops.length + ' operaciones, ' + cl.length + ' cerradas')) { A.dirty = false; A.pubT = now; } } }
module.exports = { run, CFG, step, gates };
