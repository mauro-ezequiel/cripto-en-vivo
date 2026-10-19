/* INVESTIGACIÓN SALIDA ANTICIPADA en ACCIONES (octubre 2026). No cambia la página ni los bots.
   Abre la página (?bot=estudio), y recalcula el último año de ACCIONES con las mismas entradas; solo cambia el seguimiento: si al cierre de una vela
   diaria al menos N de 8 señales están en contra (Supertrend, EMA 21, EMA 9 vs 21, RSI 14, MACD, DMI, flujo comprador y figura chartista), se sale.
   Antes del objetivo 1 pide ganancia ≥ medio stop; después del objetivo 1, solo estar por encima de la entrada. Como en la simulación de la página,
   al salir antes la acción queda libre y puede volver a entrar con una señal nueva. Escribe investigacion-salida-acciones.json */
const fs = require('fs'), { chromium } = require('playwright-core');
const LIB = fs.readFileSync(__dirname + '/figuras-lib.js', 'utf8');
const PATCH = `
window.__AG=new WeakMap();
window.__agArr=function(b){let o=__AG.get(b);if(o)return o;o=withCandles(b,()=>{const n=b.length,cl=closes(),st=calcST(10,3).dir,e9=emaArr(cl,9),e21=emaArr(cl,21),R=calcRSI(14),M=calcMACD(),A=calcADX(14);
  const fig=Array(n).fill(0);try{for(const f of FIG.scan(b))if(f.conf)for(let k=f.i1;k<Math.min(n,f.i1+6);k++)fig[k]=f.dir;}catch(e){}
  const a=new Int8Array(n),u=new Int8Array(n);
  for(let j=30;j<n;j++){const c=cl[j],h=M.hist[j]||0;let fl=0;for(let k=Math.max(0,j-2);k<=j;k++)fl+=2*(b[k].tb||0)-(b[k].v||0);
    const dn=[st[j]===-1,e21[j]!=null&&c<e21[j],e9[j]!=null&&e21[j]!=null&&e9[j]<e21[j],R[j]!=null&&R[j]<50,h<0,A.pdi[j]!=null&&A.mdi[j]>A.pdi[j],fl<0,fig[j]===-1];
    const up=[st[j]===1,e21[j]!=null&&c>e21[j],e9[j]!=null&&e21[j]!=null&&e9[j]>e21[j],R[j]!=null&&R[j]>50,h>0,A.pdi[j]!=null&&A.pdi[j]>A.mdi[j],fl>0,fig[j]===1];
    a[j]=dn.filter(Boolean).length;u[j]=up.filter(Boolean).length;}return {a,u};});__AG.set(b,o);return o;};
histFollow=function(o,rb,resMs,maxAge,llConf,fee){const d=o.dir,T=[o.tp0,o.tp1,o.tp2];let ae=o.entry,sz=1,fail=o.fail,loss=o.loss,real=0,hit=0,llNo=!o.llAt;const now=Date.now(),SX=window.__SX;
  const pnlAt=px=>real+(1-hit/3)*sz*o.not*d*(px/ae-1);
  const close=(state,px,ts,why,pnl)=>{Object.assign(o,{state,px,closeAt:ts,why,hit,pnl:Math.round((pnl-o.not*sz*fee*2)*100)/100});if(o.ll)Object.assign(o,{ae,fail,loss});return o;};
  let j=0;while(j<rb.length&&rb[j].t<o.t)j++;
  for(;j<rb.length;j++){const b=rb[j],ts=Math.max(b.t,o.t),adv=d>0?b.low:b.high,fav=d>0?b.high:b.low;
    if(!hit&&o.llAt&&!o.ll&&!llNo&&d*(adv-o.llAt)<=0){if(llConf(ts,d)){const px=o.llAt;ae=(o.entry+.5*px)/1.5;sz=1.5;fail=ae*(1-d*o.liqD);loss=1.5*o.not*o.liqD;o.ll={t:ts,px,margin:o.llMargin};}else llNo=true;}
    if(!hit&&d*(adv-fail)<=0)return close('fail',fail,ts,'tocó el stop',-loss);
    if(hit>0&&d*(adv-ae)<=0)return close('win',ae,ts,'llegó al objetivo '+hit+' y el resto se cerró en la entrada',real);
    while(hit<3&&d*(fav-T[hit])>=0){real+=sz*o.not/3*d*(T[hit]/ae-1);hit++;}
    if(hit===3)return close('win',T[2],ts,'llegó a los 3 objetivos',real);
    if(SX&&b.t+resMs<=now){const g=d*(b.close/ae-1),ok=hit===0?SX.N0<9&&g>=.5*o.liqD:SX.N1<9&&g>0;
      if(ok){const G=__agArr(rb),cnt=d>0?G.a[j]:G.u[j];if(cnt>=(hit===0?SX.N0:SX.N1)){const r=close(hit>0?'win':'exp',b.close,b.t+resMs,'salida anticipada',pnlAt(b.close));r.salida=1;return r;}}}
    if(ts-o.t>maxAge){const px=(b.low+b.high)/2;return close(hit>0?'win':'exp',px,ts,'venció el plazo',Math.max(-loss,pnlAt(px)));}}
  o.state='open';o.hit=hit;o.real=real;if(o.ll)Object.assign(o,{ae,fail,loss,sz});return o;};`;
const UNIS = process.env.UNI ? process.env.UNI.split(',').map(Number) : null;
const VARS = UNIS ? UNIS.map(() => null) : process.env.DETALLE ? [null, { N0: 6, N1: 5 }, { N0: 5, N1: 5 }] : [null, { N0: 5, N1: 5 }, { N0: 5, N1: 4 }, { N0: 5, N1: 6 }, { N0: 6, N1: 5 }, { N0: 9, N1: 5 }, { N0: 5, N1: 9 }, { N0: 6, N1: 6 }];
(async () => {
  const br = await chromium.launch({ channel: 'chrome' }), pg = await br.newPage();
  await pg.goto('https://mauro-ezequiel.github.io/cripto-en-vivo/?bot=estudio&t=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await pg.waitForFunction(() => typeof stkReady !== 'undefined' && stkReady && typeof histStocks === 'function', null, { timeout: 180000 });
  await pg.evaluate(() => { if (mode !== 'a') applyMode('a'); }); if (!(await pg.evaluate(() => typeof FIG !== 'undefined'))) await pg.addScriptTag({ content: LIB });
  await pg.addScriptTag({ content: PATCH });
  const out = { upd: Date.now(), nota: 'usd300 = resultado si cada señal fuera 300 USD × 10 (retorno sobre el precio × 3000, con comisión). Sin salida = versión actual.', variantes: [] };
  if (UNIS) await pg.addScriptTag({ content: "stkUniverse=function(){return Object.values(STK).filter(x=>x.kind==='US'&&(NYSE.has(x.s)||NASDAQ.has(x.s))&&x.q>0&&x.c>0).sort((a,b)=>b.q-a.q).slice(0,window.__UNI||130).map(x=>x.s);};" });
  for (const [vi, V] of VARS.entries()) { if (UNIS) await pg.evaluate(n => { window.__UNI = n; }, UNIS[vi]); const r = await pg.evaluate(async V => { window.__SX = V; HIST_A = null; histABusy = false; await histStocks();
      const L = (HIST_A || []).filter(o => o.state !== 'open').sort((a, b) => a.t - b.t), mid = Date.now() - 182.5 * 864e5;
      const st = A => { const n = A.length; if (!n) return { n: 0 }; const u = A.map(o => o.pnl / o.not * 3000), lo = u.filter(x => x < 0);
        return { n, gana: +(100 * (n - lo.length) / n).toFixed(1), usd_op: +(u.reduce((a, x) => a + x, 0) / n).toFixed(1), usd: Math.round(u.reduce((a, x) => a + x, 0)), perd_media: lo.length ? +(lo.reduce((a, x) => a + x, 0) / lo.length).toFixed(1) : 0,
          pct_margen_app: +(A.reduce((a, o) => a + o.pnl / SIM.a.margin * 100, 0) / n).toFixed(2), salidas: A.filter(o => o.salida).length, salidas_tras_obj1: A.filter(o => o.salida && o.hit >= 1).length }; };
      const det = L.map(o => ({ id: o.id, sym: o.sym, t: o.t, setup: o.setup, hit: o.hit, salida: o.salida ? 1 : 0, usd: +(o.pnl / o.not * 3000).toFixed(1), cierre: o.closeAt, por: o.why }));
      return { det, v: V || ('universo ' + (window.__UNI || 130)), año: st(L), mitad1: st(L.filter(o => o.t < mid)), mitad2: st(L.filter(o => o.t >= mid)) }; }, V);
    out.variantes.push(r); console.log(JSON.stringify(Object.assign({}, r, { det: undefined }))); fs.writeFileSync('investigacion-salida-acciones.json', JSON.stringify(out, null, 1)); }
  await br.close();
})().catch(e => { console.error(e); process.exit(1); });
