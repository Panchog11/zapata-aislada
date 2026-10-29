/* Pruebas de la planilla de zapatas aisladas. Ejecutar con:  node --test tests/
 * Los valores de referencia se calculan a mano (fórmulas cerradas) dentro de cada prueba,
 * sin usar las funciones bajo prueba.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ZC = require('../js/zapata-calc.js');
const ZD = require('../js/zapata-design.js');
const ZX = require('../js/zapata-dxf.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} esperado ${b}, obtenido ${a} (tol ${tol})`);
const rel = (a, b, r, msg) => near(a, b, Math.abs(b) * r, msg);

test('Presiones: contacto total, flexión biaxial (P/A ± 6M/(b·h²))', () => {
  const s = ZC.solvePressure(1000, 50, 100, 2, 3);
  assert.equal(s.full, true);
  // σ = 1000/6 ± 6·100/(3·2²) ± 6·50/(2·3²) = 166,67 ± 50 ± 16,67
  near(s.sMax, 233.333, 1e-3); near(s.sMin, 100, 1e-3); assert.equal(s.contact, 1);
});

test('Presiones: despegue uniaxial = solución triangular analítica', () => {
  const s = ZC.solvePressure(1000, 0, 600, 2.6, 2.6);
  assert.equal(s.full, false);
  // e = 0,6 > B/6;  σmax = 2P / (3·L·(B/2 − e)) = 2000/(3·2,6·0,7) = 366,30 kPa;  contacto = 3(B/2 − e)/B = 0,8077
  rel(s.sMax, 366.30, 0.003, 'σmax'); rel(s.contact, 0.8077, 0.01, 'área');
});

test('Presiones: despegue biaxial cumple equilibrio de N, Mx y My', () => {
  const B = 2.6, L = 2.0, s = ZC.solvePressure(900, 250, 380, B, L);
  const n = 500, dx = B / n, dy = L / n; let F = 0, Mx = 0, My = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const x = -B / 2 + (i + .5) * dx, y = -L / 2 + (j + .5) * dy, v = s.sig(x, y) * dx * dy; F += v; Mx += v * y; My += v * x; }
  rel(F, 900, 0.005, 'N'); rel(Mx, 250, 0.01, 'Mx'); rel(My, 380, 0.01, 'My');
});

test('Presiones: resultante fuera de la base se informa como falla', () => {
  const s = ZC.solvePressure(100, 0, 200, 2, 2);
  assert.ok(s.fail && /fuera/.test(s.fail));
  assert.ok(ZC.solvePressure(-10, 0, 0, 2, 2).fail);
});

test('Flexión: armadura necesaria por fórmula cerrada (φ = 0,9)', () => {
  // Mu = 100 kN·m/m, d = 500 mm: Rn = 100e6/(0,9·1000·500²) = 0,4444 MPa
  // ρ = 0,85·25/420·(1 − √(1 − 2·0,4444/(0,85·25))) = 0,0010695  →  As = 534,7 mm²/m
  const r = ZC.asRequired(100, 0.5, 25, 420);
  near(r.AsReq, 534.7, 1.0);
  // φMn de φ12 c/10 con d = 544 mm: a = 1131·420/(0,85·25·1000) = 22,35 mm; φMn = 0,9·1131·420·(544 − 11,18) = 227,8 kN·m/m
  const fa = ZC.flexAt(ZC.abar(12) / 0.1, 544, 25, 420);
  near(fa.a, 22.35, 0.02); near(fa.phiMn, 227.8, 0.1); assert.equal(fa.phi, 0.9);
});

test('Flexión: límite εt ≥ 0,004 y mínimo ρ = 0,0018', () => {
  const r = ZC.asRequired(5000, 0.3, 25, 420);
  assert.equal(r.AsReq, Infinity);
  const fa = ZC.flexAt(r.AsMax, 300, 25, 420); near(fa.et, 0.004, 1e-6);
  assert.equal(ZC.rhoMin(420), 0.0018); assert.equal(ZC.rhoMin(280), 0.0020);
});

test('Anclajes: ld, ldh y ldc (§12.2.2, §12.5.2, §12.3.2)', () => {
  near(ZC.ldTension(12, 25, 420, 1, true) * 1000, 480, 0.01);          // 420·12/(2,1·5)
  near(ZC.ldTension(20, 25, 420, 1, true) * 1000, 988.24, 0.01);       // 420·20/(1,7·5)
  near(ZC.ldTension(12, 25, 420, 1.3, true) * 1000, 624, 0.01);        // ψt = 1,3
  near(ZC.ldTension(8, 25, 420, 1, true) * 1000, 320, 0.01);           // 420·8/(2,1·5) = 320 ≥ 300
  near(ZC.ldHook(16, 25, 420) * 1000, 322.56, 0.01);                   // 0,24·420·16/5
  near(ZC.ldHook(8, 25, 420) * 1000, 161.28, 0.01);                    // > 150 y > 8db
  near(ZC.ldComp(16, 25, 420) * 1000, 322.56, 0.01);                   // máx(0,24·fy·db/√f'c; 0,043·fy·db = 289)
  near(ZC.ldComp(8, 25, 420) * 1000, 200, 0.01);                       // mínimo 200 mm
});

test('Punzonado interior: Vu, bo, γv y Jc según fórmulas del ACI 318-05 / CIRSOC 201-2005', () => {
  const I = Object.assign(ZC.defaults(), { B: 2.6, L: 2.6, cx: 0.4, cy: 0.4, ex0: 0, ey0: 0 });
  const G = ZC.coords(2.6, 2.6, 260), q = 1120 / 6.76, Q = new Float64Array(G.N).fill(q);
  const p = ZC.punching(I, G, Q, 1120, 0, 0, 0.5);
  // Vu = 1120·(1 − 0,9²/6,76) = 985,8 kN; bo = 3,6 m; vu = 985,8/(3,6·0,5) = 547,7 kPa
  rel(p.Vu, 985.8, 0.003); near(p.bo, 3.6, 1e-9); rel(p.vu, 0.5477, 0.004);
  near(p.gvx, 0.4, 1e-9); near(p.gvy, 0.4, 1e-9); assert.equal(p.alphaS, 40);
  // Jc = d·b1³/6 + b1·d³/6 + d·b2·b1²/2 = 0,06075 + 0,01875 + 0,18225 = 0,26175 m⁴
  near(p.Jy, 0.26175, 1e-9); near(p.Jx, 0.26175, 1e-9);
});

test('Punzonado de borde: perímetro de 3 lados y αs = 30', () => {
  const I = Object.assign(ZC.defaults(), { B: 2.0, L: 2.0, cx: 0.4, cy: 0.4, ex0: 0.75, ey0: 0 });
  const G = ZC.coords(2, 2, 100), Q = new Float64Array(G.N).fill(100);
  const p = ZC.punching(I, G, Q, 500, 0, 0, 0.4);
  assert.equal(p.ns, 3); assert.equal(p.alphaS, 30);
  // x: 0,35 a 1,15 recortado en el borde 1,0; y: −0,4 a 0,4 → lado izquierdo 0,8 + dos lados de 0,65 = 2,1 m
  near(p.bo, 2.1, 1e-9);
});

test('Fuste: φPn,máx = 0,65·0,80·[0,85·f\'c·(Ag − As) + fy·As]', () => {
  const I = Object.assign(ZC.defaults(), { cx: 0.4, cy: 0.4, recCol: 40, dbe: 8 });
  const sec = ZC.colSection(I, 16, 3, 3, 8);
  const As = 8 * ZC.abar(16), ref = 0.52 * (0.85 * 25 * (160000 - As) + 420 * As) / 1000;
  const c = ZC.colCapacity(sec, 25, 420, 1000, 0, 0);
  rel(c.phiPnMax, ref, 1e-9);
  near(ZC.colCapacity(sec, 25, 420, ref, 0, 0).u, 1, 1e-9);
});

test('Fuste: flexión pura por compatibilidad = cálculo manual (≈ 76,5 kN·m)', () => {
  // 6 φ16 (3 por cara), 40×40, d' = 56 mm, d = 344 mm. Equilibrio: 7225·c + 603·600·(c − 56)/c = 603·420 → c = 45,97 mm
  // Mn = 332,1 kN·0,1805 − 78,9·0,144 + 253,3·0,144 = 85,0 kN·m; εt = 0,0195 → φ = 0,9 → φMn = 76,5 kN·m
  const I = Object.assign(ZC.defaults(), { cx: 0.4, cy: 0.4, recCol: 40, dbe: 8 });
  const sec = ZC.colSection(I, 16, 3, 2, 8);
  const c = ZC.colCapacity(sec, 25, 420, 0, 50, 0);
  rel(c.rM, 76.5, 0.03, 'φMn');
});

test('Análisis completo del ejemplo: todas las verificaciones con referencia y estado', () => {
  const R = ZC.analyze(ZC.defaults());
  assert.equal(R.err, null);
  assert.ok(R.checks.length > 35);
  R.checks.forEach(c => { assert.ok(c.ref, `${c.n} sin referencia`); assert.ok(['ok', 'bad', 'warn', 'na', 'nv'].includes(c.st)); });
  assert.equal(R.checks.filter(c => c.st === 'bad').length, 0, R.checks.filter(c => c.st === 'bad').map(c => c.n).join(', '));
});

test('Sensibilidad: los resultados cambian en el sentido correcto', () => {
  const base = ZC.defaults(), get = (I, k) => ZC.analyze(I).checks.find(c => c.key === k);
  const sm0 = get(base, 'smax').d;
  const I1 = ZC.defaults(); I1.combos[0].N = 1000; assert.ok(get(I1, 'smax').d > sm0, 'más N → más σ');
  const I2 = ZC.defaults(); I2.B = 3.0; I2.L = 3.0; assert.ok(get(I2, 'smax').d < sm0, 'más área → menos σ');
  const I3 = ZC.defaults(); I3.H = 0.8; assert.ok(get(I3, 'punz').u < get(base, 'punz').u, 'más H → menos punzonado');
  const I4 = ZC.defaults(); I4.sx = 20; assert.ok(get(I4, 'flexx').u > get(base, 'flexx').u, 'menos acero → más utilización');
});

test('Armadura superior: se exige sólo cuando el momento negativo lo requiere', () => {
  const I = ZC.defaults();
  let R = ZC.analyze(I);
  assert.equal(R.checks.find(c => c.key === 'supreqx').st, 'ok'); // sin despegue no hay tracción superior
  // Fuerte despegue: el peso del voladizo descargado tracciona la cara superior
  Object.assign(I, { critSup: 'siempre', B: 3.4, L: 2.4, H: 0.7, Df: 2.2, gs: 20 });
  I.combos[1] = Object.assign(I.combos[1], { N: 300, My: 420, Mx: 0, Vx: 0, Vy: 0, gD: 1.2 });
  R = ZC.analyze(I);
  const req = R.checks.find(c => c.key === 'supreqx');
  assert.ok(R.dem.x.mun > 0, 'existe Mu−');
  assert.equal(req.st, 'bad', 'sin armadura superior debe fallar');
  I.supX = true; I.dbxs = 12; I.sxs = 10;
  R = ZC.analyze(I);
  assert.equal(R.checks.find(c => c.key === 'supreqx').st, 'ok');
  assert.ok(R.checks.find(c => c.key === 'flexsx'), 'se verifica la flexión superior');
});

test('Validación: datos faltantes o incompatibles se informan', () => {
  assert.ok(ZC.analyze(Object.assign(ZC.defaults(), { B: 0 })).err);
  assert.ok(ZC.analyze(Object.assign(ZC.defaults(), { ex0: 2 })).err.some(e => /fuera/.test(e)));
  assert.ok(ZC.analyze(Object.assign(ZC.defaults(), { H: 0.05 })).err);
  assert.ok(ZC.analyze(Object.assign(ZC.defaults(), { combos: [ZC.defaults().combos[0]] })).err.some(e => /última/.test(e)));
});

test('Compatibilidad: datos de la versión anterior se migran a combinaciones', () => {
  const I = ZC.normalize({ B: 2, L: 2, N: 500, Vx: 1, Vy: 2, Mx: 3, My: 4, Mz: 5, Nu: 700, Vxu: 1, Vyu: 2, Mxu: 3, Myu: 4, Mzu: 5 });
  assert.equal(I.combos.length, 2); assert.equal(I.combos[0].N, 500); assert.equal(I.combos[1].tipo, 'ult'); assert.equal(I.combos[1].N, 700);
});

test('Geometría de armaduras coherente con el cálculo', () => {
  const I = ZC.defaults(), R = ZC.analyze(I), P1 = R.layout.groups.find(g => g.id === 'P1');
  // separación real = adoptada; barras dentro del recubrimiento
  near(P1.pos[1] - P1.pos[0], I.sx / 100, 1e-9);
  P1.pos.forEach(p => assert.ok(Math.abs(p) + I.dbx / 2000 <= I.L / 2 - I.rec / 1000 + 1e-9));
  near(P1.straight, I.B - 2 * I.rec / 1000, 1e-9);
  const P5 = R.layout.groups.find(g => g.id === 'P5');
  assert.equal(P5.n, 2 * I.nbx + 2 * I.nby - 4);
  near(P1.bars[0][0][2], -I.Df + I.rec / 1000 + I.dbx / 2000, 1e-9, 'z de la capa inferior');
});

test('Dimensionamiento automático: la solución propuesta verifica todo', async () => {
  const I = ZC.defaults(); I.forma = 'cuadrada';
  const r = await ZD.autoDesign(I);
  assert.ok(r.best, 'debe encontrar solución');
  const R = ZC.analyze(r.best.I);
  assert.equal(R.checks.filter(c => c.st === 'bad').length, 0);
  // mínima: una planta 5 cm menor no verifica suelo/estabilidad
  const J = Object.assign({}, r.best.I, { B: r.best.B - I.paso, L: r.best.L - I.paso });
  assert.equal(ZD.serviceOK(J), false);
});

test('Dimensionamiento automático: informa cuando no hay solución', async () => {
  const I = ZC.defaults(); Object.assign(I, { sadm: 30, Lmax: 2.0, Hmax: 0.6 });
  const r = await ZD.autoDesign(I);
  assert.equal(r.alts.length, 0); assert.equal(r.best, null); assert.ok(r.diag.length > 0);
});

test('DXF R12: estructura válida, capas declaradas y texto en ANSI-1252', () => {
  const I = ZC.defaults(); I.supX = true; I.supY = true;
  const R = ZC.analyze(I), D = ZX.buildDrawing(R.I, R, { sheet: 'A2', date: '27/10/2026' });
  const s = ZX.toDXF(D), lines = s.split('\r\n'); lines.pop();
  assert.equal(lines.length % 2, 0, 'pares código/valor');
  const pairs = []; for (let i = 0; i < lines.length; i += 2) pairs.push([+lines[i].trim(), lines[i + 1]]);
  assert.ok(pairs.every(([c]) => Number.isInteger(c)), 'códigos enteros');
  assert.equal(pairs[pairs.length - 1][1], 'EOF');
  const secs = pairs.filter(([c, v]) => c === 0 && (v === 'SECTION' || v === 'ENDSEC')).map(p => p[1]);
  assert.deepEqual(secs, ['SECTION', 'ENDSEC', 'SECTION', 'ENDSEC', 'SECTION', 'ENDSEC', 'SECTION', 'ENDSEC']);
  const declared = new Set(), used = new Set();
  for (let i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === 0 && pairs[i][1] === 'LAYER' && pairs[i + 1][0] === 2) declared.add(pairs[i + 1][1]);
    if (pairs[i][0] === 8) used.add(pairs[i][1]);
  }
  used.forEach(l => assert.ok(declared.has(l), `capa ${l} no declarada`));
  ['HORMIGON', 'ARM_INF', 'ARM_SUP', 'ARM_FUSTE', 'ESTRIBOS', 'COTAS', 'EJES', 'TEXTOS'].forEach(l => assert.ok(used.has(l), `falta capa ${l}`));
  pairs.filter(([c]) => c >= 10 && c < 60).forEach(([, v]) => assert.ok(isFinite(+v), `número inválido ${v}`));
  const b = ZX.toBytes(s); assert.ok(b.every(x => x < 256));
  assert.ok(/%%c12/.test(s), 'diámetro como %%c');
  // las barras inferiores dibujadas en planta coinciden con el cálculo
  const nInf = pairs.filter(([c, v], i) => c === 0 && v === 'LINE' && pairs[i + 1][1] === 'ARM_INF').length;
  const P1 = R.layout.groups.find(g => g.id === 'P1'), P2 = R.layout.groups.find(g => g.id === 'P2');
  assert.equal(nInf, P1.n + P2.n);
  assert.equal(D.fits, true);
});

test('ZIP: CRC-32 estándar y estructura', () => {
  assert.equal(ZX.crc32(ZX.toBytes('123456789')), 0xCBF43926);
  const z = ZX.zip([{ name: 'a.txt', data: ZX.toBytes('hola') }]);
  assert.equal(z[0], 0x50); assert.equal(z[1], 0x4b); assert.equal(z[2], 3); assert.equal(z[3], 4);
});

const ZR = require('../js/zapata-report.js');
test('Memoria: incluye todas las verificaciones con fórmula, criterio y referencia', () => {
  const I = ZC.defaults(); I.supX = true;
  const R = ZC.analyze(I), doc = ZR.build(R, { date: '28/10/2026' });
  const h3 = doc.blocks.filter(b => b.t === 'h3').map(b => b.text);
  R.checks.forEach(c => assert.ok(h3.some(t => t.startsWith(c.n)), `falta ${c.n}`));
  const html = ZR.toHTML(doc);
  assert.ok(html.includes('Resumen de verificaciones') && html.includes('Referencia'));
  assert.equal(doc.meta.nb, 0);
});

test('Memoria Word: paquete .docx con partes, títulos y figuras', () => {
  const I = ZC.defaults(), R = ZC.analyze(I), doc = ZR.build(R, { date: '28/10/2026' });
  const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  const P = ZR.docxParts(doc, { 'CORTE A-A (dirección x)': { bytes: png, wmm: 100, hmm: 80 } });
  ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/footer1.xml', 'word/_rels/document.xml.rels'].forEach(k => assert.ok(P.xml[k], k));
  const docx = P.xml['word/document.xml'];
  assert.equal((docx.match(/w:val="Heading1"/g) || []).length, doc.blocks.filter(b => b.t === 'h1').length);
  assert.equal(P.media.length, 1); assert.ok(P.xml['word/_rels/document.xml.rels'].includes('media/figura1.png'));
  assert.ok(!/[<&](?![a-zA-Z/?!#])/.test(docx.replace(/<!\[CDATA\[.*?\]\]>/g, '')), 'caracteres sin escapar');
  assert.ok(docx.includes('√f') && docx.includes('φ'), 'símbolos Unicode conservados');
  const z = ZR.toDocx(doc, {}); assert.equal(z[0], 0x50); assert.equal(z[1], 0x4b);
});
