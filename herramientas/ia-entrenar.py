"""CRIPTO-LIVE · IA: estudio diario.
Lee ia-datos.json.gz (lo genera historial-anual.js con IA=1: cada señal del último año, vela a vela) y aprende dos cosas:
  1. SALIDA: en cada cierre de vela de una operación abierta, la probabilidad de que el precio siga a favor
     (llegue 1,5 ATR a favor antes que 1,5 ATR en contra). Con eso decide mantener o salir, sin esperar a los objetivos fijos.
  2. ENTRADA: qué indicadores ayudan de verdad a que una entrada llegue al objetivo 1.
Antes de publicar se prueba en los últimos 4 meses (que no usó para aprender) contra la gestión fija del bot.
Escribe ia.json (modelos como árboles, umbral de salida, resultados de la prueba e indicadores que sirven)."""
import json, gzip, sys, time
DAY = 864e5
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import roc_auc_score

D = json.load(gzip.open(sys.argv[1] if len(sys.argv) > 1 else 'ia-datos.json.gz'))
FEE, EXF, ENF = D['fee'], D['exitF'], D['entryF']
FAM = {'tr': dict(K=1.5, H=24, name='TRADING y TRADING+'), 'sh': dict(K=1.5, H=20, name='SHOOTER')}
RNG = np.random.default_rng(7)


def gbc(n=150):
    return GradientBoostingClassifier(n_estimators=n, max_depth=3, learning_rate=.05, subsample=.8, min_samples_leaf=150, random_state=7)


def export(clf, X):
    p = float(clf.init_.class_prior_[1])
    trees = []
    for est in clf.estimators_[:, 0]:
        t = est.tree_
        trees.append({'f': t.feature.tolist(), 't': [float(x) for x in t.threshold], 'l': t.children_left.tolist(),
                      'r': t.children_right.tolist(), 'v': [round(float(v), 6) for v in t.value[:, 0, 0]]})
    M = {'init': float(np.log(p / (1 - p))), 'lr': clf.learning_rate, 'trees': trees, 'med': [round(float(v), 4) for v in np.median(X, axis=0)]}
    # control: el evaluador de la página tiene que dar lo mismo que sklearn
    xs = X[RNG.choice(len(X), min(300, len(X)), replace=False)]
    err = np.abs(predict(M, xs) - clf.predict_proba(xs)[:, 1]).max()
    assert err < 1e-3, f'exportación distinta: {err}'
    return M


def predict(M, X):
    out = np.full(len(X), M['init'])
    for T in M['trees']:
        f, t, l, r, v = T['f'], T['t'], T['l'], T['r'], T['v']
        for i, x in enumerate(X):
            n = 0
            while l[n] != -1:
                n = l[n] if x[f[n]] <= t[n] else r[n]
            out[i] += M['lr'] * v[n]
    return 1 / (1 + np.exp(-out))


def labels(op, K, H):
    """1 si desde el cierre de esa vela el precio fue K ATR a favor antes que K ATR en contra (en H velas)."""
    B, d = np.array(op['B']), op['dir']
    n, y = len(B), np.full(len(B), -1)
    for k in range(n):
        c, a = B[k, 2], B[k, 3] or B[k, 2] * .01
        up, dn = c + d * K * a, c - d * K * a
        for j in range(k + 1, min(n, k + 1 + H)):
            h, l = B[j, 0], B[j, 1]
            adv, fav = (l, h) if d > 0 else (h, l)
            if d * (dn - adv) >= 0:
                y[k] = 0; break
            if d * (fav - up) >= 0:
                y[k] = 1; break
        else:
            if k + H < n:
                y[k] = 1 if d * (B[k + H, 2] - c) > 0 else 0
    return y


def manage(op, p, theta, minhold, variant, hold=.55):
    """Gestión de la IA (igual que IA.shadow de la página). Devuelve cómo y cuándo salió.
    A: posición entera, stop del bot; al tocar el objetivo 1 el stop pasa a la entrada y luego al objetivo anterior; sale cuando la
       probabilidad de seguir a favor cae bajo theta.
    B: como A, pero asegura 1/3 en el objetivo 1.
    C: como B, pero nunca corta antes del objetivo 1: aguanta los retrocesos normales (solo el stop la saca).
    D: parte del plan del bot (1/3 en cada objetivo, cierra en el objetivo 3 o al plazo) y solo lo corrige: después del objetivo 1 sale
       antes si la probabilidad cae bajo theta, y en el objetivo 3 se queda con el último tercio si la probabilidad sigue alta (>= hold)."""
    d, e, sl, r, B = op['dir'], op['entry'], op['sl'], op['r'], op['B']
    tps = [e * (1 + d * k * r * sl) for k in (1, 2, 3)]
    stop, size, real, hits, kept = e * (1 - d * sl), 1.0, 0.0, 0, False
    lim = int(round(len(B) / 1.5))
    res = lambda px, k, kind, **kw: {'pct': 100 * op['L'] * (real + size * d * (px / e - 1) - 2 * FEE), 'hits': hits, 'k': k, 'kind': kind, 'px': px, **kw}
    for k, (h, l, c, a) in enumerate(B):
        adv, fav = (l, h) if d > 0 else (h, l)
        if d * (stop - adv) >= 0:
            return res(stop, k, 'stop' if hits == 0 else 'seguro')
        while hits < 3 and d * (fav - tps[hits]) >= 0:
            if variant == 'D':
                if hits < 2:
                    real += d * (tps[hits] / e - 1) / 3; size -= 1 / 3
                else:
                    pp = p[k - 1] if k else 0
                    if pp >= hold:
                        kept = True
                    else:
                        real += size * d * (tps[2] / e - 1); size = 0; hits = 3
                        return res(tps[2], k, 'obj3')
            elif variant in ('B', 'C') and hits == 0:
                real += d * (tps[0] / e - 1) / 3; size -= 1 / 3
            hits += 1
            stop = e if hits == 1 else tps[hits - 2]
        early = hits >= 1 if variant in ('C', 'D') else True
        if early and k + 1 >= minhold and p[k] < theta:
            return res(c, k, 'ia', p=float(p[k]))
        if variant == 'D' and not kept and k + 1 >= lim:
            return res(c, k, 'plazo')
    return res(B[-1][2], len(B) - 1, 'plazo')


def policy(op, p, theta, minhold, variant, hold=.55):
    r = manage(op, p, theta, minhold, variant, hold)
    return r['pct'], r['hits']


def policy2(op, p, theta, minhold, variant, hold=.55):
    return manage(op, p, theta, minhold, variant, hold)


DAY = 864e5


def cut_of(ts):
    """Inicio de la prueba: el último tercio, pero como mucho los últimos 120 días (con años de memoria la prueba sigue siendo reciente)."""
    ts = np.asarray(ts, float)
    return float(max(np.quantile(ts, 2 / 3), ts.max() - 120 * DAY))


def walk_forward(ops, E, rows, days=100):
    """Resultado de la IA operación por operación en los últimos `days` días, sin trampa: cada 15 días la IA
    vuelve a aprender, solo con operaciones que ya habían terminado antes de empezar esos 15 días."""
    end = max(o['t'] for o in ops); start = end - days * DAY; out = []
    edges = [start + i * 15 * DAY for i in range(int(days / 15) + 2)]
    for a, b in zip(edges[:-1], edges[1:]):
        win = [o for o in ops if a <= o['t'] < b]
        if not win:
            continue
        past = [o for o in ops if o['t'] + 1.5 * o['maxAge'] < a]
        if len(past) < 60:
            continue
        m = gbc().fit(*rows(past))
        for o in win:
            r = policy2(o, m.predict_proba(np.array(o['X'], float))[:, 1], E['theta'], E['minhold'], E['variant'], E['hold'])
            out.append([o['m'], o['setup'], o['s'].replace('USDT', ''), o['t'], round(o['botPct'], 2), o['botHit'], round(r['pct'], 2), r['hits'], r['k'], r['kind'], float('%.6g' % r['px']), o['L'], o.get('tf', '4h')])
    return out


def resumen(recs, now):
    """Efectividad (operaciones ganadas) y ganancia por operación: bot vs IA, última semana y últimos 3 meses."""
    res = {}
    for nm, days in (('semana', 7), ('3meses', 90)):
        res[nm] = {}
        for modo in ('TRADING', 'TRADING+', 'SHOOTER'):
            L = [r for r in recs if r[3] >= now - days * DAY and (('SHOOTER' if r[0] == 'x' else 'TRADING+' if r[1] == 'tp-x' else 'TRADING') == modo)]
            if not L:
                res[nm][modo] = {'n': 0}; continue
            b = np.array([r[4] for r in L]); i = np.array([r[6] for r in L])
            res[nm][modo] = {'n': len(L), 'bot_gana': round(float((b > 0).mean() * 100), 1), 'ia_gana': round(float((i > 0).mean() * 100), 1),
                             'bot_pct': round(float(b.mean()), 2), 'ia_pct': round(float(i.mean()), 2), 'bot_obj1': round(float(np.mean([r[5] >= 1 for r in L]) * 100), 1)}
    return res


def fam_exit(ops, K, H):
    ops = [o for o in ops if len(o['B']) > 2]
    ts = np.array([o['t'] for o in ops])
    cut = cut_of(ts)
    for o in ops:
        o['y'] = labels(o, K, H)
    def rows(sel):
        X, Y = [], []
        for o in sel:
            m = o['y'] >= 0
            X += [x for x, ok in zip(o['X'], m) if ok]; Y += list(o['y'][m])
        return np.array(X, float), np.array(Y)
    tr = [o for o in ops if o['t'] < cut]; te = [o for o in ops if o['t'] >= cut]
    trA = [o for o in tr if o['t'] < np.quantile([x['t'] for x in tr], .6)]; trB = [o for o in tr if o not in trA]
    # 1) elegir umbral con un modelo que no vio la parte de validación
    mA = gbc().fit(*rows(trA))
    pB = [mA.predict_proba(np.array(o['X'], float))[:, 1] for o in trB]
    best = None
    for variant in ('A', 'B', 'C', 'D'):
        for hold in ((.5, .6, .7) if variant == 'D' else (.55,)):
            for minhold in (1, 2, 4):
                for theta in np.arange(.20, .66, .05):
                    v = np.mean([policy(o, pp, theta, minhold, variant, hold)[0] for o, pp in zip(trB, pB)])
                    if best is None or v > best[0]:
                        best = (v, round(float(theta), 2), minhold, variant, hold)
    _, theta, minhold, variant, hold = best
    # 2) prueba honesta: modelo con todo el entrenamiento, evaluado en los últimos meses
    Xtr, Ytr = rows(tr); Xte, Yte = rows(te)
    mT = gbc().fit(Xtr, Ytr)
    auc = roc_auc_score(Yte, mT.predict_proba(Xte)[:, 1])
    ia, bot, better = [], [], 0
    for o in te:
        v, _ = policy(o, mT.predict_proba(np.array(o['X'], float))[:, 1], theta, minhold, variant, hold)
        ia.append(v); bot.append(o['botPct']); better += v > o['botPct'] + 1e-9
    ia, bot = np.array(ia), np.array(bot)
    imp = importance(mT, Xte, Yte, EXF)
    # 3) modelo final con todo el año
    Xall, Yall = rows(ops)
    mF = gbc().fit(Xall, Yall)
    res = {'n_ops': len(ops), 'n_test': len(te), 'auc': round(auc, 3),
           'bot': {'pct': round(float(bot.mean()), 2), 'gana': round(float((bot > 0).mean() * 100), 1), 'peor': round(float(bot.min()), 1)},
           'ia': {'pct': round(float(ia.mean()), 2), 'gana': round(float((ia > 0).mean() * 100), 1), 'peor': round(float(ia.min()), 1)},
           'mejora_ops': round(better / len(te) * 100, 1), 'desde_prueba': int(cut)}
    # CURVA DE APRENDIZAJE: la misma prueba, aprendiendo con menos historia (siempre la más reciente).
    # Muestra cuánto mejora la IA con cada mes extra de datos: con eso se estima cuánto le falta para alcanzar a los bots.
    curva, t_min = [], min(o['t'] for o in tr)
    span = (cut - t_min) / DAY
    for fr in (.25, .5, .75, 1.0):
        sub = [o for o in tr if o['t'] >= cut - fr * span * DAY]
        if len(sub) < 60:
            continue
        m = mT if fr == 1.0 else gbc().fit(*rows(sub))
        v = [policy(o, m.predict_proba(np.array(o['X'], float))[:, 1], theta, minhold, variant, hold)[0] for o in te]
        curva.append([round(fr * span / 30, 2), round(float(np.sum(v)), 2)])
    res['curva'] = {'meses_ia': curva, 'bot_suma': round(float(bot.sum()), 2), 'n': len(te)}
    by = {}
    for o, v in zip(te, ia):
        k = 'TRADING+' if o['setup'] == 'tp-x' else 'SHOOTER' if o['m'] == 'x' else 'TRADING'
        b = by.setdefault(k, {'n': 0, 'bot': 0, 'ia': 0})
        b['n'] += 1; b['bot'] += o['botPct']; b['ia'] += v
    res['por_modo'] = {k: {'n': b['n'], 'bot': round(b['bot'] / b['n'], 2), 'ia': round(b['ia'] / b['n'], 2)} for k, b in by.items()}
    # solo se usa en vivo si le ganó al bot en los meses que no vio (y de verdad predice algo)
    res['activa'] = bool(res['ia']['pct'] > res['bot']['pct'] + .3 and auc >= .53)
    E = {'model': export(mF, Xall), 'theta': theta, 'minhold': minhold, 'variant': variant, 'hold': hold, 'K': K, 'H': H, 'test': res, 'imp': imp, 'activa': res['activa']}
    E['ops'] = walk_forward(ops, E, rows)
    return E


def run_rule(op, noprog=None, after3='close', k=2.0, lock=True, take=(1 / 3, 1 / 3)):
    """Gestión por reglas: parciales en objetivo 1 y 2, stop a la entrada (y al objetivo anterior si lock), después del 3.º cerrar o seguir
    con stop móvil a k ATR del máximo; salir si en `noprog` velas no tocó el objetivo 1. TRADING+ mantiene su aviso de salida a mitad del stop."""
    d, e, sl, r, B = op['dir'], op['entry'], op['sl'], op['r'], op['B']
    tps = [e * (1 + d * q * r * sl) for q in (1, 2, 3)]
    cut = .5 if op['setup'] == 'tp-x' else None
    stop, size, real, hits, peak = e * (1 - d * sl), 1.0, 0.0, 0, e
    lim = int(round(len(B) / 1.5)) if after3 == 'close' else len(B)
    end = lambda px: 100 * op['L'] * (real + size * d * (px / e - 1) - 2 * FEE)
    for j, (h, l, c, a) in enumerate(B):
        if j >= lim:
            return end(c)
        adv, fav = (l, h) if d > 0 else (h, l)
        if d * (stop - adv) >= 0:
            return end(stop)
        while hits < 3 and d * (fav - tps[hits]) >= 0:
            if hits < 2:
                q = take[hits]; real += q * d * (tps[hits] / e - 1); size -= q
            elif after3 == 'close':
                real += size * d * (tps[2] / e - 1); size = 0; return end(e)
            hits += 1
            stop = e if hits == 1 else (tps[hits - 2] if lock else e)
        peak = max(peak, h) if d > 0 else min(peak, l)
        if hits >= 3 and after3 == 'trail':
            ts = peak - d * k * a
            if d * (ts - stop) > 0:
                stop = ts
        if cut is not None and hits == 0 and d * (e - c) / e >= cut * sl:
            return end(c)
        if noprog and hits == 0 and j + 1 >= noprog:
            return end(c)
    return end(B[-1][2])


def rules_search(ops, fam):
    """Prueba muchas maneras de salir; elige con los primeros meses y la compara con el bot en los últimos (que no vio)."""
    import itertools
    groups = {'tr': {'TRADING': ('t-pb', 'tp-r55', 'tp-u80'), 'TRADING+': ('tp-x',)}, 'sh': {'SHOOTER': ('sh-c',)}}[fam]
    NP = [None, 6, 12, 24, 48] if fam == 'tr' else [None, 5, 10, 20, 40]
    cut = cut_of([o['t'] for o in ops]); out = {}
    for g, setups in groups.items():
        G = [o for o in ops if o['setup'] in setups]
        tr = [o for o in G if o['t'] < cut]; te = [o for o in G if o['t'] >= cut]
        if len(tr) < 30 or len(te) < 15:
            continue
        ev = lambda L, kw: float(np.mean([run_rule(o, **kw) for o in L]))
        bot = {}
        best = None; n = 0
        for noprog, after3, k, lock, take in itertools.product(NP, ['close', 'trail'], [1, 2, 3], [True, False], [(1 / 3, 1 / 3), (1 / 3, 0), (0, 0), (.5, .25)]):
            if after3 == 'close' and k != 2:
                continue
            kw = dict(noprog=noprog, after3=after3, k=k, lock=lock, take=take); v = ev(tr, kw); n += 1
            if best is None or v > best[0]:
                best = (v, kw)
        b_tr, b_te = ev(tr, {}), ev(te, {})
        ia_te = ev(te, best[1])
        out[g] = {'probadas': n, 'regla': {**best[1], 'take': [round(x, 3) for x in best[1]['take']]}, 'entren': {'bot': round(b_tr, 2), 'ia': round(best[0], 2)},
                  'prueba': {'bot': round(b_te, 2), 'ia': round(ia_te, 2), 'n': len(te)}, 'activa': bool(ia_te > b_te + .3 and best[0] > b_tr + .3)}
    return out


def importance(m, X, Y, names, reps=2):
    base = roc_auc_score(Y, m.predict_proba(X)[:, 1]); out = []
    for k, nm in enumerate(names):
        drops = []
        for _ in range(reps):
            Z = X.copy(); Z[:, k] = RNG.permutation(Z[:, k])
            drops.append(base - roc_auc_score(Y, m.predict_proba(Z)[:, 1]))
        out.append([nm, round(float(np.mean(drops)), 4)])
    return sorted(out, key=lambda x: -x[1])


def fam_entry(ent, fam):
    w = min(len(r) for r in ent); A = np.array([r[:min(w, 1 + len(ENF) + 5)] for r in ent], float)
    if len(A) < 500:
        return None
    k0 = 1 + len(ENF)
    t, X, Y, P = A[:, 0], A[:, 1:k0], A[:, k0], A[:, k0 + 2]
    RK = A[:, k0 + 3] if A.shape[1] > k0 + 3 else np.arange(len(A))  # datos viejos sin la moneda: no se agrupa
    cut = cut_of(t); tr, te = t < cut, t >= cut
    m = gbc(120).fit(X[tr], Y[tr]); p = m.predict_proba(X[te])[:, 1]
    auc = roc_auc_score(Y[te], p); top = p >= np.quantile(p, .8)
    res = {'n': int(len(A)), 'auc': round(auc, 3), 'base': round(float(Y[te].mean() * 100), 1), 'top20': round(float(Y[te][top].mean() * 100), 1),
           'top20_pct': round(float(P[te][top].mean()), 2), 'base_pct': round(float(P[te].mean()), 2)}
    imp = importance(m, X[te], Y[te], ENF)
    # ENTRADAS PROPIAS: la IA busca sola en todas las velas candidatas (no solo en las señales de los bots) las que puntúa más alto.
    # Umbral elegido con los meses de aprendizaje (mejor 10 %), resultado medido en los meses que no vio, una por moneda cada 24 h (TRADING) o 1 h (SHOOTER).
    samp, cool = (.5, 24 * 36e5) if fam == 'tr' else (.3, 36e5)

    def picks(idx, pr, thr):
        sel = idx[pr >= thr]; last = {}; out = []
        for i in sel[np.argsort(t[sel])]:
            k = int(RK[i])
            if k in last and t[i] - last[k] < cool:
                continue
            last[k] = t[i]; out.append(i)
        return np.array(out, int)
    # UMBRAL DINÁMICO: se elige con la última parte de los meses de aprendizaje (validación), sin mirar la prueba.
    # Puntaje = ganancia total con las pérdidas pesando 1,5 veces: más señales mientras sigan siendo eficientes, y castiga perder.
    trI = np.where(tr)[0]; c1 = np.quantile(t[trI], .7); a, v = trI[t[trI] < c1], trI[t[trI] >= c1]
    mv = gbc(120).fit(X[a], Y[a]); pv = mv.predict_proba(X[v])[:, 1]; pa = mv.predict_proba(X[a])[:, 1]
    best_q, best_s = .9, -1e18
    for q in (.5, .6, .7, .75, .8, .85, .9, .93, .95, .97):
        pk = picks(v, pv, float(np.quantile(pa, q)))
        if len(pk) < 15:
            continue
        PP = P[pk]; sc = PP.sum() + .5 * PP[PP < 0].sum()
        if PP.mean() > 0 and Y[pk].mean() >= Y[v].mean() and sc > best_s:
            best_q, best_s = q, sc
    ptr = m.predict_proba(X[tr])[:, 1]; thr = float(np.quantile(ptr, best_q))
    pick = picks(np.where(te)[0], p, thr); dias = (t[te].max() - t[te].min()) / DAY if te.sum() else 1
    PP = P[pick] if len(pick) else np.array([0.])
    res['propias'] = {'n': int(len(pick)), 'q': best_q, 'por_dia': round(len(pick) / max(dias, 1) / samp, 2), 'obj1': round(float(Y[pick].mean() * 100), 1) if len(pick) else None,
                      'pct': round(float(P[pick].mean()), 2) if len(pick) else None, 'gana': round(float((P[pick] > 0).mean() * 100), 1) if len(pick) else None,
                      'peor': round(float(PP.min()), 2), 'base_obj1': round(float(Y[te].mean() * 100), 1), 'base_pct': round(float(P[te].mean()), 2)}
    mF = gbc(120).fit(X, Y); pall = mF.predict_proba(X)[:, 1]
    return {'model': export(mF, X), 'test': res, 'imp': imp, 'q': [round(float(v), 4) for v in np.quantile(pall, [.2, .5, .8])], 'thr': round(float(np.quantile(pall, best_q)), 4)}


def memoria(D):
    """MEMORIA ACUMULADA: suma lo que la IA ya estudió antes y salió de la ventana del último año. Así cada día tiene un día más
    de datos para aprender (hasta 3 años) en vez de olvidar el día más viejo."""
    try:
        P = json.load(gzip.open('prev-datos.json.gz'))
    except Exception:
        return {'dias': 0, 'ops': 0}
    if P.get('exitF') != D['exitF'] or P.get('entryF') != D['entryF']:
        return {'dias': 0, 'ops': 0, 'nota': 'cambiaron los indicadores: empieza de nuevo'}
    lim, add = D['upd'] - 3 * 365 * DAY, 0
    for f in FAM:
        cur, old = D[f], P.get(f) or {}
        t0 = min([o['t'] for o in cur['ops']] or [D['upd']])
        keep = [o for o in old.get('ops', []) if lim <= o['t'] < t0]
        cur['ops'] = keep + cur['ops']; add += len(keep)
        if cur['ent']:
            e0, w = min(r[0] for r in cur['ent']), len(cur['ent'][0])
            cur['ent'] = [r for r in old.get('ent', []) if lim <= r[0] < e0 and len(r) == w] + cur['ent']
    return {'ops': add}


MEM = memoria(D)
ALL_T = [o['t'] for f in FAM for o in D[f]['ops']]
MEM['dias'] = round((max(ALL_T) - min(ALL_T)) / DAY) if ALL_T else 0
with gzip.open('ia-datos.json.gz', 'wt') as fh:  # se guarda la memoria para mañana
    json.dump(D, fh, separators=(',', ':'))
print('memoria', MEM)

t0 = time.time()
OUT = {'upd': D['upd'], 'ver': 1, 'exitF': EXF, 'entryF': ENF}
for f, cfg in FAM.items():
    part = D[f]
    OUT[f] = {'name': cfg['name']}
    if len(part['ops']) >= int(__import__('os').environ.get('IA_MIN', 60)):
        OUT[f]['exit'] = fam_exit(part['ops'], cfg['K'], cfg['H'])
        print(f, 'salida', json.dumps(OUT[f]['exit']['test'], ensure_ascii=False), OUT[f]['exit']['theta'], OUT[f]['exit']['minhold'], OUT[f]['exit']['variant'])
        print(f, 'importa (salida)', OUT[f]['exit']['imp'][:8])
        OUT[f]['reglas'] = rules_search([o for o in part['ops'] if len(o['B']) > 2], f)
        print(f, 'reglas', json.dumps(OUT[f]['reglas'], ensure_ascii=False))
    e = fam_entry(part['ent'], f)
    if e:
        OUT[f]['entry'] = e
        print(f, 'entrada', e['test'], e['imp'][:8])
allrec = [r for f in FAM for r in (OUT[f].get('exit', {}).get('ops') or [])]
OUT['resumen'] = resumen(allrec, D['upd'])
print('resumen', json.dumps(OUT['resumen'], ensure_ascii=False))
OUT['syms'] = D.get('syms', [])


def progreso(R, prev):
    """La IA se autoevalúa: cuánto de la ganancia de los bots consigue (100 % = iguala, más = los supera), en los últimos 3 meses."""
    b = sum((x.get('bot_pct', 0) * x['n']) for x in R['3meses'].values() if x.get('n'))
    i = sum((x.get('ia_pct', 0) * x['n']) for x in R['3meses'].values() if x.get('n'))
    val = None if b <= 0 else round(max(0, min(1000, 100 * i / b)), 1)
    hist = [h for h in (prev.get('progreso', {}).get('hist') or []) if h[0] < D['upd'] - 3600e3][-120:] + [[D['upd'], val]]
    notas = []
    pc = lambda v: (f'{v:+.1f}').replace('.', ',')
    for m, x in R['3meses'].items():
        if not x.get('n'):
            continue
        if x['ia_pct'] >= x['bot_pct']:
            notas.append(f"En {m} ya saca igual o más que el bot por operación ({pc(x['ia_pct'])} % contra {pc(x['bot_pct'])} %).")
        elif x['ia_gana'] < x['bot_gana'] - 10:
            notas.append(f"En {m} sale demasiado pronto: gana el {x['ia_gana']:.0f} % de las veces contra el {x['bot_gana']:.0f} % del bot. Tiene que aprender a aguantar los retrocesos normales.")
        else:
            notas.append(f"En {m} acierta parecido al bot ({x['ia_gana']:.0f} % contra {x['bot_gana']:.0f} %) pero gana menos por operación ({pc(x['ia_pct'])} % contra {pc(x['bot_pct'])} %): suelta las ganancias antes de tiempo.")
    old = [h for h in hist[:-1] if h[1] is not None and h[0] <= D['upd'] - 6.5 * DAY]
    if old and val is not None:
        d = val - old[-1][1]
        notas.append(f"Hace una semana sacaba el {old[-1][1]:.0f} % de lo de los bots: {'mejoró' if d > 0 else 'empeoró' if d < 0 else 'quedó igual'} {abs(d):.0f} puntos.")
    return {'valor': val, 'hist': hist, 'notas': notas}


def noticias():
    """Noticias: el bot guarda cada hora el clima de las noticias y el precio de BTC. Con eso la IA mide si las noticias mueven el precio."""
    try:
        H = json.load(open('noticias.json'))['h']
    except Exception:
        return {'dias': 0}
    H = [h for h in H if h.get('btc')]
    if len(H) < 2:
        return {'dias': 0, 'n': len(H)}
    dias = (H[-1]['t'] - H[0]['t']) / DAY; out = {'dias': round(dias, 1), 'n': len(H)}
    xs, ys = [], []
    for k, h in enumerate(H):
        fut = next((g for g in H[k + 1:] if g['t'] >= h['t'] + 4 * 3600e3), None)
        if fut and h.get('n', 0) >= 3:
            xs.append(h['s']); ys.append(fut['btc'] / h['btc'] - 1)
    if len(xs) >= 200:
        c = float(np.corrcoef(xs, ys)[0, 1]); out['corr'] = round(c, 3); out['muestras'] = len(xs)
    return out


try:
    prev = json.load(open('prev-ia.json'))
except Exception:
    prev = {}
OUT['progreso'] = progreso(OUT['resumen'], prev)


def estimar():
    """¿Cuánto le falta para alcanzar a los bots? Junta la curva de aprendizaje de las dos familias (ganancia de la IA con 25, 50, 75
    y 100 % de la historia) y ajusta progreso = a + b × ln(meses de datos). Como la memoria crece un día por día, los meses
    de datos que faltan son el tiempo que falta. Si más datos no la mejoran (b <= 0), lo dice: necesita otro método, no tiempo."""
    C = [OUT[f]['exit']['test']['curva'] for f in FAM if OUT[f].get('exit') and OUT[f]['exit']['test'].get('curva')]
    if not C:
        return None
    n = min(len(c['meses_ia']) for c in C); bot = sum(c['bot_suma'] for c in C)
    if n < 3 or bot <= 0:
        return {'ok': False, 'motivo': 'pocos datos'}
    pts = [[float(np.mean([c['meses_ia'][i][0] for c in C])), 100 * sum(c['meses_ia'][i][1] for c in C) / bot] for i in range(n)]
    x, y = np.log([p[0] for p in pts]), np.array([p[1] for p in pts])
    b, a = np.polyfit(x, y, 1); now = pts[-1][0]
    out = {'ok': True, 'puntos': [[round(m, 1), round(v, 1)] for m, v in pts], 'por_doble': round(float(b * np.log(2)), 1), 'meses_datos': round(now, 1)}
    if pts[-1][1] >= 100:
        out['dias'] = 0
    elif b <= .5:
        out['dias'] = None
    else:
        need = float(np.exp((100 - a) / b)); out['dias'] = int(min(3650, max(1, (need - now) * 30)))
    return out


OUT['estimado'] = estimar()
OUT['memoria'] = MEM
print('estimado', OUT['estimado'])
OUT['noticias'] = noticias()
print('progreso', OUT['progreso']['valor'], OUT['progreso']['notas'], 'noticias', OUT['noticias'])
OUT['secs'] = round(time.time() - t0)
json.dump(OUT, open('ia.json', 'w'), separators=(',', ':'))
print('ia.json listo', round(time.time() - t0), 's')
