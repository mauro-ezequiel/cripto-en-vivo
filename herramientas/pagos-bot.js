/* PAGOS (octubre 2026): cada 10 min revisa los pagos pendientes que informaron los usuarios (Firestore pagos/*) y los comprueba en la red:
   - USDT TRC20: tronscan (envío de USDT a la dirección TRC20 de config/pagos, transacción exitosa y confirmada)
   - USDT BEP20: nodo público de BNB Smart Chain (recibo exitoso con un Transfer de USDT a la dirección BEP20)
   Si llegó el monto del plan (tolerancia 2 % por comisiones), suma los días a subs/{uid} y marca el pago como ok. Binance Pay no se puede
   comprobar desde afuera: queda pendiente para que el dueño lo confirme en el panel 👑. Avisa al dueño por Telegram.
   Necesita el secreto FIREBASE_SA (cuenta de servicio de Firebase, JSON). Sin ese secreto no hace nada. */
const SA = process.env.FIREBASE_SA, TOKEN = process.env.TELEGRAM_TOKEN, CHAT = process.env.TELEGRAM_CHAT;
const USDT_TRC = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t', USDT_BEP = '0x55d398326f99059ff775485246999027b3197955';
const PLANES = { '1m': { nm: 'Mensual', usd: 5, d: 30 }, '3m': { nm: '3 meses', usd: 13, d: 90 }, '6m': { nm: '6 meses', usd: 24, d: 180 } };
async function tg(text) { if (!TOKEN || !CHAT) return console.log('[sin Telegram]', text); try { await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, { method: 'POST', body: new URLSearchParams({ chat_id: CHAT, text }) }); } catch (e) {} }
async function check(p, C) {
  if (p.red === 'TRC20') { const j = await (await fetch('https://apilist.tronscanapi.com/api/transaction-info?hash=' + encodeURIComponent(p.txid))).json();
    if (!j || !j.hash) return { ok: null, msg: 'todavía no aparece en la red TRON' };
    if (j.contractRet !== 'SUCCESS') return { ok: false, msg: 'la transacción falló' };
    const tr = (j.trc20TransferInfo || []).find(x => x.contract_address === USDT_TRC && x.to_address === C.trc20); if (!tr) return { ok: false, msg: 'no es un envío de USDT a la dirección de cobro' };
    if (!j.confirmed) return { ok: null, msg: 'esperando confirmación' };
    const m = +tr.amount_str / Math.pow(10, +tr.decimals || 6); return m >= p.monto * .98 ? { ok: true, monto: m } : { ok: false, msg: `llegaron ${m} USDT y el plan cuesta ${p.monto}` }; }
  if (p.red === 'BEP20') { const r = await (await fetch('https://bsc-dataseed.binance.org/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionReceipt', params: [p.txid] }) })).json(), x = r && r.result;
    if (!x) return { ok: null, msg: 'todavía no aparece en BNB Smart Chain' }; if (x.status !== '0x1') return { ok: false, msg: 'la transacción falló' };
    const to = '0x' + String(C.bep20 || '').toLowerCase().replace(/^0x/, '').padStart(64, '0');
    const lg = (x.logs || []).find(l => l.address.toLowerCase() === USDT_BEP && l.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' && l.topics[2].toLowerCase() === to);
    if (!lg) return { ok: false, msg: 'no es un envío de USDT a la dirección de cobro' };
    const m = Number(BigInt(lg.data)) / 1e18; return m >= p.monto * .98 ? { ok: true, monto: m } : { ok: false, msg: `llegaron ${m} USDT y el plan cuesta ${p.monto}` }; }
  return { ok: null, msg: 'Binance Pay: lo confirma el dueño' }; }
(async () => {
  if (!SA) { console.log('Sin el secreto FIREBASE_SA: los pagos se confirman a mano desde el panel 👑.'); return; }
  const admin = require('firebase-admin'); admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) }); const db = admin.firestore();
  const C = (await db.doc('config/pagos').get()).data() || {};
  const P = await db.collection('pagos').where('estado', '==', 'pendiente').get(); console.log('pendientes', P.size);
  const usados = new Set((await db.collection('pagos').where('estado', '==', 'ok').get()).docs.map(x => String(x.data().txid || '').toLowerCase())); // un mismo pago no activa dos planes
  for (const d of P.docs) { const p = d.data(); if (p.red === 'BPAY') continue;
    if (usados.has(String(p.txid || '').toLowerCase())) { await d.ref.update({ estado: 'rechazado', nota: 'ese pago ya activó otro plan', okT: Date.now() }); continue; } const plan = PLANES[p.plan]; if (!plan) continue; p.monto = plan.usd; // el precio sale de acá, no de lo que mandó el usuario
    let r; try { r = await check(p, C); } catch (e) { console.log(d.id, e.message); continue; }
    if (r.ok === true) { const ref = db.doc('subs/' + p.uid); await db.runTransaction(async T => { const s = await T.get(ref), x = s.exists ? s.data() : {}, base = Math.max(Date.now(), x.hasta || 0);
        T.set(ref, { plan: p.plan, desde: x.desde || Date.now(), hasta: base + plan.d * 864e5, email: p.email || x.email || '', upd: Date.now() }, { merge: true }); T.update(d.ref, { estado: 'ok', auto: true, recibido: r.monto, okT: Date.now() }); });
      await tg(`💰 Pago confirmado: ${p.email} · ${plan.nm} · ${r.monto} USDT (${p.red}). Plan activado.`); usados.add(String(p.txid).toLowerCase()); console.log(d.id, 'ok'); }
    else if (r.ok === false) { await d.ref.update({ estado: 'rechazado', nota: r.msg, okT: Date.now() }); await tg(`⚠️ Pago rechazado: ${p.email} · ${p.red} · ${r.msg}`); console.log(d.id, 'rechazado', r.msg); }
    else { if (Date.now() - p.t > 3 * 864e5 && !p.avisado) { await d.ref.update({ avisado: true }); await tg(`⏳ Pago pendiente hace más de 3 días: ${p.email} · ${p.red} · ${r.msg}. Revisalo en el panel 👑.`); } console.log(d.id, 'pendiente', r.msg); } }
})().catch(e => { console.error(e); process.exit(1); });
