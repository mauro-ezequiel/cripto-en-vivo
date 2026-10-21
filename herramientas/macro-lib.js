/* CALENDARIO MACRO de EE.UU. (octubre 2026): reuniones de la Fed (decisión 14:00 hora de Nueva York) y datos de inflación (CPI) y de
   empleo (Employment Situation) a las 8:30 de Nueva York. Fechas oficiales: federalreserve.gov (calendario del FOMC) y bls.gov
   (calendario 2026 y fechas cambiadas por el cierre del gobierno de 2025: el CPI y el empleo de octubre 2025 se cancelaron).
   Cada evento: [ms UTC, tipo]. Sirve para la simulación, los bots y la página. */
(function (root) {
  const H = 36e5;
  /* horario de verano de Nueva York: 9/3/2025–2/11/2025 y 8/3/2026–1/11/2026 (UTC−4); el resto UTC−5 */
  const DST = [['2025-03-09', '2025-11-02'], ['2026-03-08', '2026-11-01'], ['2027-03-14', '2027-11-07']].map(([a, b]) => [Date.parse(a + 'T07:00:00Z'), Date.parse(b + 'T06:00:00Z')]);
  const ny = (d, h, m) => { const t0 = Date.parse(d + 'T00:00:00Z') + (h * 60 + m) * 6e4, off = DST.some(([a, b]) => t0 + 5 * H >= a && t0 + 5 * H < b) ? 4 : 5; return t0 + off * H; };
  const FOMC = ['2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10',
    '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09'];
  const CPI = ['2025-10-24', '2025-12-18', '2026-01-13', '2026-02-13', '2026-03-11', '2026-04-10', '2026-05-12', '2026-06-10', '2026-07-14', '2026-08-12',
    '2026-09-11', '2026-10-14', '2026-11-10', '2026-12-10'];
  const NFP = ['2025-11-20', '2025-12-16', '2026-01-09', '2026-02-11', '2026-03-06', '2026-04-03', '2026-05-08', '2026-06-05', '2026-07-02', '2026-08-07',
    '2026-09-04', '2026-10-02', '2026-11-06', '2026-12-04', '2027-01-08'];
  const EV = [...FOMC.map(d => [ny(d, 14, 0), 'fomc']), ...CPI.map(d => [ny(d, 8, 30), 'cpi']), ...NFP.map(d => [ny(d, 8, 30), 'empleo'])].sort((a, b) => a[0] - b[0]);
  const NOMBRE = { fomc: 'decisión de tasas de la Fed', cpi: 'dato de inflación (CPI) de EE.UU.', empleo: 'dato de empleo de EE.UU.' };
  /* ¿t cae dentro de la ventana de algún evento? antes / despues en horas; tipos: lista o null = todos. Devuelve el evento o null */
  function bloquea(t, antes, despues, tipos) { for (const e of EV) { if (tipos && !tipos.includes(e[1])) continue; if (t >= e[0] - antes * H && t <= e[0] + despues * H) return e; } return null; }
  const proximo = (t, tipos) => EV.find(e => e[0] >= t && (!tipos || tipos.includes(e[1]))) || null;
  const MACRO = { EV, NOMBRE, bloquea, proximo, desde: EV[0][0], hasta: EV[EV.length - 1][0] };
  if (typeof module !== 'undefined' && module.exports) module.exports = MACRO; else root.MACRO = MACRO;
})(typeof window !== 'undefined' ? window : globalThis);
