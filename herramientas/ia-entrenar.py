"""CRIPTO-LIVE · IA: estudio diario.
Lee ia-datos.json.gz (lo genera historial-anual.js con IA=1: cada señal del último año, vela a vela) y aprende dos cosas:
  1. SALIDA: en cada cierre de vela de una operación abierta, la probabilidad de que el precio siga a favor
     (llegue 1,5 ATR a favor antes que 1,5 ATR en contra). Con eso decide mantener o salir, sin esperar a los objetivos fijos.
  2. ENTRADA: qué indicadores ayudan de verdad a que una entrada llegue al objetivo 1.
Antes de publicar se prueba en los últimos 4 meses (que no usó para aprender) contra la gestión fija del bot.
Escribe ia.json (modelos como árboles, umbral de salida, resultados de la prueba e indicadores que sirven)."""
import json, gzip, sys, time
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


def policy(op, p, theta, minhold, variant):
    """Gestión de la IA: stop inicial del bot; al tocar el objetivo 1 el stop pasa a la entrada y luego sube al objetivo anterior;
    sale cuando la probabilidad de seguir a favor cae bajo theta (o en el stop, o al 1,5 × plazo). Variante B: asegura 1/3 en el objetivo 1."""
    d, e, sl, r, B = op['dir'], op['entry'], op['sl'], op['r'], op['B']
    tps = [e * (1 + d * k * r * sl) for k in (1, 2, 3)]
    stop, size, real, hits, out = e * (1 - d * sl), 1.0, 0.0, 0, None
    for k, (h, l, c, a) in enumerate(B):
        adv, fav = (l, h) if d > 0 else (h, l)
        if d * (stop - adv) >= 0:
            out = real + size * d * (stop / e - 1); break
        while hits < 3 and d * (fav - tps[hits]) >= 0:
            if variant == 'B' and hits == 0:
                real += d * (tps[0] / e - 1) / 3; size -= 1 / 3
            hits += 1
            stop = e if hits == 1 else tps[hits - 2]
        if k + 1 >= minhold and p[k] < theta:
            out = real + size * d * (c / e - 1); break
    if out is None:
        out = real + size * d * (B[-1][2] / e - 1)
    return 100 * op['L'] * (out - 2 * FEE), hits


def fam_exit(ops, K, H):
    ops = [o for o in ops if len(o['B']) > 2]
    ts = np.array([o['t'] for o in ops])
    cut = np.quantile(ts, 2 / 3)
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
    for variant in ('A', 'B'):
        for minhold in (1, 2, 4):
            for theta in np.arange(.30, .66, .05):
                v = np.mean([policy(o, pp, theta, minhold, variant)[0] for o, pp in zip(trB, pB)])
                if best is None or v > best[0]:
                    best = (v, round(float(theta), 2), minhold, variant)
    _, theta, minhold, variant = best
    # 2) prueba honesta: modelo con todo el entrenamiento, evaluado en los últimos meses
    Xtr, Ytr = rows(tr); Xte, Yte = rows(te)
    mT = gbc().fit(Xtr, Ytr)
    auc = roc_auc_score(Yte, mT.predict_proba(Xte)[:, 1])
    ia, bot, better = [], [], 0
    for o in te:
        v, _ = policy(o, mT.predict_proba(np.array(o['X'], float))[:, 1], theta, minhold, variant)
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
    by = {}
    for o, v in zip(te, ia):
        k = 'TRADING+' if o['setup'] == 'tp-x' else 'SHOOTER' if o['m'] == 'x' else 'TRADING'
        b = by.setdefault(k, {'n': 0, 'bot': 0, 'ia': 0})
        b['n'] += 1; b['bot'] += o['botPct']; b['ia'] += v
    res['por_modo'] = {k: {'n': b['n'], 'bot': round(b['bot'] / b['n'], 2), 'ia': round(b['ia'] / b['n'], 2)} for k, b in by.items()}
    # solo se usa en vivo si le ganó al bot en los meses que no vio (y de verdad predice algo)
    res['activa'] = bool(res['ia']['pct'] > res['bot']['pct'] + .3 and auc >= .53)
    return {'model': export(mF, Xall), 'theta': theta, 'minhold': minhold, 'variant': variant, 'K': K, 'H': H, 'test': res, 'imp': imp, 'activa': res['activa']}


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
    cut = np.quantile([o['t'] for o in ops], 2 / 3); out = {}
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


def fam_entry(ent):
    A = np.array(ent, float)
    if len(A) < 500:
        return None
    t, X, Y, P = A[:, 0], A[:, 1:1 + len(ENF)], A[:, 1 + len(ENF)], A[:, -1]
    cut = np.quantile(t, 2 / 3); tr, te = t < cut, t >= cut
    m = gbc(120).fit(X[tr], Y[tr]); p = m.predict_proba(X[te])[:, 1]
    auc = roc_auc_score(Y[te], p); top = p >= np.quantile(p, .8)
    res = {'n': int(len(A)), 'auc': round(auc, 3), 'base': round(float(Y[te].mean() * 100), 1), 'top20': round(float(Y[te][top].mean() * 100), 1),
           'top20_pct': round(float(P[te][top].mean()), 2), 'base_pct': round(float(P[te].mean()), 2)}
    imp = importance(m, X[te], Y[te], ENF)
    mF = gbc(120).fit(X, Y)
    return {'model': export(mF, X), 'test': res, 'imp': imp, 'q': [round(float(v), 4) for v in np.quantile(mF.predict_proba(X)[:, 1], [.2, .5, .8])]}


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
    e = fam_entry(part['ent'])
    if e:
        OUT[f]['entry'] = e
        print(f, 'entrada', e['test'], e['imp'][:8])
OUT['secs'] = round(time.time() - t0)
json.dump(OUT, open('ia.json', 'w'), separators=(',', ':'))
print('ia.json listo', round(time.time() - t0), 's')
