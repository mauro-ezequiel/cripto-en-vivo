/* DATOS CIFRADOS (noviembre 2026). El repositorio es público (así los bots corren gratis), pero los datos que se pagan
   (señales, bitácora, historial, IA, planillas) se suben cifrados con AES-256-GCM. La clave:
   - en GitHub: secreto DATOS_KEY (lo usan los bots para cifrar y leer);
   - en Firebase: privado/datos (solo lo pueden leer las cuentas con suscripción activa y el dueño; lo crea el dueño en el panel 👑).
   Sin DATOS_KEY todo sigue igual que antes (sin cifrar). Leer acepta las dos formas, así el cambio no corta nada.
   Uso por consola (para los pasos de los workflows que bajan archivos con curl): node herramientas/cifra.js dec a.json b.json … */
const crypto = require('crypto'), zlib = require('zlib'), path = require('path'), fs = require('fs');
const RAW = (process.env.DATOS_KEY || '').trim();
const KEY = RAW ? Buffer.from(RAW, 'base64') : null;
const OK = !!(KEY && KEY.length === 32);
if (RAW && !OK) console.log('DATOS_KEY inválida (tiene que ser 32 bytes en base64): los datos se suben SIN cifrar');
const CIFRAR = new Set(['senales.json', 'bitacora.json', 'historial.json', 'ia.json', 'ia-ops.json', 'versiones.json', 'acciones.json', 'capitulacion.json', 'rsi.json']);
const huella = () => OK ? crypto.createHash('sha256').update(KEY).digest('hex').slice(0, 8) : null;
function enc(file, text) {
  if (!OK || !CIFRAR.has(path.basename(String(file)))) return text;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv), z = zlib.gzipSync(Buffer.from(String(text)));
  const d = Buffer.concat([c.update(z), c.final(), c.getAuthTag()]);
  return JSON.stringify({ cl_enc: 1, z: 1, h: huella(), iv: iv.toString('base64'), d: d.toString('base64') });
}
function dec(text) {
  const s = Buffer.isBuffer(text) ? text.toString('utf8') : String(text);
  if (s.indexOf('"cl_enc"') < 0 || s.length > 0 && s.trimStart()[0] !== '{') return s;
  let j; try { j = JSON.parse(s); } catch (e) { return s; }
  if (!j || j.cl_enc !== 1) return s;
  if (!OK) throw new Error('archivo cifrado y falta DATOS_KEY');
  const iv = Buffer.from(j.iv, 'base64'), d = Buffer.from(j.d, 'base64'), tag = d.subarray(d.length - 16), ct = d.subarray(0, d.length - 16);
  const dc = crypto.createDecipheriv('aes-256-gcm', KEY, iv); dc.setAuthTag(tag); let out = Buffer.concat([dc.update(ct), dc.final()]);
  if (j.z) out = zlib.gunzipSync(out); return out.toString('utf8');
}
const decJ = text => JSON.parse(dec(text));
module.exports = { enc, dec, decJ, huella, OK, CIFRAR };
if (require.main === module) { const [cmd, ...files] = process.argv.slice(2);
  if (cmd === 'dec') for (const f of files) { try { if (!fs.existsSync(f)) continue; const t = fs.readFileSync(f, 'utf8'), o = dec(t); if (o !== t) { fs.writeFileSync(f, o); console.log('descifrado', f); } } catch (e) { console.log('no se pudo descifrar', f, e.message); } }
  else if (cmd === 'enc') for (const f of files) { try { if (!fs.existsSync(f)) continue; const t = fs.readFileSync(f, 'utf8'), o = enc(f, t); if (o !== t) { fs.writeFileSync(f, o); console.log('cifrado', f); } } catch (e) { console.log('no se pudo cifrar', f, e.message); } }
  /* binarios (ia-datos.json.gz): cabecera CLENC1 + iv (12) + datos + etiqueta (16) */
  else if (cmd === 'encbin') for (const f of files) { try { if (!OK || !fs.existsSync(f)) continue; const b = fs.readFileSync(f); if (b.subarray(0, 6).toString() === 'CLENC1') continue; const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
      fs.writeFileSync(f, Buffer.concat([Buffer.from('CLENC1'), iv, c.update(b), c.final(), c.getAuthTag()])); console.log('cifrado', f); } catch (e) { console.log('no se pudo cifrar', f, e.message); } }
  else if (cmd === 'decbin') for (const f of files) { try { if (!fs.existsSync(f)) continue; const b = fs.readFileSync(f); if (b.subarray(0, 6).toString() !== 'CLENC1') continue; if (!OK) { console.log('cifrado y falta DATOS_KEY', f); continue; }
      const iv = b.subarray(6, 18), tag = b.subarray(b.length - 16), dc = crypto.createDecipheriv('aes-256-gcm', KEY, iv); dc.setAuthTag(tag); fs.writeFileSync(f, Buffer.concat([dc.update(b.subarray(18, b.length - 16)), dc.final()])); console.log('descifrado', f); } catch (e) { console.log('no se pudo descifrar', f, e.message); } }
  else if (cmd === 'huella') console.log(huella() || 'sin clave');
  else if (cmd === 'prueba') { const t = JSON.stringify({ a: 1, b: 'ñ' }); const e = enc('senales.json', t); console.log(e.slice(0, 80)); console.log(dec(e) === t ? 'ok' : 'FALLA'); } }
