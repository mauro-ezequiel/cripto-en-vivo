/* Sube un archivo a la rama "datos" (la página y el bot lo leen de ahí). Uso: node herramientas/publicar.js ia.json "mensaje" */
const fs = require('fs');
(async () => { const [file, msg] = process.argv.slice(2), tok = process.env.GH_TOKEN, repo = process.env.GITHUB_REPOSITORY;
  if (!tok || !repo || !fs.existsSync(file)) { console.log('nada para publicar'); return; }
  const H = { Authorization: 'Bearer ' + tok, Accept: 'application/vnd.github+json', 'User-Agent': 'cripto-live' }, api = 'https://api.github.com/repos/' + repo, body = fs.readFileSync(file);
  for (let k = 0; k < 3; k++) { const g = await fetch(api + '/contents/' + file + '?ref=datos', { headers: H }), sha = g.ok ? (await g.json()).sha : null;
    const p = await fetch(api + '/contents/' + file, { method: 'PUT', headers: H, body: JSON.stringify(Object.assign({ message: msg || file, content: body.toString('base64'), branch: 'datos' }, sha ? { sha } : {})) });
    if (p.ok) { console.log('publicado', file, body.length, 'bytes'); return; } console.log('publicar:', p.status, (await p.text()).slice(0, 200)); await new Promise(r => setTimeout(r, 3000)); }
  process.exitCode = 1; })();
