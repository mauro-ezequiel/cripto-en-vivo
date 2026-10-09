"""Experimento: ¿la IA aprende a elegir entradas si además de los indicadores de precio ve datos de futuros?
Lee ia-datos.json.gz hecho con IA=1 IAX=1 (las últimas 6 columnas de cada entrada son los datos de futuros) y compara,
con los mismos meses de aprendizaje y de prueba, el modelo de siempre contra el modelo con los datos nuevos.
Mide: precisión (AUC, 0,5 = azar), y el 10 % de entradas con mejor puntaje en la prueba (objetivo 1 y ganancia por operación).
Escribe ia-experimento.json."""
import json, gzip, sys
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import roc_auc_score

D = json.load(gzip.open(sys.argv[1] if len(sys.argv) > 1 else 'ia-datos.json.gz'))
ENF = D['entryF']; NX = 6; XN = ['interés abierto 24 h', 'interés abierto 1 h', 'flujo comprador/vendedor 1 h', 'traders grandes', 'minoristas', 'funding']
gbc = lambda: GradientBoostingClassifier(n_estimators=150, max_depth=3, learning_rate=.05, subsample=.8, min_samples_leaf=150, random_state=7)
OUT = {'upd': D['upd']}
for fam in ('tr', 'sh'):
    E = [r for r in D[fam]['ent'] if len(r) >= 1 + len(ENF) + 3 + NX]
    k0 = 1 + len(ENF)
    rows = [r for r in E if all(v is not None for v in r[-NX:])]
    if len(rows) < 800:
        OUT[fam] = {'filas': len(rows), 'nota': 'pocas filas con datos de futuros'}; continue
    A = np.array([[float(v) for v in r[:k0 + 3]] + [float(v) for v in r[-NX:]] for r in rows])
    t, Xb, Y, P, Xn = A[:, 0], A[:, 1:k0], A[:, k0], A[:, k0 + 2], A[:, -NX:]
    cut = np.quantile(t, 2 / 3); tr, te = t < cut, t >= cut
    res = {'filas': int(len(A)), 'prueba': int(te.sum()), 'base_obj1': round(float(Y[te].mean() * 100), 1), 'base_pct': round(float(P[te].mean()), 2)}
    for nm, X in (('precio', Xb), ('precio_y_futuros', np.hstack([Xb, Xn])), ('solo_futuros', Xn)):
        m = gbc().fit(X[tr], Y[tr]); p = m.predict_proba(X[te])[:, 1]; top = p >= np.quantile(p, .9)
        res[nm] = {'auc': round(float(roc_auc_score(Y[te], p)), 3), 'top10_obj1': round(float(Y[te][top].mean() * 100), 1), 'top10_pct': round(float(P[te][top].mean()), 2)}
        if nm == 'precio_y_futuros':
            base = roc_auc_score(Y[te], p); imp = []
            rng = np.random.default_rng(7)
            for j in range(X.shape[1]):
                Z = X[te].copy(); Z[:, j] = rng.permutation(Z[:, j]); imp.append(base - roc_auc_score(Y[te], m.predict_proba(Z)[:, 1]))
            names = list(ENF) + XN
            res[nm]['importa'] = [[names[j], round(float(imp[j]), 4)] for j in np.argsort(imp)[::-1][:10]]
    OUT[fam] = res
    print(fam, json.dumps(res, ensure_ascii=False))
json.dump(OUT, open('ia-experimento.json', 'w'), ensure_ascii=False, indent=1)
