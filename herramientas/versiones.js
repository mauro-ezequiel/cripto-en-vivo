/* VERSIONES EN PARALELO (octubre 2026): cada versión de TRADING y SHOOTER sigue dando señales las 24 h dentro del bot, en práctica (sin Telegram:
   a Telegram solo llegan las de la versión actual, que salen del bot como siempre). Así se ve en vivo cómo le va a cada una con el mismo mercado.
   En cada señal se guarda una foto de los indicadores, para ver cuál le suma y cuál le resta a cada versión. Todo queda en datos/versiones.json.
   Las reglas de cada versión salen del historial de cambios (git): v1 es la más vieja. Para comparar las reglas, todas usan el margen de hoy
   (TRADING 350 USD × 10 · SHOOTER 50 USD × su X de entonces) y comisión de 0,05 % por lado; sin salvavidas. */
const H = 36e5, DAY = 864e5, TFMS = { '3m': 18e4, '5m': 3e5, '15m': 9e5, '30m': 18e5, '1h': H, '4h': 4 * H, '1d': DAY };
const VERS = {
  medio: [
    { v: 1, desde: '2026-10-07T12:53:00+02:00', txt: 'Tendencia alineada (Supertrend, EMA 21/50/200) y retroceso; stop 3 ATR (máx. 3,6 %), objetivos 0,5 × stop', btc: 0, brake: 0, d200: 0, ciclo: 0, r: .5 },
    { v: 2, desde: '2026-10-07T14:45:00+02:00', txt: '+ solo a favor de BTC', btc: 1, brake: 0, d200: 0, ciclo: 0, r: .5 },
    { v: 3, desde: '2026-10-08T14:57:00+02:00', txt: '+ el retroceso tiene que frenar antes de la EMA 50', btc: 1, brake: 1, d200: 0, ciclo: 0, r: .5 },
    { v: 4, desde: '2026-10-12T19:57:00+02:00', txt: '+ precio a menos de 8 % de la EMA 200, objetivos 0,75 × stop', btc: 1, brake: 1, d200: 1, ciclo: 0, r: .75 },
    { v: 5, desde: '2026-10-13T23:57:00+02:00', txt: '+ shorts solo en la fase de caída del ciclo del halving', btc: 1, brake: 1, d200: 1, ciclo: 1, r: .75 }],
  x: [
    { v: 1, desde: '2026-10-07T12:53:00+02:00', txt: 'Velas de 5 min: cierre fuera de la banda de Bollinger (±2) con RSI 7 ≤ 35 / ≥ 65 y la tendencia de 15 min a favor (LONG y SHORT)', k: 'bb', tfs: ['5m'], htf: '15m', r7: 35, btc: 0, n: 45, a: 3, r: .5, cap: .076, lev: 10, age: 4 * H, cool: 1.5 * H },
    { v: 2, desde: '2026-10-07T15:16:00+02:00', txt: '+ RSI 7 extremo (≤ 25 / ≥ 75) y solo a favor de BTC', k: 'bb', tfs: ['5m'], htf: '15m', r7: 25, btc: 1, n: 45, a: 3, r: .5, cap: .076, lev: 10, age: 4 * H, cool: 1.5 * H },
    { v: 3, desde: '2026-10-08T15:08:00+02:00', txt: 'Velas de 3 min: rebote después de caer 3 % en 1 h, bajo la banda de Bollinger con RSI 7 ≤ 35 y la tendencia de 1 h a favor (solo LONG)', k: 'drop', tfs: ['3m'], n: 30, a: 3, r: .5, cap: .076, lev: 10, age: 4 * H, cool: 1.5 * H, atrMin: .004, atrMax: .012 },
    { v: 4, desde: '2026-10-08T17:02:00+02:00', txt: 'La misma regla en velas de 15 y 30 min, las 30 con más volumen; stop 3 ATR (máx. 5 %), objetivos 0,35 × stop, × 15', k: 'drop', tfs: ['15m', '30m'], n: 30, a: 3, r: .35, cap: .05, lev: 15, age: 12 * H, cool: H },
    { v: 5, desde: '2026-10-12T19:57:00+02:00', txt: '+ solo con el precio sobre la EMA 200; stop 4 ATR, objetivos 0,25 × stop', k: 'drop', tfs: ['15m', '30m'], n: 30, e200: 1, a: 4, r: .25, cap: .05, lev: 15, age: 12 * H, cool: H },
    { v: 6, desde: '2026-10-14T16:29:00+02:00', txt: '+ solo las 30 con más volumen promedio de 7 días y sin caídas de más de 10 % en 24 h', k: 'drop', tfs: ['15m', '30m'], n: 30, e200: 1, uni7: 1, a: 4, r: .25, cap: .05, lev: 15, age: 12 * H, cool: H }] };
const MG = { medio: 350, x: 50 }, TR = { a: 3, cap: .036, lev: 10, age: 7 * DAY, cool: 24 * H };
const CYC_TOPS = ['2013-12-04', '2017-12-17', '2021-11-10', '2025-10-06'].map(d => Date.parse(d + 'T00:00:00Z')), cycFall = t => CYC_TOPS.some(a => t >= a && t < a + 400 * DAY);
const r2 = v => v == null || !isFinite(v) ? null : +(+v).toFixed(2);

/* D: funciones del bot (withCandles, closes, emaArr, calcRSI, calcADX, calcST, smaStd, wilder, trArr, htfTrend, lastBarStats, kl, getJ, API, ghPut, sleep) */
function trAll(D, cs, hc, rank, btcDir, now) { const cc = cs.slice(0, -1);
  return D.withCandles(cc, () => { const i = cc.length - 1, cl = D.closes(), c = cs[cs.length - 1].close, cb = cc[i].close, atr = D.wilder(D.trArr(), 14)[i], atrP = atr / cb;
    const st = D.calcST(10, 3).dir[i], e21 = D.emaArr(cl, 21)[i], e50 = D.emaArr(cl, 50)[i], e200 = D.emaArr(cl, 200)[i], r14 = D.calcRSI(14)[i], L = D.lastBarStats(cc, i);
    if (e200 == null || r14 == null) return [];
    const dir = st === 1 && e21 > e50 && cb > e200 ? 1 : st === -1 && e21 < e50 && cb < e200 ? -1 : 0;
    if (!dir || L.vr >= 1 || !(atrP > .01 && atrP <= .05 / 3)) return [];
    const pull = dir > 0 ? r14 < 50 : r14 > 50, soft = dir > 0 ? r14 < 55 : r14 > 45, adx = D.calcADX(14).adx[i];
    let setup = null; if (pull) setup = rank < 40 ? 't-pb' : 'tp-u80'; else if (rank < 40 && soft && adx != null && adx >= 25) setup = 'tp-r55'; if (!setup) return [];
    const brakeOk = !(pull && dir * (cb - e50) / atr < .5), d200 = dir * (cb / e200 - 1) * 100, fall = cycFall(now);
    const f = { rsi14: r2(r14), adx: r2(adx), ema200_dist: r2(d200), ema50_atr: r2(dir * (cb - e50) / atr), volumen: r2(L.vr), atr_pct: r2(atrP * 100), btc_a_favor: btcDir === dir ? 1 : 0,
      ciclo_a_favor: (dir < 0) === fall ? 1 : 0, tendencia_diaria: Math.sign(D.htfTrend(hc)) === dir ? 1 : 0, hora: new Date(now).getUTCHours() };
    const out = [];
    for (const V of VERS.medio) { if (V.btc && btcDir !== dir) continue; if (V.brake && !brakeOk) continue; if (V.d200 && d200 > 8) continue; if (V.ciclo && dir < 0 && !fall) continue;
      out.push({ v: V.v, dir, c, atrP, r: V.r, setup, f }); }
    return out; }); }
function shAll(D, cs, hc, tf, btcDir, s, U7, ch24) { const cc = cs.slice(0, -1), mins = TFMS[tf] / 6e4, back = Math.round(60 / mins);
  return D.withCandles(cc, () => { const i = cc.length - 1, cl = D.closes(), c = cs[cs.length - 1].close, cb = cc[i].close, atr = D.wilder(D.trArr(), 14)[i], atrP = atr / cb;
    const [bm, bs] = D.smaStd(cl, 20), r7 = D.calcRSI(7)[i], z = bs[i] ? (cb - bm[i]) / bs[i] : 0, e200 = D.emaArr(cl, 200)[i]; if (r7 == null || !(atrP > 0)) return [];
    const h = hc.slice(0, -1), he = D.emaArr(h.map(b => b.close), 50), hk = h.length - 1, up1h = hk >= 0 && he[hk] != null && h[hk].close > he[hk] ? 1 : 0, drop = i >= back ? (cb / cc[i - back].close - 1) * 100 : 0, htf = D.htfTrend(hc);
    const L = D.lastBarStats(cc, i), out = [];
    for (const V of VERS.x) { if (!V.tfs.includes(tf)) continue; let dir = 0;
      if (V.k === 'bb') { if (!(atrP > .04 / 3 && atrP <= .04 / 1.5)) continue; if (!(Math.abs(z) >= 2 && (z < 0 ? r7 <= V.r7 : r7 >= 100 - V.r7))) continue; dir = z < 0 ? 1 : -1; if (Math.sign(htf) !== dir) continue; if (V.btc && btcDir !== dir) continue; }
      else { if (V.atrMin && !(atrP >= V.atrMin && atrP <= V.atrMax)) continue; if (!(z <= -1.8 && r7 <= 35 && drop <= -3 && up1h)) continue; dir = 1;
        if (V.e200 && !(e200 != null && cb > e200)) continue; if (V.uni7 && !(U7 && U7.has(s) && ch24 > -10)) continue; }
      out.push({ v: V.v, dir, c, atrP, r: V.r, setup: V.k === 'bb' ? 'sh-r' : 'sh-c', f: { rsi7: r2(r7), bollinger_z: r2(z), caida_1h: r2(drop), ema200_dist: e200 ? r2((cb / e200 - 1) * 100) : null, atr_pct: r2(atrP * 100),
        tendencia_1h: up1h, btc_a_favor: btcDir === dir ? 1 : 0, volumen: r2(L.vr), cambio_24h: r2(ch24), hora: new Date().getUTCHours() } }); }
    return out; }); }
/* % del margen: 1/3 en cada objetivo, tocado el objetivo 1 el stop pasa a la entrada, plazo, comisión 0,05 % por lado */
function step(o, b) { const d = o.dir, adv = d > 0 ? b.l : b.h, fav = d > 0 ? b.h : b.l, stop = o.hit ? o.entry : o.sl;
  const fin = (px, c) => { let v = 0; for (let k = 0; k < o.hit; k++) v += d * (o.tp[k] / o.entry - 1) / 3; v += (1 - o.hit / 3) * d * (px / o.entry - 1); o.out = { c, hit: o.hit, p: +px.toPrecision(8), t: b.t, pct: +((v - .001) * o.lev * 100).toFixed(2) }; };
  if (d * (adv - stop) <= 0) return fin(stop, o.hit ? 3 : 1);
  while (o.hit < 3 && d * (fav - o.tp[o.hit]) >= 0) o.hit++; if (o.hit === 3) return fin(o.tp[2], 4);
  if (b.t + 3e5 - o.t >= o.age) return fin(b.c, 5); }
async function run(now, base, U7, D) { const S = D.S;
  if (!S.ver) { try { const r = await fetch('https://raw.githubusercontent.com/' + (process.env.GITHUB_REPOSITORY || 'mauro-ezequiel/cripto-en-vivo') + '/datos/versiones.json?t=' + now);
      if (r.ok) { const j = await r.json(); S.ver = { ops: Array.isArray(j.ops) ? j.ops : [], last: {} }; } else if (r.status === 404) S.ver = { ops: [], last: {} }; else return; } catch (e) { return; } }
  const A = S.ver; A.last = A.last || {}; A.diag = A.diag || {}; let ch = false; const K = {}, get = (s, tf, n) => { const k = s + tf; return K[k] || (K[k] = D.kl(s, tf, n).catch(() => null)); };
  const btc = async tf => { const b = await get('BTCUSDT', tf, 80); if (!b) return 0; const cl = b.slice(0, -1).map(x => x.close), e = D.emaArr(cl, 50); return cl[cl.length - 1] > e[e.length - 1] ? 1 : -1; };
  const add = (m, s, x, tf) => { const V = VERS[m].find(y => y.v === x.v), G = m === 'medio' ? TR : V, cool = G.cool;
    if (A.ops.some(o => o.m === m && o.v === x.v && o.sym === s && (!o.out || now - o.t < cool))) return;
    const sl = Math.min(G.cap, Math.max(.004, G.a * x.atrP)), tp = [1, 2, 3].map(k => x.c * (1 + x.dir * k * x.r * sl));
    A.ops.push({ id: m + x.v + '-' + s + '-' + now, m, v: x.v, sym: s, tf, dir: x.dir, entry: x.c, tp, sl: x.c * (1 - x.dir * sl), lev: G.lev, age: G.age, t: now, hit: 0, setup: x.setup, f: x.f, out: null }); ch = true; };
  /* TRADING (4 h): todas las versiones con cada vela de 4 h recién cerrada */
  const b4 = Math.floor(now / (4 * H)) * 4 * H;
  if (A.last.tr !== b4 && now - b4 >= 6e4 && now - b4 < 30 * 6e4) { A.last.tr = b4; ch = true; const bd = await btc('4h'); const rank = {}; base.forEach((t, k) => rank[t.symbol] = k);
    for (const t of base) { const s = t.symbol; try { const [cs, hc] = await Promise.all([D.kl(s, '4h', 300), D.kl(s, '1d', 120)]); if (cs.length < 150 || hc.length < 30) continue;
        for (const x of trAll(D, cs, hc, rank[s], bd, now)) add('medio', s, x, '4h'); A.diag.tr = (A.diag.tr || 0) + 1; } catch (e) { A.diag.err = 'tr ' + s + ': ' + e.message; } await D.sleep(40); } }
  /* SHOOTER: cada temporalidad cuando cierra su vela */
  const groups = [['5m', '15m', base.slice(0, 45)], ['3m', '1h', base.slice(0, 30)], ['15m', '1h', base.slice(0, 30)], ['30m', '1h', base.slice(0, 30)]];
  if (U7) for (const g of groups.slice(2)) for (const t of base) if (U7.has(t.symbol) && !g[2].includes(t)) g[2].push(t);
  for (const [tf, htf, L] of groups) { const ms = TFMS[tf], bar = Math.floor(now / ms) * ms; if (A.last['x' + tf] === bar || now - bar > Math.max(ms, 5 * 6e4) + 6e4) continue; A.last['x' + tf] = bar; ch = true;
    const bd = await btc(tf === '5m' || tf === '3m' ? '1h' : '1h');
    for (const t of L) { const s = t.symbol; try { const [cs, hc] = await Promise.all([get(s, tf, 300), get(s, htf, 200)]); if (!cs || !hc || cs.length < 220 || hc.length < 60) continue;
        for (const x of shAll(D, cs, hc, tf, bd, s, U7, +t.priceChangePercent)) add('x', s, x, tf); A.diag[tf] = (A.diag[tf] || 0) + 1; } catch (e) { A.diag.err = tf + ' ' + s + ': ' + e.message; } await D.sleep(30); } }
  /* seguimiento con velas de 5 min */
  for (const o of A.ops.filter(x => !x.out)) { try { const k = await D.getJ(`${D.API}/klines?symbol=${o.sym}&interval=5m&startTime=${o.chk || o.t}&limit=1000`);
      for (const r of k || []) { const b = { t: +r[0], h: +r[2], l: +r[3], c: +r[4] }; if (b.t + 3e5 > now) break; if (b.t + 3e5 <= o.t) continue; step(o, b); o.chk = b.t + 3e5; ch = true; if (o.out) break; } } catch (e) {} await D.sleep(30); }
  if (A.ops.length > 6000) A.ops = A.ops.slice(-6000);
  if (ch) A.dirty = true;
  if (A.dirty && (!A.pubT || now - A.pubT >= 15 * 6e4) && process.env.GH_TOKEN) {
    const meta = { medio: VERS.medio.map(({ v, desde, txt }) => ({ v, desde, txt })), x: VERS.x.map(({ v, desde, txt }) => ({ v, desde, txt })) };
    if (await D.ghPut('versiones.json', JSON.stringify({ upd: now, desde: A.since || (A.since = now), revisadas: A.diag, nota: 'Todas las versiones de TRADING (medio) y SHOOTER (x) en práctica 24 h. out.pct = % del margen con comisión. f = indicadores al momento de la señal.', versiones: meta, ops: A.ops }), 'verSha', 'Versiones en paralelo', A.ops.length + ' señales')) { A.dirty = false; A.pubT = now; } } }
module.exports = { run, VERS };
